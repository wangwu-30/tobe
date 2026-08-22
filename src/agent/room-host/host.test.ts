import assert from 'node:assert/strict';

import { expect, test } from '@playwright/test';

import { DeterministicRoomContextBuilderV1 } from '@/agent/context';
import {
  ROOM_RUNTIME_CONTRACT_VERSION_V1,
  type RoomDeliveryEnvelopeV1,
  type RoomMessageEnvelopeV1,
  type RoomPolicyV1,
  type RoomRuntimeEventEnvelopeV1,
  type RoomRuntimeEventPayloadV1,
  type RoomSessionRefV1,
} from '@/agent/room-runtime/contracts';
import { RoomSessionRuntimeRegistryV1 } from '@/agent/room-runtime/registry';

import {
  RoomSessionHostV1,
  type RoomHostLoggerV1,
  type RoomHostWaitV1,
} from './host';
import {
  InMemoryRoomHostStoreV1,
  type InMemoryRoomHostSessionSeedV1,
} from './in-memory-store';
import { StubRoomSessionRuntimeV1 } from './stub-runtime';

const BASE_TIME = new Date('2026-08-21T12:00:00.000Z');
const RUNTIME_ID = 'test-room-runtime';

test('settles a dual-host claim race atomically', async () => {
  const store = new InMemoryRoomHostStoreV1([seed('session-1', [1])]);
  const candidate = {
    roomSessionId: 'session-1',
    runtimeId: RUNTIME_ID,
    leaseDurationMs: 3_000,
    now: BASE_TIME,
  };

  const claims = await Promise.all([
    store.claim({ ...candidate, workerId: 'host-a' }),
    store.claim({ ...candidate, workerId: 'host-b' }),
  ]);

  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(store.snapshot('session-1')?.generation, 1);
  assert.equal(store.snapshot('session-1')?.deliveries[0].status, 'claimed');
});

test('serializes one session while different sessions run concurrently and duplicate wakeups are harmless', async () => {
  const gates = new Map([
    ['session-a-delivery-1', deferred<void>()],
    ['session-a-delivery-2', deferred<void>()],
    ['session-b-delivery-1', deferred<void>()],
  ]);
  const store = new InMemoryRoomHostStoreV1([
    seed('session-a', [1, 2]),
    seed('session-b', [1]),
  ]);
  const runtime = new StubRoomSessionRuntimeV1({
    runtimeId: RUNTIME_ID,
    clock: { now: () => BASE_TIME },
    beforeHandle: async ({ delivery }) => {
      await gates.get(delivery.deliveryId)?.promise;
    },
  });
  const host = await createHost({ store, runtime, workerId: 'host-a' });

  const running = host.run();
  await expect
    .poll(() => runtime.handles.map(({ delivery }) => delivery.deliveryId))
    .toEqual(['session-a-delivery-1', 'session-b-delivery-1']);
  host.wake();
  host.wake();
  host.wake();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(runtime.handles).toHaveLength(2);

  gates.get('session-a-delivery-1')?.resolve();
  await expect
    .poll(() => runtime.handles.map(({ delivery }) => delivery.deliveryId))
    .toEqual([
      'session-a-delivery-1',
      'session-b-delivery-1',
      'session-a-delivery-2',
    ]);
  expect(store.snapshot('session-b')?.deliveries[0].status).toBe('claimed');

  gates.get('session-a-delivery-2')?.resolve();
  gates.get('session-b-delivery-1')?.resolve();
  await expect.poll(() => host.activeSessionCount).toBe(0);
  await host.drain();
  await running;

  expect(
    store.snapshot('session-a')?.deliveries.map(({ status }) => status)
  ).toEqual(['completed', 'completed']);
  expect(store.snapshot('session-b')?.deliveries[0].status).toBe('completed');
  expect(store.messages).toHaveLength(3);
});

