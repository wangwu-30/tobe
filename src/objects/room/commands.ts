import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';

import {
  createQuietHostRoomPolicy,
  guardRoomDelegation,
  type RoomActorRefV1,
  type RoomAgentMentionV1,
  type RoomAttachmentRefV1,
  type RoomDelegationInvocationV1,
  type RoomDelegationTraceV1,
  type RoomJsonValueV1,
} from '@/agent/room-runtime';
import { planRoomDeliveriesV1 } from '@/agent/room';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/framework/resilience/app-error';
import { isRecord } from '@/framework/resilience/safe-data';
import { prisma } from '@/lib/db/prisma';
import {
  BUILTIN_ASSISTANT_PROFILE_V1,
  readAgentProfileRuntimeBindingV1,
  serializeAgentCapabilitiesV1,
  serializeAgentConfigV1,
} from '@/objects/agent-profile';
import {
  IdempotencyInProgressError,
  withAtomicIdempotency,
} from '@/lib/platform/idempotency';

import {
  ROOM_CONTRACT_VERSION_V1,
  isRoomAgentMentionV1,
  isRoomAttachmentRefV1,
  isRoomJsonValueV1,
  isRoomDelegationGrantDtoV1,
  mapRoomDelegationGrantV1,
  mapRoomEventV1,
  mapRoomV1,
  parseRoomDeliveryCauseJsonV1,
  toRoomMessageReceiptV1,
  type RoomActor,
  type RoomDelegationGrantDtoV1,
  type RoomDelegationGrantScopeV1,
  type RoomDtoV1,
  type RoomEventDtoV1,
  type RoomMessageReceiptV1,
} from './schema';
import { resolveDefaultRoomKey } from './identity';

export const ROOM_IDEMPOTENCY_HEADER = 'x-dao-idempotency-key';
export const DEFAULT_ROOM_NAME = 'Project Room';

type RoomDb = Prisma.TransactionClient;

export type EnsureDefaultRoomInput = {
  hostAgentId?: string | null;
  name?: string | null;
  projectId?: string | null;
};

export type PostRoomMessageInputV1 = {
  attachments?: readonly RoomAttachmentRefV1[];
  correlationId?: string | null;
  mentions?: readonly RoomAgentMentionV1[];
  metadata?: RoomJsonValueV1;
  replyToMessageId?: string | null;
  text: string;
};

export type PostRoomMessageOptions = {
  idempotencyKey?: string | null;
};

export type RoomGrantCommandOptions = {
  idempotencyKey?: string | null;
};

export type IssueRoomDelegationGrantInputV1 = {
  fromAgentId: string;
  rootMessageId?: string | null;
  scope: RoomDelegationGrantScopeV1;
  targetAgentId: string;
};

export type ConsumeRoomDelegationGrantInputV1 = {
  instruction: string;
  invocationId: string;
  source: {
    deliveryId: string;
    generation: number;
    roomSessionId: string;
    workerId: string;
  };
  targetAgentId: string;
};

export type ConsumeRoomDelegationGrantResultV1 =
  | {
      schemaVersion: typeof ROOM_CONTRACT_VERSION_V1;
      status: 'accepted';
      invocationId: string;
      deliveryId: string;
      instructionMessageId: string;
      event: RoomEventDtoV1;
      grant: RoomDelegationGrantDtoV1;
    }
  | {
      schemaVersion: typeof ROOM_CONTRACT_VERSION_V1;
      status: 'blocked';
      invocationId: string;
      code: string;
      message: string;
      event: RoomEventDtoV1;
    };

export async function ensureDefaultRoom(
  actor: RoomActor,
  input: EnsureDefaultRoomInput = {}
): Promise<RoomDtoV1> {
  const projectId = nullableText(input.projectId);
  return prisma.$transaction((db) =>
    projectId
      ? ensureProjectRoom(db, actor, projectId, input)
      : ensureRoomByKey(db, actor, resolveDefaultRoomKey(), null, input)
  );
}

/** Transaction-compatible seam used while creating a project workspace. */
export async function ensureProjectRoom(
  db: RoomDb,
  actor: RoomActor,
  projectId: string,
  options: Omit<EnsureDefaultRoomInput, 'projectId'> = {}
): Promise<RoomDtoV1> {
  const normalizedProjectId = requiredText(projectId, 'projectId is required.');
  const projectExists = await db.document.findFirst({
    where: {
      deletedAt: null,
      organizationId: actor.organizationId,
      OR: [
        { id: normalizedProjectId },
        { projectId: normalizedProjectId },
      ],
    },
    select: { id: true },
  });
  if (!projectExists) {
    // Deliberately hide whether this id belongs to a different organization.
    throw new NotFoundError('Project not found.');
  }
  return ensureRoomByKey(
    db,
    actor,
    resolveDefaultRoomKey(normalizedProjectId),
    normalizedProjectId,
    options
  );
}

export async function postRoomMessage(
  actor: RoomActor,
  roomId: string,
  input: PostRoomMessageInputV1,
  options: PostRoomMessageOptions = {}
): Promise<RoomMessageReceiptV1> {
  const normalized = normalizeMessageInput(input);
  const normalizedRoomId = requiredText(roomId, 'roomId is required.');

  try {
    return await withAtomicIdempotency({
      action: (db) =>
        appendRoomMessageOnce(
          db,
          actor,
          normalizedRoomId,
          { type: 'human', userId: actor.userId },
          normalized
        ),
      key: options.idempotencyKey,
      operation: `room:message:create:v1:${normalizedRoomId}`,
      organizationId: actor.organizationId,
      requestHash: sha256(stableJsonStringify(normalized)),
      resource: (receipt) => ({
        resourceId: receipt.messageId,
        resourceType: 'room-message',
      }),
      userId: actor.userId,
    });
  } catch (error) {
    if (error instanceof IdempotencyInProgressError) {
      throw new ConflictError('This room message request is still in progress.');
    }
    throw error;
  }
}

