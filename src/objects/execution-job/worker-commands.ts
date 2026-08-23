import { parseStoredWorkspaceLifecycleV1 } from '@/agent/execution/workspace-lifecycle';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/framework/resilience/app-error';
import { safeJsonParse } from '@/framework/resilience/safe-data';
import { prisma } from '@/lib/db/prisma';
import { parseRuntimeCapabilitiesJsonV1 } from '@/objects/execution-runtime/schema';

import { getExecutionJob, type ExecutionJobActor } from './queries';
import {
  enqueueExecutionRoomProjection,
  projectExecutionTerminalToTeamTask,
} from './room-projection';
import {
  isExecutionJsonValueV1,
  mapExecutionAttempt,
  type ExecutionAttemptDtoV1,
  type ExecutionAttemptRecord,
  type ExecutionJobDtoV1,
  type ExecutionJsonValueV1,
} from './schema';

const DEFAULT_LEASE_DURATION_MS = 30_000;
const MIN_LEASE_DURATION_MS = 1_000;
const MAX_LEASE_DURATION_MS = 60 * 60_000;
const INVALID_JSON = Symbol('invalid-json');

export type ClaimExecutionAttemptInput = {
  attemptId: string;
  workerId: string;
  leaseDurationMs?: number;
  runtimeId: string;
};

export type HeartbeatExecutionAttemptInput = {
  attemptId: string;
  workerId: string;
  generation: number;
  leaseDurationMs?: number;
  checkpoint?: ExecutionJsonValueV1 | null;
  runtimeRunId?: string | null;
};

export type CompleteExecutionAttemptInput = {
  attemptId: string;
  workerId: string;
  generation: number;
  status: 'succeeded' | 'failed' | 'cancelled';
  result?: ExecutionJsonValueV1 | null;
  error?: ExecutionJsonValueV1 | null;
  runtimeRunId?: string | null;
};

export type CompleteExecutionAttemptResultV1 = {
  schemaVersion: 1;
  attempt: ExecutionAttemptDtoV1;
  job: ExecutionJobDtoV1;
};

type AttemptControlRow = ExecutionAttemptRecord & {
  organizationId: string;
  capacityReserved: boolean | number;
};

type AttemptControlWithJobRow = AttemptControlRow & {
  jobStatus: string;
};

type ClaimAttemptControlWithJobRow = AttemptControlWithJobRow & {
  workspaceLifecycleJson: string | null;
};

export type WorkerExecutionAttemptDtoV1 = ExecutionAttemptDtoV1 & {
  /** Present on durable worker reads; optional for backwards-compatible mocks. */
  cancelRequested?: boolean;
  /** Latest durable human answer for a native runtime resume. */
  resumeInput?: {
    schemaVersion: 1;
    requestId: string;
    responseId: string;
    response: ExecutionJsonValueV1;
  } | null;
};

type AnsweredInputRow = {
  id: string;
  responseJson: string | null;
  responseId: string | null;
  respondedAt: Date | string | null;
};

/**
 * Claims a pending attempt, or reclaims a running attempt whose lease has
 * expired. Every successful claim increments generation, so a prior owner can
 * no longer heartbeat or complete after a reclaim.
 */
