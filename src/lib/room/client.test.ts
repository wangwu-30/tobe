import assert from 'node:assert/strict';
import test from 'node:test';
import { safeJsonParse } from '@/framework/resilience';
import {
  isRoomAgentMentionV1,
  isRoomDtoV1,
  isRoomJsonValueV1,
  isRoomMessageEnvelopeV1,
  isRoomPolicyV1,
  mapRoomEventV1,
  mapRoomV1,
  parseRoomAttachmentsJsonV1,
  parseRoomDeliveryCauseJsonV1,
} from '@/objects/room/schema';
import {
  getRoomActorFromHeaders,
  readRoomEnsureBody,
  readRoomMessageBody,
} from '@/app/api/rooms/_shared';

import {
  consumeRoomEventStream,
  getRoomEventMessage,
  issueRoomDelegationGrant,
  parseRoomSseFrame,
  revokeRoomDelegationGrant,
  sendRoomMessage,
} from './client';

const EVENT = {
  createdAt: '2026-08-21T10:00:00.000Z',
  data: { deliveries: [] },
  eventId: 'event-3',
  organizationId: 'org-1',
  roomId: 'room-1',
  schemaVersion: 1,
  sequence: 3,
  type: 'message.accepted',
} as const;

const GRANT = {
  consumedAt: null,
  consumedByInvocationId: null,
  createdAt: '2026-08-21T10:00:00.000Z',
  expiresAt: '2026-08-21T11:00:00.000Z',
  fromAgentId: 'agent-1',
  hopLimit: 2,
  id: 'grant/1',
  invocationCount: 0,
  invocationLimit: 1,
  issuedByUserId: 'user-1',
  organizationId: 'org-1',
  revokedAt: null,
  roomId: 'room/1',
  rootMessageId: null,
  schemaVersion: 1,
  scope: 'once',
  status: 'active',
  targetAgentId: 'agent-2',
  updatedAt: '2026-08-21T10:00:00.000Z',
} as const;

