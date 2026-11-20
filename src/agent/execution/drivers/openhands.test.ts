import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertErrorMatches,
  assertMatchesObject,
} from '@/lib/testing/node-assert';

import type {
  RuntimeArchiveAttemptV1,
  RuntimeInterruptAttemptV1,
  RuntimeReconcileAttemptV1,
  RuntimeStartAttemptV1,
} from '../driver';
import {
  OpenHandsExecutionRuntimeDriverV1,
  OpenHandsRuntimeUnavailableError,
  type OpenHandsExecutionRuntimeDriverConfigV1,
} from './openhands';

const CONFIG: OpenHandsExecutionRuntimeDriverConfigV1 = {
  enabled: true,
  endpoint: 'https://openhands.example.test',
  token: 'secret-test-token',
  runtimeVersion: 'test-deployment',
  workspace: 'git-worktree',
  sandbox: 'container',
};

const ATTEMPT = {
  jobId: 'job-1',
  attemptId: 'attempt-1',
  generation: 1,
};

test('descriptor exposes only configured, conservative capabilities', async () => {
  const driver = new OpenHandsExecutionRuntimeDriverV1({
    ...CONFIG,
    runtimeId: 'openhands-east',
    sandbox: 'remote',
    supportedModels: ['model-a'],
    features: ['repo-write'],
    selectionPriority: 7,
  });

  assertMatchesObject(await driver.describe(), {
    runtimeId: 'openhands-east',
    runtimeVersion: 'test-deployment',
    selectionPriority: 7,
    capabilities: {
      kinds: ['coding'],
      nativeResume: false,
      checkpoint: false,
      streaming: 'none',
      interrupt: 'none',
      workspace: 'git-worktree',
      sandbox: 'remote',
      structuredArtifacts: false,
      waitingForHuman: false,
      supportedModels: ['model-a'],
      features: ['repo-write'],
    },
  });
});

test('reports disabled configuration distinctly without requiring secrets', () => {
  const driver = new OpenHandsExecutionRuntimeDriverV1({
    ...CONFIG,
    enabled: false,
    endpoint: null,
    token: null,
  });

  assert.deepEqual(driver.getConfigurationState(), {
    state: 'disabled',
    executable: false,
    message: 'The OpenHands adapter is explicitly disabled.',
    issues: [],
  });
});

test('reports missing and invalid connection configuration explicitly', () => {
  const missing = new OpenHandsExecutionRuntimeDriverV1({
    ...CONFIG,
    endpoint: null,
    token: '   ',
  });
  const invalid = new OpenHandsExecutionRuntimeDriverV1({
    ...CONFIG,
    endpoint: 'ftp://user:password@openhands.example.test',
    requestTimeoutMs: 0,
  });

  assert.deepEqual(
    missing.getConfigurationState().issues.map(({ code }) => code),
    ['missing-endpoint', 'missing-token', 'unverified-api-contract']
  );
  assert.deepEqual(
    invalid.getConfigurationState().issues.map(({ code }) => code),
    ['invalid-endpoint', 'invalid-timeout', 'unverified-api-contract']
  );
});

test('valid endpoint and token remain unavailable until an API contract exists', () => {
  const driver = new OpenHandsExecutionRuntimeDriverV1(CONFIG);

  assert.deepEqual(driver.getConfigurationState(), {
    state: 'unavailable',
    executable: false,
    message:
      'No compatible OpenHands HTTP API contract is implemented; authentication, timeout, HTTP, network, and response errors cannot yet be mapped safely.',
    issues: [
      {
        code: 'unverified-api-contract',
        message:
          'No compatible OpenHands HTTP API contract is implemented; authentication, timeout, HTTP, network, and response errors cannot yet be mapped safely.',
      },
    ],
  });
});

test('every operation fails clearly without fabricating work or leaking the token', async () => {
  const driver = new OpenHandsExecutionRuntimeDriverV1(CONFIG);
  const startInput: RuntimeStartAttemptV1 = {
    ...ATTEMPT,
    executionSpec: {
      schemaVersion: 1,
      goal: 'Implement the requested repository change.',
      kind: 'coding',
      requirements: {},
    },
    contextManifest: {},
  };
  const runtimeAttemptInput = {
    ...ATTEMPT,
    runtimeAttemptId: 'runtime-attempt-1',
  };

  assert.throws(
    () => driver.start(startInput),
    OpenHandsRuntimeUnavailableError
  );

  const operations = [
    {
      operation: 'interrupt',
      promise: driver.interrupt(
        runtimeAttemptInput as RuntimeInterruptAttemptV1
      ),
    },
    {
      operation: 'reconcile',
      promise: driver.reconcile(
        runtimeAttemptInput as RuntimeReconcileAttemptV1
      ),
    },
    {
      operation: 'archive',
      promise: driver.archive(runtimeAttemptInput as RuntimeArchiveAttemptV1),
    },
  ];

  for (const item of operations) {
    await assert.rejects(item.promise, (error: unknown) => {
      assertErrorMatches(
        error,
        {
          code: 'openhands-runtime-unavailable',
          operation: item.operation,
        },
        OpenHandsRuntimeUnavailableError
      );
      const message = error instanceof Error ? error.message : String(error);
      assert.equal(/secret-test-token/.test(message), false);
      assert.match(message, /No HTTP request was sent/);
      return true;
    });
  }
});