/**
 * Transaction-compatible seam for commands, such as project creation, that
 * must durably create a Room message in the same commit as their own facts.
 * The caller owns command-level idempotency; routing, inbox delivery, event,
 * and outbox writes still use the canonical Room mutation below.
 */
export async function postRoomMessageInTransaction(
  db: RoomDb,
  actor: RoomActor,
  roomId: string,
  input: PostRoomMessageInputV1
): Promise<RoomMessageReceiptV1> {
  return appendRoomMessageOnce(
    db,
    actor,
    requiredText(roomId, 'roomId is required.'),
    { type: 'human', userId: actor.userId },
    normalizeMessageInput(input)
  );
}

/** Trusted host seam for persisting an agent response through the same router. */
export async function postRoomAgentMessage(
  actor: RoomActor,
  roomId: string,
  agentId: string,
  input: PostRoomMessageInputV1,
  options: PostRoomMessageOptions = {}
): Promise<RoomMessageReceiptV1> {
  const normalizedAgentId = requiredText(agentId, 'agentId is required.');
  const agent = await prisma.agentProfile.findFirst({
    where: {
      enabled: true,
      id: normalizedAgentId,
      organizationId: actor.organizationId,
    },
  });
  if (!agent) throw new NotFoundError('Agent not found.');
  const normalized = normalizeMessageInput(input);
  const normalizedRoomId = requiredText(roomId, 'roomId is required.');

  try {
    return await withAtomicIdempotency({
      action: (db) =>
        appendRoomMessageOnce(
          db,
          actor,
          normalizedRoomId,
          {
            type: 'agent',
            agentId: agent.id,
            displayName: agent.name,
            handle: agent.handle,
          },
          normalized
        ),
      key: options.idempotencyKey,
      operation: `room:agent-message:create:v1:${normalizedRoomId}:${agent.id}`,
      organizationId: actor.organizationId,
      requestHash: sha256(stableJsonStringify(normalized)),
      resource: (receipt) => ({
        resourceId: receipt.messageId,
        resourceType: 'room-message',
      }),
      userId: actor.userId,
    });
  } catch (error) {
    if (error instanceof IdempotencyInProgressError) {
      throw new ConflictError('This room message request is still in progress.');
    }
    throw error;
  }
}

export async function issueRoomDelegationGrant(
  actor: RoomActor,
  roomId: string,
  input: IssueRoomDelegationGrantInputV1,
  options: RoomGrantCommandOptions = {}
): Promise<RoomDelegationGrantDtoV1> {
  const normalizedRoomId = requiredText(roomId, 'roomId is required.');
  const fromAgentId = requiredText(input.fromAgentId, 'fromAgentId is required.');
  const targetAgentId = requiredText(
    input.targetAgentId,
    'targetAgentId is required.'
  );
  if (fromAgentId === targetAgentId) {
    throw new ValidationError('A delegation grant requires distinct agents.');
  }
  if (input.scope !== 'once' && input.scope !== 'room') {
    throw new ValidationError('scope must be once or room.');
  }
  const rootMessageId = nullableText(input.rootMessageId);

  return runAtomicGrantCommand({
    action: async (db) => {
      await requireGrantAuthority(db, actor);
      const room = await requireRoom(db, actor, normalizedRoomId);
      await requireEnabledAgents(db, actor.organizationId, [
        fromAgentId,
        targetAgentId,
      ]);
      if (rootMessageId) {
        await requireMessage(db, actor.organizationId, room.id, rootMessageId);
      }
      const grant = await db.roomDelegationGrant.create({
        data: {
          fromAgentId,
          issuedByUserId: actor.userId,
          organizationId: actor.organizationId,
          roomId: room.id,
          rootMessageId,
          scope: input.scope,
          targetAgentId,
        },
      });
      await appendPublicEvent(db, room, 'delegation_grant.issued', {
        grantId: grant.id,
        fromAgentId,
        targetAgentId,
        scope: input.scope,
        rootMessageId,
      });
      return mapRoomDelegationGrantV1(grant);
    },
    actor,
    key: options.idempotencyKey,
    operation: `room:delegation-grant:issue:v1:${normalizedRoomId}`,
    request: { fromAgentId, rootMessageId, scope: input.scope, targetAgentId },
  });
}

export async function revokeRoomDelegationGrant(
  actor: RoomActor,
  roomId: string,
  grantId: string,
  options: RoomGrantCommandOptions = {}
): Promise<RoomDelegationGrantDtoV1> {
  const normalizedRoomId = requiredText(roomId, 'roomId is required.');
  const normalizedGrantId = requiredText(grantId, 'grantId is required.');
  return runAtomicGrantCommand({
    action: async (db) => {
      await requireGrantAuthority(db, actor);
      const room = await requireRoom(db, actor, normalizedRoomId);
      const grant = await db.roomDelegationGrant.findFirst({
        where: {
          id: normalizedGrantId,
          organizationId: actor.organizationId,
          roomId: room.id,
        },
      });
      if (!grant) throw new NotFoundError('Delegation grant not found.');
      if (grant.status === 'revoked') return mapRoomDelegationGrantV1(grant);
      if (grant.status === 'consumed') {
        throw new ConflictError('A consumed delegation grant cannot be revoked.');
      }
      const revoked = await db.roomDelegationGrant.update({
        where: { id: grant.id },
        data: { revokedAt: new Date(), status: 'revoked' },
      });
      await appendPublicEvent(db, room, 'delegation_grant.revoked', {
        grantId: grant.id,
      });
      return mapRoomDelegationGrantV1(revoked);
    },
    actor,
    key: options.idempotencyKey,
    operation: `room:delegation-grant:revoke:v1:${normalizedRoomId}`,
    request: { grantId: normalizedGrantId },
  });
}