test('posts exact typed mentions with a stable correlation idempotency key', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;
  let requestHeaders = new Headers();

  globalThis.fetch = (async (_input, init) => {
    requestHeaders = new Headers(init?.headers);
    requestBody = safeJsonParse<unknown>(String(init?.body), null);
    return new Response(
      JSON.stringify({
        schemaVersion: 1,
        receipt: {
          deliveryIds: ['delivery-1', 'delivery-2'],
          eventId: 'event-1',
          eventSequence: 1,
          messageId: 'message-1',
          messageSequence: 1,
          roomId: 'room-1',
          schemaVersion: 1,
          status: 'accepted',
        },
      }),
      { headers: { 'Content-Type': 'application/json' }, status: 202 }
    );
  }) as typeof fetch;

  try {
    const result = await sendRoomMessage('room-1', {
      correlationId: 'room-web:request-1',
      mentions: [
        {
          agentId: 'agent-1',
          handle: '@analyst',
          range: { end: 8, start: 0 },
          type: 'agent',
        },
        {
          agentId: 'agent-2',
          handle: '@writer',
          range: { end: 16, start: 9 },
          type: 'agent',
        },
      ],
      replyToMessageId: 'message-root',
      text: '@analyst @writer review',
    });

    assert.equal(result.ok, true);
    assert.equal(
      requestHeaders.get('x-dao-idempotency-key'),
      'room-web:request-1'
    );
    assert.deepEqual(requestBody, {
      attachments: [],
      correlationId: 'room-web:request-1',
      mentions: [
        {
          agentId: 'agent-1',
          handle: '@analyst',
          range: { end: 8, start: 0 },
          type: 'agent',
        },
        {
          agentId: 'agent-2',
          handle: '@writer',
          range: { end: 16, start: 9 },
          type: 'agent',
        },
      ],
      metadata: {
        client: 'project-room-web',
        selectedAgentIds: ['agent-1', 'agent-2'],
      },
      replyToMessageId: 'message-root',
      schemaVersion: 1,
      text: '@analyst @writer review',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('issues a typed Room delegation grant with an idempotency key', async () => {
  const originalFetch = globalThis.fetch;
  const originalRandomUuid = crypto.randomUUID;
  let requestedUrl = '';
  let requestBody: unknown;
  let requestHeaders = new Headers();

  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    requestBody = safeJsonParse<unknown>(String(init?.body), null);
    return new Response(JSON.stringify({ schemaVersion: 1, grant: GRANT }), {
      headers: { 'Content-Type': 'application/json' },
      status: 201,
    });
  }) as typeof fetch;
  crypto.randomUUID = () => '00000000-0000-4000-8000-000000000001';

  try {
    const result = await issueRoomDelegationGrant('room/1', {
      fromAgentId: 'agent-1',
      rootMessageId: null,
      scope: 'once',
      targetAgentId: 'agent-2',
    });

    assert.deepEqual(result, { data: GRANT, ok: true });
    assert.equal(requestedUrl, '/api/rooms/room%2F1/grants');
    assert.equal(
      requestHeaders.get('x-dao-idempotency-key'),
      'room-web:grant:issue:00000000-0000-4000-8000-000000000001'
    );
    assert.deepEqual(requestBody, {
      fromAgentId: 'agent-1',
      schemaVersion: 1,
      scope: 'once',
      targetAgentId: 'agent-2',
    });
  } finally {
    crypto.randomUUID = originalRandomUuid;
    globalThis.fetch = originalFetch;
  }
});

test('revokes a typed Room delegation grant and rejects malformed responses', async () => {
  const originalFetch = globalThis.fetch;
  const originalRandomUuid = crypto.randomUUID;
  const requestedUrls: string[] = [];
  let requestHeaders = new Headers();
  let calls = 0;

  globalThis.fetch = (async (input, init) => {
    calls += 1;
    requestedUrls.push(String(input));
    requestHeaders = new Headers(init?.headers);
    return new Response(
      JSON.stringify(
        calls === 1
          ? {
              schemaVersion: 1,
              grant: {
                ...GRANT,
                revokedAt: '2026-08-21T10:01:00.000Z',
                status: 'revoked',
                updatedAt: '2026-08-21T10:01:00.000Z',
              },
            }
          : { schemaVersion: 1, grant: { id: 'grant/1' } }
      ),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;
  crypto.randomUUID = () => '00000000-0000-4000-8000-000000000002';

  try {
    const result = await revokeRoomDelegationGrant('room/1', 'grant/1');
    assert.equal(result.ok, true);
    assert.equal(
      requestedUrls[0],
      '/api/rooms/room%2F1/grants/grant%2F1/revoke'
    );
    assert.equal(
      requestHeaders.get('x-dao-idempotency-key'),
      'room-web:grant:revoke:00000000-0000-4000-8000-000000000002'
    );

    assert.deepEqual(await revokeRoomDelegationGrant('room/1', 'grant/1'), {
      error: 'Room grant response did not contain a valid grant.',
      ok: false,
      retryable: true,
    });
  } finally {
    crypto.randomUUID = originalRandomUuid;
    globalThis.fetch = originalFetch;
  }
});

test('parses SSE frames and resumes after the last durable event sequence', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestHeaders = new Headers();

  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(': connected\nretry: 1000\n\n'));
          controller.enqueue(
            encoder.encode(`id: 3\nevent: message.accepted\ndata: ${JSON.stringify(EVENT)}\n\n`)
          );
          controller.close();
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } }
    );
  }) as typeof fetch;

  try {
    const events: unknown[] = [];
    const states: string[] = [];
    const cursor = await consumeRoomEventStream(
      'room-1',
      2,
      new AbortController().signal,
      {
        onConnectionChange: (state) => states.push(state),
        onEvent: (event) => events.push(event),
      }
    );

    assert.ok(requestedUrl.includes('/events?format=sse&after=2'));
    assert.equal(requestHeaders.get('Last-Event-ID'), '2');
    assert.deepEqual(states, ['connecting', 'live']);
    assert.deepEqual(events, [EVENT]);
    assert.equal(cursor, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ignores comments and malformed SSE payloads', () => {
  assert.equal(parseRoomSseFrame(': heartbeat'), null);
  assert.equal(parseRoomSseFrame('data: {not-json}'), null);
  assert.deepEqual(
    parseRoomSseFrame(`id: 3\ndata: ${JSON.stringify(EVENT)}`),
    EVENT
  );
});

test('extracts both accepted human messages and created agent messages from Room events', () => {
  const message = {
    actor: {
      agentId: 'agent-1',
      displayName: 'Researcher',
      handle: '@researcher',
      type: 'agent',
    },
    attachments: [],
    createdAt: '2026-08-21T10:00:00.000Z',
    envelopeType: 'room.message',
    mentions: [],
    messageId: 'message-1',
    organizationId: 'org-1',
    roomId: 'room-1',
    schemaVersion: 1,
    sequence: 1,
    text: 'Research complete.',
  } as const;
  const event = {
    ...EVENT,
    data: { message },
  };

  assert.deepEqual(getRoomEventMessage(event), message);
  assert.deepEqual(
    getRoomEventMessage({
      ...event,
      type: 'room.message.created',
    }),
    message
  );
  assert.equal(
    getRoomEventMessage({
      ...event,
      type: 'room.delivery.completed',
    }),
    null
  );
  assert.equal(
    getRoomEventMessage({
      ...event,
      data: { message: { ...message, sequence: 1.5 } },
    }),
    null
  );
});

