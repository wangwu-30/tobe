import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { controlPlaneTestGroup } from '../../../scripts/control-plane-test-inventory.mjs';

const repoRoot = path.resolve(__dirname, '../../..');
const conversationGroup = controlPlaneTestGroup('conversation');

export default defineConfig({
  outputDir: path.resolve(
    __dirname,
    '../../../.tmp/control-plane-tests/conversation'
  ),
  reporter: 'list',
  testDir: path.resolve(repoRoot, conversationGroup.testDir),
  testMatch: conversationGroup.testMatch,
  tsconfig: './tsconfig.test.json',
  workers: 1,
});
