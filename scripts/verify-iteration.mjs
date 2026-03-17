import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const repoRoot = process.cwd();
const iterationRoot = path.join(repoRoot, '.tmp', 'iteration-regression');
const appDataRoot = path.join(iterationRoot, 'app-data');
const artifactsRoot = path.join(iterationRoot, 'artifacts');
const htmlReportRoot = path.join(artifactsRoot, 'html-report');
const projectsRoot = path.join(iterationRoot, 'projects');
const playwrightBrowsersRoot = path.join(repoRoot, '.tmp', 'playwright-browsers');
const seedStatePath = path.join(iterationRoot, 'seed-state.json');

async function main() {
  await prepareRoots();
  await runStep('static', ['node', 'scripts/verify-iteration-static.mjs']);
  await runStep('bootstrap', [
    'node',
    'scripts/bootstrap-local-db.mjs',
    '--app-data-root',
    appDataRoot,
  ]);
  await runStep('e2e', ['npx', 'playwright', 'test', '--config=playwright.config.ts'], {
    DAO_APP_DATA_ROOT: appDataRoot,
    DAO_E2E: '1',
    DATABASE_URL: `file:${path.join(appDataRoot, 'dev.db')}`,
    HOSTNAME: '127.0.0.1',
    ITERATION_ARTIFACTS_ROOT: artifactsRoot,
    ITERATION_ROOT: iterationRoot,
    ITERATION_PROJECTS_ROOT: projectsRoot,
    ITERATION_SEED_STATE_PATH: seedStatePath,
    PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersRoot,
    PLAYWRIGHT_HTML_REPORT: htmlReportRoot,
    PORT: '3216',
  });
}

async function prepareRoots() {
  await fs.rm(iterationRoot, { force: true, recursive: true });
  await fs.mkdir(appDataRoot, { recursive: true });
  await fs.mkdir(artifactsRoot, { recursive: true });
  await fs.mkdir(projectsRoot, { recursive: true });
}

function runStep(label, command, extraEnv = {}) {
  process.stdout.write(`\n[verify:iteration] ${label}\n`);
  return runCommand(command, extraEnv);
}

function runCommand(command, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Command failed with exit code ${code ?? 'unknown'}: ${command.join(' ')}`
        )
      );
    });
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
