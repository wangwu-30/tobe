import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');

export function parseMissingSharedLibraries(lddOutput) {
  const missing = new Set();
  for (const line of lddOutput.split(/\r?\n/u)) {
    const match = line.match(/^\s*(\S+)\s+=>\s+not found\s*$/u);
    if (match) missing.add(match[1]);
  }
  return [...missing].sort(compareText);
}

export function formatMissingSharedLibraries(executablePath, libraries) {
  return [
    '[test:browser:preflight] Chromium cannot start because host shared libraries are missing:',
    ...libraries.map((library) => `  - ${library}`),
    `Browser executable: ${executablePath}`,
    'Install the missing host packages, then rerun the gate.',
  ].join('\n');
}

export async function checkBrowserPreflight(options = {}) {
  const platform = options.platform || process.platform;
  const resolveExecutable =
    options.resolveExecutable || resolveChromiumHeadlessShell;
  const checkExecutable = options.checkExecutable || assertExecutable;
  const runLdd = options.runLdd || runLddCommand;
  const executablePath = await resolveExecutable();
  try {
    await checkExecutable(executablePath);
  } catch (error) {
    throw new Error(
      `[test:browser:preflight] Chromium executable is unavailable: ${executablePath}\n` +
        'Run the repository browser install command, then rerun the gate.',
      { cause: error }
    );
  }

  if (platform !== 'linux') {
    process.stdout.write(
      `[test:browser:preflight] ready: ${executablePath} (shared-library check is Linux-only)\n`
    );
    return { executablePath, missingLibraries: [] };
  }

  const { exitCode, stderr, stdout } = await runLdd(executablePath);
  const missingLibraries = parseMissingSharedLibraries(`${stdout}\n${stderr}`);
  if (missingLibraries.length > 0) {
    throw new Error(
      formatMissingSharedLibraries(executablePath, missingLibraries)
    );
  }
  if (exitCode !== 0) {
    throw new Error(
      `[test:browser:preflight] ldd failed with exit code ${exitCode} for ${executablePath}:\n${
        stderr || stdout || 'No diagnostic output.'
      }`
    );
  }

  process.stdout.write(
    `[test:browser:preflight] ready: ${executablePath}; all linked shared libraries resolved\n`
  );
  return { executablePath, missingLibraries };
}

function assertExecutable(executablePath) {
  return fs.access(executablePath, constants.X_OK);
}

async function resolveChromiumHeadlessShell() {
  // Playwright's default headless launch uses chromium-headless-shell, which is
  // a different binary from chromium.executablePath(). Inspect the executable
  // that the browser phase will actually start.
  const { createRequire } = await import('node:module');
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(
    repoRoot,
    '.tmp',
    'playwright-browsers'
  );
  const require = createRequire(import.meta.url);
  const { registry } = require('playwright-core/lib/server');
  const executable = registry.findExecutable('chromium-headless-shell');
  const executablePath = executable?.executablePath();
  if (!executablePath) {
    throw new Error(
      '[test:browser:preflight] Could not resolve the Chromium headless-shell executable.'
    );
  }
  return executablePath;
}

function runLddCommand(executablePath) {
  return new Promise((resolve, reject) => {
    const child = spawn('ldd', [executablePath], {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      resolve({ exitCode: code, stderr, stdout });
    });
  });
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  checkBrowserPreflight().catch((error) => {
    console.error(errorMessage(error));
    process.exit(1);
  });
}