test('bounds streamed Room request bodies by actual bytes and stabilizes cancellation errors', async () => {
  const prefix = new TextEncoder().encode('{"projectId":"');
  const suffix = new TextEncoder().encode('"}');
  const valueBytes = 1_000_001 - prefix.byteLength - suffix.byteLength;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(prefix);
      controller.enqueue(new Uint8Array(valueBytes).fill(97));
      controller.enqueue(suffix);
    },
    cancel() {
      cancelled = true;
      return Promise.reject(new Error('hostile cancellation'));
    },
  });

  await assert.rejects(
    readRoomEnsureBody(
      new Request('http://localhost/api/rooms', {
        body,
        duplex: 'half',
        method: 'POST',
      } as RequestInit)
    ),
    /Request body is too large\./
  );
  assert.equal(cancelled, true);
});

test('rejects invalid UTF-8 and bounded metadata from Room message bodies', async () => {
  const invalidUtf8 = new Request('http://localhost/api/rooms/one/messages', {
    body: new Uint8Array([0xc3, 0x28]),
    duplex: 'half',
    method: 'POST',
  } as RequestInit);
  await assert.rejects(
    readRoomMessageBody(invalidUtf8),
    /Request body must be valid UTF-8\./
  );

  let metadata: unknown = 'leaf';
  for (let index = 0; index < 33; index += 1) {
    metadata = { child: metadata };
  }
  await assert.rejects(
    readRoomMessageBody(
      new Request('http://localhost/api/rooms/one/messages', {
        body: JSON.stringify({ metadata, text: 'hello' }),
        method: 'POST',
      })
    ),
    /metadata must be finite JSON/
  );
});

test('bootstraps only headerless Room actors and validates every explicit identity', async () => {
  let bootstraps = 0;
  let checkedActor: unknown;
  const dependencies = {
    getLocalContext: async () => {
      bootstraps += 1;
      return {
        deviceId: 'local-device',
        organizationId: 'local-org',
        userId: 'local-user',
      };
    },
    isExistingContext: async (actor: unknown) => {
      checkedActor = actor;
      return true;
    },
  };

  assert.deepEqual(await getRoomActorFromHeaders(new Headers(), dependencies), {
    deviceId: 'local-device',
    organizationId: 'local-org',
    userId: 'local-user',
  });
  assert.equal(bootstraps, 1);

  const explicitLocal = new Headers({
    'x-dao-device-id': 'local-device',
    'x-dao-organization-id': 'local-org',
    'x-dao-user-id': 'local-user',
  });
  await assert.rejects(
    getRoomActorFromHeaders(explicitLocal, {
      ...dependencies,
      isExistingContext: async (actor: unknown) => {
        checkedActor = actor;
        return false;
      },
    }),
    /Room actor headers are not authorized\./
  );
  assert.deepEqual(checkedActor, {
    deviceId: 'local-device',
    organizationId: 'local-org',
    userId: 'local-user',
  });
  assert.equal(bootstraps, 1);

  const custom = new Headers({
    'x-dao-device-id': 'device-2',
    'x-dao-organization-id': 'org-2',
    'x-dao-user-id': 'user-2',
  });
  assert.deepEqual(await getRoomActorFromHeaders(custom, dependencies), {
    deviceId: 'device-2',
    organizationId: 'org-2',
    userId: 'user-2',
  });
  assert.deepEqual(checkedActor, {
    deviceId: 'device-2',
    organizationId: 'org-2',
    userId: 'user-2',
  });

  await assert.rejects(
    getRoomActorFromHeaders(custom, {
      ...dependencies,
      isExistingContext: async () => false,
    }),
    /Room actor headers are not authorized\./
  );
  assert.equal(bootstraps, 1);
});

