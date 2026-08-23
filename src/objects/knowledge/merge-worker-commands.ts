import { randomUUID } from 'node:crypto';

import { ConflictError, NotFoundError, ValidationError } from '@/framework/resilience';
import { prisma } from '@/lib/db/prisma';

import {
  mapKnowledgeChangeRequest,
  mapKnowledgeMergeOperation,
  mapKnowledgeSnapshot,
  type KnowledgeChangeRequestDto,
  type KnowledgeMergeOperationDto,
  type KnowledgeMergeOperationRecord,
  type KnowledgeSnapshotDto,
  type KnowledgeSnapshotRecord,
} from './schema';

const DEFAULT_LEASE_DURATION_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_LEASE_DURATION_MS = 60 * 60_000;

export type KnowledgeMergeWorkerActor = {
  organizationId: string;
  authority: 'knowledge-merge-service';
};

export type KnowledgeMergeClaimV1 = {
  schemaVersion: 1;
  operation: KnowledgeMergeOperationDto;
  changeRequest: KnowledgeChangeRequestDto;
  repositoryPath: string;
  defaultBranch: string;
  expectedPatchSha256: string | null;
};

type MergeContextRow = KnowledgeMergeOperationRecord & {
  crId: string;
  crOrganizationId: string;
  crJobId: string;
  crAttemptId: string;
  crSpaceId: string;
  crBaseCommit: string;
  crHeadCommit: string;
  crBranchName: string;
  crStatus: string;
  crDiffSummary: string;
  crDiffMetadataJson: string;
  crReviewerId: string | null;
  crReviewNote: string | null;
  crReviewedAt: Date | string | null;
  crMergedCommit: string | null;
  crMergedAt: Date | string | null;
  crRevision: number;
  crCreatedAt: Date | string;
  crUpdatedAt: Date | string;
  repoPath: string | null;
  repoUrl: string | null;
  defaultBranch: string;
};

