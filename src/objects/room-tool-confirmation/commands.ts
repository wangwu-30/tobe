import { createHash, randomBytes } from 'node:crypto';

import type {
  AgentToolConfirmationAuthority,
  AgentToolConfirmationRequest,
  AgentToolConfirmationRequestReceiptV1,
} from '@/agent/tool-policy';
import { RUNTIME_CONTRACT_VERSION_V1 } from '@/agent/execution';
import { parseStartExecutionJobParametersV1 } from '@/agent/tools/execution/start-execution-job';
import type { Prisma } from '@/generated/prisma/client';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/framework/resilience/app-error';
import { safeJsonParse } from '@/framework/resilience/safe-data';
import { prisma } from '@/lib/db/prisma';
import { retrySqliteBusyV1 } from '@/lib/db/sqlite-busy-retry';
import { createExecutionJob, type ExecutionJobReceiptV1 } from '@/objects/execution-job';

import { canonicalizeRoomToolParameters, hashRoomToolParameters } from './canonical';
import {
  ROOM_TOOL_CONFIRMATION_CONTRACT_VERSION_V1,
  mapRoomToolConfirmationRequestV1,
  type RoomToolConfirmationDecisionReceiptV1,
  type RoomToolConfirmationRequestDtoV1,
  type RoomToolConfirmationStatusV1,
} from './schema';

const DEFAULT_EXPIRY_MS = 15 * 60 * 1_000;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_TOOL_NAME_LENGTH = 256;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type RoomToolConfirmationActor = {
  organizationId: string;
  userId: string;
  deviceId?: string;
};

export type RoomToolConfirmationBinding = {
  organizationId: string;
  requestedByUserId: string;
  roomId: string;
  roomMessageId: string;
  roomSessionId: string;
  deliveryId: string;
  workspaceId: string;
  projectId?: string | null;
  originDeviceId?: string | null;
};

export type PrismaRoomToolConfirmationAuthorityInput = {
  /** Resolve every identity/scope field from the currently fenced delivery. */
  resolveBinding: () =>
    | Promise<RoomToolConfirmationBinding>
    | RoomToolConfirmationBinding;
  expiresInMs?: number;
};

export type ListRoomToolConfirmationsInput = {
  roomId: string;
  status?: RoomToolConfirmationStatusV1;
};

export type DecideRoomToolConfirmationInput = { expectedRevision: number };

/**
 * Production authority: confirmation is requested, never supplied by the
 * model. The exact validated Pi arguments and trusted delivery binding are
 * durably frozen before the policy error is surfaced to the adapter.
 */
export function createPrismaRoomToolConfirmationAuthority(
  input: PrismaRoomToolConfirmationAuthorityInput
): AgentToolConfirmationAuthority {
  return {
    consumeConfirmation: () => false,
    async requestConfirmation(request) {
      const binding = await input.resolveBinding();
      return requestRoomToolConfirmation(binding, request, {
        expiresInMs: input.expiresInMs,
      });
    },
  };
}

