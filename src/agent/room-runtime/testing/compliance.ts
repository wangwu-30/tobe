import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { assertMatchesObject } from '@/lib/testing/node-assert';

import {
  ROOM_RUNTIME_CONTRACT_VERSION_V1,
  type HandleRoomDeliveryInputV1,
  type OpenRoomSessionInputV1,
  type RoomDeliveryEnvelopeV1,
  type RoomMessageEnvelopeV1,
  type RoomRuntimeEventEnvelopeV1,
  type RoomSessionRuntimePortV1,
} from '../contracts';
import { createQuietHostRoomPolicy } from '../policy';

export type RoomRuntimeComplianceBehaviorV1 =
  | 'error'
  | 'pending'
  | 'success';

export type RoomSessionRuntimeComplianceHarnessV1 = {
  runtime: RoomSessionRuntimePortV1;
  invocationCount(): number;
  cancellationCount(): number;
  idleWaitCount(): number;
};

export type RoomSessionRuntimeComplianceFactoryV1 = {
  create(
    behavior: RoomRuntimeComplianceBehaviorV1
  ): RoomSessionRuntimeComplianceHarnessV1;
  expectedResponseText: string;
  expectedRuntimeId: string;
};

/**
 * Registers the provider-neutral behavioral checks every Room runtime adapter
 * can run against a deterministic provider/harness.
 */
export function registerRoomSessionRuntimeComplianceSuiteV1(
  name: string,
  factory: RoomSessionRuntimeComplianceFactoryV1
) {
  describe(`${name} RoomSessionRuntimePortV1 compliance`, () => {
    test('describes stable capabilities and opens isolated handles', async () => {
      const { runtime } = factory.create('success');
      const descriptor = await runtime.describe();
      const first = await runtime.open(openInput());
      const second = await runtime.open(
        openInput({
          requestId: 'open-2',
          session: session({ roomSessionId: 'room-session-2' }),
        })
      );

      assert.deepEqual(await runtime.describe(), descriptor);
      assertMatchesObject(descriptor, {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        runtimeId: factory.expectedRuntimeId,
      });
      assertMatchesObject(first.handle, {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        session: session(),
        generation: 1,
        runtimeId: factory.expectedRuntimeId,
      });
      assert.notEqual(first.handle.runtimeSessionId, '');
      assert.notEqual(
        second.handle.runtimeSessionId,
        first.handle.runtimeSessionId
      );
    });

    test('emits ordered response events with one terminal event', async () => {
      const harness = factory.create('success');
      const opened = await harness.runtime.open(openInput());
      const input = handleInput(opened.handle);
      const events = await collect(harness.runtime.handle(input));

      assert.deepEqual(
        events.map(({ event }) => event.type),
        [
          'response-started',
          'text-delta',
          'text-delta',
          'message-ready',
          'delivery-completed',
        ]
      );
      assert.deepEqual(
        events.map(({ eventSequence }) => eventSequence),
        [1, 2, 3, 4, 5]
      );
      assert.equal(
        events.every(
          (event) =>
            event.roomSessionId === input.handle.session.roomSessionId &&
            event.runtimeSessionId === input.handle.runtimeSessionId &&
            event.deliveryId === input.delivery.deliveryId
        ),
        true
      );
      assert.equal(
        events.filter(({ event }) =>
          event.type === 'delivery-completed' || event.type === 'error'
        ).length,
        1
      );
      assert.deepEqual(events.at(-1)?.event, {
        type: 'delivery-completed',
        disposition: 'responded',
      });
      const ready = events.find(({ event }) => event.type === 'message-ready');
      assertMatchesObject(ready?.event, {
        type: 'message-ready',
        message: {
          text: factory.expectedResponseText,
          mentions: [],
          attachments: [],
        },
      });
      assert.equal(harness.invocationCount(), 1);
    });

    test('observes without invoking the provider', async () => {
      const harness = factory.create('success');
      const opened = await harness.runtime.open(openInput());
      const input = handleInput(opened.handle, { intent: 'observe' });

      assertMatchesObject(await collect(harness.runtime.handle(input)), [
        {
          deliveryId: input.delivery.deliveryId,
          event: {
            type: 'delivery-completed',
            disposition: 'observed',
          },
        },
      ]);
      assert.equal(harness.invocationCount(), 0);
    });

    test('emits a single error terminal when the provider fails', async () => {
      const harness = factory.create('error');
      const opened = await harness.runtime.open(openInput());
      const events = await collect(
        harness.runtime.handle(handleInput(opened.handle))
      );

      assertMatchesObject(events.at(-1)?.event, {
        type: 'error',
        retryable: true,
      });
      assert.equal(
        events.filter(({ event }) =>
          event.type === 'delivery-completed' || event.type === 'error'
        ).length,
        1
      );
      assert.equal(
        events.some(({ event }) => event.type === 'message-ready'),
        false
      );
    });

    test('creates JSON checkpoints and resumes through fresh replay', async () => {
      const harness = factory.create('success');
      const opened = await harness.runtime.open(openInput());
      await collect(harness.runtime.handle(handleInput(opened.handle)));
      const checkpointResult = await harness.runtime.checkpoint({
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        requestId: 'checkpoint-1',
        handle: opened.handle,
        cursor: {
          messageSequence: 1,
          deliverySequence: 1,
          eventSequence: 5,
        },
        reason: 'idle',
      });

      assert.equal(checkpointResult.status, 'created');
      if (checkpointResult.status !== 'created') {
        throw new Error('Expected a checkpoint.');
      }
      assert.doesNotThrow(() => JSON.stringify(checkpointResult.checkpoint));
      assert.equal(
        JSON.stringify(checkpointResult.checkpoint).includes('secret-api-key'),
        false
      );

      const resumed = await harness.runtime.resume({
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        requestId: 'resume-1',
        session: session(),
        generation: 2,
        checkpoint: checkpointResult.checkpoint,
        context: context(),
        policy: policy(),
      });
      assert.equal(resumed.status, 'resumed');
      if (resumed.status !== 'resumed') {
        throw new Error('Expected a resumed session.');
      }
      assert.equal(resumed.handle.generation, 2);
      assert.notEqual(
        resumed.handle.runtimeSessionId,
        opened.handle.runtimeSessionId
      );

      const events = await collect(
        harness.runtime.handle(
          handleInput(resumed.handle, {
            delivery: delivery({
              deliveryId: 'delivery-2',
              deliverySequence: 2,
              message: message({ messageId: 'message-2', sequence: 2 }),
            }),
          })
        )
      );
      assert.ok((events[0]?.eventSequence ?? 0) > 5);

      const stale = await collect(
        harness.runtime.handle(
          handleInput(opened.handle, {
            delivery: delivery({
              deliveryId: 'delivery-stale',
              deliverySequence: 3,
              message: message({ messageId: 'message-3', sequence: 3 }),
            }),
          })
        )
      );
      assert.equal(stale.length, 1);
      assertMatchesObject(stale[0]?.event, {
        type: 'error',
        code: 'stale-runtime-handle',
        retryable: false,
      });
    });

    test('cancels and waits for the provider when iteration stops', async () => {
      const harness = factory.create('pending');
      const opened = await harness.runtime.open(openInput());
      const iterator = harness.runtime
        .handle(handleInput(opened.handle))
        [Symbol.asyncIterator]();

      assert.equal((await iterator.next()).value?.event.type, 'response-started');
      await iterator.return?.();

      assert.equal(harness.cancellationCount(), 1);
      assert.ok(harness.idleWaitCount() > 0);
      assertMatchesObject(await iterator.next(), { done: true });
    });
  });
}

