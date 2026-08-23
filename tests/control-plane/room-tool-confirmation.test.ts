import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';
import type {
  AgentToolConfirmationAuthority,
  AgentToolConfirmationRequest,
  AgentToolConfirmationRequestReceiptV1,
} from '../../src/agent/tool-policy';
import type { RoomEvent } from '../../src/generated/prisma/client';
import type { ExecutionJobReceiptV1 } from '../../src/objects/execution-job';
import type {
  RoomToolConfirmationActor,
  RoomToolConfirmationBinding,
  RoomToolConfirmationRequestDtoV1,
} from '../../src/objects/room-tool-confirmation';

import {
  approveRoomToolConfirmation,
  canonicalizeRoomToolParameters,
  createPrismaRoomToolConfirmationAuthority,
  ForbiddenError,
  hashRoomToolParameters,
  listRoomToolConfirmations,
  prisma,
  rejectRoomToolConfirmation,
  requestRoomToolConfirmation,
  ValidationError,
} from '../../.tmp/room-tool-confirmation-test/room-tool-confirmation.mjs';

const run = promisify(execFile);
const ORGANIZATION_ID = 'confirmation-org';
const OWNER_ID = 'confirmation-owner';
const MEMBER_ID = 'confirmation-member';
const OUTSIDER_ID = 'confirmation-outsider';
const ROOM_ID = 'confirmation-room';
const MESSAGE_ID = 'confirmation-message';
const ROOM_SESSION_ID = 'confirmation-room-session';
const DELIVERY_ID = 'confirmation-delivery';
const WORKSPACE_SESSION_ID = 'confirmation-workspace-session';
const WORKSPACE_ID = 'confirmation-workspace';
const ALIGNED_VERSION_ID = 'confirmation-version-aligned';
const UNALIGNED_VERSION_ID = 'confirmation-version-unaligned';
const TOOL_NAME = 'start_execution_job';
const PARAMETERS = {
  requirements: {
    structuredArtifacts: true,
    streaming: 'typed-events',
    sandbox: ['container'],
    features: ['typed-events', 'durable-confirmation'],
  },
  kind: 'coding',
  goal: 'Run focused checks',
  documentVersionId: ALIGNED_VERSION_ID,
};
const CANONICAL_PARAMETERS =
  '{"documentVersionId":"confirmation-version-aligned","goal":"Run focused checks","kind":"coding","requirements":{"features":["typed-events","durable-confirmation"],"sandbox":["container"],"streaming":"typed-events","structuredArtifacts":true}}';

let temporaryRoot = '';

type ConfirmationEventPayload = {
  schemaVersion: 1;
  request: RoomToolConfirmationRequestDtoV1;
};