test('fences stale generation events and completion after lease reclaim', async () => {
  const store = new InMemoryRoomHostStoreV1([seed('session-1', [1])]);
  const first = await claim(store, 'session-1', 'host-old', BASE_TIME);
  assert.ok(first);
  const reclaimedAt = new Date(BASE_TIME.getTime() + 3_001);
  const second = await claim(store, 'session-1', 'host-new', reclaimedAt);
  assert.ok(second);

  const staleEvent = runtimeEvent({
    lease: first.lease,
    runtimeSessionId: 'runtime-old',
    sequence: 1,
    event: { type: 'session-ready' },
  });
  assert.equal(
    await store.appendEvent({
      lease: first.lease,
      event: staleEvent,
      now: reclaimedAt,
    }),
    'fenced'
  );
  assert.equal(
    await store.finishDelivery({
      lease: first.lease,
      terminal: {
        kind: 'host-failure',
        failure: {
          kind: 'interrupted',
          code: 'stale-host',
          message: 'must not win',
          retryable: false,
        },
      },
      now: reclaimedAt,
    }),
    'fenced'
  );
  expect(second.lease.generation).toBe(2);
  expect(second.delivery.attempt).toBe(2);
  expect(store.publicEvents).toHaveLength(0);
});

test('recovers a durable message-ready after crash and publishes exactly one final message', async () => {
  const store = new InMemoryRoomHostStoreV1([seed('session-1', [1])]);
  const crashed = await claim(store, 'session-1', 'crashed-host', BASE_TIME);
  assert.ok(crashed);
  const draft = { text: 'durable response before crash', mentions: [] };
  const messageReady = runtimeEvent({
    lease: crashed.lease,
    runtimeSessionId: 'runtime-crashed',
    sequence: 1,
    event: { type: 'message-ready', responseId: 'response-1', message: draft },
  });
  const appended = await store.appendEvent({
    lease: crashed.lease,
    event: messageReady,
    now: BASE_TIME,
  });
  assert.notEqual(appended, 'fenced');

  const restartedAt = new Date(BASE_TIME.getTime() + 3_001);
  const restarted = await claim(
    store,
    'session-1',
    'restarted-host',
    restartedAt
  );
  assert.ok(restarted);
  assert.deepEqual(restarted.pendingOutput, draft);
  const terminal = runtimeEvent({
    lease: restarted.lease,
    runtimeSessionId: 'runtime-restarted',
    sequence: 1,
    event: { type: 'delivery-completed', disposition: 'responded' },
  });
  const finished = await store.finishDelivery({
    lease: restarted.lease,
    terminal: { kind: 'runtime-event', event: terminal },
    output: restarted.pendingOutput ?? undefined,
    now: restartedAt,
  });

  assert.notEqual(finished, 'fenced');
  expect(store.messages).toHaveLength(1);
  expect(store.messages[0].text).toBe('durable response before crash');
  expect(
    store.publicEvents.map(({ type }) => type).filter(
      (type) => type === 'room.message.created'
    )
  ).toHaveLength(1);
  expect(store.snapshot('session-1')?.generation).toBe(2);
  expect(store.snapshot('session-1')?.deliveries[0].status).toBe('completed');
});

test('retries the same delivery id with a higher attempt and deterministic backoff availability', async () => {
  const store = new InMemoryRoomHostStoreV1([seed('session-1', [1])]);
  const first = await claim(store, 'session-1', 'host-a', BASE_TIME);
  assert.ok(first);
  const availableAt = new Date(BASE_TIME.getTime() + 250);

  expect(
    await store.retryDelivery({
      lease: first.lease,
      failure: {
        kind: 'runtime',
        code: 'temporary',
        message: 'try again',
        retryable: true,
      },
      availableAt,
      now: BASE_TIME,
    })
  ).toBe('retried');
  expect(
    await store.listCandidates({
      runtimeIds: [RUNTIME_ID],
      limit: 1,
      now: new Date(availableAt.getTime() - 1),
    })
  ).toEqual([]);

  const retried = await claim(store, 'session-1', 'host-b', availableAt);
  assert.ok(retried);
  expect(retried.delivery.deliveryId).toBe(first.delivery.deliveryId);
  expect(retried.delivery.attempt).toBe(2);
  expect(retried.lease.generation).toBe(2);
});

test('forced shutdown checkpoints and requeues without completing the delivery', async () => {
  const gate = deferred<void>();
  const store = new InMemoryRoomHostStoreV1([seed('session-1', [1])]);
  const runtime = new StubRoomSessionRuntimeV1({
    runtimeId: RUNTIME_ID,
    clock: { now: () => BASE_TIME },
    beforeHandle: () => gate.promise,
  });
  const host = await createHost({ store, runtime, workerId: 'host-a' });

  const running = host.run();
  await expect.poll(() => host.activeSessionCount).toBe(1);
  await expect.poll(() => runtime.handles.length).toBe(1);
  const draining = host.drain();
  await host.interruptActive('test-forced-shutdown');
  await draining;
  await running;
  gate.resolve();

  const snapshot = store.snapshot('session-1');
  expect(snapshot?.deliveries[0]).toMatchObject({
    status: 'pending',
    lastError: 'test-forced-shutdown',
  });
  expect(snapshot?.deliveries[0].envelope.attempt).toBe(2);
  expect(snapshot?.checkpoint).not.toBeNull();
  expect(store.messages).toHaveLength(0);
});

