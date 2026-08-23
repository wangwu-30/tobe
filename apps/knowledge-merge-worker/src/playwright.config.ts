import path from 'node:path';

import { defineConfig } from '@playwright/test';
import { controlPlaneTestGroup } from '../../../scripts/control-plane-test-inventory.mjs';

const repoRoot = path.resolve(__dirname, '../../..');
const mergeWorkerGroup = controlPlaneTestGroup('knowledge-merge-worker');

export default defineConfig({
  outputDir: path.join(
    repoRoot,
    '.tmp/control-plane-tests/knowledge-merge-worker'
  ),
  reporter: 'list',
  testDir: path.resolve(repoRoot, mergeWorkerGroup.testDir),
  testMatch: mergeWorkerGroup.testMatch,
  workers: 1,
});
