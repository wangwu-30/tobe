import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export default async function globalSetup() {
  await run(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      'vite',
      'build',
      '--config',
      'vite.room-tool-confirmation-test.config.mts',
    ],
    { cwd: process.cwd() }
  );
}
