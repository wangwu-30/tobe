import { prisma } from '@/lib/db/prisma';

import {
  mapKnowledgeBinding,
  mapKnowledgeChangeRequest,
  mapKnowledgeMergeOperation,
  mapKnowledgeSnapshot,
  mapKnowledgeSpace,
  type KnowledgeBindingDto,
  type KnowledgeBindingRecord,
  type KnowledgeChangeRequestDto,
  type KnowledgeChangeRequestRecord,
  type KnowledgeChangeRequestStatus,
  type KnowledgeMergeOperationDto,
  type KnowledgeMergeOperationRecord,
  type KnowledgeMergeOperationStatus,
  type KnowledgeSnapshotDto,
  type KnowledgeSnapshotRecord,
  type KnowledgeSpaceDto,
  type KnowledgeSpaceRecord,
  type KnowledgeSpaceScope,
} from './schema';

export type KnowledgeActor = {
  organizationId: string;
};

export type KnowledgeHumanActor = KnowledgeActor & {
  actorType: 'user';
  userId: string;
};

export type ListKnowledgeSpacesInput = {
  scope?: KnowledgeSpaceScope;
  ownerAgentId?: string | null;
};

export type ListKnowledgeBindingsInput = {
  workspaceId?: string;
  agentId?: string | null;
  spaceId?: string;
};

export type ListKnowledgeSnapshotsInput = {
  spaceId: string;
};

export type ListKnowledgeChangeRequestsInput = {
  spaceId?: string;
  jobId?: string;
  attemptId?: string;
  status?: KnowledgeChangeRequestStatus;
};

export type ListKnowledgeMergeOperationsInput = {
  changeRequestId?: string;
  status?: KnowledgeMergeOperationStatus;
};

export async function getKnowledgeSpace(
  actor: KnowledgeActor,
  spaceId: string
): Promise<KnowledgeSpaceDto | null> {
  const records = await prisma.$queryRaw<KnowledgeSpaceRecord[]>`
    SELECT
      "id", "organizationId", "scope", "ownerAgentId",
      "repoPath", "repoUrl", "defaultBranch", "credentialRef",
      "activeSnapshotId", "readPolicy", "writePolicy",
      "createdAt", "updatedAt"
    FROM "KnowledgeSpace"
    WHERE "id" = ${spaceId}
      AND "organizationId" = ${actor.organizationId}
    LIMIT 1
  `;
  return records[0] ? mapKnowledgeSpace(records[0]) : null;
}

export async function listKnowledgeSpaces(
  actor: KnowledgeActor,
  input: ListKnowledgeSpacesInput = {}
): Promise<KnowledgeSpaceDto[]> {
  const scope = input.scope ?? null;
  const hasOwnerFilter = input.ownerAgentId !== undefined;
  const ownerAgentId = input.ownerAgentId ?? null;
  const records = await prisma.$queryRaw<KnowledgeSpaceRecord[]>`
    SELECT
      "id", "organizationId", "scope", "ownerAgentId",
      "repoPath", "repoUrl", "defaultBranch", "credentialRef",
      "activeSnapshotId", "readPolicy", "writePolicy",
      "createdAt", "updatedAt"
    FROM "KnowledgeSpace"
    WHERE "organizationId" = ${actor.organizationId}
      AND (${scope} IS NULL OR "scope" = ${scope})
      AND (
        ${hasOwnerFilter} = false OR
        (${ownerAgentId} IS NULL AND "ownerAgentId" IS NULL) OR
        "ownerAgentId" = ${ownerAgentId}
      )
    ORDER BY "updatedAt" DESC, "id" ASC
  `;
  return records.map(mapKnowledgeSpace);
}

export async function getKnowledgeBinding(
  actor: KnowledgeActor,
  bindingId: string
): Promise<KnowledgeBindingDto | null> {
  const records = await prisma.$queryRaw<KnowledgeBindingRecord[]>`
    SELECT
      "id", "organizationId", "workspaceId", "agentId",
      "spaceId", "mountPath", "access", "createdAt", "updatedAt"
    FROM "KnowledgeBinding"
    WHERE "id" = ${bindingId}
      AND "organizationId" = ${actor.organizationId}
    LIMIT 1
  `;
  return records[0] ? mapKnowledgeBinding(records[0]) : null;
}