export async function requestRoomToolConfirmation(
  rawBinding: RoomToolConfirmationBinding,
  request: AgentToolConfirmationRequest,
  options: { expiresInMs?: number; now?: Date } = {}
): Promise<AgentToolConfirmationRequestReceiptV1> {
  const binding = normalizeBinding(rawBinding);
  const normalizedRequest = normalizeRequest(request);
  const now = options.now ? new Date(options.now) : new Date();
  const expiresInMs = options.expiresInMs ?? DEFAULT_EXPIRY_MS;
  if (!Number.isSafeInteger(expiresInMs) || expiresInMs < 1 || expiresInMs > 86_400_000) {
    throw new ValidationError('Confirmation expiry must be from 1ms to 24 hours.');
  }
  const expiresAt = new Date(now.getTime() + expiresInMs);
  const parametersJson = canonicalizeRoomToolParameters(
    normalizedRequest.parameters
  );
  const parametersHash = hashRoomToolParameters(normalizedRequest.parameters);

  const persisted = await retrySqliteBusyV1(() => prisma.$transaction(async (db) => {
    await validateRequestBinding(db, binding);
    const existing = await db.roomToolConfirmationRequest.findUnique({
      where: {
        organizationId_roomSessionId_deliveryId_toolCallId: {
          organizationId: binding.organizationId,
          roomSessionId: binding.roomSessionId,
          deliveryId: binding.deliveryId,
          toolCallId: normalizedRequest.toolCallId,
        },
      },
    });
    if (existing) {
      if (
        existing.toolName !== normalizedRequest.toolName ||
        existing.parametersHash !== parametersHash ||
        existing.parametersJson !== parametersJson ||
        existing.safetyLevel !== normalizedRequest.safetyLevel ||
        existing.writePolicy !== normalizedRequest.writePolicy ||
        existing.roomId !== binding.roomId ||
        existing.roomMessageId !== binding.roomMessageId ||
        existing.requestedByUserId !== binding.requestedByUserId ||
        existing.workspaceId !== binding.workspaceId ||
        existing.projectId !== binding.projectId ||
        existing.originDeviceId !== binding.originDeviceId
      ) {
        throw new ConflictError(
          'The tool call already has a confirmation request with different bindings.'
        );
      }
      return existing;
    }

    const created = await db.roomToolConfirmationRequest.create({
      data: {
        organizationId: binding.organizationId,
        requestedByUserId: binding.requestedByUserId,
        roomId: binding.roomId,
        roomMessageId: binding.roomMessageId,
        roomSessionId: binding.roomSessionId,
        deliveryId: binding.deliveryId,
        toolCallId: normalizedRequest.toolCallId,
        toolName: normalizedRequest.toolName,
        parametersJson,
        parametersHash,
        safetyLevel: normalizedRequest.safetyLevel,
        writePolicy: normalizedRequest.writePolicy,
        workspaceId: binding.workspaceId,
        projectId: binding.projectId,
        originDeviceId: binding.originDeviceId,
        expiresAt,
      },
    });
    await appendConfirmationEvent(db, created, 'requested');
    return created;
  }));

  return {
    schemaVersion: ROOM_TOOL_CONFIRMATION_CONTRACT_VERSION_V1,
    requestId: persisted.id,
    expiresAt: persisted.expiresAt.toISOString(),
  };
}

