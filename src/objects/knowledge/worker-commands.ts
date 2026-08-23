import { randomUUID } from "node:crypto";

import type {
  FinalizedGitWorktree,
  PreparedGitWorktree,
} from "@/agent/knowledge/contracts";
import {
  assertWorkspaceLifecycleAdvanceV1,
  parseStoredWorkspaceLifecycleV1,
  parseWorkspaceLifecycleV1,
  serializeWorkspaceLifecycleV1,
  type WorkspaceLifecycleV1,
} from "@/agent/execution/workspace-lifecycle";
import {
  ConflictError,
  ValidationError,
} from "@/framework/resilience/app-error";
import { isRecord, safeJsonParse } from "@/framework/resilience/safe-data";
import { prisma } from "@/lib/db/prisma";
import {
  parseFrozenKnowledgeBindingV1,
  type FrozenKnowledgeBindingV1,
} from "@/objects/execution-job/schema";

import {
  mapKnowledgeChangeRequest,
  type KnowledgeChangeRequestDto,
  type KnowledgeChangeRequestRecord,
} from "./schema";

const INVALID_MANIFEST = Symbol("invalid-knowledge-job-manifest");

export type CreateKnowledgeChangeRequestForAttemptInputV1 = {
  attemptId: string;
  workerId: string;
  generation: number;
  binding: FrozenKnowledgeBindingV1;
  prepared: PreparedGitWorktree;
  finalized: FinalizedGitWorktree;
};

export type CreateKnowledgeChangeRequestForAttemptResultV1 = {
  schemaVersion: 1;
  changeRequest: KnowledgeChangeRequestDto;
  replayed: boolean;
};

