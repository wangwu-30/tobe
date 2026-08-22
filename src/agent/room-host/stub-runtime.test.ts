import assert from 'node:assert/strict';
import { test } from '@playwright/test';

import {
  ROOM_RUNTIME_CONTRACT_VERSION_V1,
  type HandleRoomDeliveryInputV1,
  type OpenRoomSessionInputV1,
  type RoomDeliveryEnvelopeV1,
  type RoomPolicyV1,
  type RoomRuntimeEventEnvelopeV1,
  type RoomSessionRefV1,
} from '@/agent/room-runtime/contracts';
import {
  createStubRoomSessionRuntimeV1,
  StubRoomSessionRuntimeV1,
} from './stub-runtime';

const NOW = new Date('2026-08-21T12:00:00.000Z');

test('describes checkpoint support and opens with injected deterministic identity', async () => {
  const runtime = createRuntime();
  const input = openInput();

  assert.deepEqual(await runtime.describe(), {
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    runtimeId: 'test-room-runtime',
    displayName: 'Deterministic stub Room runtime',
    runtimeVersion: 'test-v1',
    capabilities: {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      streaming: 'typed-events',
      resume: 'checkpoint',
      checkpoint: 'opaque-json',
      typedMentionOutput: false,
      delegationRequests: false,
    },
  });

  const result = await runtime.open(input);

  assert.deepEqual(result, {
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    handle: {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      session: session(),
      runtimeId: 'test-room-runtime',
      runtimeSessionId: 'runtime-session-1',
      generation: 3,
      openedAt: NOW.toISOString(),
    },
  });
  assert.equal(runtime.opens.length, 1);
  assert.equal(runtime.calls.opens[0], input);
  assert.deepEqual(runtime.calls.resumes, []);
  assert.deepEqual(runtime.calls.handles, []);
  assert.deepEqual(runtime.calls.checkpoints, []);
});

test('emits deterministic response events with isolated runtime-session sequences', async () => {
  const runtime = createRuntime({
    responseText: ({ delivery }) => `Acknowledged ${delivery.message.text}`,
  });
  const firstHandle = (await runtime.open(openInput())).handle;
  const otherHandle = (
    await runtime.open(
      openInput({
        session: session({
          roomSessionId: 'room-session-2',
          agent: { agentId: 'reviewer', handle: '@reviewer' },
        }),
      })
    )
  ).handle;

  const first = await collect(
    runtime.handle(handleInput(firstHandle, delivery({ deliveryId: 'delivery-1' })))
  );
  const second = await collect(
    runtime.handle(
      handleInput(
        firstHandle,
        delivery({
          deliveryId: 'delivery-2',
          deliverySequence: 2,
          message: message({ messageId: 'message-2', sequence: 2, text: 'Again' }),
        })
      )
    )
  );
  const other = await collect(
    runtime.handle(
      handleInput(
        otherHandle,
        delivery({
          deliveryId: 'delivery-3',
          roomSessionId: 'room-session-2',
          target: { agentId: 'reviewer', handle: '@reviewer' },
        })
      )
    )
  );

  assert.deepEqual(eventTypes(first), [
    'session-ready',
    'response-started',
    'text-delta',
    'message-ready',
    'delivery-completed',
  ]);
  assert.deepEqual(
    first.map((event) => event.eventSequence),
    [1, 2, 3, 4, 5]
  );
  assert.deepEqual(
    second.map((event) => event.eventSequence),
    [6, 7, 8, 9]
  );
  assert.deepEqual(
    other.map((event) => event.eventSequence),
    [1, 2, 3, 4, 5]
  );
  assert.deepEqual(
    [...first, ...second, ...other].map((event) => event.eventId),
    Array.from({ length: 14 }, (_, index) => `event-${index + 1}`)
  );

  assertResponse(first, 'response-1', 'Acknowledged Hello');
  assertResponse(second, 'response-2', 'Acknowledged Again');
  assertResponse(other, 'response-3', 'Acknowledged Hello');
  assert.ok(
    first.every(
      (event) =>
        event.occurredAt === NOW.toISOString() &&
        event.roomSessionId === 'room-session-1' &&
        event.runtimeSessionId === 'runtime-session-1' &&
        event.deliveryId === 'delivery-1'
    )
  );
  assert.equal(runtime.handles.length, 3);
});