export async function consumeRoomDelegationGrant(
  actor: RoomActor,
  roomId: string,
  input: ConsumeRoomDelegationGrantInputV1
): Promise<ConsumeRoomDelegationGrantResultV1> {
  const normalizedRoomId = requiredText(roomId, 'roomId is required.');
  const normalized = normalizeDelegationCommand(input);
  return prisma.$transaction(async (db) => {
    const room = await requireRoom(db, actor, normalizedRoomId);
    const requestHash = sha256(stableJsonStringify(normalized));
    const existing = await db.roomDelegationInvocation.findUnique({
      where: {
        organizationId_roomId_invocationId: {
          invocationId: normalized.invocationId,
          organizationId: actor.organizationId,
          roomId: room.id,
        },
      },
    });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictError(
          'Delegation invocation parameters changed on replay.'
        );
      }
      return replayDelegationResult(db, existing);
    }

    const now = new Date();
    const source = await db.roomAgentSession.findFirst({
      where: {
        id: normalized.source.roomSessionId,
        organizationId: actor.organizationId,
        roomId: room.id,
        currentDeliveryId: normalized.source.deliveryId,
        generation: normalized.source.generation,
        leaseOwnerId: normalized.source.workerId,
        leaseExpiresAt: { gt: now },
        status: 'active',
      },
      include: {
        deliveries: {
          where: {
            id: normalized.source.deliveryId,
            organizationId: actor.organizationId,
            roomId: room.id,
            status: 'claimed',
          },
          take: 1,
        },
      },
    });
    const sourceDelivery = source?.deliveries[0];
    if (!source || !sourceDelivery) {
      throw new ConflictError(
        'Delegation source lease is no longer active.'
      );
    }

    const sourceCause = parseRoomDeliveryCauseJsonV1(sourceDelivery.causeJson);
    const rootMessageId =
      sourceCause.type === 'delegation'
        ? sourceCause.invocation.rootMessageId
        : sourceDelivery.messageId;
    const parentInvocation =
      sourceCause.type === 'delegation'
        ? await db.roomDelegationInvocation.findUnique({
            where: {
              organizationId_roomId_invocationId: {
                invocationId: sourceCause.invocation.invocationId,
                organizationId: actor.organizationId,
                roomId: room.id,
              },
            },
          })
        : null;
    if (
      sourceCause.type === 'delegation' &&
      (!parentInvocation ||
        parentInvocation.status !== 'accepted' ||
        parentInvocation.rootMessageId !== rootMessageId ||
        parentInvocation.targetAgentId !== source.agentId ||
        parentInvocation.targetDeliveryId !== sourceDelivery.id)
    ) {
      throw new ConflictError(
        'Delegation source lineage does not match the durable invocation ledger.'
      );
    }
    const parentInvocationId = parentInvocation?.id ?? null;
    const lineage =
      sourceCause.type === 'delegation'
        ? [...sourceCause.trace.lineage]
        : [source.agentId];
    const invocation: RoomDelegationInvocationV1 = {
      fromAgentId: source.agentId,
      invocationId: normalized.invocationId,
      rootMessageId,
      targetAgentId: normalized.targetAgentId,
    };
    const persistedInvocations = await loadAcceptedRootDelegationInvocations(
      db,
      actor.organizationId,
      room.id,
      rootMessageId
    );
    const rootInvocationCount = await db.roomDelegationInvocation.count({
      where: {
        organizationId: actor.organizationId,
        roomId: room.id,
        rootMessageId,
      },
    });
    const trace: RoomDelegationTraceV1 = {
      invocations: persistedInvocations,
      lineage,
      rootMessageId,
    };
    const policy = mapRoomV1(room).policy;
    const policyDecision =
      rootInvocationCount >= policy.delegation.maxInvocations
        ? {
            allowed: false as const,
            code: 'max-invocations-reached',
            message:
              'Delegation would exceed the root message invocation budget.',
          }
        : guardRoomDelegation({ invocation, policy, trace });
    if (!policyDecision.allowed) {
      return persistBlockedDelegation({
        db,
        room,
        invocation,
        source: normalized.source,
        parentInvocationId,
        requestHash,
        code: policyDecision.code,
        message: policyDecision.message,
      });
    }

    const agents = await db.agentProfile.findMany({
      where: {
        enabled: true,
        id: { in: [invocation.fromAgentId, invocation.targetAgentId] },
        organizationId: actor.organizationId,
      },
    });
    const target = agents.find((agent) => agent.id === invocation.targetAgentId);
    if (agents.length !== 2 || !target) {
      return persistBlockedDelegation({
        db,
        room,
        invocation,
        source: normalized.source,
        parentInvocationId,
        requestHash,
        code: 'agent-unavailable',
        message: 'A delegation agent is unavailable.',
      });
    }
    const grants = await db.roomDelegationGrant.findMany({
      where: {
        fromAgentId: invocation.fromAgentId,
        organizationId: actor.organizationId,
        roomId: room.id,
        status: 'active',
        targetAgentId: invocation.targetAgentId,
      },
      orderBy: { createdAt: 'asc' },
    });
    const matchingGrants = [
      ...grants.filter(
        (candidate) =>
          candidate.scope === 'once' &&
          candidate.rootMessageId === invocation.rootMessageId
      ),
      ...grants.filter(
        (candidate) => candidate.scope === 'once' && !candidate.rootMessageId
      ),
      ...grants.filter(
        (candidate) =>
          candidate.scope === 'room' &&
          (!candidate.rootMessageId ||
            candidate.rootMessageId === invocation.rootMessageId)
      ),
    ];
    const grant = matchingGrants.find(
      (candidate) => candidate.expiresAt.getTime() > now.getTime()
    );
    if (!grant && matchingGrants.length === 0) {
      return persistBlockedDelegation({
        db,
        room,
        invocation,
        source: normalized.source,
        parentInvocationId,
        requestHash,
        code: 'grant-required',
        message: 'No active delegation grant authorizes this request.',
      });
    }
    if (!grant) {
      return persistBlockedDelegation({
        db,
        room,
        invocation,
        source: normalized.source,
        parentInvocationId,
        requestHash,
        code: 'grant-expired',
        message: 'The delegation grant has expired.',
      });
    }
    if (policyDecision.nextTrace.lineage.length - 1 > grant.hopLimit) {
      return persistBlockedDelegation({
        db,
        room,
        invocation,
        source: normalized.source,
        parentInvocationId,
        requestHash,
        code: 'grant-hop-limit-reached',
        message: 'Delegation would exceed the grant hop budget.',
      });
    }
    const rootBudget = await db.roomDelegationRootBudget.upsert({
      where: {
        organizationId_roomId_rootMessageId: {
          organizationId: actor.organizationId,
          roomId: room.id,
          rootMessageId,
        },
      },
      create: {
        invocationLimit: policy.delegation.maxInvocations,
        organizationId: actor.organizationId,
        roomId: room.id,
        rootMessageId,
      },
      update: {},
    });
    const effectiveRootLimit = Math.min(
      rootBudget.invocationLimit,
      policy.delegation.maxInvocations
    );
    if (rootBudget.invocationCount >= effectiveRootLimit) {
      return persistBlockedDelegation({
        db,
        room,
        invocation,
        source: normalized.source,
        parentInvocationId,
        requestHash,
        code: 'root-invocation-limit-reached',
        message: 'Delegation would exceed the root message invocation budget.',
      });
    }
    if (grant.invocationCount >= grant.invocationLimit) {
      return persistBlockedDelegation({
        db,
        room,
        invocation,
        source: normalized.source,
        parentInvocationId,
        requestHash,
        code: 'grant-invocation-limit-reached',
        message: 'Delegation would exceed the grant invocation budget.',
      });
    }
    const budgetFailure = await reserveDelegationBudgets(db, {
      grantId: grant.id,
      grantInvocationLimit: grant.invocationLimit,
      organizationId: actor.organizationId,
      policyInvocationLimit: policy.delegation.maxInvocations,
      rootBudgetId: rootBudget.id,
    });
    if (budgetFailure) {
      return persistBlockedDelegation({
        db,
        room,
        invocation,
        source: normalized.source,
        parentInvocationId,
        requestHash,
        code: budgetFailure.code,
        message: budgetFailure.message,
      });
    }

    const instructionMessage = await appendDelegationInstruction(
      db,
      room,
      source,
      normalized.instruction,
      invocation,
      parentInvocationId
    );
    const session = await upsertAndAdvanceSession(db, room, {
      agentId: target.id,
      displayName: target.name,
      handle: target.handle,
    });
    const delivery = await db.roomInboxDelivery.create({
      data: {
        causeJson: JSON.stringify({
          invocation,
          trace: policyDecision.nextTrace,
          type: 'delegation',
        }),
        deliverySequence: session.deliverySequence,
        id: crypto.randomUUID(),
        intent: 'respond',
        messageId: instructionMessage.id,
        organizationId: actor.organizationId,
        roomId: room.id,
        roomSessionId: session.id,
      },
    });
    const persistedGrant =
      grant.scope === 'once'
        ? await db.roomDelegationGrant.update({
            where: { id: grant.id },
            data: {
              consumedAt: now,
              consumedByInvocationId: invocation.invocationId,
              status: 'consumed',
            },
          })
        : await db.roomDelegationGrant.findUniqueOrThrow({
            where: { id: grant.id },
          });
    const grantReceipt = mapRoomDelegationGrantV1(persistedGrant);
    const event = await appendPublicEvent(db, room, 'delegation.accepted', {
      deliveryId: delivery.id,
      grant: grantReceipt,
      instructionMessageId: instructionMessage.id,
      invocation,
      roomSessionId: session.id,
      trace: policyDecision.nextTrace,
    });
    await db.roomDelegationInvocation.create({
      data: {
        acceptedEventId: event.eventId,
        completedAt: now,
        fromAgentId: invocation.fromAgentId,
        grantId: grant.id,
        hop: policyDecision.nextTrace.lineage.length - 1,
        instructionMessageId: instructionMessage.id,
        invocationId: invocation.invocationId,
        organizationId: actor.organizationId,
        parentInvocationId,
        requestHash,
        rootMessageId,
        roomId: room.id,
        sourceDeliveryId: normalized.source.deliveryId,
        sourceGeneration: normalized.source.generation,
        sourceRoomSessionId: normalized.source.roomSessionId,
        status: 'accepted',
        targetAgentId: invocation.targetAgentId,
        targetDeliveryId: delivery.id,
      },
    });
    return {
      schemaVersion: ROOM_CONTRACT_VERSION_V1,
      status: 'accepted',
      invocationId: invocation.invocationId,
      deliveryId: delivery.id,
      instructionMessageId: instructionMessage.id,
      event,
      grant: grantReceipt,
    };
  });
}