export async function listKnowledgeBindings(
  actor: KnowledgeActor,
  input: ListKnowledgeBindingsInput = {}
): Promise<KnowledgeBindingDto[]> {
  const workspaceId = input.workspaceId ?? null;
  const spaceId = input.spaceId ?? null;
  const hasAgentFilter = input.agentId !== undefined;
  const agentId = input.agentId ?? null;
  const records = await prisma.$queryRaw<KnowledgeBindingRecord[]>`
    SELECT
      "id", "organizationId", "workspaceId", "agentId",
      "spaceId", "mountPath", "access", "createdAt", "updatedAt"
    FROM "KnowledgeBinding"
    WHERE "organizationId" = ${actor.organizationId}
      AND (${workspaceId} IS NULL OR "workspaceId" = ${workspaceId})
      AND (${spaceId} IS NULL OR "spaceId" = ${spaceId})
      AND (
        ${hasAgentFilter} = false OR
        (${agentId} IS NULL AND "agentId" IS NULL) OR
        "agentId" = ${agentId}
      )
    ORDER BY "updatedAt" DESC, "id" ASC
  `;
  return records.map(mapKnowledgeBinding);
}

export async function getKnowledgeSnapshot(
  actor: KnowledgeActor,
  snapshotId: string
): Promise<KnowledgeSnapshotDto | null> {
  const records = await prisma.$queryRaw<KnowledgeSnapshotRecord[]>`
    SELECT
      "id", "organizationId", "spaceId", "changeRequestId",
      "commitSha", "indexVersion", "artifactPath",
      "artifactSha256", "readyAt", "createdAt"
    FROM "KnowledgeSnapshot"
    WHERE "id" = ${snapshotId}
      AND "organizationId" = ${actor.organizationId}
    LIMIT 1
  `;
  return records[0] ? mapKnowledgeSnapshot(records[0]) : null;
}

export async function listKnowledgeSnapshots(
  actor: KnowledgeActor,
  input: ListKnowledgeSnapshotsInput
): Promise<KnowledgeSnapshotDto[]> {
  const records = await prisma.$queryRaw<KnowledgeSnapshotRecord[]>`
    SELECT
      "id", "organizationId", "spaceId", "changeRequestId",
      "commitSha", "indexVersion", "artifactPath",
      "artifactSha256", "readyAt", "createdAt"
    FROM "KnowledgeSnapshot"
    WHERE "organizationId" = ${actor.organizationId}
      AND "spaceId" = ${input.spaceId}
    ORDER BY "createdAt" DESC, "id" ASC
  `;
  return records.map(mapKnowledgeSnapshot);
}

export async function getKnowledgeChangeRequest(
  actor: KnowledgeActor,
  changeRequestId: string
): Promise<KnowledgeChangeRequestDto | null> {
  const records = await prisma.$queryRaw<KnowledgeChangeRequestRecord[]>`
    SELECT
      "id", "organizationId", "jobId", "attemptId", "spaceId",
      "baseCommit", "headCommit", "branchName", "status",
      "diffSummary", "diffMetadataJson", "reviewerId", "reviewNote",
      "reviewedAt", "mergedCommit", "mergedAt", "revision",
      "createdAt", "updatedAt"
    FROM "KnowledgeChangeRequest"
    WHERE "id" = ${changeRequestId}
      AND "organizationId" = ${actor.organizationId}
    LIMIT 1
  `;
  return records[0] ? mapKnowledgeChangeRequest(records[0]) : null;
}