test('observes without constructing response output', async () => {
  let responseCalls = 0;
  const runtime = createRuntime({
    response: () => {
      responseCalls += 1;
      return { text: 'must not be used', mentions: [] };
    },
  });
  const handle = (await runtime.open(openInput())).handle;

  const first = await collect(
    runtime.handle(
      handleInput(handle, delivery({ deliveryId: 'observe-1', intent: 'observe' }))
    )
  );
  const second = await collect(
    runtime.handle(
      handleInput(
        handle,
        delivery({
          deliveryId: 'observe-2',
          deliverySequence: 2,
          intent: 'observe',
        })
      )
    )
  );

  assert.deepEqual(eventTypes(first), ['session-ready', 'delivery-completed']);
  assert.deepEqual(eventTypes(second), ['delivery-completed']);
  assert.deepEqual(
    [...first, ...second].map((event) => event.eventSequence),
    [1, 2, 3]
  );
  assert.equal(first[1]?.event.type, 'delivery-completed');
  if (first[1]?.event.type === 'delivery-completed') {
    assert.equal(first[1].event.disposition, 'observed');
  }
  assert.equal(responseCalls, 0);
});

test('checkpoints runtime identity and resumes into a new generation-bound handle', async () => {
  const runtime = createRuntime();
  const originalHandle = (await runtime.open(openInput())).handle;
  await collect(
    runtime.handle(handleInput(originalHandle, delivery({ deliveryId: 'before-checkpoint' })))
  );

  const checkpointResult = await runtime.checkpoint({
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    requestId: 'checkpoint-request-1',
    handle: originalHandle,
    cursor: { messageSequence: 8, deliverySequence: 5, eventSequence: 5 },
    reason: 'idle',
  });
  assert.equal(checkpointResult.status, 'created');
  if (checkpointResult.status !== 'created') {
    assert.fail('Expected the stub runtime to create a checkpoint.');
  }
  assert.deepEqual(checkpointResult.checkpoint, {
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    envelopeType: 'room.checkpoint',
    checkpointId: 'checkpoint-1',
    createdAt: NOW.toISOString(),
    session: session(),
    runtimeId: 'test-room-runtime',
    runtimeVersion: 'test-v1',
    runtimeSessionId: 'runtime-session-1',
    generation: 3,
    cursor: { messageSequence: 8, deliverySequence: 5, eventSequence: 5 },
    runtimeState: {
      kind: 'stub-room-session',
      handledDeliveryIds: ['before-checkpoint'],
      lastEventSequence: 5,
    },
  });

  const resumed = await runtime.resume({
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    requestId: 'resume-request-1',
    session: session(),
    generation: 4,
    checkpoint: checkpointResult.checkpoint,
    context: { throughMessageSequence: 8, messages: [] },
    policy: policy(),
  });
  assert.equal(resumed.status, 'resumed');
  if (resumed.status !== 'resumed') {
    assert.fail('Expected the stub runtime to resume the checkpoint.');
  }
  assert.equal(resumed.handle.runtimeSessionId, 'runtime-session-2');
  assert.equal(resumed.handle.generation, 4);
  assert.deepEqual(resumed.handle.session, originalHandle.session);
  assert.equal(runtime.resumes.length, 1);
  assert.equal(runtime.checkpoints.length, 1);

  await assert.rejects(
    collect(
      runtime.handle(
        handleInput(originalHandle, delivery({ deliveryId: 'stale-delivery' }))
      )
    ),
    /no longer active/
  );

  const resumedEvents = await collect(
    runtime.handle(
      handleInput(
        resumed.handle,
        delivery({ deliveryId: 'resumed-delivery', deliverySequence: 6 })
      )
    )
  );
  assert.deepEqual(
    resumedEvents.map((event) => event.eventSequence),
    [1, 2, 3, 4, 5]
  );
  assert.ok(
    resumedEvents.every(
      (event) => event.runtimeSessionId === 'runtime-session-2'
    )
  );
  const resumedCheckpoint = await runtime.checkpoint({
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    requestId: 'checkpoint-request-2',
    handle: resumed.handle,
    cursor: { messageSequence: 9, deliverySequence: 6, eventSequence: 10 },
    reason: 'idle',
  });
  assert.equal(resumedCheckpoint.status, 'created');
  if (resumedCheckpoint.status === 'created') {
    assert.deepEqual(resumedCheckpoint.checkpoint.runtimeState, {
      kind: 'stub-room-session',
      handledDeliveryIds: ['before-checkpoint', 'resumed-delivery'],
      lastEventSequence: 5,
    });
  }
});