async function ensureRoomByKey(
  db: RoomDb,
  actor: RoomActor,
  key: string,
  projectId: string | null,
  input: Omit<EnsureDefaultRoomInput, 'projectId'>
) {
  const requestedHostAgentId = nullableText(input.hostAgentId);
  const host = requestedHostAgentId
    ? await db.agentProfile.findFirst({
        where: {
          enabled: true,
          id: requestedHostAgentId,
          organizationId: actor.organizationId,
        },
      })
    : await db.agentProfile.upsert({
        where: {
          organizationId_handle: {
            handle: BUILTIN_ASSISTANT_PROFILE_V1.handle,
            organizationId: actor.organizationId,
          },
        },
        create: {
          builtin: true,
          capabilitiesJson: serializeAgentCapabilitiesV1(
            BUILTIN_ASSISTANT_PROFILE_V1.capabilities
          ),
          configJson: serializeAgentConfigV1(
            BUILTIN_ASSISTANT_PROFILE_V1.config
          ),
          description: BUILTIN_ASSISTANT_PROFILE_V1.description,
          enabled: true,
          handle: BUILTIN_ASSISTANT_PROFILE_V1.handle,
          id: `builtin-assistant:${actor.organizationId}`,
          name: BUILTIN_ASSISTANT_PROFILE_V1.name,
          organizationId: actor.organizationId,
          skillsJson: JSON.stringify(
            BUILTIN_ASSISTANT_PROFILE_V1.capabilities.skills
          ),
        },
        update: { builtin: true, enabled: true },
      });
  if (!host) throw new NotFoundError('Room host agent not found.');
  if (!host.enabled) {
    throw new ValidationError('Room host agent must be enabled.');
  }

  const name = nullableText(input.name) || DEFAULT_ROOM_NAME;
  const room = await db.room.upsert({
    where: {
      organizationId_key: { key, organizationId: actor.organizationId },
    },
    create: {
      createdByUserId: actor.userId,
      hostAgentId: host.id,
      key,
      name,
      organizationId: actor.organizationId,
      policyJson: JSON.stringify(
        createQuietHostRoomPolicy({ hostAgentId: host.id })
      ),
      projectId,
    },
    // Ensure is a stable resolve operation. Once created, a room's host and
    // policy are changed only by an explicit policy command, not a raced GET.
    update: {},
  });
  return mapRoomV1(room);
}

