import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { controlPlaneTestGroup } from '../../../scripts/control-plane-test-inventory.mjs';

const repoRoot = path.resolve(__dirname, '../../..');
const executionJobGroup = controlPlaneTestGroup('execution-job');

export default defineConfig({
  outputDir: path.resolve(
    __dirname,
    '../../../.tmp/control-plane-tests/execution-job'
  ),
  reporter: 'list',
  testDir: path.resolve(repoRoot, executionJobGroup.testDir),
  testMatch: executionJobGroup.testMatch,
  tsconfig: './tsconfig.worker-test.json',
  workers: 1,
});
