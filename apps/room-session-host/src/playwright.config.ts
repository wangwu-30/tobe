import path from 'node:path';

import { defineConfig } from '@playwright/test';
import { controlPlaneTestGroup } from '../../../scripts/control-plane-test-inventory.mjs';

const repoRoot = path.resolve(__dirname, '../../..');
const roomHostGroup = controlPlaneTestGroup('room-session-host');

export default defineConfig({
  build: {
    // Prisma's generated client is native ESM. Excluding it from Playwright's
    // CommonJS transform keeps the test loader on the production boundary.
    external: [
      '**/.tmp/room-backend-test/**/*.mjs',
      '**/src/generated/prisma/**/*.ts',
    ],
  },
  outputDir: path.join(repoRoot, '.tmp/control-plane-tests/room-session-host'),
  reporter: 'list',
  testDir: path.resolve(repoRoot, roomHostGroup.testDir),
  testMatch: roomHostGroup.testMatch,
  workers: 1,
});