async function createHost(input: {
  store: InMemoryRoomHostStoreV1;
  runtime: StubRoomSessionRuntimeV1;
  workerId: string;
}) {
  const registry = new RoomSessionRuntimeRegistryV1();
  await registry.register(input.runtime);
  return new RoomSessionHostV1({
    workerId: input.workerId,
    store: input.store,
    registry,
    contextSource: input.store,
    contextBuilder: new DeterministicRoomContextBuilderV1(),
    clock: { now: () => BASE_TIME },
    wait: waitUntilAborted,
    logger: silentLogger(),
    pollIntervalMs: 100,
    heartbeatIntervalMs: 1_000,
    leaseDurationMs: 3_000,
    maxConcurrentSessions: 2,
    retryBaseDelayMs: 250,
    retryMaxDelayMs: 1_000,
  });
}

async function claim(
  store: InMemoryRoomHostStoreV1,
  roomSessionId: string,
  workerId: string,
  now: Date
) {
  return store.claim({
    roomSessionId,
    runtimeId: RUNTIME_ID,
    workerId,
    leaseDurationMs: 3_000,
    now,
  });
}

function seed(
  roomSessionId: string,
  sequences: readonly number[]
): InMemoryRoomHostSessionSeedV1 {
  const roomId = `room-${roomSessionId}`;
  const session: RoomSessionRefV1 = {
    organizationId: 'org-1',
    roomId,
    roomSessionId,
    agentConfigVersion: '1',
    agent: { agentId: 'agent-1', handle: '@agent' },
  };
  const messages = sequences.map((sequence) =>
    message(roomId, sequence, `${roomSessionId}-message-${sequence}`)
  );
  return {
    session,
    runtimeId: RUNTIME_ID,
    context: {
      throughMessageSequence: Math.max(0, ...sequences),
      messages,
    },
    policy: policy(),
    deliveries: sequences.map((sequence, index) => ({
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      envelopeType: 'room.delivery',
      deliveryId: `${roomSessionId}-delivery-${sequence}`,
      roomSessionId,
      deliverySequence: index + 1,
      attempt: 1,
      createdAt: BASE_TIME.toISOString(),
      target: session.agent,
      intent: 'respond',
      cause: { type: 'system', reason: 'host-test' },
      message: messages[index],
    })),
  };
}

function message(
  roomId: string,
  sequence: number,
  messageId: string
): RoomMessageEnvelopeV1 {
  return {
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    envelopeType: 'room.message',
    messageId,
    organizationId: 'org-1',
    roomId,
    sequence,
    createdAt: BASE_TIME.toISOString(),
    actor: { type: 'human', userId: 'user-1' },
    text: `message ${sequence}`,
    mentions: [],
    attachments: [],
  };
}

function policy(): RoomPolicyV1 {
  return {
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    participation: {
      mode: 'quiet-host',
      hostAgentId: 'agent-1',
      unmentionedHostAction: 'observe',
    },
    delegation: { enabled: true, maxHops: 3, maxInvocations: 8 },
  };
}

function runtimeEvent<TEvent extends RoomRuntimeEventPayloadV1>(input: {
  lease: { roomSessionId: string; deliveryId: string; generation: number };
  runtimeSessionId: string;
  sequence: number;
  event: TEvent;
}): RoomRuntimeEventEnvelopeV1 & { event: TEvent } {
  return {
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    envelopeType: 'room.runtime-event',
    eventId: `runtime-event-${input.sequence}`,
    eventSequence: input.sequence,
    occurredAt: BASE_TIME.toISOString(),
    roomSessionId: input.lease.roomSessionId,
    runtimeSessionId: input.runtimeSessionId,
    deliveryId: input.lease.deliveryId,
    event: input.event,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const waitUntilAborted: RoomHostWaitV1 = (_duration, signal) => {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), {
      once: true,
    });
  });
};

function silentLogger(): RoomHostLoggerV1 {
  return { debug() {}, info() {}, warn() {}, error() {} };
}
