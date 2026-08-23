import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { controlPlaneTestGroup } from '../../../scripts/control-plane-test-inventory.mjs';

const repoRoot = path.resolve(__dirname, '../../..');
const recoveryGroup = controlPlaneTestGroup('execution-recovery');

export default defineConfig({
  outputDir: path.resolve(
    __dirname,
    '../../../.tmp/control-plane-tests/execution-recovery'
  ),
  reporter: 'list',
  testDir: path.resolve(repoRoot, recoveryGroup.testDir),
  testMatch: recoveryGroup.testMatch,
  tsconfig: './tsconfig.test.json',
  workers: 1,
});
