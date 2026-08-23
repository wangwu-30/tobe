import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
  testDir: '.',
  testMatch: 'tool-policy.test.ts',
  workers: 1,
});
