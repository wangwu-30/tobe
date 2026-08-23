import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';

const STALE_LOCK_MS = 5 * 60_000;
const LOCK_HEARTBEAT_MS = 30_000;

export async function readCredentialMap(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (error) {
    if (error instanceof SyntaxError || error?.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export async function modifyCredentialEntry(
  filePath,
  providerId,
  update,
  options = {}
) {
  return withCredentialFileLock(filePath, async () => {
    options.signal?.throwIfAborted();
    const credentials = await readCredentialMap(filePath);
    const current = credentials[providerId];
    const next = await update(current);
    options.signal?.throwIfAborted();
    if (next === undefined) {
      return current;
    }

    credentials[providerId] = next;
    await writeCredentialMap(filePath, credentials);
    return next;
  }, options.signal);
}

export async function deleteCredentialEntry(
  filePath,
  providerId,
  options = {}
) {
  await withCredentialFileLock(filePath, async () => {
    options.signal?.throwIfAborted();
    const credentials = await readCredentialMap(filePath);
    delete credentials[providerId];
    await writeCredentialMap(filePath, credentials);
    await options.afterDelete?.();
    options.signal?.throwIfAborted();
  }, options.signal);
}

async function writeCredentialMap(filePath, credentials) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(credentials, null, 2), {
      mode: 0o600,
    });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function withCredentialFileLock(filePath, operation, signal) {
  const lockPath = `${filePath}.lock`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  signal?.throwIfAborted();
  const release = await lockfile.lock(filePath, {
    lockfilePath: lockPath,
    realpath: false,
    retries: { factor: 1.5, maxTimeout: 500, minTimeout: 25, retries: 20 },
    stale: STALE_LOCK_MS,
    update: LOCK_HEARTBEAT_MS,
  });

  try {
    signal?.throwIfAborted();
    return await operation();
  } finally {
    await release();
  }
}