async function appendRoomMessageOnce(
  db: RoomDb,
  actor: RoomActor,
  roomId: string,
  messageActor: RoomActorRefV1,
  input: Required<Pick<PostRoomMessageInputV1, 'attachments' | 'mentions' | 'text'>> &
    Pick<PostRoomMessageInputV1, 'correlationId' | 'metadata' | 'replyToMessageId'>
) {
  const room = await requireRoom(db, actor, roomId);
  const replyTo = input.replyToMessageId
    ? await requireMessage(db, actor.organizationId, room.id, input.replyToMessageId)
    : null;
  const profiles = await db.agentProfile.findMany({
    where: { organizationId: actor.organizationId },
  });
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const replyActor: RoomActorRefV1 | null = replyTo
    ? replyTo.actorType === 'agent'
      ? (() => {
          const profile = profileById.get(replyTo.actorId);
          return {
            type: 'agent' as const,
            agentId: replyTo.actorId,
            handle: profile?.handle || replyTo.actorId,
            ...(replyTo.actorDisplayName
              ? { displayName: replyTo.actorDisplayName }
              : {}),
          };
        })()
      : replyTo.actorType === 'system'
        ? { type: 'system', systemId: replyTo.actorId }
        : {
            type: 'human',
            userId: replyTo.actorId,
            ...(replyTo.actorDisplayName
              ? { displayName: replyTo.actorDisplayName }
              : {}),
          }
    : null;
  const routing = planRoomDeliveriesV1({
    actor: messageActor,
    hostAgentId: room.hostAgentId,
    mentionableAgents: profiles.map((profile) => ({
      agentId: profile.id,
      displayName: profile.name,
      enabled: profile.enabled,
      handle: profile.handle,
    })),
    mentions: input.mentions,
    replyTo: replyTo && replyActor
      ? { actor: replyActor, messageId: replyTo.id }
      : null,
    text: input.text,
  });
  if (!routing.accepted) {
    throw new ValidationError('Room message routing validation failed.', {
      detail: JSON.stringify(routing.issues),
    });
  }

  const allocatedRoom = await db.room.update({
    where: { id: room.id },
    data: { eventSequence: { increment: 1 }, messageSequence: { increment: 1 } },
  });
  const messageId = crypto.randomUUID();
  const createdAt = new Date();
  await db.roomMessage.create({
    data: {
      actorDisplayName:
        messageActor.type === 'human' || messageActor.type === 'agent'
          ? messageActor.displayName
          : null,
      actorId:
        messageActor.type === 'human'
          ? messageActor.userId
          : messageActor.type === 'agent'
            ? messageActor.agentId
            : messageActor.systemId,
      actorType: messageActor.type,
      attachmentsJson: JSON.stringify(input.attachments),
      correlationId: input.correlationId || null,
      createdAt,
      id: messageId,
      metadataJson:
        input.metadata === undefined ? null : JSON.stringify(input.metadata),
      organizationId: actor.organizationId,
      replyToMessageId: input.replyToMessageId || null,
      roomId: room.id,
      sequence: allocatedRoom.messageSequence,
      text: input.text,
      mentions: {
        create: routing.mentions.map((mention, mentionIndex) => ({
          agentId: mention.agentId,
          handle: mention.handle,
          mentionIndex,
          organizationId: actor.organizationId,
          rangeEnd: mention.range.end,
          rangeStart: mention.range.start,
          roomId: room.id,
        })),
      },
    },
  });

  const publicDeliveries: Array<Record<string, RoomJsonValueV1>> = [];
  const deliveryIds: string[] = [];
  for (const planned of routing.deliveries) {
    const session = await upsertAndAdvanceSession(db, room, {
      agentId: planned.target.agentId,
      displayName: planned.target.displayName,
      handle: planned.target.handle,
    });
    const delivery = await db.roomInboxDelivery.create({
      data: {
        causeJson: JSON.stringify(planned.cause),
        deliverySequence: session.deliverySequence,
        id: crypto.randomUUID(),
        intent: planned.intent,
        messageId,
        organizationId: actor.organizationId,
        roomId: room.id,
        roomSessionId: session.id,
      },
    });
    deliveryIds.push(delivery.id);
    publicDeliveries.push({
      deliveryId: delivery.id,
      deliverySequence: delivery.deliverySequence,
      intent: planned.intent,
      roomSessionId: session.id,
      targetAgentId: planned.target.agentId,
    });
  }

  const message = {
    schemaVersion: ROOM_CONTRACT_VERSION_V1,
    envelopeType: 'room.message',
    messageId,
    organizationId: actor.organizationId,
    roomId: room.id,
    sequence: allocatedRoom.messageSequence,
    createdAt: createdAt.toISOString(),
    actor: messageActor,
    text: input.text,
    mentions: routing.mentions,
    attachments: input.attachments,
    ...(input.replyToMessageId
      ? { replyToMessageId: input.replyToMessageId }
      : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  } as const;
  const event = await db.roomEvent.create({
    data: {
      dataJson: JSON.stringify({ message, deliveries: publicDeliveries }),
      id: crypto.randomUUID(),
      organizationId: actor.organizationId,
      roomId: room.id,
      sequence: allocatedRoom.eventSequence,
      type: 'message.accepted',
    },
  });
  await db.roomOutbox.create({
    data: {
      dedupeKey: messageId,
      organizationId: actor.organizationId,
      payloadJson: JSON.stringify(mapRoomEventV1(event)),
      roomId: room.id,
      topic: 'room.message.accepted',
    },
  });
  return toRoomMessageReceiptV1({
    deliveryIds,
    eventId: event.id,
    eventSequence: event.sequence,
    messageId,
    messageSequence: allocatedRoom.messageSequence,
    roomId: room.id,
  });
}

async function upsertAndAdvanceSession(
  db: RoomDb,
  room: { id: string; organizationId: string },
  target: { agentId: string; displayName?: string; handle: string }
) {
  const profile = await db.agentProfile.findFirst({
    where: {
      enabled: true,
      id: target.agentId,
      organizationId: room.organizationId,
    },
    select: { configJson: true },
  });
  if (!profile) {
    throw new ValidationError('The target Agent is not available.');
  }
  const roomBinding = readAgentProfileRuntimeBindingV1(profile.configJson);
  const agentConfigVersion = String(roomBinding.configVersion);
  const identity = {
    agentId: target.agentId,
    organizationId: room.organizationId,
    roomId: room.id,
  };
  const existing = await db.roomAgentSession.findUnique({
    where: { organizationId_roomId_agentId: identity },
  });
  if (
    existing?.currentDeliveryId &&
    (existing.runtimeId !== roomBinding.runtimeId ||
      existing.agentConfigVersion !== agentConfigVersion)
  ) {
    throw new ConflictError(
      'The Agent runtime configuration changed while its Room session is active.'
    );
  }
  const bindingChanged = Boolean(
    existing &&
      (existing.runtimeId !== roomBinding.runtimeId ||
        existing.agentConfigVersion !== agentConfigVersion)
  );
  const session = existing
    ? await db.roomAgentSession.update({
        where: { id: existing.id },
        data: {
          agentDisplayName: target.displayName,
          agentHandle: target.handle,
          agentConfigVersion,
          runtimeId: roomBinding.runtimeId,
          status: 'active',
          ...(bindingChanged
            ? {
                checkpointJson: null,
                checkpointUpdatedAt: null,
                generation: { increment: 1 },
                runtimeSessionId: null,
              }
            : {}),
        },
      })
    : await db.roomAgentSession.create({
        data: {
          agentDisplayName: target.displayName,
          agentHandle: target.handle,
          agentId: target.agentId,
          agentConfigVersion,
          organizationId: room.organizationId,
          roomId: room.id,
          runtimeId: roomBinding.runtimeId,
        },
      });
  return db.roomAgentSession.update({
    where: { id: session.id },
    data: { deliverySequence: { increment: 1 } },
  });
}

async function appendPublicEvent(
  db: RoomDb,
  room: { eventSequence: number; id: string; organizationId: string },
  type: string,
  data: RoomJsonValueV1
): Promise<RoomEventDtoV1> {
  const allocated = await db.room.update({
    where: { id: room.id },
    data: { eventSequence: { increment: 1 } },
    select: { eventSequence: true },
  });
  const event = await db.roomEvent.create({
    data: {
      dataJson: JSON.stringify(data),
      id: crypto.randomUUID(),
      organizationId: room.organizationId,
      roomId: room.id,
      sequence: allocated.eventSequence,
      type,
    },
  });
  await db.roomOutbox.create({
    data: {
      dedupeKey: event.id,
      organizationId: room.organizationId,
      payloadJson: JSON.stringify(mapRoomEventV1(event)),
      roomId: room.id,
      topic: `room.${type}`,
    },
  });
  return mapRoomEventV1(event);
}

type NormalizedDelegationCommandV1 = {
  instruction: string;
  invocationId: string;
  source: {
    deliveryId: string;
    generation: number;
    roomSessionId: string;
    workerId: string;
  };
  targetAgentId: string;
};

function normalizeDelegationCommand(
  input: ConsumeRoomDelegationGrantInputV1
): NormalizedDelegationCommandV1 {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('Delegation input must be an object.');
  }
  if (
    !input.source ||
    typeof input.source !== 'object' ||
    !Number.isSafeInteger(input.source.generation) ||
    input.source.generation < 0
  ) {
    throw new ValidationError('Delegation source generation is invalid.');
  }
  return {
    instruction: requiredBoundedText(
      input.instruction,
      'instruction is required.',
      8_000
    ),
    invocationId: requiredBoundedText(
      input.invocationId,
      'invocationId is required.',
      512
    ),
    source: {
      deliveryId: requiredBoundedText(
        input.source.deliveryId,
        'source.deliveryId is required.',
        512
      ),
      generation: input.source.generation,
      roomSessionId: requiredBoundedText(
        input.source.roomSessionId,
        'source.roomSessionId is required.',
        512
      ),
      workerId: requiredBoundedText(
        input.source.workerId,
        'source.workerId is required.',
        512
      ),
    },
    targetAgentId: requiredBoundedText(
      input.targetAgentId,
      'targetAgentId is required.',
      512
    ),
  };
}

