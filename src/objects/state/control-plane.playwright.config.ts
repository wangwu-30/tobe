import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { controlPlaneTestGroup } from '../../../scripts/control-plane-test-inventory.mjs';

const repoRoot = path.resolve(__dirname, '../../..');
const stateGroup = controlPlaneTestGroup('state');

export default defineConfig({
  outputDir: path.resolve(__dirname, '../../../.tmp/control-plane-tests/state'),
  reporter: 'list',
  testDir: path.resolve(repoRoot, stateGroup.testDir),
  testMatch: stateGroup.testMatch,
  tsconfig: './tsconfig.test.json',
  workers: 1,
});
