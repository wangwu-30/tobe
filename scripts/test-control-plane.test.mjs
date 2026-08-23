import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  compareTestInventory,
  configuredTestsFromManifest,
  controlPlaneBuilds,
  controlPlaneConfigs,
  controlPlaneInventoryRoots,
  findForbiddenTestModifiers,
  runControlPlaneGate,
  scriptTests,
  testPolicyRoots,
} from './test-control-plane.mjs';

test('inventory reports missing, duplicate, and stale config entries deterministically', () => {
  const root = path.resolve('/fixture');
  const first = path.join(root, 'src/first.test.ts');
  const missing = path.join(root, 'src/missing.test.ts');
  const stale = path.join(root, 'apps/stale.test.ts');
  const configured = new Map([
    [first, ['core', 'duplicate']],
    [stale, ['core']],
  ]);

  assert.deepEqual(compareTestInventory([missing, first], configured), {
    duplicated: [{ file: first, configs: ['core', 'duplicate'] }],
    missing: [missing],
    unexpected: [{ file: stale, configs: ['core'] }],
  });
});

test('inventory accepts files matched exactly once', () => {
  const file = path.resolve('/fixture/src/covered.test.ts');
  assert.deepEqual(compareTestInventory([file], new Map([[file, ['core']]])), {
    duplicated: [],
    missing: [],
    unexpected: [],
  });
});

test('inventory scans every control-plane test root', () => {
  assert.deepEqual(controlPlaneInventoryRoots, [
    'apps',
    'src',
    'tests/control-plane',
  ]);
});

test('test policy scans all production and test source roots', () => {
  assert.deepEqual(testPolicyRoots, ['apps', 'scripts', 'src', 'tests']);
});

test('test policy rejects disabled and focused tests without matching prose', () => {
  const fixture = [
    `test.${'skip'}(condition, 'reason')`,
    `test.describe.${'only'}('focused', () => {})`,
    `it['${'todo'}']('later')`,
    `test('option', { ${'skip'}: true }, () => {})`,
    `const prose = 'test.${'skip'} is not executable here'`,
    `// describe.${'only'}('commented out')`,
  ].join('\n');

  assert.deepEqual(
    findForbiddenTestModifiers(fixture, '/fixture/policy.test.ts').map(
      ({ expression, line }) => ({ expression, line })
    ),
    [
      { expression: `test.${'skip'}`, line: 1 },
      { expression: `test.describe.${'only'}`, line: 2 },
      { expression: `it.${'todo'}`, line: 3 },
      { expression: `test option ${'skip'}`, line: 4 },
    ]
  );
});

test('inventory rejects entries outside their declared Playwright testDir', () => {
  assert.throws(
    () =>
      configuredTestsFromManifest(
        [
          {
            id: 'escaped',
            config: 'escaped.config.ts',
            testDir: 'src/objects/room',
            testMatch: ['../../agent/room-host/context.test.ts'],
          },
        ],
        path.resolve('/fixture')
      ),
    /entry escapes its testDir: escaped/u
  );
});

test('control-plane gate builds and executes every standalone process suite', () => {
  assert.deepEqual(
    controlPlaneBuilds.map(({ id }) => id),
    [
      'execution-daemon',
      'room-session-host',
      'knowledge-merge-worker',
    ]
  );
  assert.deepEqual(
    controlPlaneConfigs
      .map(({ id }) => id)
      .filter((id) =>
        [
          'execution-daemon',
          'room-session-host',
          'knowledge-merge-worker',
        ].includes(id)
      ),
    ['execution-daemon', 'room-session-host', 'knowledge-merge-worker']
  );
  assert.deepEqual(scriptTests, [
    'scripts/bootstrap-local-db.test.mjs',
    'scripts/browser-preflight.test.mjs',
    'scripts/check-web-interface-guidelines.test.mjs',
    'scripts/test-ai-inspector.test.mjs',
    'scripts/test-control-plane.test.mjs',
    'scripts/verify-iteration.test.mjs',
  ]);
});

test('control-plane gate executes every configured stage in fail-closed order', async () => {
  const executed = [];
  await runControlPlaneGate({
    checkInventory: async () => {
      executed.push('inventory');
    },
    cleanArtifacts: async () => {
      executed.push('clean-artifacts');
    },
    runStep: async (id) => {
      executed.push(id);
    },
  });

  assert.deepEqual(executed, [
    'inventory',
    'clean-artifacts',
    'script-contracts',
    ...controlPlaneBuilds.map(({ id }) => `build:${id}`),
    ...controlPlaneConfigs.map(({ id }) => `tests:${id}`),
  ]);
});

test('control-plane gate stops on the first failed stage', async () => {
  const executed = [];
  await assert.rejects(
    runControlPlaneGate({
      checkInventory: async () => {},
      cleanArtifacts: async () => {},
      runStep: async (id) => {
        executed.push(id);
        if (id === 'build:room-session-host') {
          throw new Error('room host smoke prerequisite failed');
        }
      },
    }),
    /room host smoke prerequisite failed/u
  );
  assert.deepEqual(executed, [
    'script-contracts',
    'build:execution-daemon',
    'build:room-session-host',
  ]);
});
