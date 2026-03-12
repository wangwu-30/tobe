import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const APP_DATA_DIRS = ['dev', 'prod'];
const OAUTH_DIR_NAME = '.oauth';
const BACKUP_ROOT_NAME = '.desktop-oauth-backup';

const mode = process.argv[2];
if (mode !== 'backup' && mode !== 'restore') {
  console.error('Usage: node apps/desktop/scripts/oauth-backup-restore.mjs <backup|restore>');
  process.exit(1);
}

const workspaceRoot = path.resolve(process.cwd());
const backupRoot = path.join(workspaceRoot, BACKUP_ROOT_NAME);

for (const dirName of APP_DATA_DIRS) {
  const appOauthDir = path.join(workspaceRoot, '.dao-desktop', dirName, OAUTH_DIR_NAME);
  const backupOauthDir = path.join(backupRoot, dirName, OAUTH_DIR_NAME);

  if (mode === 'backup') {
    await replaceDirectory(appOauthDir, backupOauthDir);
  } else {
    await replaceDirectory(backupOauthDir, appOauthDir);
  }
}

console.log(`[desktop oauth] ${mode} complete.`);

async function replaceDirectory(sourceDir, destinationDir) {
  if (!(await exists(sourceDir))) {
    return false;
  }

  await fs.rm(destinationDir, { recursive: true, force: true });
  await fs.mkdir(destinationDir, { recursive: true });
  await copyDirectoryRecursive(sourceDir, destinationDir);
  return true;
}

async function copyDirectoryRecursive(sourceDir, destinationDir) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      await fs.mkdir(destinationPath, { recursive: true });
      await copyDirectoryRecursive(sourcePath, destinationPath);
    } else {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