type RawSqlDb = {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

export async function listClaimableKnowledgeMergeOperationIds(
  actor: KnowledgeMergeWorkerActor,
  input: { limit?: number; now?: Date; maxAttempts?: number } = {}
): Promise<string[]> {
  assertAuthority(actor);
  const limit = readLimit(input.limit);
  const maxAttempts = positiveInteger(
    input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    'maxAttempts'
  );
  const now = readDate(input.now ?? new Date(), 'now');
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT operation."id"
    FROM "KnowledgeMergeOperation" AS operation
    INNER JOIN "KnowledgeChangeRequest" AS changeRequest
      ON changeRequest."id" = operation."changeRequestId"
     AND changeRequest."organizationId" = operation."organizationId"
    WHERE operation."organizationId" = ${actor.organizationId}
      AND (
        operation."status" = 'queued'
        OR (
          operation."status" = 'failed'
          AND operation."attemptCount" < ${maxAttempts}
        )
        OR (
          operation."status" = 'running'
          AND operation."leaseExpiresAt" IS NOT NULL
          AND operation."leaseExpiresAt" <= ${now}
          AND operation."attemptCount" < ${maxAttempts}
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "KnowledgeMergeOperation" AS active
        INNER JOIN "KnowledgeChangeRequest" AS activeChange
          ON activeChange."id" = active."changeRequestId"
         AND activeChange."organizationId" = active."organizationId"
        WHERE active."organizationId" = operation."organizationId"
          AND activeChange."spaceId" = changeRequest."spaceId"
          AND active."status" = 'running'
          AND active."leaseExpiresAt" > ${now}
          AND active."id" <> operation."id"
      )
    ORDER BY operation."createdAt" ASC, operation."id" ASC
    LIMIT ${limit}
  `;
  return rows.map((row) => row.id);
}

export async function claimKnowledgeMergeOperation(
  actor: KnowledgeMergeWorkerActor,
  input: {
    operationId: string;
    workerId: string;
    leaseDurationMs?: number;
    allowFailedRetry?: boolean;
  }
): Promise<KnowledgeMergeClaimV1> {
  assertAuthority(actor);
  const operationId = requireText(input.operationId, 'operationId');
  const workerId = requireText(input.workerId, 'workerId');
  const leaseDurationMs = readLeaseDuration(input.leaseDurationMs);
  const now = new Date();
  const leaseExpiresAt = new Date(now.valueOf() + leaseDurationMs);

  return prisma.$transaction(async (db) => {
    const current = await loadMergeContext(db, actor.organizationId, operationId);
    if (!current) throw new NotFoundError('Knowledge merge operation not found.');
    const claimable =
      current.status === 'queued' ||
      (current.status === 'failed' && input.allowFailedRetry === true) ||
      (current.status === 'running' &&
        current.leaseExpiresAt !== null &&
        new Date(current.leaseExpiresAt).valueOf() <= now.valueOf());
    if (!claimable) {
      throw new ConflictError('Knowledge merge operation is not claimable.');
    }

    const changed = await db.$executeRaw`
      UPDATE "KnowledgeMergeOperation"
      SET "status" = 'running',
          "attemptCount" = "attemptCount" + 1,
          "leaseOwnerId" = ${workerId},
          "leaseExpiresAt" = ${leaseExpiresAt},
          "startedAt" = COALESCE("startedAt", ${now}),
          "completedAt" = NULL,
          "errorCode" = NULL,
          "errorMessage" = NULL,
          "updatedAt" = ${now}
      WHERE "id" = ${operationId}
        AND "organizationId" = ${actor.organizationId}
        AND "attemptCount" = ${current.attemptCount}
        AND (
          "status" = 'queued'
          OR (${input.allowFailedRetry === true} AND "status" = 'failed')
          OR ("status" = 'running' AND "leaseExpiresAt" <= ${now})
        )
        AND NOT EXISTS (
          SELECT 1 FROM "KnowledgeMergeOperation" AS active
          INNER JOIN "KnowledgeChangeRequest" AS activeChange
            ON activeChange."id" = active."changeRequestId"
           AND activeChange."organizationId" = active."organizationId"
          WHERE active."organizationId" = ${actor.organizationId}
            AND activeChange."spaceId" = ${current.crSpaceId}
            AND active."status" = 'running'
            AND active."leaseExpiresAt" > ${now}
            AND active."id" <> ${operationId}
        )
    `;
    if (changed !== 1) {
      throw new ConflictError('Knowledge merge operation was claimed by another worker.');
    }
    const claimed = await loadMergeContext(db, actor.organizationId, operationId);
    if (!claimed) throw new Error('Claimed knowledge merge operation disappeared.');
    return mapClaim(claimed);
  });
}

export async function heartbeatKnowledgeMergeOperation(
  actor: KnowledgeMergeWorkerActor,
  input: LeaseInput & { leaseDurationMs?: number }
): Promise<KnowledgeMergeOperationDto> {
  assertAuthority(actor);
  const operationId = requireText(input.operationId, 'operationId');
  const workerId = requireText(input.workerId, 'workerId');
  const attemptCount = positiveInteger(input.attemptCount, 'attemptCount');
  const leaseDurationMs = readLeaseDuration(input.leaseDurationMs);
  const now = new Date();
  const leaseExpiresAt = new Date(now.valueOf() + leaseDurationMs);
  const changed = await prisma.$executeRaw`
    UPDATE "KnowledgeMergeOperation"
    SET "leaseExpiresAt" = ${leaseExpiresAt}, "updatedAt" = ${now}
    WHERE "id" = ${operationId}
      AND "organizationId" = ${actor.organizationId}
      AND "status" = 'running'
      AND "leaseOwnerId" = ${workerId}
      AND "attemptCount" = ${attemptCount}
      AND "leaseExpiresAt" IS NOT NULL
      AND "leaseExpiresAt" > ${now}
  `;
  if (changed !== 1) throw mergeFenceError();
  return requireOperation(prisma, actor.organizationId, operationId);
}

export async function recordKnowledgeGitMerge(
  actor: KnowledgeMergeWorkerActor,
  input: LeaseInput & { mergedCommit: string }
): Promise<KnowledgeMergeOperationDto> {
  assertAuthority(actor);
  const mergedCommit = requireText(input.mergedCommit, 'mergedCommit');
  return prisma.$transaction(async (db) => {
    const context = await requireFencedContext(db, actor, input);
    if (mergedCommit !== context.expectedHeadCommit) {
      throw new ConflictError('Trusted Git returned an unexpected merged commit.');
    }
    const exactApproved =
      context.crStatus === 'approved' &&
      context.crRevision === context.expectedRevision &&
      context.crBaseCommit === context.expectedBaseCommit &&
      context.crHeadCommit === context.expectedHeadCommit;
    const exactReplay =
      context.crStatus === 'merged' &&
      context.crRevision === context.expectedRevision + 1 &&
      context.crMergedCommit === context.expectedHeadCommit;
    if (!exactApproved && !exactReplay) {
      throw new ConflictError('Approved knowledge revision changed before merge recording.');
    }
    const now = new Date();
    if (exactApproved) {
      const updated = await db.$executeRaw`
        UPDATE "KnowledgeChangeRequest"
        SET "status" = 'merged', "mergedCommit" = ${mergedCommit},
            "mergedAt" = ${now}, "revision" = "revision" + 1,
            "updatedAt" = ${now}
        WHERE "id" = ${context.changeRequestId}
          AND "organizationId" = ${actor.organizationId}
          AND "status" = 'approved'
          AND "revision" = ${context.expectedRevision}
          AND "baseCommit" = ${context.expectedBaseCommit}
          AND "headCommit" = ${context.expectedHeadCommit}
      `;
      if (updated !== 1) throw mergeFenceError();
    }
    const changed = await db.$executeRaw`
      UPDATE "KnowledgeMergeOperation"
      SET "mergedCommit" = ${mergedCommit}, "updatedAt" = ${now}
      WHERE "id" = ${input.operationId}
        AND "organizationId" = ${actor.organizationId}
        AND "status" = 'running'
        AND "leaseOwnerId" = ${input.workerId}
        AND "attemptCount" = ${input.attemptCount}
        AND "leaseExpiresAt" IS NOT NULL
        AND "leaseExpiresAt" > ${now}
    `;
    if (changed !== 1) throw mergeFenceError();
    return requireOperation(db, actor.organizationId, input.operationId);
  });
}

export async function recordKnowledgeMergeConflict(
  actor: KnowledgeMergeWorkerActor,
  input: LeaseInput & { code: string; message: string }
): Promise<KnowledgeMergeOperationDto> {
  assertAuthority(actor);
  return prisma.$transaction(async (db) => {
    const context = await requireFencedContext(db, actor, input);
    const now = new Date();
    if (context.crStatus === 'approved' && context.crRevision === context.expectedRevision) {
      await db.$executeRaw`
        UPDATE "KnowledgeChangeRequest"
        SET "status" = 'conflicted', "revision" = "revision" + 1,
            "updatedAt" = ${now}
        WHERE "id" = ${context.changeRequestId}
          AND "organizationId" = ${actor.organizationId}
          AND "status" = 'approved'
          AND "revision" = ${context.expectedRevision}
      `;
    }
    const changed = await db.$executeRaw`
      UPDATE "KnowledgeMergeOperation"
      SET "status" = 'conflicted', "leaseOwnerId" = NULL,
          "leaseExpiresAt" = NULL, "errorCode" = ${safeError(input.code)},
          "errorMessage" = ${safeError(input.message)},
          "completedAt" = ${now}, "updatedAt" = ${now}
      WHERE "id" = ${input.operationId}
        AND "organizationId" = ${actor.organizationId}
        AND "status" = 'running'
        AND "leaseOwnerId" = ${input.workerId}
        AND "attemptCount" = ${input.attemptCount}
        AND "leaseExpiresAt" IS NOT NULL
        AND "leaseExpiresAt" > ${now}
    `;
    if (changed !== 1) throw mergeFenceError();
    return requireOperation(db, actor.organizationId, input.operationId);
  });
}

export async function recordKnowledgeMergeFailure(
  actor: KnowledgeMergeWorkerActor,
  input: LeaseInput & { code: string; message: string }
): Promise<KnowledgeMergeOperationDto> {
  assertAuthority(actor);
  const now = new Date();
  const changed = await prisma.$executeRaw`
    UPDATE "KnowledgeMergeOperation"
    SET "status" = 'failed', "leaseOwnerId" = NULL,
        "leaseExpiresAt" = NULL, "errorCode" = ${safeError(input.code)},
        "errorMessage" = ${safeError(input.message)},
        "completedAt" = ${now}, "updatedAt" = ${now}
    WHERE "id" = ${input.operationId}
      AND "organizationId" = ${actor.organizationId}
      AND "status" = 'running'
      AND "leaseOwnerId" = ${input.workerId}
      AND "attemptCount" = ${input.attemptCount}
      AND "leaseExpiresAt" IS NOT NULL
      AND "leaseExpiresAt" > ${now}
  `;
  if (changed !== 1) throw mergeFenceError();
  return requireOperation(prisma, actor.organizationId, input.operationId);
}

export async function publishKnowledgeIndexSnapshot(
  actor: KnowledgeMergeWorkerActor,
  input: LeaseInput & {
    artifactPath: string;
    artifactSha256: string;
    readyAt: Date;
  }
): Promise<{ operation: KnowledgeMergeOperationDto; snapshot: KnowledgeSnapshotDto }> {
  assertAuthority(actor);
  const artifactPath = requireText(input.artifactPath, 'artifactPath');
  const artifactSha256 = sha256(input.artifactSha256, 'artifactSha256');
  const readyAt = readDate(input.readyAt, 'readyAt');
  return prisma.$transaction(async (db) => {
    const context = await requireFencedContext(db, actor, input);
    if (
      context.crStatus !== 'merged' ||
      context.crMergedCommit !== context.expectedHeadCommit ||
      context.mergedCommit !== context.expectedHeadCommit
    ) {
      throw new ConflictError('Git merge must be durably recorded before index publication.');
    }
    const now = new Date();
    const snapshotId = randomUUID();
    await db.$executeRaw`
      INSERT INTO "KnowledgeSnapshot" (
        "id", "organizationId", "spaceId", "changeRequestId",
        "commitSha", "indexVersion", "artifactPath",
        "artifactSha256", "readyAt", "createdAt"
      ) VALUES (
        ${snapshotId}, ${actor.organizationId}, ${context.crSpaceId},
        ${context.changeRequestId}, ${context.expectedHeadCommit},
        ${context.indexVersion}, ${artifactPath}, ${artifactSha256},
        ${readyAt}, ${now}
      )
      ON CONFLICT ("spaceId", "commitSha", "indexVersion") DO NOTHING
    `;
    const snapshots = await db.$queryRaw<KnowledgeSnapshotRecord[]>`
      SELECT "id", "organizationId", "spaceId", "changeRequestId",
        "commitSha", "indexVersion", "artifactPath",
        "artifactSha256", "readyAt", "createdAt"
      FROM "KnowledgeSnapshot"
      WHERE "spaceId" = ${context.crSpaceId}
        AND "commitSha" = ${context.expectedHeadCommit}
        AND "indexVersion" = ${context.indexVersion}
      LIMIT 1
    `;
    const snapshot = snapshots[0];
    if (
      !snapshot ||
      snapshot.organizationId !== actor.organizationId ||
      snapshot.changeRequestId !== context.changeRequestId ||
      snapshot.artifactPath !== artifactPath ||
      snapshot.artifactSha256 !== artifactSha256
    ) {
      throw new ConflictError('Knowledge snapshot key was reused with different content.');
    }
    const activated = await db.$executeRaw`
      UPDATE "KnowledgeSpace"
      SET "activeSnapshotId" = ${snapshot.id}, "updatedAt" = ${now}
      WHERE "id" = ${context.crSpaceId}
        AND "organizationId" = ${actor.organizationId}
    `;
    if (activated !== 1) throw new NotFoundError('Knowledge space not found.');
    const completed = await db.$executeRaw`
      UPDATE "KnowledgeMergeOperation"
      SET "status" = 'succeeded', "snapshotId" = ${snapshot.id},
          "leaseOwnerId" = NULL, "leaseExpiresAt" = NULL,
          "errorCode" = NULL, "errorMessage" = NULL,
          "completedAt" = ${now}, "updatedAt" = ${now}
      WHERE "id" = ${input.operationId}
        AND "organizationId" = ${actor.organizationId}
        AND "status" = 'running'
        AND "leaseOwnerId" = ${input.workerId}
        AND "attemptCount" = ${input.attemptCount}
        AND "leaseExpiresAt" IS NOT NULL
        AND "leaseExpiresAt" > ${now}
        AND "mergedCommit" = ${context.expectedHeadCommit}
    `;
    if (completed !== 1) throw mergeFenceError();
    return {
      operation: await requireOperation(db, actor.organizationId, input.operationId),
      snapshot: mapKnowledgeSnapshot(snapshot),
    };
  });
}

type LeaseInput = { operationId: string; workerId: string; attemptCount: number };

async function requireFencedContext(
  db: RawSqlDb,
  actor: KnowledgeMergeWorkerActor,
  input: LeaseInput
): Promise<MergeContextRow> {
  const context = await loadMergeContext(
    db,
    actor.organizationId,
    requireText(input.operationId, 'operationId')
  );
  const now = new Date();
  if (
    !context ||
    context.status !== 'running' ||
    context.leaseOwnerId !== requireText(input.workerId, 'workerId') ||
    context.attemptCount !== positiveInteger(input.attemptCount, 'attemptCount') ||
    context.leaseExpiresAt === null ||
    new Date(context.leaseExpiresAt).valueOf() <= now.valueOf()
  ) {
    throw mergeFenceError();
  }
  return context;
}

async function loadMergeContext(
  db: RawSqlDb,
  organizationId: string,
  operationId: string
): Promise<MergeContextRow | null> {
  const rows = await db.$queryRaw<MergeContextRow[]>`
    SELECT operation.*,
      changeRequest."id" AS "crId",
      changeRequest."organizationId" AS "crOrganizationId",
      changeRequest."jobId" AS "crJobId",
      changeRequest."attemptId" AS "crAttemptId",
      changeRequest."spaceId" AS "crSpaceId",
      changeRequest."baseCommit" AS "crBaseCommit",
      changeRequest."headCommit" AS "crHeadCommit",
      changeRequest."branchName" AS "crBranchName",
      changeRequest."status" AS "crStatus",
      changeRequest."diffSummary" AS "crDiffSummary",
      changeRequest."diffMetadataJson" AS "crDiffMetadataJson",
      changeRequest."reviewerId" AS "crReviewerId",
      changeRequest."reviewNote" AS "crReviewNote",
      changeRequest."reviewedAt" AS "crReviewedAt",
      changeRequest."mergedCommit" AS "crMergedCommit",
      changeRequest."mergedAt" AS "crMergedAt",
      changeRequest."revision" AS "crRevision",
      changeRequest."createdAt" AS "crCreatedAt",
      changeRequest."updatedAt" AS "crUpdatedAt",
      space."repoPath", space."repoUrl", space."defaultBranch"
    FROM "KnowledgeMergeOperation" AS operation
    INNER JOIN "KnowledgeChangeRequest" AS changeRequest
      ON changeRequest."id" = operation."changeRequestId"
     AND changeRequest."organizationId" = operation."organizationId"
    INNER JOIN "KnowledgeSpace" AS space
      ON space."id" = changeRequest."spaceId"
     AND space."organizationId" = changeRequest."organizationId"
    WHERE operation."id" = ${operationId}
      AND operation."organizationId" = ${organizationId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function mapClaim(row: MergeContextRow): KnowledgeMergeClaimV1 {
  if (!row.repoPath || row.repoUrl) {
    throw new ConflictError('Trusted merge supports local repository paths only.');
  }
  const metadata = safeDiffMetadata(row.crDiffMetadataJson);
  return {
    schemaVersion: 1,
    operation: mapKnowledgeMergeOperation(operationRecord(row)),
    changeRequest: mapKnowledgeChangeRequest({
      id: row.crId,
      organizationId: row.crOrganizationId,
      jobId: row.crJobId,
      attemptId: row.crAttemptId,
      spaceId: row.crSpaceId,
      baseCommit: row.crBaseCommit,
      headCommit: row.crHeadCommit,
      branchName: row.crBranchName,
      status: row.crStatus,
      diffSummary: row.crDiffSummary,
      diffMetadataJson: row.crDiffMetadataJson,
      reviewerId: row.crReviewerId,
      reviewNote: row.crReviewNote,
      reviewedAt: row.crReviewedAt,
      mergedCommit: row.crMergedCommit,
      mergedAt: row.crMergedAt,
      revision: row.crRevision,
      createdAt: row.crCreatedAt,
      updatedAt: row.crUpdatedAt,
    }),
    repositoryPath: row.repoPath,
    defaultBranch: row.defaultBranch,
    expectedPatchSha256: metadata,
  };
}

function operationRecord(row: MergeContextRow): KnowledgeMergeOperationRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    changeRequestId: row.changeRequestId,
    requestedById: row.requestedById,
    expectedRevision: row.expectedRevision,
    expectedBaseCommit: row.expectedBaseCommit,
    expectedHeadCommit: row.expectedHeadCommit,
    indexVersion: row.indexVersion,
    status: row.status,
    attemptCount: row.attemptCount,
    leaseOwnerId: row.leaseOwnerId,
    leaseExpiresAt: row.leaseExpiresAt,
    mergedCommit: row.mergedCommit,
    snapshotId: row.snapshotId,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function safeDiffMetadata(raw: string): string | null {
  // mapKnowledgeChangeRequest performs safe parsing and JSON-value validation.
  const dto = mapKnowledgeChangeRequest({
    id: 'metadata', organizationId: 'metadata', jobId: 'metadata',
    attemptId: 'metadata', spaceId: 'metadata', baseCommit: 'base',
    headCommit: 'head', branchName: 'branch', status: 'pending_review',
    diffSummary: '', diffMetadataJson: raw, reviewerId: null, reviewNote: null,
    reviewedAt: null, mergedCommit: null, mergedAt: null, revision: 1,
    createdAt: new Date(0), updatedAt: new Date(0),
  });
  const value = dto.diffMetadata.patchSha256;
  if (value === undefined || value === null) return null;
  return sha256(value, 'diffMetadata.patchSha256');
}

async function requireOperation(
  db: RawSqlDb,
  organizationId: string,
  operationId: string
): Promise<KnowledgeMergeOperationDto> {
  const rows = await db.$queryRaw<KnowledgeMergeOperationRecord[]>`
    SELECT "id", "organizationId", "changeRequestId", "requestedById",
      "expectedRevision", "expectedBaseCommit", "expectedHeadCommit",
      "indexVersion", "status", "attemptCount", "leaseOwnerId",
      "leaseExpiresAt", "mergedCommit", "snapshotId", "errorCode",
      "errorMessage", "startedAt", "completedAt", "createdAt", "updatedAt"
    FROM "KnowledgeMergeOperation"
    WHERE "id" = ${operationId} AND "organizationId" = ${organizationId}
    LIMIT 1
  `;
  if (!rows[0]) throw new NotFoundError('Knowledge merge operation not found.');
  return mapKnowledgeMergeOperation(rows[0]);
}

function assertAuthority(actor: KnowledgeMergeWorkerActor): void {
  if (actor.authority !== 'knowledge-merge-service') {
    throw new ValidationError('Trusted knowledge merge authority is required.');
  }
  requireText(actor.organizationId, 'organizationId');
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} is required.`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new ValidationError(`${field} must be a positive integer.`);
  }
  return value as number;
}

function readLimit(value: number | undefined): number {
  const limit = value ?? 32;
  if (!Number.isInteger(limit) || limit < 1 || limit > 256) {
    throw new ValidationError('limit must be an integer from 1 to 256.');
  }
  return limit;
}

function readLeaseDuration(value: number | undefined): number {
  const duration = value ?? DEFAULT_LEASE_DURATION_MS;
  if (!Number.isInteger(duration) || duration < 1_000 || duration > MAX_LEASE_DURATION_MS) {
    throw new ValidationError('leaseDurationMs must be an integer from 1000 to 3600000.');
  }
  return duration;
}

function readDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new ValidationError(`${field} must be a valid Date.`);
  }
  return value;
}

function sha256(value: unknown, field: string): string {
  const digest = requireText(value, field).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new ValidationError(`${field} must be a SHA-256 digest.`);
  }
  return digest;
}

function safeError(value: unknown): string {
  const text = requireText(value, 'error').slice(0, 1_000);
  return text;
}

function mergeFenceError(): ConflictError {
  return new ConflictError('Knowledge merge lease is stale, expired, or owned by another worker.');
}
