import { expect, test } from '@playwright/test';

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
  test.describe(`${name} RoomSessionRuntimePortV1 compliance`, () => {
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

      expect(await runtime.describe()).toEqual(descriptor);
      expect(descriptor).toMatchObject({
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        runtimeId: factory.expectedRuntimeId,
      });
      expect(first.handle).toMatchObject({
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        session: session(),
        generation: 1,
        runtimeId: factory.expectedRuntimeId,
      });
      expect(first.handle.runtimeSessionId).not.toBe('');
      expect(second.handle.runtimeSessionId).not.toBe(
        first.handle.runtimeSessionId
      );
    });

    test('emits ordered response events with one terminal event', async () => {
      const harness = factory.create('success');
      const opened = await harness.runtime.open(openInput());
      const input = handleInput(opened.handle);
      const events = await collect(harness.runtime.handle(input));

      expect(events.map(({ event }) => event.type)).toEqual([
        'response-started',
        'text-delta',
        'text-delta',
        'message-ready',
        'delivery-completed',
      ]);
      expect(events.map(({ eventSequence }) => eventSequence)).toEqual([
        1, 2, 3, 4, 5,
      ]);
      expect(
        events.every(
          (event) =>
            event.roomSessionId === input.handle.session.roomSessionId &&
            event.runtimeSessionId === input.handle.runtimeSessionId &&
            event.deliveryId === input.delivery.deliveryId
        )
      ).toBe(true);
      expect(
        events.filter(({ event }) =>
          event.type === 'delivery-completed' || event.type === 'error'
        )
      ).toHaveLength(1);
      expect(events.at(-1)?.event).toEqual({
        type: 'delivery-completed',
        disposition: 'responded',
      });
      const ready = events.find(({ event }) => event.type === 'message-ready');
      expect(ready?.event).toMatchObject({
        type: 'message-ready',
        message: {
          text: factory.expectedResponseText,
          mentions: [],
          attachments: [],
        },
      });
      expect(harness.invocationCount()).toBe(1);
    });

    test('observes without invoking the provider', async () => {
      const harness = factory.create('success');
      const opened = await harness.runtime.open(openInput());
      const input = handleInput(opened.handle, { intent: 'observe' });

      await expect(collect(harness.runtime.handle(input))).resolves.toMatchObject([
        {
          deliveryId: input.delivery.deliveryId,
          event: {
            type: 'delivery-completed',
            disposition: 'observed',
          },
        },
      ]);
      expect(harness.invocationCount()).toBe(0);
    });

    test('emits a single error terminal when the provider fails', async () => {
      const harness = factory.create('error');
      const opened = await harness.runtime.open(openInput());
      const events = await collect(
        harness.runtime.handle(handleInput(opened.handle))
      );

      expect(events.at(-1)?.event).toMatchObject({
        type: 'error',
        retryable: true,
      });
      expect(
        events.filter(({ event }) =>
          event.type === 'delivery-completed' || event.type === 'error'
        )
      ).toHaveLength(1);
      expect(events.some(({ event }) => event.type === 'message-ready')).toBe(
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

      expect(checkpointResult.status).toBe('created');
      if (checkpointResult.status !== 'created') {
        throw new Error('Expected a checkpoint.');
      }
      expect(() => JSON.stringify(checkpointResult.checkpoint)).not.toThrow();
      expect(JSON.stringify(checkpointResult.checkpoint)).not.toContain(
        'secret-api-key'
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
      expect(resumed.status).toBe('resumed');
      if (resumed.status !== 'resumed') {
        throw new Error('Expected a resumed session.');
      }
      expect(resumed.handle.generation).toBe(2);
      expect(resumed.handle.runtimeSessionId).not.toBe(
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
      expect(events[0]?.eventSequence).toBeGreaterThan(5);

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
      expect(stale).toHaveLength(1);
      expect(stale[0]?.event).toMatchObject({
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

      expect((await iterator.next()).value?.event.type).toBe('response-started');
      await iterator.return?.();

      expect(harness.cancellationCount()).toBe(1);
      expect(harness.idleWaitCount()).toBeGreaterThan(0);
      expect(await iterator.next()).toMatchObject({ done: true });
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