test('requires exact Room DTO shapes, canonical dates, and matching policy hosts', () => {
  const policy = {
    delegation: { enabled: true, maxHops: 3, maxInvocations: 8 },
    participation: {
      hostAgentId: 'host',
      mode: 'quiet-host',
      unmentionedHostAction: 'observe',
    },
    schemaVersion: 1,
  } as const;
  const room = {
    createdAt: '2026-08-21T10:00:00.000Z',
    eventSequence: 0,
    hostAgentId: 'host',
    id: 'room-1',
    key: 'default',
    messageSequence: 0,
    name: 'Project Room',
    organizationId: 'org-1',
    policy,
    projectId: null,
    schemaVersion: 1,
    updatedAt: '2026-08-21T10:00:00.000Z',
  } as const;

  assert.equal(isRoomPolicyV1(policy), true);
  assert.equal(isRoomPolicyV1({ ...policy, extra: true }), false);
  assert.equal(
    isRoomPolicyV1({
      ...policy,
      participation: { ...policy.participation, extra: true },
    }),
    false
  );
  assert.equal(isRoomDtoV1(room), true);
  assert.equal(isRoomDtoV1({ ...room, extra: true }), false);
  assert.equal(
    isRoomDtoV1({
      ...room,
      policy: {
        ...policy,
        participation: { ...policy.participation, hostAgentId: 'other' },
      },
    }),
    false
  );
  assert.equal(
    isRoomDtoV1({
      ...room,
      createdAt: '2026-08-21T10:00:00Z',
    }),
    false
  );
});

test('requires plain bounded JSON and exact nested persisted DTO shapes', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(isRoomJsonValueV1(cyclic), false);
  assert.equal(isRoomJsonValueV1(new Date()), false);
  assert.equal(isRoomJsonValueV1(new Array(10_000).fill(null)), false);
  assert.equal(
    isRoomAgentMentionV1({
      agentId: 'agent-1',
      handle: '@agent',
      range: { end: 6, extra: true, start: 0 },
      type: 'agent',
    }),
    false
  );

  const message = {
    actor: { type: 'system', systemId: 'router' },
    attachments: [],
    createdAt: '2026-08-21T10:00:00.000Z',
    envelopeType: 'room.message',
    mentions: [],
    messageId: 'message-1',
    organizationId: 'org-1',
    roomId: 'room-1',
    schemaVersion: 1,
    sequence: 1,
    text: 'hello',
  } as const;
  assert.equal(isRoomMessageEnvelopeV1(message), true);
  assert.equal(
    isRoomMessageEnvelopeV1({
      ...message,
      actor: { ...message.actor, elevated: true },
    }),
    false
  );

  assert.throws(
    () =>
      parseRoomAttachmentsJsonV1(
        JSON.stringify([
          {
            attachmentId: 'attachment-1',
            extra: true,
            mediaType: 'text/plain',
          },
        ])
      ),
    /Stored room message attachments is invalid\./
  );
  assert.throws(
    () =>
      parseRoomDeliveryCauseJsonV1(
        JSON.stringify({
          extra: true,
          type: 'room-observation',
        })
      ),
    /Stored room delivery cause is invalid\./
  );
});

test('rejects invalid persisted Room scalar data and noncanonical timestamp strings', () => {
  const record = {
    createdAt: '2026-08-21T10:00:00.000Z',
    createdByUserId: 'user-1',
    eventSequence: 0,
    hostAgentId: 'host',
    id: 'room-1',
    key: 'default',
    messageSequence: 0,
    name: 'Project Room',
    organizationId: 'org-1',
    policyJson: JSON.stringify({
      delegation: { enabled: true, maxHops: 3, maxInvocations: 8 },
      participation: {
        hostAgentId: 'host',
        mode: 'quiet-host',
        unmentionedHostAction: 'observe',
      },
      schemaVersion: 1,
    }),
    projectId: null,
    updatedAt: '2026-08-21T10:00:00.000Z',
  };

  assert.throws(
    () => mapRoomV1({ ...record, id: ' ' }),
    /Stored room room is invalid\./
  );
  assert.throws(
    () =>
      mapRoomV1({
        ...record,
        createdAt: '2026-08-21T10:00:00Z',
      }),
    /Stored room createdAt is invalid\./
  );
  assert.throws(
    () =>
      mapRoomV1({
        ...record,
        policyJson: record.policyJson.replace(
          '"hostAgentId":"host"',
          '"hostAgentId":"other"'
        ),
      }),
    /Stored room policy host agent is invalid\./
  );
  assert.throws(
    () =>
      mapRoomEventV1({
        createdAt: record.createdAt,
        dataJson: '{}',
        id: '',
        organizationId: 'org-1',
        roomId: 'room-1',
        sequence: 1,
        type: 'message.accepted',
      }),
    /Stored room event is invalid\./
  );
});
