import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const APP_DATA_DIRS = ['dev', 'prod'];
const workspaceRoot = path.resolve(process.cwd());

for (const dirName of APP_DATA_DIRS) {
  const appDataRoot = path.join(workspaceRoot, '.dao-desktop', dirName);
  await fs.rm(appDataRoot, {
    force: true,
    recursive: true,
  });
}

console.log(`[desktop reset] Removed local desktop app data roots for ${APP_DATA_DIRS.join(', ')}.`);
