import path from 'node:path';

import { defineConfig } from '@playwright/test';
import { controlPlaneTestGroup } from '../../../scripts/control-plane-test-inventory.mjs';

const repoRoot = path.resolve(__dirname, '../../..');
const confirmationGroup = controlPlaneTestGroup('room-tool-confirmation');

export default defineConfig({
  build: {
    // The setup emits a native ESM test bundle. Keep Playwright from
    // rewriting it as CommonJS before Node loads it.
    external: ['**/.tmp/room-tool-confirmation-test/**/*.mjs'],
  },
  globalSetup: './test-global-setup.ts',
  outputDir: path.join(
    repoRoot,
    '.tmp/control-plane-tests/room-tool-confirmation'
  ),
  reporter: 'list',
  testDir: path.resolve(repoRoot, confirmationGroup.testDir),
  testMatch: confirmationGroup.testMatch,
  workers: 1,
});
