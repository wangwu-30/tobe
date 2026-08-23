import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { controlPlaneTestGroup } from '../../../scripts/control-plane-test-inventory.mjs';

const repoRoot = path.resolve(__dirname, '../../..');
const fileGroup = controlPlaneTestGroup('file');

export default defineConfig({
  outputDir: path.resolve(__dirname, '../../../.tmp/control-plane-tests/file'),
  reporter: 'list',
  testDir: path.resolve(repoRoot, fileGroup.testDir),
  testMatch: fileGroup.testMatch,
  tsconfig: './tsconfig.test.json',
  workers: 1,
});