test('rejects mismatched checkpoints and delivery handles', async () => {
  const runtime = createRuntime();
  const handle = (await runtime.open(openInput())).handle;
  const checkpointResult = await runtime.checkpoint({
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    requestId: 'checkpoint-request-1',
    handle,
    cursor: { messageSequence: 0, deliverySequence: 0, eventSequence: 0 },
    reason: 'manual',
  });
  if (checkpointResult.status !== 'created') {
    assert.fail('Expected the stub runtime to create a checkpoint.');
  }

  await assert.rejects(
    runtime.resume({
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      requestId: 'resume-request-1',
      session: session({ roomId: 'another-room' }),
      generation: 4,
      checkpoint: checkpointResult.checkpoint,
      context: { throughMessageSequence: 0, messages: [] },
      policy: policy(),
    }),
    /different Room session/
  );
  await assert.rejects(
    collect(
      runtime.handle(
        handleInput(
          handle,
          delivery({ roomSessionId: 'another-room-session' })
        )
      )
    ),
    /different Room sessions/
  );
  await assert.rejects(
    runtime.checkpoint({
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      requestId: 'checkpoint-request-2',
      handle: { ...handle, generation: 2 },
      cursor: { messageSequence: 0, deliverySequence: 0, eventSequence: 0 },
      reason: 'manual',
    }),
    /Unknown Room runtime session/
  );
  await assert.rejects(
    runtime.resume({
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      requestId: 'resume-request-invalid-state',
      session: session(),
      generation: 4,
      checkpoint: {
        ...checkpointResult.checkpoint,
        runtimeState: { kind: 'unknown-checkpoint' },
      },
      context: { throughMessageSequence: 0, messages: [] },
      policy: policy(),
    }),
    /invalid stub Room runtime state/
  );
});

test('supports a deterministic delivery gate and typed failure event', async () => {
  const gate = deferred<void>();
  const entered = deferred<void>();
  const runtime = createRuntime({
    beforeHandle: async ({ delivery }) => {
      if (delivery.deliveryId === 'blocked-delivery') {
        entered.resolve();
        await gate.promise;
      }
    },
    handleFailure: ({ delivery: inputDelivery }) =>
      inputDelivery.deliveryId === 'blocked-delivery'
        ? {
            code: 'stub-unavailable',
            message: 'The configured stub failure occurred.',
            retryable: true,
          }
        : null,
  });
  const handle = (await runtime.open(openInput())).handle;
  const iterator = runtime
    .handle(handleInput(handle, delivery({ deliveryId: 'blocked-delivery' })))
    [Symbol.asyncIterator]();
  const firstEventPromise = iterator.next();

  await entered.promise;
  assert.equal(runtime.handles.length, 1);
  let settled = false;
  void firstEventPromise.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);

  gate.resolve();
  const first = await firstEventPromise;
  const second = await iterator.next();
  const done = await iterator.next();

  assert.equal(first.value.event.type, 'session-ready');
  assert.deepEqual(second.value.event, {
    type: 'error',
    code: 'stub-unavailable',
    message: 'The configured stub failure occurred.',
    retryable: true,
  });
  assert.equal(second.value.eventSequence, 2);
  assert.equal(done.done, true);
});

