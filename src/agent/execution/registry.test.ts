import assert from 'node:assert/strict';
import test from 'node:test';

import { assertErrorMatches } from '@/lib/testing/node-assert';

import { RUNTIME_CONTRACT_VERSION_V1 } from './contracts';
import type {
  ExecutionRuntimeDriverV1,
  RuntimeEventV1,
} from './driver';
import {
  ExecutionRuntimeDriverRegistryErrorV1,
  ExecutionRuntimeDriverRegistryV1,
} from './registry';

const VERSION = RUNTIME_CONTRACT_VERSION_V1;

function driver(runtimeId: string): ExecutionRuntimeDriverV1 {
  return {
    async describe() {
      return {
        schemaVersion: VERSION,
        runtimeId,
        displayName: runtimeId,
        runtimeVersion: 'test',
        capabilities: {
          schemaVersion: VERSION,
          kinds: ['coding'],
          nativeResume: false,
          checkpoint: false,
          streaming: 'none',
          interrupt: 'none',
          workspace: 'none',
          sandbox: 'host',
          structuredArtifacts: false,
          waitingForHuman: false,
          supportedModels: [],
        },
      };
    },
    start() {
      return noEvents();
    },
    async interrupt() {},
    async reconcile(input) {
      return {
        runtimeAttemptId: input.runtimeAttemptId,
        status: 'unknown',
      };
    },
    async archive() {
      return [];
    },
  };
}

async function* noEvents(): AsyncIterable<RuntimeEventV1> {}

function waitingDriver(
  runtimeId: string,
  options: { nativeResume: boolean; implementsResume: boolean }
): ExecutionRuntimeDriverV1 {
  const base = driver(runtimeId);
  return {
    ...base,
    async describe() {
      const descriptor = await base.describe();
      return {
        ...descriptor,
        capabilities: {
          ...descriptor.capabilities,
          nativeResume: options.nativeResume,
          waitingForHuman: true,
        },
      };
    },
    ...(options.implementsResume ? { resume: noEvents } : {}),
  };
}

test('registers multiple drivers and supports stable lookup and listing', async () => {
  const registry = new ExecutionRuntimeDriverRegistryV1();
  const openhands = driver('openhands');
  const genericCli = driver('generic-cli');

  assert.equal(await registry.register(openhands), openhands);
  assert.equal(await registry.register(genericCli), genericCli);

  assert.equal(registry.lookup('openhands'), openhands);
  assert.equal(registry.lookup('generic-cli'), genericCli);
  assert.equal(registry.lookup('missing'), undefined);
  assert.deepEqual(registry.list(), [openhands, genericCli]);
});

test('rejects duplicate runtime ids without replacing the first driver', async () => {
  const registry = new ExecutionRuntimeDriverRegistryV1();
  const first = driver('openhands');
  const duplicate = driver('openhands');
  await registry.register(first);

  await assert.rejects(
    registry.register(duplicate),
    (error: unknown) =>
      assertErrorMatches(
        error,
        { code: 'duplicate-runtime-id', runtimeId: 'openhands' },
        ExecutionRuntimeDriverRegistryErrorV1
      )
  );
  assert.equal(registry.lookup('openhands'), first);
  assert.deepEqual(registry.list(), [first]);
});

test('rejects empty and whitespace-padded runtime ids', async () => {
  for (const runtimeId of ['', ' openhands', 'openhands ']) {
    const registry = new ExecutionRuntimeDriverRegistryV1();
    await assert.rejects(
      registry.register(driver(runtimeId)),
      (error: unknown) =>
        assertErrorMatches(
          error,
          { code: 'invalid-runtime-id', runtimeId },
          ExecutionRuntimeDriverRegistryErrorV1
        )
    );
    assert.deepEqual(registry.list(), []);
  }
});

test('rejects waiting-for-human without advertised native resume', async () => {
  const registry = new ExecutionRuntimeDriverRegistryV1();

  await assert.rejects(
    registry.register(
      waitingDriver('invalid-waiting-runtime', {
        nativeResume: false,
        implementsResume: true,
      })
    ),
    (error: unknown) =>
      assertErrorMatches(
        error,
        {
          code: 'waiting-for-human-requires-native-resume',
          runtimeId: 'invalid-waiting-runtime',
        },
        ExecutionRuntimeDriverRegistryErrorV1
      )
  );
  assert.deepEqual(registry.list(), []);
});

test('rejects waiting-for-human when the driver omits resume()', async () => {
  const registry = new ExecutionRuntimeDriverRegistryV1();

  await assert.rejects(
    registry.register(
      waitingDriver('missing-resume-runtime', {
        nativeResume: true,
        implementsResume: false,
      })
    ),
    (error: unknown) =>
      assertErrorMatches(
        error,
        {
          code: 'waiting-for-human-requires-resume-implementation',
          runtimeId: 'missing-resume-runtime',
        },
        ExecutionRuntimeDriverRegistryErrorV1
      )
  );
  assert.deepEqual(registry.list(), []);
});

test('registers waiting-for-human only with native resume and resume()', async () => {
  const registry = new ExecutionRuntimeDriverRegistryV1();
  const resumable = waitingDriver('resumable-runtime', {
    nativeResume: true,
    implementsResume: true,
  });

  assert.equal(await registry.register(resumable), resumable);
  assert.equal(registry.lookup('resumable-runtime'), resumable);
});
