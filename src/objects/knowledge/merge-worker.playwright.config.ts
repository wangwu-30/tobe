import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
  testDir: '.',
  testMatch: ['merge-worker-commands.test.ts'],
  tsconfig: './tsconfig.test.json',
  workers: 1,
});
