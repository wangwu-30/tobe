import assert from 'node:assert/strict';
import test from 'node:test';

import { assertErrorMatches } from '@/lib/testing/node-assert';
import { ROOM_RUNTIME_CONTRACT_VERSION_V1 } from './contracts';
import type {
  RoomRuntimeEventEnvelopeV1,
  RoomSessionRuntimePortV1,
} from './contracts';
import {
  RoomSessionRuntimeRegistryErrorV1,
  RoomSessionRuntimeRegistryV1,
} from './registry';

function runtime(runtimeId: string): RoomSessionRuntimePortV1 {
  return {
    async describe() {
      return {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        runtimeId,
        displayName: runtimeId,
        runtimeVersion: 'test',
        capabilities: {
          schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
          streaming: 'final-only',
          resume: 'none',
          checkpoint: 'none',
          typedMentionOutput: false,
          delegationRequests: false,
        },
      };
    },
    async open(input) {
      return {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        handle: {
          schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
          session: input.session,
          runtimeId,
          runtimeSessionId: `${runtimeId}-session`,
          generation: input.generation,
          openedAt: '2026-08-21T00:00:00.000Z',
        },
      };
    },
    async resume() {
      return {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        status: 'unsupported',
        reason: 'No resume.',
      };
    },
    handle() {
      return noEvents();
    },
    async checkpoint() {
      return {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        status: 'unsupported',
        reason: 'No checkpoint.',
      };
    },
  };
}

async function* noEvents(): AsyncIterable<RoomRuntimeEventEnvelopeV1> {}

test('registers Room runtimes by descriptor id in stable order', async () => {
  const registry = new RoomSessionRuntimeRegistryV1();
  const pi = runtime('pi-agent-core');
  const alternate = runtime('alternate');

  assert.equal(await registry.register(pi), pi);
  assert.equal(await registry.register(alternate), alternate);

  assert.equal(registry.lookup('pi-agent-core'), pi);
  assert.equal(registry.lookup('missing'), undefined);
  assert.deepEqual(registry.list(), [pi, alternate]);
  assert.deepEqual(registry.runtimeIds(), ['pi-agent-core', 'alternate']);
  assert.equal(registry.descriptor('pi-agent-core')?.runtimeVersion, 'test');
});

test('rejects duplicate ids and preserves the original runtime', async () => {
  const registry = new RoomSessionRuntimeRegistryV1();
  const original = runtime('pi-agent-core');
  await registry.register(original);

  await assert.rejects(
    registry.register(runtime('pi-agent-core')),
    (error: unknown) =>
      assertErrorMatches(
        error,
        { code: 'duplicate-runtime-id', runtimeId: 'pi-agent-core' },
        RoomSessionRuntimeRegistryErrorV1
      )
  );
  assert.equal(registry.lookup('pi-agent-core'), original);
});

test('rejects empty and whitespace-padded ids', async () => {
  for (const runtimeId of ['', ' pi-agent-core', 'pi-agent-core ']) {
    const registry = new RoomSessionRuntimeRegistryV1();
    await assert.rejects(
      registry.register(runtime(runtimeId)),
      (error: unknown) =>
        assertErrorMatches(
          error,
          { code: 'invalid-runtime-id', runtimeId },
          RoomSessionRuntimeRegistryErrorV1
        )
    );
    assert.deepEqual(registry.runtimeIds(), []);
  }
});
