import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
  testDir: '.',
  testMatch: 'git-worktree-coordinator.test.ts',
  workers: 1,
});
