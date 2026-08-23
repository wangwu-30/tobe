import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
  testDir: '.',
  testMatch: ['admission.test.ts', 'knowledge.test.ts'],
  tsconfig: './tsconfig.test.json',
  workers: 1,
});
