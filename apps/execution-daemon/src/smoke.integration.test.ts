import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

test('built daemon reports a structured configuration error without loading web modules', async () => {
  const entry = path.resolve(
    process.cwd(),
    '.vite/execution-daemon/index.mjs'
  );
  const result = await runNode(entry, {
    ...process.env,
    DAO_EXECUTION_DAEMON_CONFIG_PATH: undefined,
  });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe('');
  expect(JSON.parse(result.stderr.trim())).toMatchObject({
    schemaVersion: 1,
    type: 'error',
    code: 'missing-config-path',
  });
  expect(result.stderr).not.toContain('__dirname');
  expect(result.stderr).not.toContain('exports is not defined');
});

test('built daemon is a Node-only artifact without browser preload code or public assets', async () => {
  const outputRoot = path.resolve(process.cwd(), '.vite/execution-daemon');
  const files = await listFiles(outputRoot);
  const modules = files.filter((file) => file.endsWith('.mjs'));
  const source = (
    await Promise.all(
      modules.map((file) => readFile(path.join(outputRoot, file), 'utf8'))
    )
  ).join('\n');

  expect(files).not.toEqual(
    expect.arrayContaining([
      'file.svg',
      'globe.svg',
      'next.svg',
      'vercel.svg',
      'window.svg',
    ])
  );
  expect(source).not.toContain('__vitePreload');
  expect(source).not.toContain('jsx-runtime');
  expect(source).not.toMatch(/(?:from|import\()s*["'](?:react|next)(?:[\/"'])/);
  expect(source).not.toMatch(
    /\bdocument\.(?:createElement|querySelector|getElementsByTagName)/
  );
  expect(source).not.toMatch(
    /\bwindow\.(?:dispatchEvent|addEventListener)/
  );
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
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

async function listFiles(root: string, relative = ''): Promise<string[]> {
  const entries = await readdir(path.join(root, relative), {
    withFileTypes: true,
  });
  const files: string[] = [];
  for (const entry of entries) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, next)));
    } else {
      files.push(next);
    }
  }
  return files.sort();
}
