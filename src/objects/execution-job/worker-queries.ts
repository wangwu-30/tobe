import { ValidationError } from '@/framework/resilience/app-error';
import { prisma } from '@/lib/db/prisma';

import type { ExecutionJobActor } from './queries';
import {
  mapExecutionAttempt,
  type ExecutionAttemptDtoV1,
  type ExecutionAttemptRecord,
} from './schema';

export type ClaimableExecutionAttemptDtoV1 = ExecutionAttemptDtoV1 & {
  /** Present on durable worker reads; optional for backwards-compatible mocks. */
  cancelRequested?: boolean;
};

type ClaimableExecutionAttemptRow = ExecutionAttemptRecord & {
  jobStatus: string;
};

const DEFAULT_CLAIMABLE_ATTEMPT_LIMIT = 32;
const MAX_CLAIMABLE_ATTEMPT_LIMIT = 256;

export type ListClaimableExecutionAttemptsInput = {
  /** Runtime ids configured in this daemon process. An empty list fails closed. */
  runtimeIds: readonly string[];
  limit?: number;
  now?: Date;
};

/**
 * Lists attempts this organization-local daemon may try to claim. The query is
 * deliberately only a dequeue hint: claimExecutionAttempt remains the atomic
 * capacity check and generation fence when multiple daemons race.
 */
export async function listClaimableExecutionAttempts(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  input: ListClaimableExecutionAttemptsInput
): Promise<ClaimableExecutionAttemptDtoV1[]> {
  const organizationId = requireText(
    actor.organizationId,
    'organizationId is required.'
  );
  const runtimeIds = readRuntimeIds(input.runtimeIds);
  if (runtimeIds.length === 0) {
    return [];
  }

  const limit = readLimit(input.limit);
  const now = readNow(input.now);
  const runtimeIdsJson = JSON.stringify(runtimeIds);
  const rows = await prisma.$queryRaw<ClaimableExecutionAttemptRow[]>`
    SELECT
      attempt."id", attempt."jobId", attempt."runtimeId",
      attempt."number", attempt."status", attempt."generation",
      attempt."leaseOwnerId", attempt."leaseExpiresAt",
      attempt."lastHeartbeatAt", attempt."runtimeRunId",
      attempt."checkpointJson", attempt."resultJson", attempt."errorJson",
      attempt."startedAt", attempt."finishedAt", attempt."createdAt",
      attempt."updatedAt", job."status" AS "jobStatus"
    FROM "ExecutionAttempt" AS attempt
    INNER JOIN "ExecutionJob" AS job
      ON job."id" = attempt."jobId"
      AND job."organizationId" = attempt."organizationId"
    WHERE attempt."organizationId" = ${organizationId}
      AND attempt."runtimeId" IN (
        SELECT CAST(value AS TEXT)
        FROM json_each(${runtimeIdsJson})
      )
      AND (
        (attempt."status" = 'pending' AND job."status" = 'queued')
        OR (
          attempt."status" = 'waiting_input'
          AND attempt."capacityReserved" = FALSE
          AND job."status" = 'cancel_requested'
        )
        OR (
          attempt."status" = 'running'
          AND attempt."capacityReserved" = TRUE
          AND attempt."leaseExpiresAt" IS NOT NULL
          AND attempt."leaseExpiresAt" <= ${now}
          AND job."status" IN ('running', 'cancel_requested')
        )
      )
    ORDER BY
      job."priority" DESC,
      job."queuedAt" ASC,
      attempt."number" ASC,
      attempt."id" ASC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    ...mapExecutionAttempt(row),
    cancelRequested: row.jobStatus === 'cancel_requested',
  }));
}

function readRuntimeIds(value: readonly string[]): string[] {
  if (!Array.isArray(value)) {
    throw new ValidationError('runtimeIds must be an array.');
  }
  const runtimeIds: string[] = [];
  const seen = new Set<string>();
  for (const valueEntry of value) {
    const runtimeId = requireText(
      valueEntry,
      'runtimeIds must contain only non-empty strings.'
    );
    if (!seen.has(runtimeId)) {
      seen.add(runtimeId);
      runtimeIds.push(runtimeId);
    }
  }
  return runtimeIds;
}

function readLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_CLAIMABLE_ATTEMPT_LIMIT;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_CLAIMABLE_ATTEMPT_LIMIT
  ) {
    throw new ValidationError(
      'limit must be an integer from 1 to ' +
        MAX_CLAIMABLE_ATTEMPT_LIMIT +
        '.'
    );
  }
  return limit;
}

function readNow(value: Date | undefined): Date {
  const now = value ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw new ValidationError('now must be a valid Date.');
  }
  return now;
}

function requireText(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(message);
  }
  return value.trim();
}