async function loadAcceptedRootDelegationInvocations(
  db: RoomDb,
  organizationId: string,
  roomId: string,
  rootMessageId: string
): Promise<RoomDelegationInvocationV1[]> {
  const rows = await db.roomDelegationInvocation.findMany({
    where: { organizationId, roomId, rootMessageId, status: 'accepted' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      fromAgentId: true,
      invocationId: true,
      rootMessageId: true,
      targetAgentId: true,
    },
  });
  return rows;
}

async function reserveDelegationBudgets(
  db: RoomDb,
  input: {
    grantId: string;
    grantInvocationLimit: number;
    organizationId: string;
    policyInvocationLimit: number;
    rootBudgetId: string;
  }
): Promise<{ code: string; message: string } | null> {
  const rootReserved = await db.roomDelegationRootBudget.updateMany({
    where: {
      id: input.rootBudgetId,
      invocationCount: { lt: input.policyInvocationLimit },
    },
    data: { invocationCount: { increment: 1 } },
  });
  if (rootReserved.count !== 1) {
    return {
      code: 'root-invocation-limit-reached',
      message: 'Delegation would exceed the root message invocation budget.',
    };
  }

  const grantReserved = await db.roomDelegationGrant.updateMany({
    where: {
      id: input.grantId,
      invocationCount: { lt: input.grantInvocationLimit },
      status: 'active',
    },
    data: { invocationCount: { increment: 1 } },
  });
  if (grantReserved.count !== 1) {
    await db.roomDelegationRootBudget.update({
      where: { id: input.rootBudgetId },
      data: { invocationCount: { decrement: 1 } },
    });
    return {
      code: 'grant-invocation-limit-reached',
      message: 'Delegation would exceed the grant invocation budget.',
    };
  }
  return null;
}

