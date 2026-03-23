import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const repoRoot = process.cwd();
const blackboxRoot = path.join(repoRoot, '.tmp', 'blackbox-acceptance');
const appDataRoot = path.join(blackboxRoot, 'app-data');
const artifactsRoot = path.join(blackboxRoot, 'artifacts');
const playwrightBrowsersRoot = path.join(repoRoot, '.tmp', 'playwright-browsers');
const htmlReportRoot = path.join(artifactsRoot, 'html-report');
const aiInspectorScenarios = [
  {
    id: 'A1',
    title: 'AI inspector A1 first-use flow passes the blackbox gate',
  },
  {
    id: 'A2',
    title: 'AI inspector A2 web first-use flow auto-starts preview',
  },
  {
    id: 'A3',
    title: 'AI inspector A3 ambiguous first-use flow surfaces intent clarify cards',
  },
  {
    id: 'B2',
    title: 'AI inspector B2 chat advance flow writes directly into the live draft',
  },
  {
    id: 'B3',
    title: 'AI inspector B3 version save flow reaches history and compare cleanly',
  },
  {
    id: 'B4',
    title: 'AI inspector B4 branch continue and switch flow keeps the current branch clear',
  },
];

async function main() {
  await prepareRoots();
  for (const scenario of aiInspectorScenarios) {
    await resetAppDataRoot();
    await runStep(`bootstrap:${scenario.id}`, [
      'node',
      'scripts/bootstrap-local-db.mjs',
      '--app-data-root',
      appDataRoot,
    ]);
    await runStep(`ai-inspector:${scenario.id}`, [
      'npx',
      'playwright',
      'test',
      '--config=playwright.ai-inspector.config.ts',
      '--grep',
      scenario.title,
    ], {
      BLACKBOX_ACCEPTANCE_ROOT: blackboxRoot,
      BLACKBOX_ARTIFACTS_ROOT: artifactsRoot,
      DAO_APP_DATA_ROOT: appDataRoot,
      DAO_E2E: '1',
      DATABASE_URL: `file:${path.join(appDataRoot, 'dev.db')}`,
      HOSTNAME: '127.0.0.1',
      PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersRoot,
      PLAYWRIGHT_HTML_REPORT: path.join(htmlReportRoot, scenario.id.toLowerCase()),
      PORT: '3216',
    });
  }
}

async function prepareRoots() {
  await fs.rm(blackboxRoot, { force: true, recursive: true });
  await fs.mkdir(appDataRoot, { recursive: true });
  await fs.mkdir(artifactsRoot, { recursive: true });
}

async function resetAppDataRoot() {
  await fs.rm(appDataRoot, { force: true, recursive: true });
  await fs.mkdir(appDataRoot, { recursive: true });
}

function runStep(label, command, extraEnv = {}) {
  process.stdout.write(`\n[test:ai-inspector] ${label}\n`);
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
