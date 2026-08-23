import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = process.cwd();
const nextDistDir =
  process.env.NEXT_DIST_DIR?.trim() || '.next';
const typeScriptProject =
  process.env.NEXT_TSCONFIG_PATH?.trim() || 'tsconfig.json';

export const staticGateSteps = [
  {
    id: 'web-interface-guidelines',
    command: ['node', 'scripts/check-web-interface-guidelines.mjs'],
  },
  { id: 'prisma', command: ['npx', 'prisma', 'generate'] },
  { id: 'clear-next-types' },
  { id: 'typegen', command: ['npx', 'next', 'typegen'] },
  {
    id: 'build:room-backend-test',
    command: [
      'npx',
      'vite',
      'build',
      '--config',
      'vite.room-backend-test.config.mts',
    ],
  },
  {
    id: 'build:room-tool-confirmation-test',
    command: [
      'npx',
      'vite',
      'build',
      '--config',
      'vite.room-tool-confirmation-test.config.mts',
    ],
  },
  {
    id: 'tsc',
    command: ['npx', 'tsc', '--noEmit', '--project', typeScriptProject],
  },
  {
    id: 'eslint',
    command: [
      'npx',
      'eslint',
      '--rule',
      '@typescript-eslint/no-explicit-any: off',
      '--rule',
      '@typescript-eslint/no-require-imports: off',
      '--rule',
      '@typescript-eslint/no-unused-vars: off',
      '--ignore-pattern',
      'src/generated/prisma/**',
      'src/app',
      'src/agent',
      'src/components',
      'src/hooks',
      'src/lib',
      'src/objects',
      'src/types',
      'apps/execution-daemon/src',
      'apps/knowledge-merge-worker/src',
      'apps/room-session-host/src',
      'scripts',
      'tests',
      'eslint.config.mjs',
      'next.config.ts',
      'playwright.config.ts',
      'playwright.control-plane.config.ts',
      'postcss.config.mjs',
      'prisma.config.ts',
      'vite.execution-daemon.config.mts',
      'vite.knowledge-merge-worker.config.mts',
      'vite.room-session-host.config.mts',
      'vite.staged-changes-test.config.mts',
    ],
  },
];

export async function runStaticGate(options = {}) {
  const clearTypes =
    options.clearGeneratedNextTypes || clearGeneratedNextTypes;
  const run = options.runStep || runStep;

  for (const step of staticGateSteps) {
    if (!step.command) {
      await clearTypes();
      continue;
    }
    await run(step.id, step.command);
  }
}

function runStep(label, command) {
  process.stdout.write(`\n[verify:iteration:static] ${label}\n`);
  return runCommand(command);
}

async function clearGeneratedNextTypes() {
  const outputRoot = path.resolve(repoRoot, nextDistDir);
  await fs.rm(path.join(outputRoot, 'types'), { force: true, recursive: true });
  await fs.rm(path.join(outputRoot, 'dev', 'types'), {
    force: true,
    recursive: true,
  });
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: repoRoot,
      env: process.env,
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

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runStaticGate().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
