import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';
import type { Prisma } from '@/generated/prisma/client';
import { ConflictError } from '@/framework/resilience/app-error';

import {
  consumeRoomDelegationGrant,
  ensureDefaultRoom,
  getRoom,
  issueRoomDelegationGrant,
  listRoomEvents,
  listRoomMessages,
  postRoomMessage,
  PrismaRoomHostContextSourceV1,
  revokeRoomDelegationGrant,
  serializeRoomSseEvent,
  prisma,
  IdempotencyConflictError,
  builtinAssistantProfileIdV1,
  ensurePlatformContext,
  listAgentProfilesV1,
} from '../../../.tmp/room-backend-test/room-backend.mjs';

const run = promisify(execFile);
const ORG_A = { organizationId: 'room-org-a', userId: 'room-user-a' };
const ORG_B = { organizationId: 'room-org-b', userId: 'room-user-b' };
let temporaryRoot = '';
let roomId = '';
let hostAgentId = '';

type RoomSessionWithDeliveries = Prisma.RoomAgentSessionGetPayload<{
  include: { deliveries: true };
}>;

test.describe.serial('Project Room persistence and atomic router', () => {
  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tobe-room-'));
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
    await seedOrganization(ORG_A.organizationId, ORG_A.userId);
    await seedOrganization(ORG_B.organizationId, ORG_B.userId);
    const room = await ensureDefaultRoom(ORG_A);
    roomId = room.id;
    hostAgentId = room.hostAgentId;
    await prisma.agentProfile.createMany({
      data: [
        {
          handle: '@researcher',
          id: 'room-researcher-a',
          name: 'Researcher',
          organizationId: ORG_A.organizationId,
        },
        {
          handle: '@reviewer',
          id: 'room-reviewer-a',
          name: 'Reviewer',
          organizationId: ORG_A.organizationId,
        },
      ],
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
    await fs.rm(temporaryRoot, { force: true, recursive: true });
  });

  test('platform bootstrap installs one canonical coordinator while Agent reads stay pure', async () => {
    await Promise.all(Array.from({ length: 8 }, () => ensurePlatformContext()));

    const canonicalId = builtinAssistantProfileIdV1('local-org');
    const installed = await prisma.agentProfile.findMany({
      where: { organizationId: 'local-org', handle: '@assistant' },
    });
    expect(installed).toHaveLength(1);
    expect(installed[0]).toMatchObject({
      builtin: true,
      enabled: true,
      id: canonicalId,
    });

    await prisma.agentProfile.delete({ where: { id: canonicalId } });
    const listed = await listAgentProfilesV1(
      { organizationId: 'local-org', userId: 'local-user' },
      { includeDisabled: true }
    );
    expect(listed.agents).toEqual([]);
    expect(
      await prisma.agentProfile.count({
        where: { organizationId: 'local-org', handle: '@assistant' },
      })
    ).toBe(0);

    await ensurePlatformContext();
    expect(
      await prisma.agentProfile.count({
        where: { organizationId: 'local-org', handle: '@assistant' },
      })
    ).toBe(1);
  });

  test('replays an accepted command and conflicts on a changed payload', async () => {
    const options = { idempotencyKey: 'room-message-replay' };
    const first = await postRoomMessage(
      ORG_A,
      roomId,
      { text: 'A durable hello' },
      options
    );
    const replay = await postRoomMessage(
      ORG_A,
      roomId,
      { text: 'A durable hello' },
      options
    );

    expect(replay).toEqual(first);
    expect(
      await prisma.roomMessage.count({ where: { id: first.messageId } })
    ).toBe(1);
    expect(
      await prisma.roomEvent.count({ where: { id: first.eventId } })
    ).toBe(1);
    expect(
      await prisma.roomOutbox.count({
        where: { dedupeKey: first.messageId },
      })
    ).toBe(1);

    await expect(
      postRoomMessage(
        ORG_A,
        roomId,
        { text: 'Different content' },
        options
      )
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  test('rejects invalid structured mentions without any partial fact', async () => {
    const before = await roomFactCounts();
    await expect(
      postRoomMessage(
        ORG_A,
        roomId,
        {
          text: 'ask @researcher',
          mentions: [
            {
              type: 'agent',
              agentId: 'room-reviewer-a',
              handle: '@researcher',
              range: { start: 4, end: 15 },
            },
          ],
        },
        { idempotencyKey: 'invalid-mention' }
      )
    ).rejects.toThrow('routing validation failed');

    expect(await roomFactCounts()).toEqual(before);
    expect(
      await prisma.mutationRequest.count({
        where: { requestKey: 'invalid-mention' },
      })
    ).toBe(0);
  });

  test('routes multiple agents atomically and allocates FIFO delivery sequences', async () => {
    const text = '@researcher please pair with @reviewer';
    const first = await postRoomMessage(ORG_A, roomId, {
      text,
      mentions: [
        {
          type: 'agent',
          agentId: 'room-researcher-a',
          handle: '@researcher',
          range: { start: 0, end: 11 },
        },
        {
          type: 'agent',
          agentId: 'room-reviewer-a',
          handle: '@reviewer',
          range: { start: 29, end: 38 },
        },
      ],
    });
    const second = await postRoomMessage(ORG_A, roomId, {
      text: '@researcher follow up',
      mentions: [
        {
          type: 'agent',
          agentId: 'room-researcher-a',
          handle: '@researcher',
          range: { start: 0, end: 11 },
        },
      ],
    });

    expect(first.deliveryIds).toHaveLength(3);
    expect(second.deliveryIds).toHaveLength(2);
    const sessions = (await prisma.roomAgentSession.findMany({
      where: { organizationId: ORG_A.organizationId, roomId },
      include: { deliveries: { orderBy: { deliverySequence: 'asc' } } },
    })) as RoomSessionWithDeliveries[];
    const researcher = sessions.find(
      (session) => session.agentId === 'room-researcher-a'
    );
    const reviewer = sessions.find(
      (session) => session.agentId === 'room-reviewer-a'
    );
    const host = sessions.find((session) => session.agentId === hostAgentId);
    expect(researcher?.deliveries.map((delivery) => delivery.deliverySequence)).toEqual([1, 2]);
    expect(researcher?.deliveries.map((delivery) => delivery.intent)).toEqual(['respond', 'respond']);
    expect(reviewer?.deliveries).toHaveLength(1);
    expect(reviewer?.deliveries[0]?.intent).toBe('respond');
    expect(host?.deliveries.slice(-2).map((delivery) => delivery.intent)).toEqual(['observe', 'observe']);
  });

  test('loads a bounded Room delta for the claimed delivery', async () => {
    const receipts = [];
    for (let index = 1; index <= 4; index += 1) {
      receipts.push(
        await postRoomMessage(ORG_A, roomId, {
          text: `bounded context message ${index}`,
        })
      );
    }
    const session = await prisma.roomAgentSession.findFirstOrThrow({
      where: {
        agentId: hostAgentId,
        organizationId: ORG_A.organizationId,
        roomId,
      },
    });
    const delivery = await prisma.roomInboxDelivery.findFirstOrThrow({
      where: {
        messageId: receipts.at(-1)?.messageId,
        organizationId: ORG_A.organizationId,
        roomSessionId: session.id,
      },
    });
    const now = new Date('2026-08-21T12:00:00.000Z');
    const workerId = 'room-context-worker';
    const generation = session.generation + 1;
    await prisma.$transaction([
      prisma.roomAgentSession.update({
        where: { id: session.id },
        data: {
          currentDeliveryId: delivery.id,
          generation,
          leaseExpiresAt: new Date(now.valueOf() + 60_000),
          leaseOwnerId: workerId,
        },
      }),
      prisma.roomInboxDelivery.update({
        where: { id: delivery.id },
        data: { claimedAt: now, status: 'claimed' },
      }),
    ]);

    const contextSource = new PrismaRoomHostContextSourceV1({
      organizationId: ORG_A.organizationId,
      prisma,
      clock: { now: () => now },
      roomDeltaLimit: 2,
    });
    const context = await contextSource.load({
      schemaVersion: 1,
      session: {
        organizationId: ORG_A.organizationId,
        roomId,
        roomSessionId: session.id,
        agentConfigVersion: session.agentConfigVersion,
        agent: { agentId: hostAgentId, handle: '@assistant' },
      },
      delivery: {} as never,
      cursor: {} as never,
      lease: {
        roomSessionId: session.id,
        deliveryId: delivery.id,
        workerId,
        generation,
      },
    });

    expect(context.currentMessage.message.messageId).toBe(delivery.messageId);
    expect(
      context.relevantRoomDelta?.map(
        ({ message }: { message: { sequence: number } }) => message.sequence
      )
    ).toEqual([receipts[2]?.messageSequence, receipts[1]?.messageSequence]);
    expect(context.relevantRoomDelta).toHaveLength(2);
    expect(context.documentSlices).toEqual([]);
    expect(context.retrievalHits).toEqual([]);
  });

  test('fences context loads after the Room session generation advances', async () => {
    const receipt = await postRoomMessage(ORG_A, roomId, {
      text: 'fence this context load',
    });
    const session = await prisma.roomAgentSession.findFirstOrThrow({
      where: {
        agentId: hostAgentId,
        organizationId: ORG_A.organizationId,
        roomId,
      },
    });
    const delivery = await prisma.roomInboxDelivery.findFirstOrThrow({
      where: {
        messageId: receipt.messageId,
        organizationId: ORG_A.organizationId,
        roomSessionId: session.id,
      },
    });
    const now = new Date('2026-08-21T12:10:00.000Z');
    const workerId = 'room-context-fence-worker';
    const generation = session.generation + 1;
    await prisma.$transaction([
      prisma.roomAgentSession.update({
        where: { id: session.id },
        data: {
          currentDeliveryId: delivery.id,
          generation,
          leaseExpiresAt: new Date(now.valueOf() + 60_000),
          leaseOwnerId: workerId,
        },
      }),
      prisma.roomInboxDelivery.update({
        where: { id: delivery.id },
        data: { claimedAt: now, status: 'claimed' },
      }),
    ]);
    const input = {
      schemaVersion: 1 as const,
      session: {
        organizationId: ORG_A.organizationId,
        roomId,
        roomSessionId: session.id,
        agentConfigVersion: session.agentConfigVersion,
        agent: { agentId: hostAgentId, handle: '@assistant' },
      },
      delivery: {} as never,
      cursor: {} as never,
      lease: {
        roomSessionId: session.id,
        deliveryId: delivery.id,
        workerId,
        generation,
      },
    };
    const contextSource = new PrismaRoomHostContextSourceV1({
      organizationId: ORG_A.organizationId,
      prisma,
      clock: { now: () => now },
    });

    await expect(contextSource.load(input)).resolves.toMatchObject({
      currentMessage: { message: { messageId: receipt.messageId } },
    });
    await prisma.roomAgentSession.update({
      where: { id: session.id },
      data: { generation: { increment: 1 } },
    });
    await expect(contextSource.load(input)).rejects.toThrow(
      'Room context load was fenced or the session is no longer active.'
    );
  });

  test('durably delegates an instruction with exact replay and source fencing', async () => {
    const root = await postRoomMessage(ORG_A, roomId, {
      text: 'Coordinator, delegate this when authorized.',
    });
    const source = await claimDeliveryForDelegation(root.messageId, hostAgentId);
    const once = await issueRoomDelegationGrant(ORG_A, roomId, {
      fromAgentId: hostAgentId,
      rootMessageId: root.messageId,
      scope: 'once',
      targetAgentId: 'room-researcher-a',
    });
    const command = {
      instruction: 'Research the evidence and return a concise answer.',
      invocationId: 'room-once-invocation',
      source,
      targetAgentId: 'room-researcher-a',
    };
    const consumed = await consumeRoomDelegationGrant(ORG_A, roomId, command);
    expect(consumed.status).toBe('accepted');
    const replay = await consumeRoomDelegationGrant(ORG_A, roomId, command);
    expect(replay).toEqual(consumed);
    await expect(
      consumeRoomDelegationGrant(ORG_A, roomId, {
        ...command,
        instruction: 'A changed replay payload.',
      })
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      await prisma.roomDelegationInvocation.count({
        where: { invocationId: command.invocationId },
      })
    ).toBe(1);
    expect(
      await prisma.roomDelegationGrant.findUnique({ where: { id: once.id } })
    ).toMatchObject({
      consumedByInvocationId: command.invocationId,
      invocationCount: 1,
      status: 'consumed',
    });
    if (consumed.status !== 'accepted') throw new Error('Expected acceptance.');
    const instruction = await prisma.roomMessage.findUniqueOrThrow({
      where: { id: consumed.instructionMessageId },
    });
    const delivery = await prisma.roomInboxDelivery.findUniqueOrThrow({
      where: { id: consumed.deliveryId },
    });
    expect(instruction.text).toBe(command.instruction);
    expect(instruction.actorId).toBe(hostAgentId);
    expect(delivery.messageId).toBe(instruction.id);
    expect(delivery.messageId).not.toBe(root.messageId);

    await prisma.roomAgentSession.update({
      where: { id: source.roomSessionId },
      data: { generation: { increment: 1 } },
    });
    await expect(
      consumeRoomDelegationGrant(ORG_A, roomId, {
        ...command,
        invocationId: 'room-fenced-invocation',
      })
    ).rejects.toThrow('source lease is no longer active');
  });

  test('persists expiry and root/grant budget rejections for exact replay', async () => {
    const root = await postRoomMessage(ORG_A, roomId, {
      text: 'Exercise durable delegation limits.',
    });
    const source = await claimDeliveryForDelegation(root.messageId, hostAgentId);
    const expired = await issueRoomDelegationGrant(ORG_A, roomId, {
      fromAgentId: hostAgentId,
      rootMessageId: root.messageId,
      scope: 'room',
      targetAgentId: 'room-reviewer-a',
    });
    await prisma.roomDelegationGrant.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(0) },
    });
    const expiredCommand = {
      instruction: 'This must not be delivered.',
      invocationId: 'room-expired-invocation',
      source,
      targetAgentId: 'room-reviewer-a',
    };
    const expiredResult = await consumeRoomDelegationGrant(
      ORG_A,
      roomId,
      expiredCommand
    );
    expect(expiredResult).toMatchObject({
      invocationId: expiredCommand.invocationId,
      status: 'blocked',
      code: 'grant-expired',
    });
    expect(
      await consumeRoomDelegationGrant(ORG_A, roomId, expiredCommand)
    ).toEqual(expiredResult);

    const grant = await issueRoomDelegationGrant(ORG_A, roomId, {
      fromAgentId: hostAgentId,
      rootMessageId: root.messageId,
      scope: 'room',
      targetAgentId: 'room-researcher-a',
    });
    await prisma.roomDelegationGrant.update({
      where: { id: grant.id },
      data: { invocationCount: 1, invocationLimit: 1 },
    });
    const grantLimited = await consumeRoomDelegationGrant(ORG_A, roomId, {
      instruction: 'Grant budget is exhausted.',
      invocationId: 'room-grant-budget-invocation',
      source,
      targetAgentId: 'room-researcher-a',
    });
    expect(grantLimited).toMatchObject({
      status: 'blocked',
      code: 'grant-invocation-limit-reached',
    });

    await prisma.roomDelegationGrant.update({
      where: { id: grant.id },
      data: { invocationCount: 0, invocationLimit: 8 },
    });
    await prisma.roomDelegationRootBudget.upsert({
      where: {
        organizationId_roomId_rootMessageId: {
          organizationId: ORG_A.organizationId,
          roomId,
          rootMessageId: root.messageId,
        },
      },
      create: {
        organizationId: ORG_A.organizationId,
        roomId,
        rootMessageId: root.messageId,
        invocationCount: 1,
        invocationLimit: 1,
      },
      update: { invocationCount: 1, invocationLimit: 1 },
    });
    const rootLimited = await consumeRoomDelegationGrant(ORG_A, roomId, {
      instruction: 'Root budget is exhausted.',
      invocationId: 'room-root-budget-invocation',
      source,
      targetAgentId: 'room-researcher-a',
    });
    expect(rootLimited).toMatchObject({
      status: 'blocked',
      code: 'root-invocation-limit-reached',
    });
  });

  test('makes revoked delegation visible as a durable blocked receipt', async () => {
    const secondRoot = await postRoomMessage(ORG_A, roomId, {
      text: 'A second root for a revoked grant.',
    });
    const source = await claimDeliveryForDelegation(secondRoot.messageId, hostAgentId);

    const secondRoot = await postRoomMessage(ORG_A, roomId, {
      text: 'A second root for a revoked grant.',
    });
    const revocable = await issueRoomDelegationGrant(ORG_A, roomId, {
      fromAgentId: hostAgentId,
      rootMessageId: secondRoot.messageId,
      scope: 'room',
      targetAgentId: 'room-reviewer-a',
    });
    const revoked = await revokeRoomDelegationGrant(
      ORG_A,
      roomId,
      revocable.id
    );
    expect(revoked.status).toBe('revoked');
    const blocked = await consumeRoomDelegationGrant(ORG_A, roomId, {
      instruction: 'This revoked request must be blocked.',
      invocationId: 'room-revoked-invocation',
      source,
      targetAgentId: 'room-reviewer-a',
    });
    expect(blocked.status).toBe('blocked');
    expect(blocked.event.type).toBe('delegation_blocked');
    expect(
      await prisma.roomEvent.count({
        where: { id: blocked.event.eventId, type: 'delegation_blocked' },
      })
    ).toBe(1);
  });

  test('isolates organizations and serializes persisted replay events as SSE', async () => {
    const roomB = await ensureDefaultRoom(ORG_B);
    expect(roomB.id).not.toBe(roomId);
    expect(await getRoom(ORG_B, roomId)).toBeNull();
    await expect(listRoomMessages(ORG_B, roomId)).rejects.toThrow(
      'Room not found'
    );

    const events = await listRoomEvents(ORG_A, roomId, { after: 0, limit: 200 });
    expect(events.length).toBeGreaterThan(0);
    const event = events.at(-1);
    expect(event).toBeTruthy();
    if (!event) return;
    const frame = serializeRoomSseEvent(event);
    expect(frame).toContain(`id: ${event.sequence}\n`);
    expect(frame).toContain(`event: ${event.type}\n`);
    expect(frame).toContain(`data: ${JSON.stringify(event)}\n\n`);
    const replay = await listRoomEvents(ORG_A, roomId, {
      after: event.sequence - 1,
      limit: 1,
    });
    expect(replay).toEqual([event]);
  });
});