export async function listKnowledgeChangeRequests(
  actor: KnowledgeActor,
  input: ListKnowledgeChangeRequestsInput = {}
): Promise<KnowledgeChangeRequestDto[]> {
  const spaceId = input.spaceId ?? null;
  const jobId = input.jobId ?? null;
  const attemptId = input.attemptId ?? null;
  const status = input.status ?? null;
  const records = await prisma.$queryRaw<KnowledgeChangeRequestRecord[]>`
    SELECT
      "id", "organizationId", "jobId", "attemptId", "spaceId",
      "baseCommit", "headCommit", "branchName", "status",
      "diffSummary", "diffMetadataJson", "reviewerId", "reviewNote",
      "reviewedAt", "mergedCommit", "mergedAt", "revision",
      "createdAt", "updatedAt"
    FROM "KnowledgeChangeRequest"
    WHERE "organizationId" = ${actor.organizationId}
      AND (${spaceId} IS NULL OR "spaceId" = ${spaceId})
      AND (${jobId} IS NULL OR "jobId" = ${jobId})
      AND (${attemptId} IS NULL OR "attemptId" = ${attemptId})
      AND (${status} IS NULL OR "status" = ${status})
    ORDER BY "updatedAt" DESC, "id" ASC
  `;
  return records.map(mapKnowledgeChangeRequest);
}

export async function getActiveKnowledgeSnapshot(
  actor: KnowledgeActor,
  spaceId: string
): Promise<KnowledgeSnapshotDto | null> {
  const records = await prisma.$queryRaw<KnowledgeSnapshotRecord[]>`
    SELECT snapshot."id", snapshot."organizationId", snapshot."spaceId",
      snapshot."changeRequestId", snapshot."commitSha",
      snapshot."indexVersion", snapshot."artifactPath",
      snapshot."artifactSha256", snapshot."readyAt", snapshot."createdAt"
    FROM "KnowledgeSpace" AS space
    INNER JOIN "KnowledgeSnapshot" AS snapshot
      ON snapshot."id" = space."activeSnapshotId"
     AND snapshot."organizationId" = space."organizationId"
     AND snapshot."spaceId" = space."id"
    WHERE space."id" = ${spaceId}
      AND space."organizationId" = ${actor.organizationId}
    LIMIT 1
  `;
  return records[0] ? mapKnowledgeSnapshot(records[0]) : null;
}

export async function getKnowledgeMergeOperation(
  actor: KnowledgeActor,
  operationId: string
): Promise<KnowledgeMergeOperationDto | null> {
  const records = await prisma.$queryRaw<KnowledgeMergeOperationRecord[]>`
    SELECT
      "id", "organizationId", "changeRequestId", "requestedById",
      "expectedRevision", "expectedBaseCommit", "expectedHeadCommit",
      "indexVersion", "status", "attemptCount", "leaseOwnerId",
      "leaseExpiresAt", "mergedCommit", "snapshotId", "errorCode",
      "errorMessage", "startedAt", "completedAt", "createdAt", "updatedAt"
    FROM "KnowledgeMergeOperation"
    WHERE "id" = ${operationId}
      AND "organizationId" = ${actor.organizationId}
    LIMIT 1
  `;
  return records[0] ? mapKnowledgeMergeOperation(records[0]) : null;
}

export async function listKnowledgeMergeOperations(
  actor: KnowledgeActor,
  input: ListKnowledgeMergeOperationsInput = {}
): Promise<KnowledgeMergeOperationDto[]> {
  const changeRequestId = input.changeRequestId ?? null;
  const status = input.status ?? null;
  const records = await prisma.$queryRaw<KnowledgeMergeOperationRecord[]>`
    SELECT
      "id", "organizationId", "changeRequestId", "requestedById",
      "expectedRevision", "expectedBaseCommit", "expectedHeadCommit",
      "indexVersion", "status", "attemptCount", "leaseOwnerId",
      "leaseExpiresAt", "mergedCommit", "snapshotId", "errorCode",
      "errorMessage", "startedAt", "completedAt", "createdAt", "updatedAt"
    FROM "KnowledgeMergeOperation"
    WHERE "organizationId" = ${actor.organizationId}
      AND (${changeRequestId} IS NULL OR "changeRequestId" = ${changeRequestId})
      AND (${status} IS NULL OR "status" = ${status})
    ORDER BY "createdAt" DESC, "id" ASC
  `;
  return records.map(mapKnowledgeMergeOperation);
}
