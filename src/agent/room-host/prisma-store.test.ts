import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import { ROOM_RUNTIME_CONTRACT_VERSION_V1 } from '@/agent/room-runtime/contracts';

import {
  createPrismaRoomHostStoreV1,
  ensureDefaultRoom,
  postRoomMessage,
  prisma,
} from '../../../.tmp/room-backend-test/room-backend.mjs';

const run = promisify(execFile);
const ACTOR = {
  organizationId: 'room-host-prisma-store-org',
  userId: 'room-host-prisma-store-user',
};
const BASE_TIME = new Date('2026-08-21T12:00:00.000Z');
const RUNTIME_ID = 'pi-agent-core';

let temporaryRoot = '';
let roomId = '';
let sessionId = '';
let deliveryId = '';

test.describe.serial('Prisma Room Host store claim binding contract', () => {
  test.beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tobe-room-host-prisma-store-')
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

  test('claims stored agentConfigVersion and fences runtime binding on snapshot drift', async () => {
    const store = createPrismaRoomHostStoreV1({
      organizationId: ACTOR.organizationId,
      prisma,
    });
    const storedSession = await prisma.roomAgentSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: {
        roomId: true,
        agentId: true,
        agentHandle: true,
        agentDisplayName: true,
        agentConfigVersion: true,
      },
    });

    const claim = await store.claim({
      roomSessionId: sessionId,
      runtimeId: RUNTIME_ID,
      workerId: 'room-host-worker',
      leaseDurationMs: 30_000,
      now: BASE_TIME,
    });
    expect(claim).not.toBeNull();
    if (!claim) throw new Error('Expected the seeded delivery to be claimed.');

    expect(claim.session).toEqual({
      organizationId: ACTOR.organizationId,
      roomId,
      roomSessionId: sessionId,
      agentConfigVersion: storedSession.agentConfigVersion,
      agent: {
        agentId: storedSession.agentId,
        handle: storedSession.agentHandle,
        ...(storedSession.agentDisplayName
          ? { displayName: storedSession.agentDisplayName }
          : {}),
      },
    });
    expect(claim.runtimeId).toBe(RUNTIME_ID);

    const baseHandle = {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      session: claim.session,
      runtimeId: claim.runtimeId,
      runtimeSessionId: 'runtime-session-1',
      generation: claim.lease.generation,
      openedAt: BASE_TIME.toISOString(),
    } as const;

    await expect(
      store.bindRuntime({
        lease: claim.lease,
        handle: { ...baseHandle, runtimeId: 'other-runtime' },
        now: BASE_TIME,
      })
    ).resolves.toBe('fenced');
    await expect(
      store.bindRuntime({
        lease: claim.lease,
        handle: {
          ...baseHandle,
          session: {
            ...claim.session,
            agentConfigVersion: `${claim.session.agentConfigVersion}-drifted`,
          },
        },
        now: BASE_TIME,
      })
    ).resolves.toBe('fenced');

    await expect(
      store.bindRuntime({
        lease: claim.lease,
        handle: baseHandle,
        now: BASE_TIME,
      })
    ).resolves.toBe('bound');

    await expect(
      prisma.roomAgentSession.findUniqueOrThrow({ where: { id: sessionId } })
    ).resolves.toMatchObject({
      id: sessionId,
      roomId,
      currentDeliveryId: deliveryId,
      runtimeId: RUNTIME_ID,
      runtimeSessionId: 'runtime-session-1',
      agentConfigVersion: storedSession.agentConfigVersion,
    });
  });
});

async function seedOrganization() {
  await prisma.organization.create({
    data: {
      id: ACTOR.organizationId,
      name: 'Room Host Prisma Store Org',
      slug: ACTOR.organizationId,
    },
  });
  await prisma.user.create({
    data: { id: ACTOR.userId, name: 'Room Host Prisma Store User' },
  });
  await prisma.organizationMembership.create({
    data: ACTOR,
  });
}