export async function listRoomToolConfirmations(
  actor: RoomToolConfirmationActor,
  input: ListRoomToolConfirmationsInput
): Promise<RoomToolConfirmationRequestDtoV1[]> {
  const organizationId = requireIdentifier(actor.organizationId, 'organizationId');
  const userId = requireIdentifier(actor.userId, 'userId');
  const roomId = requireIdentifier(input.roomId, 'roomId');
  const now = new Date();

  return retrySqliteBusyV1(() => prisma.$transaction(async (db) => {
    await requireMember(db, organizationId, userId);
    await requireRoom(db, organizationId, roomId);
    await expirePendingRequests(db, organizationId, roomId, now);
    const rows = await db.roomToolConfirmationRequest.findMany({
      where: {
        organizationId,
        roomId,
        ...(input.status ? { status: input.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return rows.map(mapRoomToolConfirmationRequestV1);
  }));
}

export async function approveRoomToolConfirmation(
  actor: RoomToolConfirmationActor,
  requestId: string,
  input: DecideRoomToolConfirmationInput
): Promise<RoomToolConfirmationDecisionReceiptV1> {
  const principal = normalizeActor(actor);
  const id = requireIdentifier(requestId, 'requestId');
  const expectedRevision = requireRevision(input.expectedRevision);
  const capability = randomBytes(32).toString('base64url');
  const capabilityHash = sha256(capability);
  const now = new Date();

  const reservation = await retrySqliteBusyV1(() =>
    prisma.$transaction(async (db) => {
      await requireOwner(db, principal.organizationId, principal.userId);
      const request = await db.roomToolConfirmationRequest.findFirst({
        where: { id, organizationId: principal.organizationId },
      });
      if (!request) throw new NotFoundError('Tool confirmation request not found.');
      assertUntamperedRequest(request);
      if (request.expiresAt.getTime() <= now.getTime()) {
        if (request.status === 'pending') {
          const expired = await transitionRequest(db, request, expectedRevision, {
            status: 'expired',
          });
          await appendConfirmationEvent(db, expired, 'expired');
        }
        return { expired: true as const };
      }
      if (request.status !== 'pending') {
        throw new ConflictError(`A ${request.status} confirmation cannot be approved.`);
      }
      const approved = await transitionRequest(db, request, expectedRevision, {
        status: 'approved',
        approvedByUserId: principal.userId,
        approvedAt: now,
        capabilityHash,
      });
      await appendConfirmationEvent(db, approved, 'approved');
      return { expired: false as const, request: approved };
    })
  );
  if (reservation.expired) {
    throw new ConflictError('The tool confirmation request has expired.');
  }

  const stored = reservation.request;
  let receipt: ExecutionJobReceiptV1;
  try {
    const params = parseApprovedStartExecutionParameters(stored);
    receipt = await createExecutionJob(
      {
        organizationId: stored.organizationId,
        userId: stored.requestedByUserId,
        deviceId: stored.originDeviceId ?? undefined,
      },
      {
        conversationId: null,
        documentVersionId: params.documentVersionId,
        goal: params.goal,
        projectId: stored.projectId,
        spec: {
          schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
          kind: params.kind,
          requirements: params.requirements ?? {},
        },
        strategy: params.runtimeId
          ? { mode: 'explicit', runtimeId: params.runtimeId }
          : { mode: 'auto' },
        teamTaskId: params.teamTaskId ?? null,
        workspaceId: stored.workspaceId,
      },
      {
        idempotencyKey: `room-tool-confirmation:${stored.id}`,
        originRoomId: stored.roomId,
        originRoomMessageId: stored.roomMessageId,
      }
    );
  } catch (error) {
    await releaseReservation(stored.id, stored.revision, capabilityHash);
    throw error;
  }

  const executed = await retrySqliteBusyV1(() => prisma.$transaction(async (db) => {
    const changed = await db.roomToolConfirmationRequest.updateMany({
      where: {
        id: stored.id,
        organizationId: stored.organizationId,
        status: 'approved',
        revision: stored.revision,
        capabilityHash,
      },
      data: {
        status: 'executed',
        revision: { increment: 1 },
        capabilityHash: null,
        executionJobId: receipt.jobId,
        executionJobReceiptJson: JSON.stringify(receipt),
        executedAt: new Date(),
      },
    });
    if (changed.count !== 1) {
      throw new ConflictError('The single-use confirmation capability was already consumed.');
    }
    const request = await db.roomToolConfirmationRequest.findUniqueOrThrow({
      where: { id: stored.id },
    });
    await appendConfirmationEvent(db, request, 'executed');
    return request;
  }));

  return {
    schemaVersion: ROOM_TOOL_CONFIRMATION_CONTRACT_VERSION_V1,
    request: mapRoomToolConfirmationRequestV1(executed),
    receipt,
  };
}

export async function rejectRoomToolConfirmation(
  actor: RoomToolConfirmationActor,
  requestId: string,
  input: DecideRoomToolConfirmationInput
): Promise<RoomToolConfirmationDecisionReceiptV1> {
  const principal = normalizeActor(actor);
  const id = requireIdentifier(requestId, 'requestId');
  const expectedRevision = requireRevision(input.expectedRevision);
  const now = new Date();
  const rejected = await retrySqliteBusyV1(() => prisma.$transaction(async (db) => {
    await requireOwner(db, principal.organizationId, principal.userId);
    const request = await db.roomToolConfirmationRequest.findFirst({
      where: { id, organizationId: principal.organizationId },
    });
    if (!request) throw new NotFoundError('Tool confirmation request not found.');
    assertUntamperedRequest(request);
    if (request.expiresAt.getTime() <= now.getTime()) {
      if (request.status === 'pending') {
        const expired = await transitionRequest(db, request, expectedRevision, { status: 'expired' });
        await appendConfirmationEvent(db, expired, 'expired');
      }
      return null;
    }
    if (request.status !== 'pending') {
      throw new ConflictError(`A ${request.status} confirmation cannot be rejected.`);
    }
    const changed = await transitionRequest(db, request, expectedRevision, {
      status: 'rejected',
      rejectedByUserId: principal.userId,
      rejectedAt: now,
    });
    await appendConfirmationEvent(db, changed, 'rejected');
    return changed;
  }));
  if (!rejected) throw new ConflictError('The tool confirmation request has expired.');
  return {
    schemaVersion: ROOM_TOOL_CONFIRMATION_CONTRACT_VERSION_V1,
    request: mapRoomToolConfirmationRequestV1(rejected),
  };
}

async function releaseReservation(id: string, revision: number, capabilityHash: string) {
  await retrySqliteBusyV1(() => prisma.roomToolConfirmationRequest.updateMany({
    where: { id, revision, status: 'approved', capabilityHash },
    data: {
      status: 'pending',
      revision: { increment: 1 },
      approvedByUserId: null,
      approvedAt: null,
      capabilityHash: null,
    },
  }));
}

function parseApprovedStartExecutionParameters(request: {
  toolName: string; parametersJson: string; parametersHash: string;
}) {
  if (request.toolName !== 'start_execution_job') {
    throw new ValidationError('This confirmation does not authorize an execution job.');
  }
  const parameters = parseStoredConfirmationParameters(request.parametersJson);
  if (hashRoomToolParameters(parameters) !== request.parametersHash) {
    throw new ConflictError('Stored confirmation parameters failed integrity validation.');
  }
  return parseStartExecutionJobParametersV1(parameters);
}

async function validateRequestBinding(
  db: Prisma.TransactionClient,
  binding: ReturnType<typeof normalizeBinding>
) {
  await requireMember(db, binding.organizationId, binding.requestedByUserId);
  const delivery = await db.roomInboxDelivery.findFirst({
    where: {
      id: binding.deliveryId,
      organizationId: binding.organizationId,
      roomId: binding.roomId,
      roomSessionId: binding.roomSessionId,
      messageId: binding.roomMessageId,
      status: 'claimed',
      session: {
        organizationId: binding.organizationId,
        roomId: binding.roomId,
        currentDeliveryId: binding.deliveryId,
      },
      message: { organizationId: binding.organizationId, roomId: binding.roomId },
    },
    select: { id: true },
  });
  if (!delivery) {
    throw new ForbiddenError('The confirmation is not bound to the active Room delivery.');
  }
  const workspace = await db.document.findFirst({
    where: { id: binding.workspaceId, organizationId: binding.organizationId, deletedAt: null },
    select: { id: true, projectId: true },
  });
  if (!workspace || (binding.projectId && binding.projectId !== (workspace.projectId ?? workspace.id))) {
    throw new ForbiddenError('The confirmation workspace binding is invalid.');
  }
}

async function requireMember(db: Prisma.TransactionClient, organizationId: string, userId: string) {
  const membership = await db.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true },
  });
  if (!membership) throw new ForbiddenError('Organization membership is required.');
  return membership;
}

async function requireOwner(db: Prisma.TransactionClient, organizationId: string, userId: string) {
  const membership = await requireMember(db, organizationId, userId);
  if (membership.role !== 'owner') {
    throw new ForbiddenError('Only organization owners can decide tool confirmations.');
  }
}

async function requireRoom(db: Prisma.TransactionClient, organizationId: string, roomId: string) {
  const room = await db.room.findFirst({ where: { id: roomId, organizationId }, select: { id: true } });
  if (!room) throw new NotFoundError('Room not found.');
}

async function transitionRequest(
  db: Prisma.TransactionClient,
  request: { id: string; organizationId: string; revision: number },
  expectedRevision: number,
  data: Prisma.RoomToolConfirmationRequestUncheckedUpdateManyInput
) {
  if (request.revision !== expectedRevision) {
    throw new ConflictError('The confirmation request changed before this decision.');
  }
  const result = await db.roomToolConfirmationRequest.updateMany({
    where: { id: request.id, organizationId: request.organizationId, revision: expectedRevision },
    data: { ...data, revision: { increment: 1 } },
  });
  if (result.count !== 1) {
    throw new ConflictError('The confirmation request changed before this decision.');
  }
  return db.roomToolConfirmationRequest.findUniqueOrThrow({ where: { id: request.id } });
}

async function expirePendingRequests(
  db: Prisma.TransactionClient, organizationId: string, roomId: string, now: Date
) {
  const expired = await db.roomToolConfirmationRequest.findMany({
    where: { organizationId, roomId, status: 'pending', expiresAt: { lte: now } },
  });
  for (const request of expired) {
    const result = await db.roomToolConfirmationRequest.updateMany({
      where: { id: request.id, revision: request.revision, status: 'pending' },
      data: { status: 'expired', revision: { increment: 1 } },
    });
    if (result.count === 1) {
      const changed = await db.roomToolConfirmationRequest.findUniqueOrThrow({ where: { id: request.id } });
      await appendConfirmationEvent(db, changed, 'expired');
    }
  }
}

async function appendConfirmationEvent(
  db: Prisma.TransactionClient,
  request: Parameters<typeof mapRoomToolConfirmationRequestV1>[0],
  action: 'requested' | 'approved' | 'executed' | 'rejected' | 'expired'
) {
  const payload = {
    schemaVersion: ROOM_TOOL_CONFIRMATION_CONTRACT_VERSION_V1,
    request: mapRoomToolConfirmationRequestV1(request),
  };
  const room = await db.room.update({
    where: { id: request.roomId },
    data: { eventSequence: { increment: 1 } },
    select: { eventSequence: true },
  });
  const event = await db.roomEvent.create({
    data: {
      organizationId: request.organizationId,
      roomId: request.roomId,
      sequence: room.eventSequence,
      type: `room.tool_confirmation.${action}`,
      dataJson: JSON.stringify(payload),
    },
  });
  await db.roomOutbox.create({
    data: {
      organizationId: request.organizationId,
      roomId: request.roomId,
      topic: event.type,
      dedupeKey: event.id,
      payloadJson: JSON.stringify({
        schemaVersion: 1,
        eventId: event.id,
        organizationId: event.organizationId,
        roomId: event.roomId,
        sequence: event.sequence,
        type: event.type,
        createdAt: event.createdAt.toISOString(),
        data: payload,
      }),
    },
  });
}

function assertUntamperedRequest(request: { parametersJson: string; parametersHash: string }) {
  const parsed = parseStoredConfirmationParameters(request.parametersJson);
  if (!SHA256_PATTERN.test(request.parametersHash) || hashRoomToolParameters(parsed) !== request.parametersHash) {
    throw new ConflictError('Stored confirmation parameters failed integrity validation.');
  }
}

function parseStoredConfirmationParameters(raw: string): unknown {
  const invalid = Symbol('invalid-room-tool-confirmation-parameters');
  const parsed = safeJsonParse<unknown | typeof invalid>(raw, invalid);
  if (parsed === invalid) {
    throw new ConflictError('Stored confirmation parameters failed integrity validation.');
  }
  return parsed;
}

function normalizeActor(actor: RoomToolConfirmationActor) {
  return {
    organizationId: requireIdentifier(actor.organizationId, 'organizationId'),
    userId: requireIdentifier(actor.userId, 'userId'),
  };
}

function normalizeBinding(input: RoomToolConfirmationBinding) {
  return {
    organizationId: requireIdentifier(input.organizationId, 'organizationId'),
    requestedByUserId: requireIdentifier(input.requestedByUserId, 'requestedByUserId'),
    roomId: requireIdentifier(input.roomId, 'roomId'),
    roomMessageId: requireIdentifier(input.roomMessageId, 'roomMessageId'),
    roomSessionId: requireIdentifier(input.roomSessionId, 'roomSessionId'),
    deliveryId: requireIdentifier(input.deliveryId, 'deliveryId'),
    workspaceId: requireIdentifier(input.workspaceId, 'workspaceId'),
    projectId: optionalIdentifier(input.projectId, 'projectId'),
    originDeviceId: optionalIdentifier(input.originDeviceId, 'originDeviceId'),
  };
}

function normalizeRequest(request: AgentToolConfirmationRequest): AgentToolConfirmationRequest {
  return {
    parameters: request.parameters,
    safetyLevel: request.safetyLevel,
    toolCallId: requireIdentifier(request.toolCallId, 'toolCallId'),
    toolName: requireToolName(request.toolName),
    writePolicy: request.writePolicy,
  };
}

function requireRevision(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ValidationError('expectedRevision must be a positive integer.');
  }
  return value;
}

function requireIdentifier(value: string, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (normalized.length > MAX_IDENTIFIER_LENGTH) {
    throw new ValidationError(`${field} is too long.`);
  }
  return normalized;
}

function optionalIdentifier(value: string | null | undefined, field: string) {
  return value == null ? null : requireIdentifier(value, field);
}

function requireToolName(value: string) {
  const toolName = requireIdentifier(value, 'toolName');
  if (toolName.length > MAX_TOOL_NAME_LENGTH || toolName !== value || /[\u0000-\u001f\u007f]/.test(toolName)) {
    throw new ValidationError('toolName is invalid.');
  }
  return toolName;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
