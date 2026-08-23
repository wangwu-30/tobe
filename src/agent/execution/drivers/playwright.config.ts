import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
  testDir: '..',
  testMatch: ['registry.test.ts', 'drivers/openhands.test.ts'],
  workers: 1,
});
