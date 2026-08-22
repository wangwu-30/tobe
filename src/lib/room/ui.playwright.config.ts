import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
  testDir: '.',
  testMatch: [
    'activity.test.ts',
    'client.test.ts',
    'mentions.test.ts',
    'sse.test.ts',
  ],
  workers: 1,
});
