import fs from 'node:fs';
import path from 'node:path';

export type PlatformPaths = {
  appDataRoot: string;
  dbFilePath: string;
  logsRoot: string;
  oauthDir: string;
  workspaceMirrorRoot: string;
};

const DEFAULT_DB_FILE_NAME = 'dev.db';
const DEFAULT_LOGS_DIR_NAME = 'logs';
const DEFAULT_OAUTH_DIR_NAME = '.oauth';
const DEFAULT_WORKSPACE_MIRROR_DIR_NAME = 'workspace-mirror';

export function isDesktopRuntime() {
  return process.env.DAO_PLATFORM === 'desktop';
}

export function getPlatformPaths(): PlatformPaths {
  const appDataRoot = resolveAppDataRoot();

  return {
    appDataRoot,
    dbFilePath: path.join(appDataRoot, DEFAULT_DB_FILE_NAME),
    logsRoot: path.join(appDataRoot, DEFAULT_LOGS_DIR_NAME),
    oauthDir: path.join(appDataRoot, DEFAULT_OAUTH_DIR_NAME),
    workspaceMirrorRoot: path.join(appDataRoot, DEFAULT_WORKSPACE_MIRROR_DIR_NAME),
  };
}

export function ensurePlatformDirectories() {
  const paths = getPlatformPaths();

  for (const target of [
    paths.appDataRoot,
    paths.logsRoot,
    paths.oauthDir,
    paths.workspaceMirrorRoot,
  ]) {
    fs.mkdirSync(target, { recursive: true });
  }

  return paths;
}

export function resolveFileUrlFromPlatform(fileName = DEFAULT_DB_FILE_NAME) {
  return `file:${path.join(resolveAppDataRoot(), fileName)}`;
}

export function resolvePlatformPath(relativePath: string) {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }

  return path.resolve(resolveAppDataRoot(), relativePath);
}

function resolveAppDataRoot() {
  const explicitRoot = process.env.DAO_APP_DATA_ROOT?.trim();
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }

  const cwd = process.cwd();
  const nextSegment = `${path.sep}.next${path.sep}`;
  const nextIndex = cwd.indexOf(nextSegment);
  if (nextIndex !== -1) {
    return cwd.slice(0, nextIndex);
  }

  if (cwd.endsWith(`${path.sep}.next`)) {
    return path.dirname(cwd);
  }

  return cwd;
}
