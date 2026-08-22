import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
  testDir: '.',
  testMatch: ['trusted-merge.test.ts'],
  workers: 1,
});