async function appendDelegationInstruction(
  db: RoomDb,
  room: { id: string; organizationId: string },
  source: { agentDisplayName: string | null; agentHandle: string; agentId: string },
  instruction: string,
  invocation: RoomDelegationInvocationV1,
  parentInvocationId: string | null
) {
  const allocated = await db.room.update({
    where: { id: room.id },
    data: { messageSequence: { increment: 1 } },
    select: { messageSequence: true },
  });
  return db.roomMessage.create({
    data: {
      actorDisplayName: source.agentDisplayName,
      actorId: source.agentId,
      actorType: 'agent',
      attachmentsJson: '[]',
      correlationId: invocation.invocationId,
      id: crypto.randomUUID(),
      metadataJson: JSON.stringify({
        delegation: {
          invocationId: invocation.invocationId,
          parentInvocationId,
          rootMessageId: invocation.rootMessageId,
          targetAgentId: invocation.targetAgentId,
        },
      }),
      organizationId: room.organizationId,
      replyToMessageId: invocation.rootMessageId,
      roomId: room.id,
      sequence: allocated.messageSequence,
      text: instruction,
    },
  });
}

async function persistBlockedDelegation(input: {
  code: string;
  db: RoomDb;
  invocation: RoomDelegationInvocationV1;
  message: string;
  parentInvocationId: string | null;
  requestHash: string;
  room: { eventSequence: number; id: string; organizationId: string };
  source: NormalizedDelegationCommandV1['source'];
}): Promise<ConsumeRoomDelegationGrantResultV1> {
  const { code, db, invocation, message, parentInvocationId, requestHash, room, source } = input;
  const event = await appendPublicEvent(db, room, 'delegation_blocked', {
    code,
    invocation,
    message,
  });
  await db.roomDelegationInvocation.create({
    data: {
      blockedEventId: event.eventId,
      completedAt: new Date(),
      failureCode: code,
      fromAgentId: invocation.fromAgentId,
      hop: Math.max(1, parentInvocationId ? 2 : 1),
      invocationId: invocation.invocationId,
      organizationId: room.organizationId,
      parentInvocationId,
      requestHash,
      rootMessageId: invocation.rootMessageId,
      roomId: room.id,
      sourceDeliveryId: source.deliveryId,
      sourceGeneration: source.generation,
      sourceRoomSessionId: source.roomSessionId,
      status: 'blocked',
      targetAgentId: invocation.targetAgentId,
    },
  });
  return {
    schemaVersion: ROOM_CONTRACT_VERSION_V1,
    status: 'blocked',
    invocationId: invocation.invocationId,
    code,
    message,
    event,
  };
}

