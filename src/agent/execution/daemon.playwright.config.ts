import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
  testDir: '.',
  testMatch: [
    'daemon.test.ts',
    'daemon-config.test.ts',
    'runtime-plugin-loader.test.ts',
    'prisma-daemon-store.test.ts',
  ],
  workers: 1,
});
