import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
  testDir: '.',
  testMatch: [
    'commands.test.ts',
    'idempotency.test.ts',
    'input-commands.test.ts',
    'queries.test.ts',
    'room-projection.test.ts',
    'schema.test.ts',
    'worker-commands.test.ts',
    'worker-events.test.ts',
    'worker-queries.test.ts',
  ],
  tsconfig: './tsconfig.worker-test.json',
  workers: 1,
});
