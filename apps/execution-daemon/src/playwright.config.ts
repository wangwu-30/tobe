import path from 'node:path';

import { defineConfig } from '@playwright/test';
import { controlPlaneTestGroup } from '../../../scripts/control-plane-test-inventory.mjs';

const repoRoot = path.resolve(__dirname, '../../..');
const daemonGroup = controlPlaneTestGroup('execution-daemon');

export default defineConfig({
  outputDir: path.join(repoRoot, '.tmp/control-plane-tests/execution-daemon'),
  reporter: 'list',
  testDir: path.resolve(repoRoot, daemonGroup.testDir),
  testMatch: daemonGroup.testMatch,
  workers: 1,
});
