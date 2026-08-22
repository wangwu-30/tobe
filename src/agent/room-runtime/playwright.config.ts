import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
  testDir: '.',
  testMatch: ['room-runtime.test.ts', 'registry.test.ts', 'adapters/*.test.ts'],
  workers: 1,
});
