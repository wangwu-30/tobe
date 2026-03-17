import path from 'node:path';
import { defineConfig } from '@playwright/test';

const repoRoot = __dirname;
const iterationRoot =
  process.env.ITERATION_ROOT || path.join(repoRoot, '.tmp', 'iteration-regression');
const artifactsRoot =
  process.env.ITERATION_ARTIFACTS_ROOT ||
  path.join(iterationRoot, 'artifacts');
const port = Number(process.env.PORT || '3216');
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  fullyParallel: false,
  globalSetup: './tests/e2e/iteration/global-setup.ts',
  outputDir: path.join(artifactsRoot, 'test-results'),
  reporter: [
    ['list'],
    [
      'html',
      {
        open: 'never',
        outputFolder:
          process.env.PLAYWRIGHT_HTML_REPORT ||
          path.join(artifactsRoot, 'html-report'),
      },
    ],
  ],
  retries: 0,
  testDir: './tests/e2e/iteration',
  timeout: 90_000,
  use: {
    baseURL,
    locale: 'zh-CN',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `./node_modules/.bin/next dev --hostname 127.0.0.1 --port ${port}`,
    env: {
      ...process.env,
      DAO_APP_DATA_ROOT:
        process.env.DAO_APP_DATA_ROOT ||
        path.join(iterationRoot, 'app-data'),
      DAO_E2E: process.env.DAO_E2E || '1',
      DATABASE_URL:
        process.env.DATABASE_URL ||
        `file:${path.join(
          process.env.DAO_APP_DATA_ROOT || path.join(iterationRoot, 'app-data'),
          'dev.db'
        )}`,
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
    },
    reuseExistingServer: false,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: 180_000,
    url: baseURL,
  },
  workers: 1,
});