export async function claimExecutionAttempt(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  input: ClaimExecutionAttemptInput
): Promise<WorkerExecutionAttemptDtoV1> {
  const attemptId = requireText(input.attemptId, 'attemptId is required.');
  const workerId = requireText(input.workerId, 'workerId is required.');
  const runtimeId = requireText(input.runtimeId, 'runtimeId is required.');
  const leaseDurationMs = readLeaseDuration(input.leaseDurationMs);
  const now = new Date();
  const leaseExpiresAt = new Date(now.valueOf() + leaseDurationMs);

  const claimed = await prisma.$transaction(async (db) => {
    let clearRuntimeRunId = false;
    const rows = await db.$queryRaw<ClaimAttemptControlWithJobRow[]>`
      SELECT
        attempt."id", attempt."organizationId", attempt."jobId",
        attempt."runtimeId", attempt."number", attempt."status",
        attempt."generation", attempt."leaseOwnerId",
        attempt."leaseExpiresAt", attempt."lastHeartbeatAt",
        attempt."runtimeRunId", attempt."capacityReserved",
        attempt."checkpointJson", attempt."workspaceLifecycleJson",
        attempt."resultJson",
        attempt."errorJson", attempt."startedAt", attempt."finishedAt",
        attempt."createdAt", attempt."updatedAt",
        job."status" AS "jobStatus"
      FROM "ExecutionAttempt" AS attempt
      INNER JOIN "ExecutionJob" AS job
        ON job."id" = attempt."jobId"
        AND job."organizationId" = attempt."organizationId"
      WHERE attempt."id" = ${attemptId}
        AND attempt."organizationId" = ${actor.organizationId}
      LIMIT 1
    `;
    const current = rows[0];
    if (!current) {
      throw new NotFoundError('Execution attempt not found.');
    }
    if (current.runtimeId !== runtimeId) {
      throw new ConflictError('Execution attempt belongs to a different runtime.');
    }

    if (current.status === 'pending' || current.status === 'waiting_input') {
      if (Boolean(current.capacityReserved)) {
        throw new ConflictError(
          'Execution attempt already owns a runtime capacity reservation.'
        );
      }
      const reserved = await db.$executeRaw`
        UPDATE "ExecutionRuntime"
        SET
          "capacityUsed" = "capacityUsed" + 1,
          "capacityUpdatedAt" = ${now},
          "updatedAt" = ${now}
        WHERE "id" = ${runtimeId}
          AND "organizationId" = ${actor.organizationId}
          AND ("enabled" = TRUE OR ${current.jobStatus === 'cancel_requested' ? 1 : 0} = 1)
          AND "capacityUsed" < "capacityTotal"
      `;
      if (reserved !== 1) {
        throw new ConflictError(
          'Execution runtime is disabled, unavailable, or at capacity.'
        );
      }
    } else if (current.status === 'running') {
      if (!Boolean(current.capacityReserved)) {
        throw new ConflictError(
          'Execution attempt no longer owns its runtime capacity reservation.'
        );
      }
      const activeRuntime = await db.$queryRaw<
        Array<{ id: string; capabilitiesJson: string }>
      >`
        SELECT "id", "capabilitiesJson"
        FROM "ExecutionRuntime"
        WHERE "id" = ${runtimeId}
          AND "organizationId" = ${actor.organizationId}
          AND ("enabled" = TRUE OR ${current.jobStatus === 'cancel_requested' ? 1 : 0} = 1)
        LIMIT 1
      `;
      if (!activeRuntime[0]) {
        throw new ConflictError(
          'Execution runtime is disabled or no longer owns an active slot.'
        );
      }
      // A non-resumable runtime must start a new native run after an ordinary
      // lease reclaim. Clear the previous address in this claim transaction so
      // the next attempt-started event can atomically install its new one. A
      // cancellation reclaim keeps the old address so the daemon can interrupt
      // the retained process instead of starting replacement work.
      clearRuntimeRunId =
        current.jobStatus === 'running' &&
        parseStoredWorkspaceLifecycleV1(current.workspaceLifecycleJson)
          ?.runtimeCompletion === undefined &&
        parseRuntimeCapabilitiesJsonV1(
          activeRuntime[0].capabilitiesJson
        )?.nativeResume !== true;
    }

    const claimedCount = await db.$executeRaw`
      UPDATE "ExecutionAttempt"
      SET
        "status" = 'running',
        "generation" = "generation" + 1,
        "capacityReserved" = TRUE,
        "leaseOwnerId" = ${workerId},
        "leaseExpiresAt" = ${leaseExpiresAt},
        "lastHeartbeatAt" = ${now},
        "runtimeRunId" = CASE
          WHEN ${clearRuntimeRunId ? 1 : 0} = 1 THEN NULL
          ELSE "runtimeRunId"
        END,
        "startedAt" = COALESCE("startedAt", ${now}),
        "finishedAt" = NULL,
        "updatedAt" = ${now}
      WHERE "id" = ${attemptId}
        AND "organizationId" = ${actor.organizationId}
        AND "generation" = ${current.generation}
        AND (
          "status" = 'pending'
          OR (
            "status" = 'waiting_input'
            AND "capacityReserved" = FALSE
          )
          OR (
            "status" = 'running'
            AND "capacityReserved" = TRUE
            AND "leaseExpiresAt" IS NOT NULL
            AND "leaseExpiresAt" <= ${now}
          )
        )
        AND EXISTS (
          SELECT 1
          FROM "ExecutionJob" AS job
          WHERE job."id" = "ExecutionAttempt"."jobId"
            AND job."organizationId" = ${actor.organizationId}
            AND (
              ("ExecutionAttempt"."status" = 'pending' AND job."status" = 'queued')
              OR (
                "ExecutionAttempt"."status" = 'waiting_input'
                AND job."status" = 'cancel_requested'
              )
              OR (
                "ExecutionAttempt"."status" = 'running'
                AND job."status" IN ('running', 'cancel_requested')
              )
            )
        )
    `;
    if (claimedCount !== 1) {
      throw new ConflictError(
        'Execution attempt is already leased, no longer claimable, or its job was cancelled.'
      );
    }

    await db.$executeRaw`
      UPDATE "ExecutionJob"
      SET
        "status" = 'running',
        "startedAt" = COALESCE("startedAt", ${now}),
        "revision" = "revision" + 1,
        "updatedAt" = ${now}
      WHERE "id" = ${current.jobId}
        AND "organizationId" = ${actor.organizationId}
        AND "status" = 'queued'
    `;

    const updatedRows = await db.$queryRaw<ClaimAttemptControlWithJobRow[]>`
      SELECT
        attempt."id", attempt."organizationId", attempt."jobId",
        attempt."runtimeId", attempt."number", attempt."status",
        attempt."generation", attempt."leaseOwnerId",
        attempt."leaseExpiresAt", attempt."lastHeartbeatAt",
        attempt."runtimeRunId", attempt."capacityReserved",
        attempt."checkpointJson", attempt."workspaceLifecycleJson",
        attempt."resultJson", attempt."errorJson", attempt."startedAt",
        attempt."finishedAt", attempt."createdAt", attempt."updatedAt",
        job."status" AS "jobStatus"
      FROM "ExecutionAttempt" AS attempt
      INNER JOIN "ExecutionJob" AS job
        ON job."id" = attempt."jobId"
        AND job."organizationId" = attempt."organizationId"
      WHERE attempt."id" = ${attemptId}
        AND attempt."organizationId" = ${actor.organizationId}
      LIMIT 1
    `;
    const updated = updatedRows[0] || null;
    if (!updated) return null;
    const answeredInputs = await db.$queryRaw<AnsweredInputRow[]>`
      SELECT request."id", request."responseId", request."responseJson",
        request."respondedAt"
      FROM "ExecutionInputRequest" AS request
      WHERE request."organizationId" = ${actor.organizationId}
        AND request."jobId" = ${updated.jobId}
        AND request."attemptId" = ${updated.id}
        AND request."status" = 'answered'
      ORDER BY request."respondedAt" DESC, request."id" DESC
      LIMIT 1
    `;
    return { attempt: updated, resumeInput: mapAnsweredInput(answeredInputs[0]) };
  });

  if (!claimed) {
    throw new Error('Claimed execution attempt could not be loaded.');
  }
  return {
    ...mapExecutionAttempt(claimed.attempt),
    cancelRequested: claimed.attempt.jobStatus === 'cancel_requested',
    resumeInput: claimed.resumeInput,
  };
}

