import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import { safeJsonParse } from '@/framework/resilience/safe-data';

const run = promisify(execFile);

test('built host reports a structured configuration error when started directly', async () => {
  const entry = path.resolve(
    process.cwd(),
    '.vite/room-session-host/index.mjs'
  );
  const result = await runNode(entry, {
    ...process.env,
    DAO_ROOM_SESSION_HOST_CONFIG_PATH: undefined,
  });
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe('');
  expect(safeJsonParse<Record<string, unknown>>(result.stderr.trim(), {})).toMatchObject({
    schemaVersion: 1,
    type: 'error',
    code: 'missing-config-path',
  });
});

test('built host starts from valid config and stops cleanly on SIGTERM', async () => {
  const entry = path.resolve(
    process.cwd(),
    '.vite/room-session-host/index.mjs'
  );
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'tobe-room-host-smoke-')
  );
  const databasePath = path.join(temporaryRoot, 'dev.db');
  const configPath = path.join(temporaryRoot, 'room-host.json');
  const environment = {
    ...process.env,
    DAO_APP_DATA_ROOT: temporaryRoot,
    DATABASE_URL: `file:${databasePath}`,
    DAO_ROOM_SESSION_HOST_CONFIG_PATH: configPath,
  };

  try {
    await run(
      process.execPath,
      ['scripts/bootstrap-local-db.mjs', '--app-data-root', temporaryRoot],
      { cwd: process.cwd(), env: environment }
    );
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        organizationId: 'local-org',
        workerId: 'room-host-smoke',
        pollIntervalMs: 20,
        heartbeatIntervalMs: 1_000,
        leaseDurationMs: 3_000,
        shutdownGraceMs: 2_000,
        maxConcurrentSessions: 1,
        maxDeliveryAttempts: 3,
        retryBaseDelayMs: 25,
        retryMaxDelayMs: 250,
        runtimes: [
          {
            driver: 'stub',
            runtimeId: 'stub-runtime',
            runtimeVersion: '1.0.0',
            responseText: 'smoke response',
          },
        ],
      }),
      'utf8'
    );

    const result = await runNodeUntilReadyThenTerminate(entry, environment);
    expect(result.exitCode).toBe(0);
    expect(result.sawReady).toBe(true);
    expect(parseStructuredLines(result.stdout)).toEqual([
      expect.objectContaining({
        schemaVersion: 1,
        type: 'ready',
        organizationId: 'local-org',
        workerId: 'room-host-smoke',
        runtimeIds: ['stub-runtime'],
      }),
      expect.objectContaining({
        schemaVersion: 1,
        type: 'stopped',
        reason: 'SIGTERM',
        workerId: 'room-host-smoke',
      }),
    ]);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test('built host is a Node-only artifact', async () => {
  const root = path.resolve(process.cwd(), '.vite/room-session-host');
  const files = await listFiles(root);
  const source = (
    await Promise.all(
      files
        .filter((file) => file.endsWith('.mjs'))
        .map((file) => readFile(path.join(root, file), 'utf8'))
    )
  ).join('\n');

  expect(files).not.toEqual(
    expect.arrayContaining(['file.svg', 'globe.svg', 'next.svg', 'vercel.svg'])
  );
  expect(source).not.toContain('__vitePreload');
  expect(source).not.toContain('jsx-runtime');
  expect(source).not.toMatch(/(?:from|import\()\s*["'](?:react|next)(?:[\/"'])/);
  expect(source).not.toMatch(/\bdocument\.(?:createElement|querySelector)/);
  expect(source).not.toMatch(/\bwindow\.(?:dispatchEvent|addEventListener)/);
});

function runNode(
  entry: string,
  environment: NodeJS.ProcessEnv
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      cwd: process.cwd(),
      env: environment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function runNodeUntilReadyThenTerminate(
  entry: string,
  environment: NodeJS.ProcessEnv
): Promise<{
  exitCode: number | null;
  sawReady: boolean;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      cwd: process.cwd(),
      env: environment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let sawReady = false;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Timed out waiting for the Room Host smoke process.'));
    }, 10_000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (
        !sawReady &&
        parseStructuredLines(stdout).some((event) => event.type === 'ready')
      ) {
        sawReady = true;
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, sawReady, stdout, stderr });
    });
  });
}

function parseStructuredLines(text: string): Array<Record<string, unknown>> {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => safeJsonParse<Record<string, unknown> | null>(line, null))
    .filter((value): value is Record<string, unknown> => value !== null);
}

async function listFiles(root: string, relative = ''): Promise<string[]> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, next)));
    else files.push(next);
  }
  return files.sort();
}
