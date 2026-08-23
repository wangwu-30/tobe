import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { controlPlaneTestGroup } from '../../../scripts/control-plane-test-inventory.mjs';

const repoRoot = path.resolve(__dirname, '../../..');
const homeGroup = controlPlaneTestGroup('home');

export default defineConfig({
  outputDir: path.resolve(__dirname, '../../../.tmp/control-plane-tests/home'),
  reporter: 'list',
  testDir: path.resolve(repoRoot, homeGroup.testDir),
  testMatch: homeGroup.testMatch,
  workers: 1,
});
