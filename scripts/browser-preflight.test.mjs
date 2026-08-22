import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkBrowserPreflight,
  parseMissingSharedLibraries,
} from './browser-preflight.mjs';

test('parses and sorts each missing shared library exactly once', () => {
  assert.deepEqual(
    parseMissingSharedLibraries(`
      libz.so.1 => /lib/libz.so.1 (0x1234)
      libgbm.so.1 => not found
      libasound.so.2 => not found
      libgbm.so.1 => not found
    `),
    ['libasound.so.2', 'libgbm.so.1']
  );
});

test('fails with exact missing libraries and the checked executable', async () => {
  await assert.rejects(
    checkBrowserPreflight({
      checkExecutable: async () => {},
      platform: 'linux',
      resolveExecutable: async () => '/fixture/chromium',
      runLdd: async () => ({
        exitCode: 0,
        stderr: '',
        stdout: 'libgbm.so.1 => not found\nlibnss3.so => not found\n',
      }),
    }),
    (error) => {
      assert.match(error.message, /  - libgbm\.so\.1/u);
      assert.match(error.message, /  - libnss3\.so/u);
      assert.match(error.message, /Browser executable: \/fixture\/chromium/u);
      return true;
    }
  );
});

test('passes only after ldd resolves every shared library', async () => {
  const result = await checkBrowserPreflight({
    checkExecutable: async () => {},
    platform: 'linux',
    resolveExecutable: async () => '/fixture/chromium',
    runLdd: async () => ({
      exitCode: 0,
      stderr: '',
      stdout: 'libgbm.so.1 => /lib/libgbm.so.1 (0x1234)\n',
    }),
  });
  assert.deepEqual(result, {
    executablePath: '/fixture/chromium',
    missingLibraries: [],
  });
});

test('fails before ldd when the configured browser executable is absent', async () => {
  let lddCalled = false;
  await assert.rejects(
    checkBrowserPreflight({
      checkExecutable: async () => {
        throw new Error('ENOENT');
      },
      platform: 'linux',
      resolveExecutable: async () => '/fixture/missing-chromium',
      runLdd: async () => {
        lddCalled = true;
        return { exitCode: 0, stderr: '', stdout: '' };
      },
    }),
    /Chromium executable is unavailable: \/fixture\/missing-chromium/u
  );
  assert.equal(lddCalled, false);
});