type RawSqlDb = {
  $executeRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

type AttemptContextRow = {
  attemptId: string;
  jobId: string;
  attemptNumber: number;
  contextManifestJson: string;
  workspaceLifecycleJson: string | null;
};

type BindingRow = {
  id: string;
  workspaceId: string;
  agentId: string | null;
  spaceId: string;
  mountPath: string;
  access: string;
  defaultBranch: string;
  scope: string;
  ownerAgentId: string | null;
};

/**
 * Creates the review record for an already-finalized attempt without granting
 * the runtime review or merge authority. The attempt lease is checked before
 * every durable mutation and exact replays return the original record.
 */
export async function createKnowledgeChangeRequestForAttempt(
  actor: { organizationId: string },
  input: CreateKnowledgeChangeRequestForAttemptInputV1,
): Promise<CreateKnowledgeChangeRequestForAttemptResultV1> {
  const organizationId = requireText(actor.organizationId, "organizationId");
  const attemptId = requireText(input.attemptId, "attemptId");
  const workerId = requireText(input.workerId, "workerId");
  const generation = positiveInteger(input.generation, "generation");
  const binding = parseFrozenKnowledgeBindingV1(input.binding);
  const now = new Date();

  return prisma.$transaction(async (db) => {
    const attempt = await loadFencedAttempt(db, {
      organizationId,
      attemptId,
      workerId,
      generation,
      now,
    });
    const manifestBinding = parseManifestBinding(attempt.contextManifestJson);
    if (!sameFrozenBinding(binding, manifestBinding)) {
      throw new ConflictError(
        "Knowledge binding no longer matches the Job context manifest.",
      );
    }
    if (
      input.prepared.jobId !== attempt.jobId ||
      input.finalized.jobId !== attempt.jobId ||
      input.prepared.attemptId !== attemptId ||
      input.finalized.attemptId !== attemptId ||
      input.prepared.attemptNumber !== attempt.attemptNumber
    ) {
      throw new ConflictError(
        "Knowledge worktree receipts do not belong to the leased attempt.",
      );
    }
    await validateLiveBinding(db, organizationId, binding);

    const lifecycle = requireStoredLifecycle(attempt.workspaceLifecycleJson);
    const validatedLifecycle = assertSuppliedReceipts(
      lifecycle,
      binding,
      input.prepared,
      input.finalized,
    );
    const finalized = validatedLifecycle.finalized;
    if (
      finalized?.changed !== true ||
      finalized.headCommit === finalized.baseCommit
    ) {
      throw new ValidationError(
        "A knowledge change request requires a changed finalized worktree.",
      );
    }
    const expectedMetadataJson = JSON.stringify({
      bindingId: binding.bindingId,
      mountPath: binding.mountPath,
      files: [...finalized.files],
      shortStat: finalized.diffSummary.shortStat,
      insertions: finalized.diffSummary.insertions,
      deletions: finalized.diffSummary.deletions,
      patchSha256: finalized.patchSha256,
    });

    const existing = await findChangeRequest(
      db,
      organizationId,
      attemptId,
      binding.spaceId,
      finalized.headCommit,
    );
    if (existing) {
      assertReplay(existing, attempt.jobId, finalized, expectedMetadataJson);
      const lifecycleJson = advanceToChangeRequest(
        validatedLifecycle,
        existing.id,
      );
      // Even a pure replay performs a fenced CAS. The initial read alone does
      // not prove ownership remained valid through the end of the transaction.
      await persistLifecycle(db, {
        organizationId,
        attemptId,
        workerId,
        generation,
        now: new Date(),
        lifecycleJson,
      });
      return {
        schemaVersion: 1,
        changeRequest: mapKnowledgeChangeRequest(existing),
        replayed: true,
      };
    }

    const id = randomUUID();
    const inserted = await db.$executeRaw`
      INSERT INTO "KnowledgeChangeRequest" (
        "id", "organizationId", "jobId", "attemptId", "spaceId",
        "baseCommit", "headCommit", "branchName", "status",
        "diffSummary", "diffMetadataJson", "revision",
        "createdAt", "updatedAt"
      ) VALUES (
        ${id}, ${organizationId}, ${attempt.jobId}, ${attemptId}, ${binding.spaceId},
        ${finalized.baseCommit}, ${finalized.headCommit}, ${finalized.branch},
        'pending_review', ${finalized.diffSummary.shortStat},
        ${expectedMetadataJson}, 1, ${now}, ${now}
      )
      ON CONFLICT ("attemptId", "spaceId", "headCommit") DO NOTHING
    `;

    const created = await findChangeRequest(
      db,
      organizationId,
      attemptId,
      binding.spaceId,
      finalized.headCommit,
    );
    if (!created) {
      throw new Error(
        "Knowledge change request could not be loaded after creation.",
      );
    }
    if (inserted === 0) {
      assertReplay(created, attempt.jobId, finalized, expectedMetadataJson);
    } else if (inserted !== 1 || created.id !== id) {
      throw new Error(
        "Knowledge change request creation returned an invalid result.",
      );
    }
    const lifecycleJson = advanceToChangeRequest(
      validatedLifecycle,
      created.id,
    );
    await persistLifecycle(db, {
      organizationId,
      attemptId,
      workerId,
      generation,
      now: new Date(),
      lifecycleJson,
    });
    return {
      schemaVersion: 1,
      changeRequest: mapKnowledgeChangeRequest(created),
      replayed: inserted === 0,
    };
  });
}

async function loadFencedAttempt(
  db: RawSqlDb,
  input: {
    organizationId: string;
    attemptId: string;
    workerId: string;
    generation: number;
    now: Date;
  },
): Promise<AttemptContextRow> {
  const rows = await db.$queryRaw<AttemptContextRow[]>`
    SELECT a."id" AS "attemptId", a."jobId",
      a."number" AS "attemptNumber",
      j."contextManifestJson", a."workspaceLifecycleJson"
    FROM "ExecutionAttempt" a
    JOIN "ExecutionJob" j
      ON j."id" = a."jobId"
     AND j."organizationId" = a."organizationId"
    WHERE a."id" = ${input.attemptId}
      AND a."organizationId" = ${input.organizationId}
      AND a."status" = 'running'
      AND a."generation" = ${input.generation}
      AND a."leaseOwnerId" = ${input.workerId}
      AND a."leaseExpiresAt" IS NOT NULL
      AND a."leaseExpiresAt" > ${input.now}
    LIMIT 1
  `;
  if (!rows[0]) throw fenceError();
  return rows[0];
}

async function validateLiveBinding(
  db: RawSqlDb,
  organizationId: string,
  frozen: FrozenKnowledgeBindingV1,
): Promise<void> {
  const rows = await db.$queryRaw<BindingRow[]>`
    SELECT b."id", b."workspaceId", b."agentId", b."spaceId",
      b."mountPath", b."access", s."defaultBranch", s."scope",
      s."ownerAgentId"
    FROM "KnowledgeBinding" b
    JOIN "KnowledgeSpace" s
      ON s."id" = b."spaceId"
     AND s."organizationId" = b."organizationId"
    WHERE b."id" = ${frozen.bindingId}
      AND b."organizationId" = ${organizationId}
    LIMIT 1
  `;
  const live = rows[0];
  if (
    !live ||
    live.workspaceId !== frozen.workspaceId ||
    live.agentId !== frozen.agentId ||
    live.spaceId !== frozen.spaceId ||
    live.mountPath !== frozen.mountPath ||
    live.access !== "propose" ||
    live.defaultBranch !== frozen.defaultBranch ||
    (live.scope !== "team" && live.scope !== "agent") ||
    (live.scope === "agent" &&
      (frozen.agentId === null || live.ownerAgentId !== frozen.agentId))
  ) {
    throw new ConflictError(
      "Knowledge binding is no longer authorized for this attempt.",
    );
  }
}

async function findChangeRequest(
  db: RawSqlDb,
  organizationId: string,
  attemptId: string,
  spaceId: string,
  headCommit: string,
): Promise<KnowledgeChangeRequestRecord | null> {
  const rows = await db.$queryRaw<KnowledgeChangeRequestRecord[]>`
    SELECT "id", "organizationId", "jobId", "attemptId", "spaceId",
      "baseCommit", "headCommit", "branchName", "status",
      "diffSummary", "diffMetadataJson", "reviewerId", "reviewNote",
      "reviewedAt", "mergedCommit", "mergedAt", "revision",
      "createdAt", "updatedAt"
    FROM "KnowledgeChangeRequest"
    WHERE "organizationId" = ${organizationId}
      AND "attemptId" = ${attemptId}
      AND "spaceId" = ${spaceId}
      AND "headCommit" = ${headCommit}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function persistLifecycle(
  db: RawSqlDb,
  input: {
    organizationId: string;
    attemptId: string;
    workerId: string;
    generation: number;
    now: Date;
    lifecycleJson: string;
  },
): Promise<void> {
  const changed = await db.$executeRaw`
    UPDATE "ExecutionAttempt"
    SET "workspaceLifecycleJson" = ${input.lifecycleJson}, "updatedAt" = ${input.now}
    WHERE "id" = ${input.attemptId}
      AND "organizationId" = ${input.organizationId}
      AND "status" = 'running'
      AND "generation" = ${input.generation}
      AND "leaseOwnerId" = ${input.workerId}
      AND "leaseExpiresAt" IS NOT NULL
      AND "leaseExpiresAt" > ${input.now}
  `;
  if (changed !== 1) throw fenceError();
}

function parseManifestBinding(raw: string): FrozenKnowledgeBindingV1 {
  const manifest = safeJsonParse<unknown | typeof INVALID_MANIFEST>(
    raw,
    INVALID_MANIFEST,
  );
  if (manifest === INVALID_MANIFEST) {
    throw new ConflictError("Stored Job context manifest is invalid.");
  }
  if (!isRecord(manifest)) {
    throw new ConflictError("Stored Job context manifest is invalid.");
  }
  try {
    return parseFrozenKnowledgeBindingV1(manifest.knowledgeCommit);
  } catch {
    throw new ConflictError("Job has no valid frozen knowledge binding.");
  }
}

function requireStoredLifecycle(raw: string | null): WorkspaceLifecycleV1 {
  try {
    const lifecycle = parseStoredWorkspaceLifecycleV1(raw);
    if (lifecycle === null) {
      throw new ConflictError("Stored workspace lifecycle is missing.");
    }
    return lifecycle;
  } catch (error) {
    if (error instanceof ConflictError) throw error;
    throw new ConflictError("Stored workspace lifecycle is invalid.", {
      cause: error,
    });
  }
}

function assertSuppliedReceipts(
  lifecycle: WorkspaceLifecycleV1,
  binding: FrozenKnowledgeBindingV1,
  prepared: PreparedGitWorktree,
  finalized: FinalizedGitWorktree,
): WorkspaceLifecycleV1 {
  let supplied: WorkspaceLifecycleV1;
  try {
    supplied = parseWorkspaceLifecycleV1({
      ...lifecycle,
      binding,
      prepared,
      finalized,
    });
  } catch (error) {
    throw new ConflictError(
      "Supplied knowledge worktree receipts are invalid.",
      { cause: error },
    );
  }
  if (
    serializeWorkspaceLifecycleV1(lifecycle) !==
    serializeWorkspaceLifecycleV1(supplied)
  ) {
    throw new ConflictError(
      "Workspace lifecycle does not contain the supplied finalized receipt.",
    );
  }
  return supplied;
}

function advanceToChangeRequest(
  lifecycle: WorkspaceLifecycleV1,
  changeRequestId: string,
): string {
  const next: WorkspaceLifecycleV1 = { ...lifecycle, changeRequestId };
  try {
    assertWorkspaceLifecycleAdvanceV1(lifecycle, next);
    return serializeWorkspaceLifecycleV1(next);
  } catch (error) {
    throw new ConflictError(
      "Workspace lifecycle cannot advance to this change request.",
      { cause: error },
    );
  }
}

function assertReplay(
  existing: KnowledgeChangeRequestRecord,
  jobId: string,
  finalized: FinalizedGitWorktree,
  metadataJson: string,
): void {
  if (
    existing.organizationId.length === 0 ||
    existing.jobId !== jobId ||
    existing.attemptId !== finalized.attemptId ||
    existing.spaceId !== finalized.spaceId ||
    existing.baseCommit !== finalized.baseCommit ||
    existing.headCommit !== finalized.headCommit ||
    existing.branchName !== finalized.branch ||
    existing.diffSummary !== finalized.diffSummary.shortStat ||
    existing.diffMetadataJson !== metadataJson
  ) {
    throw new ConflictError(
      "Knowledge change request key was already used with different content.",
    );
  }
}

function sameFrozenBinding(
  a: FrozenKnowledgeBindingV1,
  b: FrozenKnowledgeBindingV1,
) {
  return (
    a.schemaVersion === b.schemaVersion &&
    a.bindingId === b.bindingId &&
    a.spaceId === b.spaceId &&
    a.workspaceId === b.workspaceId &&
    a.agentId === b.agentId &&
    a.mountPath === b.mountPath &&
    a.defaultBranch === b.defaultBranch &&
    a.baseCommit === b.baseCommit
  );
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
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

function fenceError(): ConflictError {
  return new ConflictError(
    "Execution attempt lease is stale, expired, or owned by another worker.",
  );
}
