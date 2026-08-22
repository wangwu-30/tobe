import { defineConfig } from '@playwright/test';

export default defineConfig({
  build: {
    // The global setup produces a native ESM bundle. Let Node load it as-is;
    // Playwright's TypeScript transform otherwise rewrites it as CommonJS and
    // trips over Prisma's generated ESM client (`exports is not defined`).
    external: ['**/.tmp/room-backend-test/**/*.mjs'],
  },
  globalSetup: './test-global-setup.ts',
  reporter: 'list',
  testDir: '.',
  testMatch: [
    'room-host-store.persistence.test.ts',
    'room.persistence.test.ts',
  ],
  workers: 1,
});
