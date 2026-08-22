import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const nextDistDir =
  process.env.NEXT_DIST_DIR?.trim() || '.next';
const typeScriptProject =
  process.env.NEXT_TSCONFIG_PATH?.trim() || 'tsconfig.json';

async function main() {
  await runStep('prisma', ['npx', 'prisma', 'generate']);
  await clearGeneratedNextTypes();
  await runStep('typegen', ['npx', 'next', 'typegen']);
  await runStep('tsc', [
    'npx',
    'tsc',
    '--noEmit',
    '--project',
    typeScriptProject,
  ]);
  await runStep('eslint', [
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
  ]);
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
