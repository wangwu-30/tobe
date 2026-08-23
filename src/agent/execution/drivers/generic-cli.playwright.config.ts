import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
  testDir: '.',
  testMatch: 'generic-cli.test.ts',
  workers: 1,
});