async function seedOrganization(organizationId: string, userId: string) {
  await prisma.organization.create({
    data: { id: organizationId, name: organizationId, slug: organizationId },
  });
  await prisma.user.create({
    data: { id: userId, name: userId },
  });
  await prisma.organizationMembership.create({
    data: { organizationId, userId },
  });
}

async function claimDeliveryForDelegation(messageId: string, agentId: string) {
  const session = await prisma.roomAgentSession.findFirstOrThrow({
    where: { agentId, organizationId: ORG_A.organizationId, roomId },
  });
  const delivery = await prisma.roomInboxDelivery.findFirstOrThrow({
    where: {
      messageId,
      organizationId: ORG_A.organizationId,
      roomSessionId: session.id,
    },
  });
  const generation = session.generation + 1;
  const workerId = `delegation-worker-${messageId}`;
  await prisma.$transaction([
    prisma.roomAgentSession.update({
      where: { id: session.id },
      data: {
        currentDeliveryId: delivery.id,
        generation,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        leaseOwnerId: workerId,
      },
    }),
    prisma.roomInboxDelivery.update({
      where: { id: delivery.id },
      data: { claimedAt: new Date(), status: 'claimed' },
    }),
  ]);
  return {
    deliveryId: delivery.id,
    generation,
    roomSessionId: session.id,
    workerId,
  };
}

async function roomFactCounts() {
  const where = { organizationId: ORG_A.organizationId, roomId };
  const [messages, mentions, deliveries, events, outbox] = await Promise.all([
    prisma.roomMessage.count({ where }),
    prisma.roomMention.count({ where }),
    prisma.roomInboxDelivery.count({ where }),
    prisma.roomEvent.count({ where }),
    prisma.roomOutbox.count({ where }),
  ]);
  return { deliveries, events, mentions, messages, outbox };
}
