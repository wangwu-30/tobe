import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
  testDir: '.',
  testMatch: ['router.test.ts'],
  workers: 1,
});
