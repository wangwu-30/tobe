import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  deleteCredentialEntry,
  modifyCredentialEntry,
  readCredentialMap,
} from './oauth-credential-file.mjs';

test('credential writes preserve concurrent provider updates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tobe-oauth-store-'));
  const filePath = path.join(root, 'auth.json');

  try {
    await Promise.all([
      modifyCredentialEntry(filePath, 'openai-codex', async () => {
        await new Promise(resolve => setTimeout(resolve, 25));
        return oauthCredential('openai-access');
      }),
      modifyCredentialEntry(filePath, 'anthropic', async () =>
        oauthCredential('anthropic-access')
      ),
    ]);

    assert.deepEqual(await readCredentialMap(filePath), {
      anthropic: oauthCredential('anthropic-access'),
      'openai-codex': oauthCredential('openai-access'),
    });
    await assert.rejects(fs.access(`${filePath}.lock`));
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
});

test('credential deletion and its cleanup callback run under the same lock', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tobe-oauth-store-'));
  const filePath = path.join(root, 'auth.json');

  try {
    await modifyCredentialEntry(filePath, 'openai-codex', async () =>
      oauthCredential('openai-access')
    );
    let cleanupSawLock = false;

    await deleteCredentialEntry(filePath, 'openai-codex', {
      async afterDelete() {
        cleanupSawLock = await fs
          .stat(`${filePath}.lock`)
          .then(stat => stat.isDirectory(), () => false);
      },
    });

    assert.equal(cleanupSawLock, true);
    assert.deepEqual(await readCredentialMap(filePath), {});
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
});

function oauthCredential(access) {
  return {
    access,
    expires: 4_102_444_800_000,
    refresh: `${access}-refresh`,
    type: 'oauth',
  };
}
