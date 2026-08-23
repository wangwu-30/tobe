import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  iterationGateEnvironment,
  iterationGateSteps,
  runIterationGate,
} from './verify-iteration.mjs';
import { runStaticGate, staticGateSteps } from './verify-iteration-static.mjs';

test('install, development, and production build generate the ignored Prisma client', async () => {
  const packageJson = JSON.parse(
    await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')
  );

  assert.equal(packageJson.scripts['db:generate'], 'prisma generate');
  assert.equal(packageJson.scripts.postinstall, 'npm run db:generate');
  assert.equal(
    packageJson.scripts.predev,
    'npm run db:generate && npm run db:bootstrap:local'
  );
  assert.equal(packageJson.scripts.prebuild, 'npm run db:generate');
});

test('static gate builds generated test modules before TypeScript in fail-closed order', async () => {
  assert.deepEqual(
    staticGateSteps.map(({ id }) => id),
    [
      'web-interface-guidelines',
      'prisma',
      'clear-next-types',
      'typegen',
      'build:room-backend-test',
      'build:room-tool-confirmation-test',
      'tsc',
      'eslint',
    ]
  );
  assert.deepEqual(
    staticGateSteps.find(({ id }) => id === 'web-interface-guidelines')
      ?.command,
    ['node', 'scripts/check-web-interface-guidelines.mjs']
  );
  assert.deepEqual(
    staticGateSteps.find(({ id }) => id === 'build:room-backend-test')
      ?.command,
    [
      'npx',
      'vite',
      'build',
      '--config',
      'vite.room-backend-test.config.mts',
    ]
  );
  assert.deepEqual(
    staticGateSteps.find(
      ({ id }) => id === 'build:room-tool-confirmation-test'
    )?.command,
    [
      'npx',
      'vite',
      'build',
      '--config',
      'vite.room-tool-confirmation-test.config.mts',
    ]
  );

  const executed = [];
  await runStaticGate({
    clearGeneratedNextTypes: async () => {
      executed.push('clear-next-types');
    },
    runStep: async (id) => {
      executed.push(id);
    },
  });
  assert.deepEqual(
    executed,
    staticGateSteps.map(({ id }) => id)
  );
});

test('static gate stops immediately when the Web interface scan fails', async () => {
  const executed = [];
  await assert.rejects(
    runStaticGate({
      clearGeneratedNextTypes: async () => {
        executed.push('clear-next-types');
      },
      runStep: async (id) => {
        executed.push(id);
        if (id === 'web-interface-guidelines') {
          throw new Error('Web interface anti-pattern found');
        }
      },
    }),
    /Web interface anti-pattern found/u
  );
  assert.deepEqual(executed, ['web-interface-guidelines']);
});

test('iteration gate includes every release stage in fail-closed order', () => {
  assert.deepEqual(
    iterationGateSteps.map(({ id }) => id),
    [
      'static',
      'control-plane',
      'bootstrap',
      'production-build',
      'browser-preflight',
      'browser-e2e',
    ]
  );
  assert.deepEqual(
    iterationGateSteps.find(({ id }) => id === 'production-build')?.command,
    ['npm', 'run', 'build']
  );
  assert.deepEqual(
    iterationGateSteps.find(({ id }) => id === 'browser-preflight')?.command,
    ['node', 'scripts/browser-preflight.mjs']
  );
  assert.equal(
    iterationGateEnvironment.NEXT_TSCONFIG_PATH,
    'tsconfig.iteration.json'
  );
  assert.equal(
    iterationGateEnvironment.NEXT_DIST_DIR,
    '.tmp/iteration-regression/next-dist'
  );
});

test('browser E2E failure rejects the gate after a successful preflight', async () => {
  const executed = [];
  await assert.rejects(
    runIterationGate({
      prepareRoots: async () => {},
      runStep: async (id) => {
        executed.push(id);
        if (id === 'browser-e2e') throw new Error('Chromium launch failed');
      },
    }),
    /Chromium launch failed/u
  );
  assert.deepEqual(executed, iterationGateSteps.map(({ id }) => id));
});

test('browser preflight failure rejects the gate and browser E2E never runs', async () => {
  const executed = [];
  await assert.rejects(
    runIterationGate({
      prepareRoots: async () => {},
      runStep: async (id) => {
        executed.push(id);
        if (id === 'browser-preflight') {
          throw new Error('missing libgbm.so.1');
        }
      },
    }),
    /missing libgbm\.so\.1/u
  );
  assert.deepEqual(executed, [
    'static',
    'control-plane',
    'bootstrap',
    'production-build',
    'browser-preflight',
  ]);
});
