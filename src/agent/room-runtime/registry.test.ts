import { expect, test } from '@playwright/test';

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

  await expect(registry.register(pi)).resolves.toBe(pi);
  await expect(registry.register(alternate)).resolves.toBe(alternate);

  expect(registry.lookup('pi-agent-core')).toBe(pi);
  expect(registry.lookup('missing')).toBeUndefined();
  expect(registry.list()).toEqual([pi, alternate]);
  expect(registry.runtimeIds()).toEqual(['pi-agent-core', 'alternate']);
  expect(registry.descriptor('pi-agent-core')?.runtimeVersion).toBe('test');
});

test('rejects duplicate ids and preserves the original runtime', async () => {
  const registry = new RoomSessionRuntimeRegistryV1();
  const original = runtime('pi-agent-core');
  await registry.register(original);

  const registration = registry.register(runtime('pi-agent-core'));
  await expect(registration).rejects.toBeInstanceOf(
    RoomSessionRuntimeRegistryErrorV1
  );
  await expect(registration).rejects.toMatchObject({
    code: 'duplicate-runtime-id',
    runtimeId: 'pi-agent-core',
  });
  expect(registry.lookup('pi-agent-core')).toBe(original);
});

test('rejects empty and whitespace-padded ids', async () => {
  for (const runtimeId of ['', ' pi-agent-core', 'pi-agent-core ']) {
    const registry = new RoomSessionRuntimeRegistryV1();
    await expect(registry.register(runtime(runtimeId))).rejects.toMatchObject({
      code: 'invalid-runtime-id',
      runtimeId,
    });
    expect(registry.runtimeIds()).toEqual([]);
  }
});
