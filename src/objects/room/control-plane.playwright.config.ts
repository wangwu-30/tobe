import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { controlPlaneTestGroup } from '../../../scripts/control-plane-test-inventory.mjs';

const repoRoot = path.resolve(__dirname, '../../..');
const roomGroup = controlPlaneTestGroup('room-persistence');

export default defineConfig({
  build: {
    // The setup emits a native ESM backend bundle. Keep Playwright from
    // rewriting that artifact as CommonJS when the inventory runner selects
    // this canonical config.
    external: ['**/.tmp/room-backend-test/**/*.mjs'],
  },
  globalSetup: './test-global-setup.ts',
  outputDir: path.join(repoRoot, '.tmp/control-plane-tests/room-persistence'),
  reporter: 'list',
  testDir: path.resolve(repoRoot, roomGroup.testDir),
  testMatch: roomGroup.testMatch,
  workers: 1,
});
