import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { controlPlaneTestGroup } from '../../../scripts/control-plane-test-inventory.mjs';

const repoRoot = path.resolve(__dirname, '../../..');
const knowledgeGroup = controlPlaneTestGroup('knowledge');

export default defineConfig({
  outputDir: path.resolve(
    __dirname,
    '../../../.tmp/control-plane-tests/knowledge'
  ),
  reporter: 'list',
  testDir: path.resolve(repoRoot, knowledgeGroup.testDir),
  testMatch: knowledgeGroup.testMatch,
  tsconfig: './tsconfig.test.json',
  workers: 1,
});