/**
 * Renews a lease only for its current generation and owner. A heartbeat after
 * expiry is rejected; the worker must claim again and receive a new generation.
 */
export async function heartbeatExecutionAttempt(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  input: HeartbeatExecutionAttemptInput
): Promise<WorkerExecutionAttemptDtoV1> {
  const attemptId = requireText(input.attemptId, 'attemptId is required.');
  const workerId = requireText(input.workerId, 'workerId is required.');
  const generation = readGeneration(input.generation);
  const leaseDurationMs = readLeaseDuration(input.leaseDurationMs);
  const runtimeRunId = readNullableRuntimeRunId(input.runtimeRunId);
  const checkpointJson =
    input.checkpoint === undefined
      ? null
      : serializeJsonValue(input.checkpoint, 'checkpoint');
  const now = new Date();
  const leaseExpiresAt = new Date(now.valueOf() + leaseDurationMs);

  return prisma.$transaction(async (db) => {
    const updated = await db.$executeRaw`
      UPDATE "ExecutionAttempt"
      SET
        "leaseExpiresAt" = ${leaseExpiresAt},
        "lastHeartbeatAt" = ${now},
        "checkpointJson" = CASE
          WHEN ${input.checkpoint === undefined ? 0 : 1} = 1
            AND EXISTS (
              SELECT 1 FROM "ExecutionJob" AS job
              WHERE job."id" = "ExecutionAttempt"."jobId"
                AND job."organizationId" = ${actor.organizationId}
                AND job."status" = 'running'
            ) THEN ${checkpointJson}
          ELSE "checkpointJson"
        END,
        "runtimeRunId" = CASE
          WHEN ${input.runtimeRunId === undefined ? 0 : 1} = 1 THEN ${runtimeRunId}
          ELSE "runtimeRunId"
        END,
        "updatedAt" = ${now}
      WHERE "id" = ${attemptId}
        AND "organizationId" = ${actor.organizationId}
        AND "status" = 'running'
        AND "generation" = ${generation}
        AND "leaseOwnerId" = ${workerId}
        AND "leaseExpiresAt" IS NOT NULL
        AND "leaseExpiresAt" > ${now}
        AND "capacityReserved" = TRUE
        AND EXISTS (
          SELECT 1 FROM "ExecutionJob" AS job
          WHERE job."id" = "ExecutionAttempt"."jobId"
            AND job."organizationId" = ${actor.organizationId}
            AND job."status" IN ('running', 'cancel_requested')
        )
    `;
    if (updated !== 1) {
      throw new ConflictError(
        'Execution attempt lease is stale, expired, or owned by another worker.'
      );
    }

    const rows = await db.$queryRaw<AttemptControlWithJobRow[]>`
      SELECT
        attempt."id", attempt."organizationId", attempt."jobId",
        attempt."runtimeId", attempt."number", attempt."status",
        attempt."generation", attempt."leaseOwnerId",
        attempt."leaseExpiresAt", attempt."lastHeartbeatAt",
        attempt."runtimeRunId", attempt."capacityReserved",
        attempt."checkpointJson",
        attempt."resultJson", attempt."errorJson", attempt."startedAt",
        attempt."finishedAt", attempt."createdAt", attempt."updatedAt",
        job."status" AS "jobStatus"
      FROM "ExecutionAttempt" AS attempt
      INNER JOIN "ExecutionJob" AS job
        ON job."id" = attempt."jobId"
        AND job."organizationId" = attempt."organizationId"
      WHERE attempt."id" = ${attemptId}
        AND attempt."organizationId" = ${actor.organizationId}
      LIMIT 1
    `;
    const attempt = rows[0];
    if (!attempt) {
      throw new NotFoundError('Execution attempt not found.');
    }
    return {
      ...mapExecutionAttempt(attempt),
      cancelRequested: attempt.jobStatus === 'cancel_requested',
    };
  });
}