export function session(overrides = {}) {
  return {
    organizationId: 'org-1',
    roomId: 'room-1',
    roomSessionId: 'room-session-1',
    agentConfigVersion: '1',
    agent: {
      agentId: 'agent-1',
      displayName: 'Researcher',
      handle: '@researcher',
    },
    ...overrides,
  };
}

export function message(
  overrides: Partial<RoomMessageEnvelopeV1> = {}
): RoomMessageEnvelopeV1 {
  return {
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    envelopeType: 'room.message',
    messageId: 'message-1',
    organizationId: 'org-1',
    roomId: 'room-1',
    sequence: 1,
    createdAt: '2026-08-21T00:00:00.000Z',
    actor: { type: 'human', userId: 'user-1' },
    text: 'Please investigate this.',
    mentions: [],
    attachments: [],
    ...overrides,
  };
}

export function context() {
  return {
    throughMessageSequence: 1,
    messages: [message()],
    summary: 'Current Room context.',
  };
}

export function policy() {
  return createQuietHostRoomPolicy({ hostAgentId: 'agent-1' });
}

export function openInput(
  overrides: Partial<OpenRoomSessionInputV1> = {}
): OpenRoomSessionInputV1 {
  return {
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    requestId: 'open-1',
    session: session(),
    generation: 1,
    context: context(),
    policy: policy(),
    ...overrides,
  };
}

export function delivery(
  overrides: Partial<RoomDeliveryEnvelopeV1> = {}
): RoomDeliveryEnvelopeV1 {
  return {
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    envelopeType: 'room.delivery',
    deliveryId: 'delivery-1',
    roomSessionId: 'room-session-1',
    deliverySequence: 1,
    attempt: 1,
    createdAt: '2026-08-21T00:00:01.000Z',
    target: session().agent,
    intent: 'respond',
    cause: { type: 'system', reason: 'test' },
    message: message(),
    ...overrides,
  };
}

export function handleInput(
  handle: HandleRoomDeliveryInputV1['handle'],
  overrides: Partial<HandleRoomDeliveryInputV1> & {
    intent?: RoomDeliveryEnvelopeV1['intent'];
  } = {}
): HandleRoomDeliveryInputV1 {
  const { intent, ...inputOverrides } = overrides;
  return {
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    handle,
    delivery:
      inputOverrides.delivery ?? delivery(intent ? { intent } : undefined),
    policy: policy(),
    ...inputOverrides,
  };
}

export async function collect(
  iterable: AsyncIterable<RoomRuntimeEventEnvelopeV1>
) {
  const events: RoomRuntimeEventEnvelopeV1[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}
