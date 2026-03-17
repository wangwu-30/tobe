import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();

async function main() {
  await runStep('prisma', ['npx', 'prisma', 'generate']);
  await clearGeneratedNextTypes();
  await runStep('typegen', ['npx', 'next', 'typegen']);
  await runStep('tsc', ['npx', 'tsc', '--noEmit']);
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
    'apps/desktop/src/renderer/.vite/**',
    '--ignore-pattern',
    'src/generated/prisma/**',
    'src/app',
    'src/components',
    'src/hooks',
    'src/lib',
    'src/types',
    'apps/desktop/src',
    'apps/desktop/scripts',
    'scripts',
    'tests',
    'eslint.config.mjs',
    'forge.config.js',
    'next.config.ts',
    'playwright.config.ts',
    'postcss.config.mjs',
    'prisma.config.ts',
    'vite.backend.config.mts',
    'vite.main.config.mts',
    'vite.preload.config.mts',
    'vite.renderer.config.mts',
  ]);
}

function runStep(label, command) {
  process.stdout.write(`\n[verify:iteration:static] ${label}\n`);
  return runCommand(command);
}

async function clearGeneratedNextTypes() {
  await fs.rm(path.join(repoRoot, '.next', 'types'), { force: true, recursive: true });
  await fs.rm(path.join(repoRoot, '.next', 'dev', 'types'), { force: true, recursive: true });
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
