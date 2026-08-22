import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { controlPlaneTestGroup } from './scripts/control-plane-test-inventory.mjs';

// The shared manifest is also consumed by scripts/test-control-plane.mjs.
// Adding a src/** or apps/** *.test.ts without listing it there fails closed.
const controlPlaneGroup = controlPlaneTestGroup('core');

export default defineConfig({
  outputDir: path.join(__dirname, '.tmp', 'control-plane-tests', 'core'),
  reporter: 'list',
  testDir: path.resolve(__dirname, controlPlaneGroup.testDir),
  testMatch: controlPlaneGroup.testMatch,
  workers: 1,
});