function createRuntime(
  overrides: ConstructorParameters<typeof StubRoomSessionRuntimeV1>[0] = {}
): StubRoomSessionRuntimeV1 {
  return createStubRoomSessionRuntimeV1({
    runtimeId: 'test-room-runtime',
    runtimeVersion: 'test-v1',
    clock: { now: () => new Date(NOW) },
    idFactory: (kind, sequence) => `${kind}-${sequence}`,
    ...overrides,
  });
}

function session(
  overrides: Partial<RoomSessionRefV1> = {}
): RoomSessionRefV1 {
  return {
    organizationId: 'org-1',
    roomId: 'room-1',
    roomSessionId: 'room-session-1',
    agentConfigVersion: '1',
    agent: {
      agentId: 'host',
      displayName: 'Host',
      handle: '@host',
    },
    ...overrides,
  };
}

function openInput(
  overrides: Partial<OpenRoomSessionInputV1> = {}
): OpenRoomSessionInputV1 {
  return {
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    requestId: 'open-request-1',
    session: session(),
    generation: 3,
    context: { throughMessageSequence: 0, messages: [] },
    policy: policy(),
    ...overrides,
  };
}

function policy(): RoomPolicyV1 {
  return {
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    participation: {
      mode: 'quiet-host',
      hostAgentId: 'host',
      unmentionedHostAction: 'observe',
    },
    delegation: { enabled: true, maxHops: 3, maxInvocations: 8 },
  };
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    envelopeType: 'room.message' as const,
    messageId: 'message-1',
    organizationId: 'org-1',
    roomId: 'room-1',
    sequence: 1,
    createdAt: NOW.toISOString(),
    actor: { type: 'human' as const, userId: 'user-1' },
    text: 'Hello',
    mentions: [],
    attachments: [],
    ...overrides,
  };
}

function delivery(
  overrides: Partial<RoomDeliveryEnvelopeV1> = {}
): RoomDeliveryEnvelopeV1 {
  return {
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    envelopeType: 'room.delivery',
    deliveryId: 'delivery-1',
    roomSessionId: 'room-session-1',
    deliverySequence: 1,
    attempt: 1,
    createdAt: NOW.toISOString(),
    target: { agentId: 'host', displayName: 'Host', handle: '@host' },
    intent: 'respond',
    cause: { type: 'system', reason: 'test' },
    message: message(),
    ...overrides,
  };
}

function handleInput(
  handle: Awaited<ReturnType<StubRoomSessionRuntimeV1['open']>>['handle'],
  inputDelivery: RoomDeliveryEnvelopeV1
): HandleRoomDeliveryInputV1 {
  return {
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    handle,
    delivery: inputDelivery,
    policy: policy(),
  };
}

async function collect<T>(input: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of input) {
    values.push(value);
  }
  return values;
}

function eventTypes(events: readonly RoomRuntimeEventEnvelopeV1[]): string[] {
  return events.map((event) => event.event.type);
}

function assertResponse(
  events: readonly RoomRuntimeEventEnvelopeV1[],
  responseId: string,
  text: string
): void {
  assert.equal(events.at(-4)?.event.type, 'response-started');
  assert.equal(events.at(-3)?.event.type, 'text-delta');
  assert.equal(events.at(-2)?.event.type, 'message-ready');
  assert.equal(events.at(-1)?.event.type, 'delivery-completed');

  const started = events.at(-4)?.event;
  const delta = events.at(-3)?.event;
  const ready = events.at(-2)?.event;
  const completed = events.at(-1)?.event;
  if (
    started?.type !== 'response-started' ||
    delta?.type !== 'text-delta' ||
    ready?.type !== 'message-ready' ||
    completed?.type !== 'delivery-completed'
  ) {
    assert.fail('Expected a complete response event lifecycle.');
  }

  assert.equal(started.responseId, responseId);
  assert.deepEqual(delta, { type: 'text-delta', responseId, text });
  assert.deepEqual(ready, {
    type: 'message-ready',
    responseId,
    message: { text, mentions: [] },
  });
  assert.equal(completed.disposition, 'responded');
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
