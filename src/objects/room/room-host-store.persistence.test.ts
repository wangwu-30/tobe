import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import type { RoomRuntimeEventEnvelopeV1 } from '@/agent/room-runtime/contracts';
import type { PrismaRoomHostIdKindV1 } from '@/agent/room-host/prisma-store';
import type { RoomHostClaimV1 } from '@/agent/room-host/store';

import {
  createPrismaRoomHostStoreV1,
  ensureDefaultRoom,
  isRecord,
  postRoomMessage,
  prisma,
  safeJsonParse,
} from '../../../.tmp/room-backend-test/room-backend.mjs';

const run = promisify(execFile);
const ACTOR = {
  organizationId: 'room-host-store-org',
  userId: 'room-host-store-user',
};
const BASE_TIME = new Date('2026-08-21T12:00:00.000Z');
const RUNTIME_ID = 'pi-agent-core';
const RUNTIME_SESSION_ID = 'room-host-runtime-session';

let temporaryRoot = '';
let roomId = '';
let sessionId = '';
let deliveryId = '';

test.describe.serial('Prisma Room Host store persistence', () => {
  test.beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tobe-room-host-store-')
    );
    const databasePath = path.join(temporaryRoot, 'dev.db');
    process.env.DAO_APP_DATA_ROOT = temporaryRoot;
    process.env.DATABASE_URL = `file:${databasePath}`;
    await run(
      process.execPath,
      ['scripts/bootstrap-local-db.mjs', '--app-data-root', temporaryRoot],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DAO_APP_DATA_ROOT: temporaryRoot,
          DATABASE_URL: `file:${databasePath}`,
        },
      }
    );
    await seedOrganization();
    const room = await ensureDefaultRoom(ACTOR);
    roomId = room.id;
    const receipt = await postRoomMessage(ACTOR, roomId, {
      text: 'Persist this Room Host delivery.',
    });
    expect(receipt.deliveryIds).toHaveLength(1);
    deliveryId = receipt.deliveryIds[0] ?? '';
    const delivery = await prisma.roomInboxDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    });
    sessionId = delivery.roomSessionId;
    await prisma.roomInboxDelivery.update({
      where: { id: deliveryId },
      data: { availableAt: BASE_TIME },
    });
  });

  test.afterEach(async () => {
    await prisma.$disconnect();
    await fs.rm(temporaryRoot, { force: true, recursive: true });
  });

  test('claims and binds before appending one event/outbox, with exact replay deduplicated', async () => {
    const store = createStore();
    const claim = await claimAndBind(store);
    const event = runtimeEvent(claim, {
      type: 'response-started',
      responseId: 'response-1',
    });
    const before = await roomFactCounts();

    const appended = await store.appendEvent({
      lease: claim.lease,
      event,
      now: BASE_TIME,
    });
    expect(appended).toMatchObject({ status: 'appended' });

    const replay = await store.appendEvent({
      lease: claim.lease,
      event,
      now: BASE_TIME,
    });
    expect(replay).toEqual({
      status: 'duplicate',
      cursor: expect.objectContaining({ eventSequence: before.eventSequence + 1 }),
    });
    expect(await roomFactCounts()).toEqual({
      events: before.events + 1,
      eventSequence: before.eventSequence + 1,
      outbox: before.outbox + 1,
    });

    const persisted = await prisma.roomEvent.findFirstOrThrow({
      where: {
        organizationId: ACTOR.organizationId,
        roomId,
        type: 'room.runtime.response-started',
      },
    });
    const outbox = await prisma.roomOutbox.findMany({
      where: {
        organizationId: ACTOR.organizationId,
        roomId,
        topic: 'room.event.created',
        dedupeKey: persisted.id,
      },
    });
    expect(outbox).toHaveLength(1);
    expect(parseRecord(persisted.dataJson)).toMatchObject({
      kind: 'room-host.runtime-event',
      roomSessionId: sessionId,
      deliveryId,
      generation: claim.lease.generation,
      event: { eventId: event.eventId, event: event.event },
    });
    expect(parseRecord(outbox[0]?.payloadJson)).toMatchObject({
      eventId: persisted.id,
      roomId,
      type: persisted.type,
    });
  });

  test('atomically persists terminal and retry events/outbox rows while requeuing', async () => {
    const store = createStore();
    const claim = await claimAndBind(store);
    const now = new Date(BASE_TIME.getTime() + 1_000);
    const availableAt = new Date(BASE_TIME.getTime() + 60_000);
    const event = runtimeEvent(
      claim,
      {
        type: 'error',
        code: 'runtime-temporary',
        message: 'Runtime is temporarily unavailable.',
        retryable: true,
      },
      'runtime-terminal-1'
    );
    const failure = {
      kind: 'runtime' as const,
      code: 'runtime-temporary',
      message: 'Runtime is temporarily unavailable.',
      retryable: true,
    };
    const before = await roomFactCounts();

    await expect(
      store.retryDelivery({
        lease: claim.lease,
        event,
        failure,
        availableAt,
        now,
      })
    ).resolves.toBe('retried');

    expect(await roomFactCounts()).toEqual({
      events: before.events + 2,
      eventSequence: before.eventSequence + 2,
      outbox: before.outbox + 2,
    });
    const events: Array<{ id: string; sequence: number; type: string }> =
      await prisma.roomEvent.findMany({
      where: {
        organizationId: ACTOR.organizationId,
        roomId,
        type: { in: ['room.runtime.error', 'room.delivery.retrying'] },
      },
      orderBy: { sequence: 'asc' },
    });
    expect(events.map(({ type }) => type)).toEqual([
      'room.runtime.error',
      'room.delivery.retrying',
    ]);
    const outbox: Array<{ dedupeKey: string; payloadJson: string }> =
      await prisma.roomOutbox.findMany({
      where: {
        organizationId: ACTOR.organizationId,
        roomId,
        topic: 'room.event.created',
        dedupeKey: { in: events.map(({ id }) => id) },
      },
    });
    expect(outbox).toHaveLength(2);
    expect(outbox.map(({ dedupeKey }) => dedupeKey).sort()).toEqual(
      events.map(({ id }) => id).sort()
    );
    for (const persisted of events) {
      const matchingOutbox = outbox.find(
        ({ dedupeKey }) => dedupeKey === persisted.id
      );
      expect(matchingOutbox).toBeTruthy();
      expect(parseRecord(matchingOutbox?.payloadJson)).toMatchObject({
        eventId: persisted.id,
        roomId,
        type: persisted.type,
      });
    }

    await expect(
      prisma.roomInboxDelivery.findUniqueOrThrow({ where: { id: deliveryId } })
    ).resolves.toMatchObject({
      attempt: 2,
      availableAt,
      claimedAt: null,
      completedAt: null,
      lastError: failure.message,
      status: 'pending',
    });
    await expect(
      prisma.roomAgentSession.findUniqueOrThrow({ where: { id: sessionId } })
    ).resolves.toMatchObject({
      currentDeliveryId: null,
      generation: claim.lease.generation,
      lastEventSequence: events[1]?.sequence,
      leaseExpiresAt: null,
      leaseOwnerId: null,
    });
    await expect(
      store.listCandidates({
        runtimeIds: [RUNTIME_ID],
        limit: 1,
        now: new Date(availableAt.getTime() - 1),
      })
    ).resolves.toEqual([]);
    await expect(
      store.listCandidates({
        runtimeIds: [RUNTIME_ID],
        limit: 1,
        now: availableAt,
      })
    ).resolves.toEqual([{ roomSessionId: sessionId, runtimeId: RUNTIME_ID }]);
  });

  test('rolls back terminal facts when the retry transaction cannot publish both outbox rows', async () => {
    const store = createStore(() => 'colliding-outbox-id');
    const claim = await claimAndBind(store);
    const before = await roomFactCounts();
    const event = runtimeEvent(
      claim,
      {
        type: 'error',
        code: 'runtime-temporary',
        message: 'This transaction must roll back.',
        retryable: true,
      },
      'runtime-terminal-rollback'
    );

    await expect(
      store.retryDelivery({
        lease: claim.lease,
        event,
        failure: {
          kind: 'runtime',
          code: 'runtime-temporary',
          message: 'This transaction must roll back.',
          retryable: true,
        },
        availableAt: new Date(BASE_TIME.getTime() + 60_000),
        now: new Date(BASE_TIME.getTime() + 1_000),
      })
    ).rejects.toThrow();

    expect(await roomFactCounts()).toEqual(before);
    await expect(
      prisma.roomInboxDelivery.findUniqueOrThrow({ where: { id: deliveryId } })
    ).resolves.toMatchObject({ attempt: 1, status: 'claimed' });
    await expect(
      prisma.roomAgentSession.findUniqueOrThrow({ where: { id: sessionId } })
    ).resolves.toMatchObject({
      currentDeliveryId: deliveryId,
      generation: claim.lease.generation,
      leaseOwnerId: claim.lease.workerId,
    });
  });
});