async function replayDelegationResult(
  db: RoomDb,
  invocation: {
    acceptedEventId: string | null;
    blockedEventId: string | null;
    failureCode: string | null;
    grantId: string | null;
    instructionMessageId: string | null;
    invocationId: string;
    status: string;
    targetDeliveryId: string | null;
  }
): Promise<ConsumeRoomDelegationGrantResultV1> {
  if (
    invocation.status === 'accepted' &&
    invocation.acceptedEventId &&
    invocation.grantId &&
    invocation.instructionMessageId &&
    invocation.targetDeliveryId
  ) {
    const [event, grant] = await Promise.all([
      db.roomEvent.findUnique({ where: { id: invocation.acceptedEventId } }),
      db.roomDelegationGrant.findUnique({ where: { id: invocation.grantId } }),
    ]);
    if (!event || !grant) {
      throw new ConflictError('Accepted delegation receipt is incomplete.');
    }
    const mappedEvent = mapRoomEventV1(event);
    const eventData = isRecord(mappedEvent.data) ? mappedEvent.data : null;
    const grantReceipt = eventData?.grant;
    if (!isRoomDelegationGrantDtoV1(grantReceipt)) {
      throw new ConflictError('Accepted delegation receipt is not replayable.');
    }
    return {
      schemaVersion: ROOM_CONTRACT_VERSION_V1,
      status: 'accepted',
      invocationId: invocation.invocationId,
      deliveryId: invocation.targetDeliveryId,
      instructionMessageId: invocation.instructionMessageId,
      event: mappedEvent,
      grant: grantReceipt,
    };
  }
  if (
    invocation.status === 'blocked' &&
    invocation.blockedEventId &&
    invocation.failureCode
  ) {
    const event = await db.roomEvent.findUnique({
      where: { id: invocation.blockedEventId },
    });
    if (!event) throw new ConflictError('Blocked delegation receipt is incomplete.');
    const mappedEvent = mapRoomEventV1(event);
    const data = isRecord(mappedEvent.data) ? mappedEvent.data : null;
    if (
      !data ||
      data.code !== invocation.failureCode ||
      typeof data.message !== 'string'
    ) {
      throw new ConflictError('Blocked delegation receipt is not replayable.');
    }
    return {
      schemaVersion: ROOM_CONTRACT_VERSION_V1,
      status: 'blocked',
      invocationId: invocation.invocationId,
      code: invocation.failureCode,
      message: data.message,
      event: mappedEvent,
    };
  }
  throw new ConflictError('Delegation invocation receipt is incomplete.');
}

async function requireRoom(db: RoomDb, actor: RoomActor, roomId: string) {
  const room = await db.room.findFirst({
    where: { id: roomId, organizationId: actor.organizationId },
  });
  if (!room) throw new NotFoundError('Room not found.');
  return room;
}

async function requireMessage(
  db: RoomDb,
  organizationId: string,
  roomId: string,
  messageId: string
) {
  const message = await db.roomMessage.findFirst({
    where: { id: messageId, organizationId, roomId },
  });
  if (!message) throw new NotFoundError('Reply message not found.');
  return message;
}

async function requireEnabledAgents(
  db: RoomDb,
  organizationId: string,
  agentIds: readonly string[]
) {
  const uniqueIds = [...new Set(agentIds)];
  const count = await db.agentProfile.count({
    where: { enabled: true, id: { in: uniqueIds }, organizationId },
  });
  if (count !== uniqueIds.length) {
    throw new NotFoundError('One or more agents were not found.');
  }
}

async function requireGrantAuthority(db: RoomDb, actor: RoomActor) {
  const membership = await db.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: actor.organizationId,
        userId: actor.userId,
      },
    },
    select: { role: true },
  });
  if (!membership) {
    throw new ForbiddenError('Organization membership is required.');
  }
  if (membership.role !== 'owner') {
    throw new ForbiddenError(
      'Only organization owners can manage delegation grants.'
    );
  }
}

async function runAtomicGrantCommand<T extends { id: string }>(params: {
  action: (db: RoomDb) => Promise<T>;
  actor: RoomActor;
  key?: string | null;
  operation: string;
  request: unknown;
}): Promise<T> {
  // Completed idempotency records bypass the action callback. Authorize once
  // before replay resolution as well as inside each mutating transaction so a
  // former owner cannot retrieve or operate a grant after losing authority.
  await requireGrantAuthority(prisma, params.actor);
  try {
    return await withAtomicIdempotency({
      action: params.action,
      key: params.key,
      operation: params.operation,
      organizationId: params.actor.organizationId,
      requestHash: sha256(stableJsonStringify(params.request)),
      resource: (grant) => ({
        resourceId: grant.id,
        resourceType: 'room-delegation-grant',
      }),
      userId: params.actor.userId,
    });
  } catch (error) {
    if (error instanceof IdempotencyInProgressError) {
      throw new ConflictError(
        'This delegation grant request is still in progress.'
      );
    }
    throw error;
  }
}

function normalizeMessageInput(input: PostRoomMessageInputV1) {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('Room message input must be an object.');
  }
  if (typeof input.text !== 'string' || !input.text.trim()) {
    throw new ValidationError('text must be a non-empty string.');
  }
  const mentions = input.mentions ?? [];
  if (!Array.isArray(mentions) || !mentions.every(isRoomAgentMentionV1)) {
    throw new ValidationError('mentions must contain valid typed mentions.');
  }
  const attachments = input.attachments ?? [];
  if (!Array.isArray(attachments) || !attachments.every(isRoomAttachmentRefV1)) {
    throw new ValidationError('attachments must contain valid attachment references.');
  }
  if (input.metadata !== undefined && !isRoomJsonValueV1(input.metadata)) {
    throw new ValidationError('metadata must be JSON-compatible.');
  }
  return {
    attachments: [...attachments],
    correlationId: nullableText(input.correlationId),
    mentions: [...mentions],
    metadata: input.metadata,
    replyToMessageId: nullableText(input.replyToMessageId),
    text: input.text,
  };
}

function requiredText(value: string, message: string) {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(message);
  return value.trim();
}

function requiredBoundedText(
  value: string,
  message: string,
  maxLength: number
) {
  const normalized = requiredText(value, message);
  if (normalized.length > maxLength) {
    throw new ValidationError(`${message} Maximum length is ${maxLength}.`);
  }
  return normalized;
}

function nullableText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)])
  );
}
