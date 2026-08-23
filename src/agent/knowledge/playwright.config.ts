import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
  testDir: '.',
  testMatch: 'git-worktree.test.ts',
  workers: 1,
});
