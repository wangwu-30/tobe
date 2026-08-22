import nodePath from 'node:path';

import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/framework/resilience';
import { prisma } from '@/lib/db/prisma';

import {
  getKnowledgeBinding,
  getKnowledgeChangeRequest,
  getKnowledgeMergeOperation,
  getKnowledgeSnapshot,
  getKnowledgeSpace,
  type KnowledgeActor,
  type KnowledgeHumanActor,
} from './queries';
import { requireKnowledgeAdmin, requireKnowledgeReviewer } from './admin';
import {
  canReviewKnowledgeChangeRequest,
  normalizeKnowledgeDiffMetadata,
  parseKnowledgeBindingAccess,
  parseKnowledgeSpaceScope,
  type KnowledgeBindingDto,
  type KnowledgeChangeRequestDto,
  type KnowledgeDiffMetadata,
  type KnowledgeMergeOperationDto,
  type KnowledgeSnapshotDto,
  type KnowledgeSpaceDto,
} from './schema';

export type CreateKnowledgeSpaceInput = {
  scope: 'team' | 'agent';
  ownerAgentId?: string | null;
  repoPath?: string | null;
  repoUrl?: string | null;
  defaultBranch?: string;
  credentialRef?: string | null;
  readPolicy: string;
  writePolicy: string;
};

export type CreateKnowledgeBindingInput = {
  workspaceId: string;
  agentId?: string | null;
  spaceId: string;
  mountPath: string;
  access: 'read' | 'propose';
};

export type CreateKnowledgeSnapshotInput = {
  spaceId: string;
  /** A merged review record proving commitSha reached the default branch. */
  changeRequestId: string;
  commitSha: string;
  indexVersion: string;
  artifactPath: string;
  artifactSha256: string;
  readyAt?: Date;
};

export type CreateKnowledgeChangeRequestInput = {
  jobId: string;
  attemptId: string;
  spaceId: string;
  baseCommit: string;
  headCommit: string;
  branchName: string;
  diffSummary?: string;
  diffMetadata?: KnowledgeDiffMetadata;
};

export type ReviewKnowledgeChangeRequestInput = {
  expectedRevision: number;
  note?: string | null;
};

export type QueueKnowledgeMergeInput = {
  expectedRevision: number;
  indexVersion?: string;
};

/** Only a trusted merge-service adapter may construct this authority. */
export type KnowledgeMergeActor = KnowledgeActor & {
  authority: 'knowledge-merge-service';
};

export type RecordKnowledgeChangeRequestMergedInput = {
  expectedRevision: number;
  expectedHeadCommit: string;
  mergedCommit: string;
};

