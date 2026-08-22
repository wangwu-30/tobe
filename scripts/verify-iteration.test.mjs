import assert from 'node:assert/strict';
import test from 'node:test';

import {
  iterationGateEnvironment,
  iterationGateSteps,
  runIterationGate,
} from './verify-iteration.mjs';

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
