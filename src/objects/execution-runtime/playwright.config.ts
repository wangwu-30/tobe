import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
  testDir: '.',
  testMatch: [
    'registry.test.ts',
    'schema.test.ts',
    'worker-commands.test.ts',
  ],
  workers: 1,
});