export async function createKnowledgeSpace(
  actor: KnowledgeHumanActor,
  input: CreateKnowledgeSpaceInput
): Promise<KnowledgeSpaceDto> {
  await requireKnowledgeAdmin(actor);
  const scope = parseKnowledgeSpaceScope(input.scope);
  const ownerAgentId = optionalText(input.ownerAgentId);
  const repoPath = optionalText(input.repoPath);
  const repoUrl = optionalText(input.repoUrl);
  const defaultBranch = requiredText(
    input.defaultBranch ?? 'main',
    'defaultBranch is required.'
  );
  const credentialRef = optionalText(input.credentialRef);
  const readPolicy = requiredText(input.readPolicy, 'readPolicy is required.');
  const writePolicy = requiredText(input.writePolicy, 'writePolicy is required.');

  if (!repoPath || !nodePath.isAbsolute(repoPath) || /[\r\n\0]/.test(repoPath)) {
    throw new ValidationError('repoPath must be an absolute local repository path.');
  }
  if (repoUrl || credentialRef) {
    throw new ValidationError(
      'Remote repositories and credentials are not supported by the local knowledge MVP.'
    );
  }
  if (scope === 'team' && ownerAgentId) {
    throw new ValidationError('A team knowledge space cannot have an ownerAgentId.');
  }
  if (scope === 'agent' && !ownerAgentId) {
    throw new ValidationError('An agent knowledge space requires ownerAgentId.');
  }

  const id = crypto.randomUUID();
  const now = new Date();
  await prisma.$transaction(async (db) => {
    if (ownerAgentId) {
      const owners = await db.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "AgentProfile"
        WHERE "id" = ${ownerAgentId}
          AND "organizationId" = ${actor.organizationId}
        LIMIT 1
      `;
      if (!owners[0]) {
        throw new ValidationError(
          'ownerAgentId must identify an agent in the current organization.'
        );
      }
    }
    await db.$executeRaw`
      INSERT INTO "KnowledgeSpace" (
        "id", "organizationId", "scope", "ownerAgentId",
        "repoPath", "repoUrl", "defaultBranch", "credentialRef",
        "readPolicy", "writePolicy", "createdAt", "updatedAt"
      ) VALUES (
        ${id}, ${actor.organizationId}, ${scope}, ${ownerAgentId},
        ${repoPath}, ${repoUrl}, ${defaultBranch}, ${credentialRef},
        ${readPolicy}, ${writePolicy}, ${now}, ${now}
      )
    `;
  });
  return requireCreated(await getKnowledgeSpace(actor, id), 'Knowledge space');
}
export async function createKnowledgeBinding(
  actor: KnowledgeHumanActor,
  input: CreateKnowledgeBindingInput
): Promise<KnowledgeBindingDto> {
  await requireKnowledgeAdmin(actor);
  const workspaceId = requiredText(input.workspaceId, 'workspaceId is required.');
  const agentId = optionalText(input.agentId);
  const spaceId = requiredText(input.spaceId, 'spaceId is required.');
  const mountPath = normalizeMountPath(input.mountPath);
  const access = parseKnowledgeBindingAccess(input.access);
  const id = crypto.randomUUID();
  const now = new Date();

  await prisma.$transaction(async (db) => {
    const workspaces = await db.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Document"
      WHERE "id" = ${workspaceId}
        AND "organizationId" = ${actor.organizationId}
        AND "deletedAt" IS NULL
      LIMIT 1
    `;
    if (!workspaces[0]) {
      throw new ValidationError(
        'workspaceId must identify a workspace in the current organization.'
      );
    }
    if (agentId) {
      const agents = await db.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "AgentProfile"
        WHERE "id" = ${agentId}
          AND "organizationId" = ${actor.organizationId}
        LIMIT 1
      `;
      if (!agents[0]) {
        throw new ValidationError(
          'agentId must identify an agent in the current organization.'
        );
      }
    }
    const spaces = await db.$queryRaw<
      Array<{ id: string; ownerAgentId: string | null; scope: string }>
    >`
      SELECT "id", "scope", "ownerAgentId" FROM "KnowledgeSpace"
      WHERE "id" = ${spaceId}
        AND "organizationId" = ${actor.organizationId}
      LIMIT 1
    `;
    const space = spaces[0];
    if (!space) {
      throw new NotFoundError('Knowledge space not found.');
    }
    if (space.scope === 'team' && agentId !== null) {
      throw new ValidationError(
        'A team knowledge space binding cannot have an agentId.'
      );
    }
    if (
      space.scope === 'agent' &&
      (agentId === null || agentId !== space.ownerAgentId)
    ) {
      throw new ValidationError(
        'An agent knowledge space binding must use its ownerAgentId.'
      );
    }
    if (space.scope !== 'team' && space.scope !== 'agent') {
      throw new ValidationError('Knowledge space scope is invalid.');
    }

    const conflictingBindings = await db.$queryRaw<
      Array<{ access: string; id: string; spaceId: string }>
    >`
      SELECT "id", "spaceId", "access"
      FROM "KnowledgeBinding"
      WHERE "organizationId" = ${actor.organizationId}
        AND "workspaceId" = ${workspaceId}
        AND "mountPath" = ${mountPath}
        AND (
          (${agentId} IS NULL AND "agentId" IS NULL)
          OR "agentId" = ${agentId}
        )
        AND (
          "spaceId" = ${spaceId}
          OR (${access} = 'propose' AND "access" = 'propose')
        )
      LIMIT 1
    `;
    if (conflictingBindings[0]?.spaceId === spaceId) {
      throw new ConflictError('This knowledge binding already exists.');
    }
    if (conflictingBindings[0]) {
      throw new ConflictError(
        'Only one propose knowledge binding is allowed per workspace, agent, and mount path.'
      );
    }
    const inserted = await db.$executeRaw`
      INSERT INTO "KnowledgeBinding" (
        "id", "organizationId", "workspaceId", "agentId",
        "spaceId", "mountPath", "access", "createdAt", "updatedAt"
      ) SELECT
        ${id}, ${actor.organizationId}, ${workspaceId}, ${agentId},
        ${spaceId}, ${mountPath}, ${access}, ${now}, ${now}
      WHERE NOT EXISTS (
        SELECT 1 FROM "KnowledgeBinding"
        WHERE "organizationId" = ${actor.organizationId}
          AND "workspaceId" = ${workspaceId}
          AND "mountPath" = ${mountPath}
          AND (
            (${agentId} IS NULL AND "agentId" IS NULL)
            OR "agentId" = ${agentId}
          )
          AND (
            "spaceId" = ${spaceId}
            OR (${access} = 'propose' AND "access" = 'propose')
          )
      )
    `;
    if (inserted !== 1) {
      throw new ConflictError(
        'A duplicate or ambiguous knowledge binding already exists.'
      );
    }
  });
  return requireCreated(await getKnowledgeBinding(actor, id), 'Knowledge binding');
}

export async function createKnowledgeSnapshot(
  actor: KnowledgeActor,
  input: CreateKnowledgeSnapshotInput
): Promise<KnowledgeSnapshotDto> {
  const spaceId = requiredText(input.spaceId, 'spaceId is required.');
  const changeRequestId = requiredText(
    input.changeRequestId,
    'changeRequestId is required.'
  );
  const commitSha = requiredText(input.commitSha, 'commitSha is required.');
  const indexVersion = requiredText(
    input.indexVersion,
    'indexVersion is required.'
  );
  const artifactPath = requiredText(
    input.artifactPath,
    'artifactPath is required.'
  );
  const artifactSha256 = sha256Digest(input.artifactSha256);
  const readyAt = input.readyAt ?? new Date();
  const id = crypto.randomUUID();
  const now = new Date();

  await prisma.$transaction(async (db) => {
    const mergedChanges = await db.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "KnowledgeChangeRequest"
      WHERE "id" = ${changeRequestId}
        AND "organizationId" = ${actor.organizationId}
        AND "spaceId" = ${spaceId}
        AND "status" = 'merged'
        AND "mergedCommit" = ${commitSha}
      LIMIT 1
    `;
    if (!mergedChanges[0]) {
      throw new ValidationError(
        'Knowledge snapshots require a merged change request for the same space and commit.'
      );
    }
    const spaces = await db.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "KnowledgeSpace"
      WHERE "id" = ${spaceId}
        AND "organizationId" = ${actor.organizationId}
      LIMIT 1
    `;
    if (!spaces[0]) {
      throw new NotFoundError('Knowledge space not found.');
    }
    await db.$executeRaw`
      INSERT INTO "KnowledgeSnapshot" (
        "id", "organizationId", "spaceId", "changeRequestId",
        "commitSha", "indexVersion", "artifactPath",
        "artifactSha256", "readyAt", "createdAt"
      ) VALUES (
        ${id}, ${actor.organizationId}, ${spaceId}, ${changeRequestId},
        ${commitSha}, ${indexVersion}, ${artifactPath},
        ${artifactSha256}, ${readyAt}, ${now}
      )
    `;
  });
  return requireCreated(await getKnowledgeSnapshot(actor, id), 'Knowledge snapshot');
}

export async function createKnowledgeChangeRequest(
  actor: KnowledgeActor,
  input: CreateKnowledgeChangeRequestInput
): Promise<KnowledgeChangeRequestDto> {
  const jobId = requiredText(input.jobId, 'jobId is required.');
  const attemptId = requiredText(input.attemptId, 'attemptId is required.');
  const spaceId = requiredText(input.spaceId, 'spaceId is required.');
  const baseCommit = requiredText(input.baseCommit, 'baseCommit is required.');
  const headCommit = requiredText(input.headCommit, 'headCommit is required.');
  const branchName = requiredText(input.branchName, 'branchName is required.');
  const diffSummary = input.diffSummary?.trim() ?? '';
  const diffMetadata = normalizeKnowledgeDiffMetadata(input.diffMetadata ?? {});
  const diffMetadataJson = JSON.stringify(diffMetadata);
  const id = crypto.randomUUID();
  const now = new Date();

  if (baseCommit === headCommit) {
    throw new ValidationError('headCommit must differ from baseCommit.');
  }

  await prisma.$transaction(async (db) => {
    const context = await db.$queryRaw<Array<{ jobId: string; attemptId: string }>>`
      SELECT j."id" AS "jobId", a."id" AS "attemptId"
      FROM "ExecutionJob" j
      JOIN "ExecutionAttempt" a
        ON a."jobId" = j."id"
       AND a."organizationId" = j."organizationId"
      WHERE j."id" = ${jobId}
        AND a."id" = ${attemptId}
        AND j."organizationId" = ${actor.organizationId}
        AND a."organizationId" = ${actor.organizationId}
      LIMIT 1
    `;
    if (!context[0]) {
      throw new ValidationError(
        'jobId and attemptId must identify an attempt in the current organization.'
      );
    }

    const spaces = await db.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "KnowledgeSpace"
      WHERE "id" = ${spaceId}
        AND "organizationId" = ${actor.organizationId}
      LIMIT 1
    `;
    if (!spaces[0]) {
      throw new NotFoundError('Knowledge space not found.');
    }

    await db.$executeRaw`
      INSERT INTO "KnowledgeChangeRequest" (
        "id", "organizationId", "jobId", "attemptId", "spaceId",
        "baseCommit", "headCommit", "branchName", "status",
        "diffSummary", "diffMetadataJson", "revision",
        "createdAt", "updatedAt"
      ) VALUES (
        ${id}, ${actor.organizationId}, ${jobId}, ${attemptId}, ${spaceId},
        ${baseCommit}, ${headCommit}, ${branchName}, 'pending_review',
        ${diffSummary}, ${diffMetadataJson}, 1, ${now}, ${now}
      )
    `;
  });
  return requireCreated(
    await getKnowledgeChangeRequest(actor, id),
    'Knowledge change request'
  );
}

export async function approveKnowledgeChangeRequest(
  actor: KnowledgeHumanActor,
  changeRequestId: string,
  input: ReviewKnowledgeChangeRequestInput
): Promise<KnowledgeChangeRequestDto> {
  await requireKnowledgeReviewer(actor);
  return reviewKnowledgeChangeRequest(
    {
      action: 'approve',
      actor,
      nextStatus: 'approved',
      reviewerId: requireReviewerActor(actor),
    },
    changeRequestId,
    input
  );
}

export async function markKnowledgeChangeRequestConflicted(
  actor: KnowledgeMergeActor,
  changeRequestId: string,
  input: ReviewKnowledgeChangeRequestInput
): Promise<KnowledgeChangeRequestDto> {
  assertKnowledgeMergeAuthority(actor);
  return reviewKnowledgeChangeRequest(
    {
      action: 'mark_conflicted',
      actor,
      nextStatus: 'conflicted',
      reviewerId: 'knowledge-merge-service',
    },
    changeRequestId,
    input
  );
}

export async function rejectKnowledgeChangeRequest(
  actor: KnowledgeHumanActor,
  changeRequestId: string,
  input: ReviewKnowledgeChangeRequestInput
): Promise<KnowledgeChangeRequestDto> {
  await requireKnowledgeReviewer(actor);
  return reviewKnowledgeChangeRequest(
    {
      action: 'reject',
      actor,
      nextStatus: 'rejected',
      reviewerId: requireReviewerActor(actor),
    },
    changeRequestId,
    input
  );
}

/**
 * Enqueues a durable trusted merge. It deliberately performs no Git or index
 * I/O in the request process. requestedById always comes from the server actor.
 */
export async function queueKnowledgeMerge(
  actor: KnowledgeHumanActor,
  changeRequestId: string,
  input: QueueKnowledgeMergeInput
): Promise<KnowledgeMergeOperationDto> {
  await requireKnowledgeReviewer(actor);
  const id = requiredText(changeRequestId, 'changeRequestId is required.');
  const requestedById = requireReviewerActor(actor);
  const expectedRevision = positiveRevision(input.expectedRevision);
  const indexVersion = requiredText(
    input.indexVersion ?? 'knowledge-index-v1',
    'indexVersion is required.'
  );
  const current = await getKnowledgeChangeRequest(actor, id);
  if (!current) throw new NotFoundError('Knowledge change request not found.');
  if (current.revision !== expectedRevision) {
    throw new ConflictError('Knowledge change request changed before merge was queued.');
  }
  if (current.status !== 'approved') {
    throw new ConflictError('Only an approved knowledge change request can be queued for merge.');
  }
  if (current.reviewerId !== requestedById) {
    throw new ConflictError(
      'Only the human actor who recorded this approval can queue its merge.'
    );
  }

  const operationId = crypto.randomUUID();
  const now = new Date();
  await prisma.$transaction(async (db) => {
    const eligible = await db.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "KnowledgeChangeRequest"
      WHERE "id" = ${id}
        AND "organizationId" = ${actor.organizationId}
        AND "revision" = ${expectedRevision}
        AND "status" = 'approved'
        AND "reviewerId" = ${requestedById}
        AND "baseCommit" = ${current.baseCommit}
        AND "headCommit" = ${current.headCommit}
      LIMIT 1
    `;
    if (!eligible[0]) {
      throw new ConflictError('Knowledge change request changed before merge was queued.');
    }
    await db.$executeRaw`
      INSERT INTO "KnowledgeMergeOperation" (
        "id", "organizationId", "changeRequestId", "requestedById",
        "expectedRevision", "expectedBaseCommit", "expectedHeadCommit",
        "indexVersion", "status", "attemptCount", "createdAt", "updatedAt"
      ) VALUES (
        ${operationId}, ${actor.organizationId}, ${id}, ${requestedById},
        ${expectedRevision}, ${current.baseCommit}, ${current.headCommit},
        ${indexVersion}, 'queued', 0, ${now}, ${now}
      )
      ON CONFLICT ("changeRequestId", "expectedRevision") DO NOTHING
    `;
  });
  const operations = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "KnowledgeMergeOperation"
    WHERE "changeRequestId" = ${id}
      AND "organizationId" = ${actor.organizationId}
      AND "expectedRevision" = ${expectedRevision}
    LIMIT 1
  `;
  const operation = operations[0]
    ? await getKnowledgeMergeOperation(actor, operations[0].id)
    : null;
  return requireCreated(operation, 'Knowledge merge operation');
}

/**
 * Records the result of an already-completed trusted merge. This function does
 * not invoke Git and is deliberately unavailable to ordinary KnowledgeActor
 * callers at the type and runtime boundaries.
 */
export async function recordKnowledgeChangeRequestMerged(
  actor: KnowledgeMergeActor,
  changeRequestId: string,
  input: RecordKnowledgeChangeRequestMergedInput
): Promise<KnowledgeChangeRequestDto> {
  if (actor.authority !== 'knowledge-merge-service') {
    throw new ValidationError('Trusted knowledge merge authority is required.');
  }
  const id = requiredText(changeRequestId, 'changeRequestId is required.');
  const expectedRevision = positiveRevision(input.expectedRevision);
  const expectedHeadCommit = requiredText(
    input.expectedHeadCommit,
    'expectedHeadCommit is required.'
  );
  const mergedCommit = requiredText(
    input.mergedCommit,
    'mergedCommit is required.'
  );
  const current = await getKnowledgeChangeRequest(actor, id);
  if (!current) {
    throw new NotFoundError('Knowledge change request not found.');
  }
  if (current.revision !== expectedRevision) {
    throw new ConflictError('Knowledge change request changed during merge.');
  }
  if (current.status !== 'approved') {
    throw new ConflictError('Only an approved knowledge change request can be merged.');
  }
  if (current.headCommit !== expectedHeadCommit) {
    throw new ConflictError('Knowledge change request head commit changed before merge.');
  }

  const now = new Date();
  const changed = await prisma.$executeRaw`
    UPDATE "KnowledgeChangeRequest"
    SET "status" = 'merged',
        "mergedCommit" = ${mergedCommit},
        "mergedAt" = ${now},
        "revision" = "revision" + 1,
        "updatedAt" = ${now}
    WHERE "id" = ${id}
      AND "organizationId" = ${actor.organizationId}
      AND "revision" = ${expectedRevision}
      AND "status" = 'approved'
      AND "headCommit" = ${expectedHeadCommit}
  `;
  if (changed !== 1) {
    throw new ConflictError('Knowledge change request changed during merge.');
  }
  return requireCreated(
    await getKnowledgeChangeRequest(actor, id),
    'Knowledge change request'
  );
}

type KnowledgeReviewTransition =
  | {
      action: 'approve';
      actor: KnowledgeHumanActor;
      nextStatus: 'approved';
      reviewerId: string;
    }
  | {
      action: 'mark_conflicted';
      actor: KnowledgeMergeActor;
      nextStatus: 'conflicted';
      reviewerId: 'knowledge-merge-service';
    }
  | {
      action: 'reject';
      actor: KnowledgeHumanActor;
      nextStatus: 'rejected';
      reviewerId: string;
    };

async function reviewKnowledgeChangeRequest(
  transition: KnowledgeReviewTransition,
  changeRequestId: string,
  input: ReviewKnowledgeChangeRequestInput
) {
  const { action, actor, nextStatus, reviewerId } = transition;
  const id = requiredText(changeRequestId, 'changeRequestId is required.');
  const reviewNote = optionalText(input.note);
  const expectedRevision = positiveRevision(input.expectedRevision);
  const current = await getKnowledgeChangeRequest(actor, id);
  if (!current) {
    throw new NotFoundError('Knowledge change request not found.');
  }
  if (current.revision !== expectedRevision) {
    throw new ConflictError('Knowledge change request changed during review.');
  }
  if (!canReviewKnowledgeChangeRequest(current.status, action)) {
    throw new ConflictError(
      `Cannot ${action.replace('_', ' ')} a ${current.status} knowledge change request.`
    );
  }

  const now = new Date();
  const changed = await prisma.$executeRaw`
    UPDATE "KnowledgeChangeRequest"
    SET "status" = ${nextStatus},
        "reviewerId" = ${reviewerId},
        "reviewNote" = ${reviewNote},
        "reviewedAt" = ${now},
        "revision" = "revision" + 1,
        "updatedAt" = ${now}
    WHERE "id" = ${id}
      AND "organizationId" = ${actor.organizationId}
      AND "revision" = ${expectedRevision}
      AND "status" = ${current.status}
      AND NOT EXISTS (
        SELECT 1 FROM "KnowledgeMergeOperation" AS operation
        WHERE operation."changeRequestId" = ${id}
          AND operation."organizationId" = ${actor.organizationId}
          AND operation."status" IN ('queued', 'running')
      )
  `;
  if (changed !== 1) {
    throw new ConflictError('Knowledge change request changed during review.');
  }
  return requireCreated(
    await getKnowledgeChangeRequest(actor, id),
    'Knowledge change request'
  );
}

function requiredText(value: unknown, message: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(message);
  }
  return value.trim();
}

function optionalText(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new ValidationError('Optional knowledge fields must be strings.');
  }
  return value.trim() || null;
}

function normalizeMountPath(value: unknown) {
  const path = requiredText(value, 'mountPath is required.');
  if (path !== '/') {
    throw new ValidationError('The local knowledge MVP only supports the root mount path /.');
  }
  return '/';
}

function positiveRevision(value: unknown) {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new ValidationError('expectedRevision must be a positive integer.');
  }
  return value as number;
}

function requireReviewerActor(actor: KnowledgeHumanActor): string {
  if (actor.actorType !== 'user') {
    throw new ValidationError('A server-authenticated human reviewer is required.');
  }
  return requiredText(actor.userId, 'A server-authenticated reviewer is required.');
}

function assertKnowledgeMergeAuthority(actor: KnowledgeMergeActor): void {
  if (actor.authority !== 'knowledge-merge-service') {
    throw new ValidationError('Trusted knowledge merge authority is required.');
  }
}

function sha256Digest(value: unknown): string {
  const digest = requiredText(value, 'artifactSha256 is required.').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new ValidationError('artifactSha256 must be a SHA-256 digest.');
  }
  return digest;
}

function requireCreated<T>(value: T | null, label: string): T {
  if (!value) throw new NotFoundError(`${label} was not found after creation.`);
  return value;
}