/**
 * Completes the attempt and its Job in one transaction. The generation and
 * owner predicates are the fence: an old worker cannot commit after a newer
 * claim, even if it still holds a copy of the previous lease.
 */
export async function completeExecutionAttempt(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  input: CompleteExecutionAttemptInput
): Promise<CompleteExecutionAttemptResultV1> {
  const attemptId = requireText(input.attemptId, 'attemptId is required.');
  const workerId = requireText(input.workerId, 'workerId is required.');
  const generation = readGeneration(input.generation);
  if (!['succeeded', 'failed', 'cancelled'].includes(input.status)) {
    throw new ValidationError('Execution attempt completion status is invalid.');
  }
  const runtimeRunId = readNullableRuntimeRunId(input.runtimeRunId);
  const resultJson =
    input.result === undefined
      ? null
      : serializeJsonValue(input.result, 'result');
  const persistedResultJson = input.status === 'cancelled' ? null : resultJson;
  const errorJson =
    input.error === undefined
      ? null
      : serializeJsonValue(input.error, 'error');
  const now = new Date();

  const completed = await prisma.$transaction(async (db) => {
    const currentRows = await db.$queryRaw<AttemptControlRow[]>`
      SELECT
        "id", "organizationId", "jobId", "runtimeId", "number",
        "status", "generation", "leaseOwnerId", "leaseExpiresAt",
        "lastHeartbeatAt", "runtimeRunId", "capacityReserved",
        "checkpointJson",
        "resultJson", "errorJson", "startedAt", "finishedAt",
        "createdAt", "updatedAt"
      FROM "ExecutionAttempt"
      WHERE "id" = ${attemptId}
        AND "organizationId" = ${actor.organizationId}
      LIMIT 1
    `;
    const current = currentRows[0];
    if (!current) {
      throw new NotFoundError('Execution attempt not found.');
    }

    const attemptUpdated = await db.$executeRaw`
      UPDATE "ExecutionAttempt"
      SET
        "status" = ${input.status},
        "runtimeRunId" = CASE
          WHEN ${input.runtimeRunId === undefined ? 0 : 1} = 1 THEN ${runtimeRunId}
          ELSE "runtimeRunId"
        END,
        "resultJson" = ${persistedResultJson},
        "errorJson" = ${errorJson},
        "capacityReserved" = FALSE,
        "leaseOwnerId" = NULL,
        "leaseExpiresAt" = NULL,
        "finishedAt" = ${now},
        "updatedAt" = ${now}
      WHERE "id" = ${attemptId}
        AND "organizationId" = ${actor.organizationId}
        AND "status" = 'running'
        AND "generation" = ${generation}
        AND "leaseOwnerId" = ${workerId}
        AND "leaseExpiresAt" IS NOT NULL
        AND "leaseExpiresAt" > ${now}
        AND "capacityReserved" = TRUE
        AND EXISTS (
          SELECT 1 FROM "ExecutionJob" AS job
          WHERE job."id" = "ExecutionAttempt"."jobId"
            AND job."organizationId" = ${actor.organizationId}
            AND (
              job."status" = 'running'
              OR (
                job."status" = 'cancel_requested'
                AND ${input.status} = 'cancelled'
              )
            )
        )
    `;
    if (attemptUpdated !== 1) {
      throw new ConflictError(
        'Execution attempt completion was fenced by a newer or expired lease.'
      );
    }

    const jobStatus =
      input.status === 'succeeded'
        ? 'succeeded'
        : input.status === 'failed'
          ? 'failed'
          : 'cancelled';
    const jobUpdated = await db.$executeRaw`
      UPDATE "ExecutionJob"
      SET
        "status" = CASE
          WHEN "status" = 'cancel_requested' THEN 'cancelled'
          ELSE ${jobStatus}
        END,
        "resultJson" = ${persistedResultJson},
        "errorJson" = ${errorJson},
        "finishedAt" = ${now},
        "revision" = "revision" + 1,
        "updatedAt" = ${now}
      WHERE "id" = ${current.jobId}
        AND "organizationId" = ${actor.organizationId}
        AND (
          "status" = 'running'
          OR ("status" = 'cancel_requested' AND ${input.status} = 'cancelled')
        )
    `;
    if (jobUpdated !== 1) {
      throw new ConflictError(
        'Execution job is no longer in a state that can be completed.'
      );
    }

    if (current.runtimeId && Boolean(current.capacityReserved)) {
      const capacityReleased = await db.$executeRaw`
        UPDATE "ExecutionRuntime"
        SET
          "capacityUsed" = "capacityUsed" - 1,
          "capacityUpdatedAt" = ${now},
          "updatedAt" = ${now}
        WHERE "id" = ${current.runtimeId}
          AND "organizationId" = ${actor.organizationId}
          AND "capacityUsed" > 0
      `;
      if (capacityReleased !== 1) {
        throw new ConflictError(
          'Execution runtime no longer owns capacity for this attempt.'
        );
      }
    }

    if (jobStatus === 'cancelled') {
      const cancelledInputs = await db.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "ExecutionInputRequest"
        WHERE "organizationId" = ${actor.organizationId}
          AND "jobId" = ${current.jobId}
          AND "status" = 'cancelled'
        ORDER BY "requestedAt" ASC, "id" ASC
      `;
      for (const request of cancelledInputs) {
        await enqueueExecutionRoomProjection(db, {
          organizationId: actor.organizationId,
          jobId: current.jobId,
          requestId: request.id,
          type: 'execution.input_cancelled',
          occurredAt: now,
        });
      }
    }
    await enqueueExecutionRoomProjection(db, {
      organizationId: actor.organizationId,
      jobId: current.jobId,
      type: 'execution.completed',
      occurredAt: now,
    });
    await projectExecutionTerminalToTeamTask(db, {
      organizationId: actor.organizationId,
      jobId: current.jobId,
      occurredAt: now,
    });

    const completedRows = await db.$queryRaw<AttemptControlRow[]>`
      SELECT
        "id", "organizationId", "jobId", "runtimeId", "number",
        "status", "generation", "leaseOwnerId", "leaseExpiresAt",
        "lastHeartbeatAt", "runtimeRunId", "capacityReserved",
        "checkpointJson",
        "resultJson", "errorJson", "startedAt", "finishedAt",
        "createdAt", "updatedAt"
      FROM "ExecutionAttempt"
      WHERE "id" = ${attemptId}
        AND "organizationId" = ${actor.organizationId}
      LIMIT 1
    `;
    return completedRows[0] || null;
  });

  if (!completed) {
    throw new Error('Completed execution attempt could not be loaded.');
  }
  const job = await getExecutionJob(actor, completed.jobId);
  if (!job) {
    throw new Error('Completed execution job could not be loaded.');
  }
  return {
    schemaVersion: 1,
    attempt: mapExecutionAttempt(completed),
    job,
  };
}

function readLeaseDuration(value: number | undefined) {
  const duration = value ?? DEFAULT_LEASE_DURATION_MS;
  if (
    !Number.isInteger(duration) ||
    duration < MIN_LEASE_DURATION_MS ||
    duration > MAX_LEASE_DURATION_MS
  ) {
    throw new ValidationError(
      `leaseDurationMs must be an integer from ${MIN_LEASE_DURATION_MS} to ${MAX_LEASE_DURATION_MS}.`
    );
  }
  return duration;
}

function readGeneration(value: number) {
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationError('generation must be a positive integer.');
  }
  return value;
}

function requireText(value: unknown, message: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(message);
  }
  return value.trim();
}

function readNullableRuntimeRunId(value: string | null | undefined) {
  if (value === undefined || value === null) return value ?? null;
  if (!value.trim()) {
    throw new ValidationError('runtimeRunId must be a non-empty string or null.');
  }
  return value.trim();
}

function serializeJsonValue(
  value: ExecutionJsonValueV1 | null,
  field: string
): string {
  let raw: string | undefined;
  try {
    raw = JSON.stringify(value);
  } catch {
    throw new ValidationError(`${field} must be JSON-compatible.`);
  }
  if (typeof raw !== 'string') {
    throw new ValidationError(`${field} must be JSON-compatible.`);
  }
  const parsed = safeJsonParse<unknown | typeof INVALID_JSON>(raw, INVALID_JSON);
  if (parsed === INVALID_JSON) {
    throw new ValidationError(`${field} must be JSON-compatible.`);
  }
  return raw;
}

function mapAnsweredInput(row: AnsweredInputRow | undefined) {
  if (!row) return null;
  const response = safeJsonParse<ExecutionJsonValueV1 | typeof INVALID_JSON>(
    row.responseJson,
    INVALID_JSON,
    (value): value is ExecutionJsonValueV1 | typeof INVALID_JSON =>
      value === INVALID_JSON || isExecutionJsonValueV1(value)
  );
  const respondedAt = row.respondedAt ? new Date(row.respondedAt) : null;
  if (
    response === INVALID_JSON ||
    typeof row.responseId !== 'string' ||
    !row.responseId.trim() ||
    !respondedAt ||
    Number.isNaN(respondedAt.valueOf())
  ) {
    throw new Error('Stored answered execution input is invalid.');
  }
  return {
    schemaVersion: 1 as const,
    requestId: row.id,
    responseId: row.responseId,
    response,
  };
}