test.describe.serial('durable Room tool confirmation requests', () => {
  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tobe-room-confirmation-')
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

    await prisma.organization.create({
      data: {
        id: ORGANIZATION_ID,
        name: 'Confirmation Organization',
        slug: ORGANIZATION_ID,
      },
    });
    await prisma.user.createMany({
      data: [
        { id: OWNER_ID, name: 'Confirmation Owner' },
        { id: MEMBER_ID, name: 'Confirmation Member' },
        { id: OUTSIDER_ID, name: 'Confirmation Outsider' },
      ],
    });
    await prisma.organizationMembership.createMany({
      data: [
        { organizationId: ORGANIZATION_ID, userId: OWNER_ID, role: 'owner' },
        { organizationId: ORGANIZATION_ID, userId: MEMBER_ID, role: 'member' },
      ],
    });
    await prisma.session.create({
      data: {
        id: WORKSPACE_SESSION_ID,
        organizationId: ORGANIZATION_ID,
        title: 'Confirmation workspace conversation',
        createdByUserId: OWNER_ID,
      },
    });
    await prisma.document.create({
      data: {
        id: WORKSPACE_ID,
        organizationId: ORGANIZATION_ID,
        sessionId: WORKSPACE_SESSION_ID,
        title: 'Confirmation Workspace',
        content: '[]',
        currentVersion: 2,
        createdByUserId: OWNER_ID,
      },
    });
    await prisma.version.createMany({
      data: [
        {
          id: ALIGNED_VERSION_ID,
          organizationId: ORGANIZATION_ID,
          documentId: WORKSPACE_ID,
          versionNum: 1,
          title: 'Aligned confirmation version',
          content: '[]',
          createdByUserId: OWNER_ID,
        },
        {
          id: UNALIGNED_VERSION_ID,
          organizationId: ORGANIZATION_ID,
          documentId: WORKSPACE_ID,
          versionNum: 2,
          title: 'Unaligned confirmation version',
          content: '[]',
          createdByUserId: OWNER_ID,
        },
      ],
    });
    await prisma.label.createMany({
      data: [
        {
          organizationId: ORGANIZATION_ID,
          versionId: ALIGNED_VERSION_ID,
          kind: 'milestone',
          name: 'Milestone',
          createdByUserId: OWNER_ID,
        },
        {
          organizationId: ORGANIZATION_ID,
          versionId: ALIGNED_VERSION_ID,
          kind: 'aligned',
          name: 'Aligned',
          createdByUserId: OWNER_ID,
        },
        {
          organizationId: ORGANIZATION_ID,
          versionId: UNALIGNED_VERSION_ID,
          kind: 'milestone',
          name: 'Milestone',
          createdByUserId: OWNER_ID,
        },
      ],
    });
    await prisma.room.create({
      data: {
        id: ROOM_ID,
        organizationId: ORGANIZATION_ID,
        hostAgentId: 'confirmation-host-agent',
        key: 'confirmation-room-key',
        name: 'Confirmation Room',
        policyJson: '{}',
        messageSequence: 1,
      },
    });
    await prisma.roomMessage.create({
      data: {
        id: MESSAGE_ID,
        organizationId: ORGANIZATION_ID,
        roomId: ROOM_ID,
        sequence: 1,
        actorType: 'user',
        actorId: OWNER_ID,
        text: 'Please run the confirmed tool.',
      },
    });
    await prisma.roomAgentSession.create({
      data: {
        id: ROOM_SESSION_ID,
        organizationId: ORGANIZATION_ID,
        roomId: ROOM_ID,
        agentId: 'confirmation-agent',
        agentHandle: '@confirmation-agent',
        deliverySequence: 1,
        lastRoomSequence: 1,
      },
    });
    await prisma.roomInboxDelivery.create({
      data: {
        id: DELIVERY_ID,
        organizationId: ORGANIZATION_ID,
        roomId: ROOM_ID,
        roomSessionId: ROOM_SESSION_ID,
        messageId: MESSAGE_ID,
        deliverySequence: 1,
        intent: 'mention',
        causeJson: '{}',
        status: 'claimed',
        claimedAt: new Date(),
      },
    });
    await prisma.roomAgentSession.update({
      where: { id: ROOM_SESSION_ID },
      data: { currentDeliveryId: DELIVERY_ID },
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
    await fs.rm(temporaryRoot, { force: true, recursive: true });
  });

  test('persists the exact structured parameters canonically and exposes no bearer secret', async () => {
    const resolvedBindings: unknown[] = [];
    const authority = createPrismaRoomToolConfirmationAuthority({
      expiresInMs: 60_000,
      resolveBinding() {
        const value = confirmationBinding();
        resolvedBindings.push(value);
        return value;
      },
    }) as AgentToolConfirmationAuthority;
    const request: AgentToolConfirmationRequest =
      confirmationRequest('canonical-call');

    expect(await authority.consumeConfirmation(request)).toBe(false);
    const receipt = await authority.requestConfirmation!(request);
    const stored = await prisma.roomToolConfirmationRequest.findUniqueOrThrow({
      where: { id: receipt.requestId },
    });

    expect(resolvedBindings).toEqual([confirmationBinding()]);
    expect(stored).toMatchObject({
      organizationId: ORGANIZATION_ID,
      requestedByUserId: OWNER_ID,
      roomId: ROOM_ID,
      roomMessageId: MESSAGE_ID,
      roomSessionId: ROOM_SESSION_ID,
      deliveryId: DELIVERY_ID,
      toolCallId: 'canonical-call',
      toolName: TOOL_NAME,
      safetyLevel: 'confirm',
      writePolicy: 'organization-scoped-append',
      workspaceId: WORKSPACE_ID,
      projectId: null,
      status: 'pending',
      revision: 1,
      capabilityHash: null,
      executionJobId: null,
    });
    expect(stored.parametersJson).toBe(CANONICAL_PARAMETERS);
    expect(stored.parametersJson).toBe(
      canonicalizeRoomToolParameters(PARAMETERS)
    );
    expect(stored.parametersHash).toBe(hashRoomToolParameters(PARAMETERS));
    expect(receipt).toEqual({
      schemaVersion: 1,
      requestId: stored.id,
      expiresAt: stored.expiresAt.toISOString(),
    });
    expectNoBearerSecret(receipt);

    const listed = await listRoomToolConfirmations(member(), {
      roomId: ROOM_ID,
      status: 'pending',
    });
    const dto = listed.find(
      (item: RoomToolConfirmationRequestDtoV1) => item.id === stored.id
    );
    expect(dto).toMatchObject({
      schemaVersion: 1,
      id: stored.id,
      parameters: PARAMETERS,
      parametersHash: stored.parametersHash,
      status: 'pending',
      revision: 1,
      executionJobReceipt: null,
    });
    expectNoBearerSecret(dto);

    const events = await confirmationEvents(stored.id);
    expect(events.map((event: RoomEvent) => event.type)).toEqual([
      'room.tool_confirmation.requested',
    ]);
    const requestedEvent = parseConfirmationEventPayload(events[0].dataJson);
    expect(requestedEvent).not.toBeNull();
    expect(requestedEvent).toEqual({
      schemaVersion: 1,
      request: expect.objectContaining({
        id: stored.id,
        toolCallId: 'canonical-call',
        toolName: TOOL_NAME,
        parameters: PARAMETERS,
        parametersHash: stored.parametersHash,
        status: 'pending',
        revision: 1,
      }),
    });
    expectNoBearerSecret(requestedEvent);

    expect(() =>
      canonicalizeRoomToolParameters({ silentlyDropped: undefined })
    ).toThrow(ValidationError);
    expect(() =>
      canonicalizeRoomToolParameters({ nonFinite: Number.NaN })
    ).toThrow(ValidationError);
  });

  test('replays the same binding idempotently but conflicts on changed parameters', async () => {
    const firstNow = new Date();
    const first = await requestRoomToolConfirmation(
      confirmationBinding(),
      confirmationRequest('request-replay'),
      { expiresInMs: 60_000, now: firstNow }
    );
    const reordered = {
      documentVersionId: ALIGNED_VERSION_ID,
      goal: 'Run focused checks',
      kind: 'coding',
      requirements: {
        features: ['typed-events', 'durable-confirmation'],
        sandbox: ['container'],
        streaming: 'typed-events',
        structuredArtifacts: true,
      },
    };
    const replay = await requestRoomToolConfirmation(
      confirmationBinding(),
      confirmationRequest('request-replay', reordered),
      {
        expiresInMs: 120_000,
        now: new Date(firstNow.getTime() + 10_000),
      }
    );

    expect(replay).toEqual(first);
    expect(hashRoomToolParameters(reordered)).toBe(
      hashRoomToolParameters(PARAMETERS)
    );
    await expect(
      requestRoomToolConfirmation(
        confirmationBinding(),
        confirmationRequest('request-replay', {
          ...PARAMETERS,
          goal: 'A changed goal must require a new confirmation',
        })
      )
    ).rejects.toMatchObject({
      name: 'ConflictError',
      statusCode: 409,
    });

    expect(
      await prisma.roomToolConfirmationRequest.count({
        where: {
          organizationId: ORGANIZATION_ID,
          roomSessionId: ROOM_SESSION_ID,
          deliveryId: DELIVERY_ID,
          toolCallId: 'request-replay',
        },
      })
    ).toBe(1);
    expect(
      (await confirmationEvents(first.requestId)).map(
        (event: RoomEvent) => event.type
      )
    ).toEqual(['room.tool_confirmation.requested']);
  });

  test('allows only owners to approve or reject and makes rejection terminal', async () => {
    const approveTarget = await requestConfirmation('owner-only-approve');
    const rejectTarget = await requestConfirmation('owner-only-reject');

    for (const actor of [member(), outsider()]) {
      await expect(
        approveRoomToolConfirmation(actor, approveTarget.requestId, {
          expectedRevision: 1,
        })
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        rejectRoomToolConfirmation(actor, rejectTarget.requestId, {
          expectedRevision: 1,
        })
      ).rejects.toBeInstanceOf(ForbiddenError);
    }

    for (const requestId of [approveTarget.requestId, rejectTarget.requestId]) {
      await expectPending(requestId, 1);
    }
    const rejected = await rejectRoomToolConfirmation(
      owner(),
      rejectTarget.requestId,
      { expectedRevision: 1 }
    );
    expect(rejected).toMatchObject({
      schemaVersion: 1,
      request: {
        id: rejectTarget.requestId,
        status: 'rejected',
        revision: 2,
        rejectedByUserId: OWNER_ID,
      },
    });
    expect(rejected.request.rejectedAt).not.toBeNull();
    expectNoBearerSecret(rejected);

    await expect(
      rejectRoomToolConfirmation(owner(), rejectTarget.requestId, {
        expectedRevision: 2,
      })
    ).rejects.toMatchObject({ name: 'ConflictError', statusCode: 409 });
    await expect(
      approveRoomToolConfirmation(owner(), rejectTarget.requestId, {
        expectedRevision: 2,
      })
    ).rejects.toMatchObject({ name: 'ConflictError', statusCode: 409 });
    expect(
      await prisma.executionJob.count({
        where: { organizationId: ORGANIZATION_ID },
      })
    ).toBe(0);
  });

  test('returns alignment and execution-job creation failures to pending', async () => {
    const cases = [
      {
        callId: 'unaligned-version',
        documentVersionId: UNALIGNED_VERSION_ID,
        message: 'Document version must be aligned before execution.',
      },
      {
        callId: 'missing-version',
        documentVersionId: 'confirmation-version-missing',
        message:
          'Document version must belong to the requested workspace and organization.',
      },
    ];

    for (const current of cases) {
      const requested = await requestConfirmation(
        current.callId,
        executionParameters(current.documentVersionId)
      );
      await expect(
        approveRoomToolConfirmation(owner(), requested.requestId, {
          expectedRevision: 1,
        })
      ).rejects.toThrow(current.message);

      const stored = await prisma.roomToolConfirmationRequest.findUniqueOrThrow({
        where: { id: requested.requestId },
      });
      expect(stored).toMatchObject({
        status: 'pending',
        revision: 3,
        approvedByUserId: null,
        approvedAt: null,
        capabilityHash: null,
        executionJobId: null,
        executionJobReceiptJson: null,
        executedAt: null,
      });
    }

    expect(
      await prisma.executionJob.count({
        where: { organizationId: ORGANIZATION_ID },
      })
    ).toBe(0);
  });

  test('expires stale requests and fails closed on tampered parameters', async () => {
    const expired = await requestRoomToolConfirmation(
      confirmationBinding(),
      confirmationRequest('expired-request'),
      { expiresInMs: 1_000, now: new Date('2020-01-01T00:00:00.000Z') }
    );

    await expect(
      approveRoomToolConfirmation(owner(), expired.requestId, {
        expectedRevision: 1,
      })
    ).rejects.toMatchObject({ name: 'ConflictError', statusCode: 409 });
    expect(
      await prisma.roomToolConfirmationRequest.findUniqueOrThrow({
        where: { id: expired.requestId },
        select: { status: true, revision: true, capabilityHash: true },
      })
    ).toEqual({ status: 'expired', revision: 2, capabilityHash: null });

    const tampered = await requestConfirmation('tampered-request');
    await prisma.roomToolConfirmationRequest.update({
      where: { id: tampered.requestId },
      data: {
        parametersJson: canonicalizeRoomToolParameters({
          ...PARAMETERS,
          goal: 'Parameters changed after the owner saw them',
        }),
      },
    });
    await expect(
      approveRoomToolConfirmation(owner(), tampered.requestId, {
        expectedRevision: 1,
      })
    ).rejects.toMatchObject({
      name: 'ConflictError',
      statusCode: 409,
      message: 'Stored confirmation parameters failed integrity validation.',
    });
    await expectPending(tampered.requestId, 1);
    expect(
      await prisma.executionJob.count({
        where: { organizationId: ORGANIZATION_ID },
      })
    ).toBe(0);
  });

  test('fails closed on malformed persisted confirmation parameters', async () => {
    const malformed = await requestConfirmation('malformed-persistence');
    await prisma.$executeRawUnsafe('PRAGMA ignore_check_constraints = true');
    try {
      await prisma.roomToolConfirmationRequest.update({
        where: { id: malformed.requestId },
        data: { parametersJson: '{"broken":' },
      });
    } finally {
      await prisma.$executeRawUnsafe('PRAGMA ignore_check_constraints = false');
    }

    for (const decide of [
      () =>
        approveRoomToolConfirmation(owner(), malformed.requestId, {
          expectedRevision: 1,
        }),
      () =>
        rejectRoomToolConfirmation(owner(), malformed.requestId, {
          expectedRevision: 1,
        }),
    ]) {
      await expect(decide()).rejects.toMatchObject({
        name: 'ConflictError',
        statusCode: 409,
        message: 'Stored confirmation parameters failed integrity validation.',
      });
    }

    await expectPending(malformed.requestId, 1);
    expect(
      await prisma.executionJob.count({
        where: { organizationId: ORGANIZATION_ID },
      })
    ).toBe(0);
    expect(
      (await confirmationEvents(malformed.requestId)).map(
        (event: RoomEvent) => event.type
      )
    ).toEqual(['room.tool_confirmation.requested']);
  });

  test('double-click approval executes exactly once and returns the durable job receipt', async () => {
    const requested = await requestConfirmation('exactly-once-approval');
    const decisions = await Promise.allSettled([
      approveRoomToolConfirmation(owner(), requested.requestId, {
        expectedRevision: 1,
      }),
      approveRoomToolConfirmation(owner(), requested.requestId, {
        expectedRevision: 1,
      }),
    ]);

    expect(decisions.map((decision) => decision.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const fulfilled = decisions.find(
      (decision) => decision.status === 'fulfilled'
    );
    const failed = decisions.find((decision) => decision.status === 'rejected');
    if (!fulfilled || fulfilled.status !== 'fulfilled') {
      throw new Error('Expected one successful approval.');
    }
    if (!failed || failed.status !== 'rejected') {
      throw new Error('Expected one rejected duplicate approval.');
    }
    expect(failed.reason).toMatchObject({
      name: 'ConflictError',
      statusCode: 409,
    });

    const decision = fulfilled.value;
    expect(decision.receipt).toBeDefined();
    const jobReceipt: ExecutionJobReceiptV1 = decision.receipt!;
    expect(jobReceipt).toMatchObject({
      schemaVersion: 1,
      status: 'blocked',
      revision: 1,
      selectedRuntimeId: null,
    });
    expect(decision.request).toMatchObject({
      id: requested.requestId,
      status: 'executed',
      revision: 3,
      approvedByUserId: OWNER_ID,
      executionJobReceipt: jobReceipt,
    });
    expect(decision.request.approvedAt).not.toBeNull();
    expect(decision.request.executedAt).not.toBeNull();
    expectNoBearerSecret(decision);

    const stored = await prisma.roomToolConfirmationRequest.findUniqueOrThrow({
      where: { id: requested.requestId },
    });
    expect(stored).toMatchObject({
      status: 'executed',
      revision: 3,
      executionJobId: jobReceipt.jobId,
      capabilityHash: null,
    });
    expect(parseStoredExecutionJobReceipt(stored.executionJobReceiptJson)).toEqual(
      jobReceipt
    );
    expect(
      await prisma.executionJob.count({
        where: {
          organizationId: ORGANIZATION_ID,
          originRoomId: ROOM_ID,
          originRoomMessageId: MESSAGE_ID,
        },
      })
    ).toBe(1);
    expect(
      await prisma.executionJob.findUniqueOrThrow({
        where: { id: jobReceipt.jobId },
        select: { originRoomId: true, originRoomMessageId: true },
      })
    ).toEqual({
      originRoomId: ROOM_ID,
      originRoomMessageId: MESSAGE_ID,
    });

    await expect(
      approveRoomToolConfirmation(owner(), requested.requestId, {
        expectedRevision: decision.request.revision,
      })
    ).rejects.toMatchObject({ name: 'ConflictError', statusCode: 409 });
    expect(
      await prisma.executionJob.count({
        where: {
          organizationId: ORGANIZATION_ID,
          originRoomId: ROOM_ID,
          originRoomMessageId: MESSAGE_ID,
        },
      })
    ).toBe(1);
    expect(
      (await confirmationEvents(requested.requestId)).map(
        (event: RoomEvent) => event.type
      )
    ).toEqual([
      'room.tool_confirmation.requested',
      'room.tool_confirmation.approved',
      'room.tool_confirmation.executed',
    ]);
  });
});

function owner(): RoomToolConfirmationActor {
  return { organizationId: ORGANIZATION_ID, userId: OWNER_ID };
}

function member(): RoomToolConfirmationActor {
  return { organizationId: ORGANIZATION_ID, userId: MEMBER_ID };
}

function outsider(): RoomToolConfirmationActor {
  return { organizationId: ORGANIZATION_ID, userId: OUTSIDER_ID };
}

function confirmationBinding(
  overrides: Partial<{
    requestedByUserId: string;
    roomId: string;
    roomMessageId: string;
    roomSessionId: string;
    deliveryId: string;
    workspaceId: string;
    projectId: string | null;
    originDeviceId: string | null;
  }> = {}
): RoomToolConfirmationBinding {
  return {
    organizationId: ORGANIZATION_ID,
    requestedByUserId: overrides.requestedByUserId ?? OWNER_ID,
    roomId: overrides.roomId ?? ROOM_ID,
    roomMessageId: overrides.roomMessageId ?? MESSAGE_ID,
    roomSessionId: overrides.roomSessionId ?? ROOM_SESSION_ID,
    deliveryId: overrides.deliveryId ?? DELIVERY_ID,
    workspaceId: overrides.workspaceId ?? WORKSPACE_ID,
    projectId: overrides.projectId ?? null,
    originDeviceId: overrides.originDeviceId ?? null,
  };
}

function confirmationRequest(
  toolCallId: string,
  parameters: unknown = PARAMETERS
): AgentToolConfirmationRequest {
  return {
    parameters,
    safetyLevel: 'confirm' as const,
    toolCallId,
    toolName: TOOL_NAME,
    writePolicy: 'organization-scoped-append' as const,
  };
}

function executionParameters(documentVersionId: string) {
  return { ...PARAMETERS, documentVersionId };
}

function requestConfirmation(
  toolCallId: string,
  parameters: unknown = PARAMETERS
): Promise<AgentToolConfirmationRequestReceiptV1> {
  return requestRoomToolConfirmation(
    confirmationBinding(),
    confirmationRequest(toolCallId, parameters),
    { expiresInMs: 60_000 }
  ) as Promise<AgentToolConfirmationRequestReceiptV1>;
}

async function expectPending(requestId: string, revision: number) {
  expect(
    await prisma.roomToolConfirmationRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: {
        status: true,
        revision: true,
        approvedByUserId: true,
        rejectedByUserId: true,
        capabilityHash: true,
        executionJobId: true,
      },
    })
  ).toEqual({
    status: 'pending',
    revision,
    approvedByUserId: null,
    rejectedByUserId: null,
    capabilityHash: null,
    executionJobId: null,
  });
}

