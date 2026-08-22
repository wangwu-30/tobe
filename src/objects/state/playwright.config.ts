import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
  testDir: '.',
  testMatch: ['aligned-label-migration.test.ts', 'commands.atomic.test.ts', 'schema.test.ts'],
  workers: 1,
});