function createStore(id?: (kind: PrismaRoomHostIdKindV1) => string) {
  let sequence = 0;
  return createPrismaRoomHostStoreV1({
    organizationId: ACTOR.organizationId,
    prisma,
    id: id ?? ((kind) => `room-host-store-${kind}-${++sequence}`),
  });
}

async function claimAndBind(store: ReturnType<typeof createStore>) {
  const claim = await store.claim({
    roomSessionId: sessionId,
    runtimeId: RUNTIME_ID,
    workerId: 'room-host-worker',
    leaseDurationMs: 30_000,
    now: BASE_TIME,
  });
  expect(claim).not.toBeNull();
  if (!claim) throw new Error('Expected the seeded delivery to be claimed.');
  expect(claim.delivery).toMatchObject({
    attempt: 1,
    deliveryId,
    roomSessionId: sessionId,
  });
  await expect(
    store.bindRuntime({
      lease: claim.lease,
      handle: {
        schemaVersion: 1,
        session: claim.session,
        runtimeId: RUNTIME_ID,
        runtimeSessionId: RUNTIME_SESSION_ID,
        generation: claim.lease.generation,
        openedAt: BASE_TIME.toISOString(),
      },
      now: BASE_TIME,
    })
  ).resolves.toBe('bound');
  return claim;
}