async function confirmationEvents(requestId: string) {
  const events = await prisma.roomEvent.findMany({
    where: {
      organizationId: ORGANIZATION_ID,
      roomId: ROOM_ID,
      type: {
        in: [
          'room.tool_confirmation.requested',
          'room.tool_confirmation.approved',
          'room.tool_confirmation.executed',
          'room.tool_confirmation.rejected',
          'room.tool_confirmation.expired',
        ],
      },
    },
    orderBy: { sequence: 'asc' },
  });
  return events.filter((event: RoomEvent) => {
    const data = parseConfirmationEventPayload(event.dataJson);
    return data?.request.id === requestId;
  });
}

function expectNoBearerSecret(value: unknown) {
  const keys = collectKeys(value);
  expect(keys).not.toContain('capability');
  expect(keys).not.toContain('capabilityHash');
  expect(keys).not.toContain('nonce');
  expect(keys).not.toContain('nonceHash');
}

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectKeys);
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }
  return Object.entries(value).flatMap(([key, entry]) => [
    key,
    ...collectKeys(entry),
  ]);
}

function parseConfirmationEventPayload(
  raw: string
): ConfirmationEventPayload | null {
  const parsed = parseJsonValue(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const request = (parsed as Record<string, unknown>).request;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return null;
  }
  if (typeof (request as Record<string, unknown>).id !== 'string') {
    return null;
  }
  return parsed as ConfirmationEventPayload;
}

function parseStoredExecutionJobReceipt(
  raw: string | null
): ExecutionJobReceiptV1 | null {
  const parsed = parseJsonValue(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed as ExecutionJobReceiptV1;
}

function parseJsonValue(raw: string | null): unknown | null {
  if (typeof raw !== 'string') {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
