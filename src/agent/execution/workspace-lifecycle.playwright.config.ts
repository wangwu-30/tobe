import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
  testDir: '.',
  testMatch: 'workspace-lifecycle.test.ts',
  workers: 1,
});