function runtimeEvent(
  claim: RoomHostClaimV1,
  event: RoomRuntimeEventEnvelopeV1['event'],
  eventId = 'runtime-event-1'
): RoomRuntimeEventEnvelopeV1 {
  return {
    schemaVersion: 1,
    envelopeType: 'room.runtime-event',
    eventId,
    eventSequence: 1,
    occurredAt: BASE_TIME.toISOString(),
    roomSessionId: claim.lease.roomSessionId,
    runtimeSessionId: RUNTIME_SESSION_ID,
    deliveryId: claim.lease.deliveryId,
    event,
  };
}

async function seedOrganization() {
  await prisma.organization.create({
    data: {
      id: ACTOR.organizationId,
      name: 'Room Host Store Org',
      slug: ACTOR.organizationId,
    },
  });
  await prisma.user.create({
    data: { id: ACTOR.userId, name: 'Room Host Store User' },
  });
  await prisma.organizationMembership.create({
    data: ACTOR,
  });
}

async function roomFactCounts() {
  const where = { organizationId: ACTOR.organizationId, roomId };
  const [room, events, outbox] = await Promise.all([
    prisma.room.findUniqueOrThrow({ where: { id: roomId } }),
    prisma.roomEvent.count({ where }),
    prisma.roomOutbox.count({ where }),
  ]);
  return { events, eventSequence: room.eventSequence, outbox };
}

function parseRecord(raw: string | null | undefined) {
  return safeJsonParse(raw, {}, isRecord);
}
