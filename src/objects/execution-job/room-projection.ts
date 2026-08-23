import { randomUUID } from 'node:crypto';

import { isRecord, safeJsonParse } from '@/framework/resilience/safe-data';
import { prisma as defaultPrisma } from '@/lib/db/prisma';
import { isTeamTaskStatus } from '@/objects/task/schema';
import type { TeamTaskStatus } from '@/types';

export const EXECUTION_ROOM_PROJECTION_TYPES_V1 = [
  'execution.input_requested',
  'execution.input_answered',
  'execution.input_cancelled',
  'execution.completed',
] as const;

export type ExecutionRoomProjectionTypeV1 =
  (typeof EXECUTION_ROOM_PROJECTION_TYPES_V1)[number];

export type ExecutionRoomProjectionPayloadV1 = {
  schemaVersion: 1;
  jobId: string;
  requestId?: string;
  jobStatus: string;
  jobRevision: number;
  inputRevision?: number;
  occurredAt: string;
  teamTaskId?: string;
};

type RawSqlDb = {
  $executeRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
  $queryRaw<T>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
};

type TransactionalRawSqlDb = RawSqlDb & {
  $transaction<T>(action: (db: RawSqlDb) => Promise<T>): Promise<T>;
};

type ProjectionJobRow = {
  id: string;
  organizationId: string;
  teamTaskId: string | null;
  originRoomId: string | null;
  originRoomMessageId: string | null;
  selectedRuntimeId: string | null;
  status: string;
  revision: number;
};

type ProjectionInputRow = {
  id: string;
  status: string;
  revision: number;
};

type ExecutionOutboxRow = {
  id: string;
  organizationId: string;
  jobId: string;
  roomId: string | null;
  topic: string;
  dedupeKey: string;
  payloadJson: string;
  status: string;
  attempts: number;
  availableAt: Date | string;
};

type RoomEventRow = {
  id: string;
  organizationId: string;
  roomId: string;
  sequence: number;
  type: string;
  dataJson: string;
  createdAt: Date | string;
};

type TeamTaskRow = {
  id: string;
  revision: number;
  status: string;
};

type TaskActivityRow = {
  actorId: string;
  actorType: string;
  id: string;
  message: string;
  metadataJson: string;
  organizationId: string;
  taskId: string;
  type: string;
};

export type EnqueueExecutionRoomProjectionInputV1 = {
  organizationId: string;
  jobId: string;
  type: ExecutionRoomProjectionTypeV1;
  requestId?: string;
  occurredAt?: Date;
};

export type RelayExecutionRoomProjectionsInputV1 = {
  limit?: number;
  now?: Date;
};

export type RelayExecutionRoomProjectionsResultV1 = {
  delivered: number;
  failed: number;
  ignored: number;
  processed: number;
};

const DEFAULT_RELAY_LIMIT = 32;
const MAX_RELAY_LIMIT = 256;
const MAX_LAST_ERROR_LENGTH = 2_000;
const INVALID_PAYLOAD = Symbol('invalid-execution-room-projection-payload');
const ALLOWED_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'jobId',
  'requestId',
  'jobStatus',
  'jobRevision',
  'inputRevision',
  'occurredAt',
  'teamTaskId',
]);

/**
 * Transaction-compatible lifecycle seam. Callers enqueue this after their
 * Job/Input CAS and before committing that same transaction. The payload is
 * deliberately reconstructed from durable scalar state; prompts and answers
 * are never accepted by this API and therefore cannot enter either outbox.
 */
export async function enqueueExecutionRoomProjection(
  db: RawSqlDb,
  input: EnqueueExecutionRoomProjectionInputV1
): Promise<{ id: string; replayed: boolean }> {
  const organizationId = requireText(input.organizationId, 'organizationId');
  const jobId = requireText(input.jobId, 'jobId');
  const type = requireProjectionType(input.type);
  const occurredAt = readDate(input.occurredAt ?? new Date(), 'occurredAt');
  const requestId = input.requestId === undefined
    ? undefined
    : requireText(input.requestId, 'requestId');

  const jobs = await db.$queryRaw<ProjectionJobRow[]>`
    SELECT "id", "organizationId", "teamTaskId",
      "originRoomId", "originRoomMessageId",
      "selectedRuntimeId", "status", "revision"
    FROM "ExecutionJob"
    WHERE "id" = ${jobId}
      AND "organizationId" = ${organizationId}
    LIMIT 1
  `;
  const job = jobs[0];
  if (!job) throw new Error('Execution projection job was not found.');
  assertOriginPair(job);

  let request: ProjectionInputRow | null = null;
  if (type !== 'execution.completed') {
    if (!requestId) {
      throw new Error(`${type} requires requestId.`);
    }
    const requests = await db.$queryRaw<ProjectionInputRow[]>`
      SELECT "id", "status", "revision"
      FROM "ExecutionInputRequest"
      WHERE "id" = ${requestId}
        AND "jobId" = ${jobId}
        AND "organizationId" = ${organizationId}
      LIMIT 1
    `;
    request = requests[0] ?? null;
    if (!request) throw new Error('Execution projection input was not found.');
  } else if (requestId !== undefined) {
    throw new Error('execution.completed does not accept requestId.');
  }

  assertProjectionState(type, job, request);
  const payload: ExecutionRoomProjectionPayloadV1 = {
    schemaVersion: 1,
    jobId: job.id,
    ...(request ? { requestId: request.id } : {}),
    jobStatus: job.status,
    jobRevision: readPositiveInteger(job.revision, 'job revision'),
    ...(request
      ? { inputRevision: readPositiveInteger(request.revision, 'input revision') }
      : {}),
    occurredAt: occurredAt.toISOString(),
    ...(job.teamTaskId ? { teamTaskId: job.teamTaskId } : {}),
  };
  const payloadJson = JSON.stringify(payload);
  const dedupeKey = request
    ? `${job.id}:${request.id}:v${request.revision}`
    : `${job.id}:v${job.revision}`;
  const outboxId = randomUUID();
  const inserted = await db.$executeRaw`
    INSERT INTO "ExecutionOutbox" (
      "id", "organizationId", "jobId", "roomId",
      "topic", "dedupeKey", "payloadJson", "status",
      "attempts", "availableAt", "createdAt", "updatedAt"
    ) VALUES (
      ${outboxId}, ${organizationId}, ${job.id}, ${job.originRoomId},
      ${type}, ${dedupeKey}, ${payloadJson}, 'pending',
      0, ${occurredAt}, ${occurredAt}, ${occurredAt}
    )
    ON CONFLICT ("organizationId", "topic", "dedupeKey")
    DO NOTHING
  `;
  if (inserted === 1) return { id: outboxId, replayed: false };

  const existingRows = await db.$queryRaw<ExecutionOutboxRow[]>`
    SELECT "id", "organizationId", "jobId", "roomId",
      "topic", "dedupeKey", "payloadJson", "status",
      "attempts", "availableAt"
    FROM "ExecutionOutbox"
    WHERE "organizationId" = ${organizationId}
      AND "topic" = ${type}
      AND "dedupeKey" = ${dedupeKey}
    LIMIT 1
  `;
  const existing = existingRows[0];
  if (
    !existing ||
    existing.jobId !== job.id ||
    existing.roomId !== job.originRoomId ||
    existing.payloadJson !== payloadJson
  ) {
    throw new Error('Execution projection dedupe key has conflicting content.');
  }
  return { id: existing.id, replayed: true };
}

/**
 * Binds a newly queued Execution to its TeamTask in the same transaction that
 * creates the Job. A system-owned start may advance open/claimed work to
 * in_progress, but it may not revive blocked, review, or terminal work.
 */
export async function projectExecutionStartToTeamTask(
  db: RawSqlDb,
  input: { organizationId: string; jobId: string; occurredAt?: Date }
): Promise<'projected' | 'no-task'> {
  const organizationId = requireText(input.organizationId, 'organizationId');
  const jobId = requireText(input.jobId, 'jobId');
  const occurredAt = readDate(input.occurredAt ?? new Date(), 'occurredAt');
  const jobs = await db.$queryRaw<ProjectionJobRow[]>`
    SELECT "id", "organizationId", "teamTaskId",
      "originRoomId", "originRoomMessageId",
      "selectedRuntimeId", "status", "revision"
    FROM "ExecutionJob"
    WHERE "id" = ${jobId}
      AND "organizationId" = ${organizationId}
    LIMIT 1
  `;
  const job = jobs[0];
  if (!job) throw new Error('Execution task start projection job was not found.');
  if (job.status !== 'queued') {
    throw new Error('Only a queued Execution job can start a linked task.');
  }
  if (!job.teamTaskId) return 'no-task';

  const tasks = await db.$queryRaw<TeamTaskRow[]>`
    SELECT "id", "status", "revision"
    FROM "TeamTask"
    WHERE "id" = ${job.teamTaskId}
      AND "organizationId" = ${organizationId}
    LIMIT 1
  `;
  const task = tasks[0];
  if (!task) {
    throw new Error('Linked TeamTask was not found while Execution was starting.');
  }

  const taskRevision = readPositiveInteger(task.revision, 'task revision');
  const activityId = `execution-task-start:${job.id}:v${job.revision}`;
  const actorId = job.selectedRuntimeId ?? 'execution-engine';
  const message = 'Linked execution job started.';
  const metadataJson = JSON.stringify({
    schemaVersion: 1,
    jobId: job.id,
    jobStatus: job.status,
    jobRevision: readPositiveInteger(job.revision, 'job revision'),
  });
  const expectedActivity: ExpectedTaskProjectionActivity = {
    activityId,
    activityType: 'execution_started',
    actorId,
    message,
    metadataJson,
    organizationId,
    taskId: task.id,
  };
  const existingActivities = await db.$queryRaw<TaskActivityRow[]>`
    SELECT "id", "organizationId", "taskId", "type",
      "message", "actorType", "actorId", "metadataJson"
    FROM "TaskActivity"
    WHERE "id" = ${activityId}
    LIMIT 1
  `;
  if (existingActivities[0]) {
    assertTaskProjectionActivity(existingActivities[0], expectedActivity);
    return 'projected';
  }

  if (!isTeamTaskStatus(task.status)) {
    throw new Error(`Stored linked TeamTask status is invalid: ${task.status}.`);
  }
  if (
    task.status !== 'open' &&
    task.status !== 'claimed' &&
    task.status !== 'in_progress'
  ) {
    throw new Error(
      `Linked TeamTask cannot start Execution from ${task.status}.`
    );
  }

  const updated = await db.$executeRaw`
    UPDATE "TeamTask"
    SET
      "status" = 'in_progress',
      "blockedReason" = NULL,
      "completedAt" = NULL,
      "revision" = CASE
        WHEN "status" = 'in_progress' THEN "revision"
        ELSE "revision" + 1
      END,
      "updatedAt" = CASE
        WHEN "status" = 'in_progress' THEN "updatedAt"
        ELSE ${occurredAt}
      END
    WHERE "id" = ${task.id}
      AND "organizationId" = ${organizationId}
      AND "status" = ${task.status}
      AND "revision" = ${taskRevision}
  `;
  if (updated !== 1) {
    throw new Error('Linked TeamTask changed while Execution was starting.');
  }

  const activityInserted = await db.$executeRaw`
    INSERT INTO "TaskActivity" (
      "id", "organizationId", "taskId", "type",
      "message", "actorType", "actorId", "metadataJson",
      "createdAt"
    ) VALUES (
      ${activityId}, ${organizationId}, ${task.id}, 'execution_started',
      ${message}, 'agent', ${actorId}, ${metadataJson}, ${occurredAt}
    )
    ON CONFLICT ("id") DO NOTHING
  `;
  if (activityInserted === 0) {
    const existingRows = await db.$queryRaw<TaskActivityRow[]>`
      SELECT "id", "organizationId", "taskId", "type",
        "message", "actorType", "actorId", "metadataJson"
      FROM "TaskActivity"
      WHERE "id" = ${activityId}
      LIMIT 1
    `;
    assertTaskProjectionActivity(existingRows[0], expectedActivity);
  } else if (activityInserted !== 1) {
    throw new Error('Execution task start activity could not be persisted.');
  }
  return 'projected';
}

/**
 * Projects a terminal Execution into its linked TeamTask in the caller's
 * transaction. Successful output is a delivery awaiting human review; only a
 * later human transition may mark the task done.
 */
export async function projectExecutionTerminalToTeamTask(
  db: RawSqlDb,
  input: { organizationId: string; jobId: string; occurredAt?: Date }
): Promise<'projected' | 'no-task'> {
  const organizationId = requireText(input.organizationId, 'organizationId');
  const jobId = requireText(input.jobId, 'jobId');
  const occurredAt = readDate(input.occurredAt ?? new Date(), 'occurredAt');
  const jobs = await db.$queryRaw<ProjectionJobRow[]>`
    SELECT "id", "organizationId", "teamTaskId",
      "originRoomId", "originRoomMessageId",
      "selectedRuntimeId", "status", "revision"
    FROM "ExecutionJob"
    WHERE "id" = ${jobId}
      AND "organizationId" = ${organizationId}
    LIMIT 1
  `;
  const job = jobs[0];
  if (!job) throw new Error('Execution task projection job was not found.');
  if (!isTerminalStatus(job.status)) {
    throw new Error('Only a terminal Execution job can project to a task.');
  }
  if (!job.teamTaskId) return 'no-task';

  const tasks = await db.$queryRaw<TeamTaskRow[]>`
    SELECT "id", "status", "revision"
    FROM "TeamTask"
    WHERE "id" = ${job.teamTaskId}
      AND "organizationId" = ${organizationId}
    LIMIT 1
  `;
  const task = tasks[0];
  if (!task) return 'no-task';

  const projection = terminalTaskProjection(job.status);
  const taskRevision = readPositiveInteger(task.revision, 'task revision');
  const activityId = `execution-task:${job.id}:v${job.revision}`;
  const actorId = job.selectedRuntimeId ?? 'execution-engine';
  const metadataJson = JSON.stringify({
    schemaVersion: 1,
    jobId: job.id,
    jobStatus: job.status,
    jobRevision: readPositiveInteger(job.revision, 'job revision'),
  });
  const existingActivities = await db.$queryRaw<TaskActivityRow[]>`
    SELECT "id", "organizationId", "taskId", "type",
      "message", "actorType", "actorId", "metadataJson"
    FROM "TaskActivity"
    WHERE "id" = ${activityId}
    LIMIT 1
  `;
  const existingActivity = existingActivities[0];
  if (existingActivity) {
    assertTaskProjectionActivity(existingActivity, {
      activityId,
      activityType: projection.activityType,
      actorId,
      message: projection.message,
      metadataJson,
      organizationId,
      taskId: task.id,
    });
    return 'projected';
  }

  if (shouldTransitionTask(task.status, projection.targetStatus)) {
    const updated = await db.$executeRaw`
      UPDATE "TeamTask"
      SET
        "status" = ${projection.targetStatus},
        "blockedReason" = CASE
          WHEN ${projection.targetStatus} = 'blocked'
            THEN ${`Execution job ${job.id} failed.`}
          ELSE NULL
        END,
        "completedAt" = NULL,
        "revision" = "revision" + 1,
        "updatedAt" = ${occurredAt}
      WHERE "id" = ${task.id}
        AND "organizationId" = ${organizationId}
        AND "status" = ${task.status}
        AND "revision" = ${taskRevision}
    `;
    if (updated !== 1) {
      throw new Error('Linked TeamTask changed while Execution was being projected.');
    }
  } else {
    const fenced = await db.$executeRaw`
      UPDATE "TeamTask"
      SET "status" = "status"
      WHERE "id" = ${task.id}
        AND "organizationId" = ${organizationId}
        AND "status" = ${task.status}
        AND "revision" = ${taskRevision}
    `;
    if (fenced !== 1) {
      throw new Error('Linked TeamTask changed while Execution was being projected.');
    }
  }

  const activityInserted = await db.$executeRaw`
    INSERT INTO "TaskActivity" (
      "id", "organizationId", "taskId", "type",
      "message", "actorType", "actorId", "metadataJson",
      "createdAt"
    ) VALUES (
      ${activityId},
      ${organizationId}, ${task.id}, ${projection.activityType}, ${projection.message},
      'agent', ${actorId}, ${metadataJson},
      ${occurredAt}
    )
    ON CONFLICT ("id") DO NOTHING
  `;
  if (activityInserted === 0) {
    const existingRows = await db.$queryRaw<TaskActivityRow[]>`
      SELECT "id", "organizationId", "taskId", "type",
        "message", "actorType", "actorId", "metadataJson"
      FROM "TaskActivity"
      WHERE "id" = ${activityId}
      LIMIT 1
    `;
    const existing = existingRows[0];
    assertTaskProjectionActivity(existing, {
      activityId,
      activityType: projection.activityType,
      actorId,
      message: projection.message,
      metadataJson,
      organizationId,
      taskId: task.id,
    });
  } else if (activityInserted !== 1) {
    throw new Error('Execution task projection activity could not be persisted.');
  }
  return 'projected';
}

/**
 * Drains a bounded organization-scoped batch. Each item is relayed in one DB
 * transaction, including Room sequence allocation, RoomEvent + RoomOutbox,
 * and the ExecutionOutbox terminal marker. A process crash therefore leaves
 * either all of those writes committed or none of them committed.
 */
export async function relayExecutionRoomProjections(
  actor: { organizationId: string },
  input: RelayExecutionRoomProjectionsInputV1 = {},
  client: TransactionalRawSqlDb = defaultPrisma as unknown as TransactionalRawSqlDb
): Promise<RelayExecutionRoomProjectionsResultV1> {
  const organizationId = requireText(actor.organizationId, 'organizationId');
  const limit = readLimit(input.limit);
  const now = readDate(input.now ?? new Date(), 'now');
  const candidates = await client.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "ExecutionOutbox"
    WHERE "organizationId" = ${organizationId}
      AND "status" = 'pending'
      AND "availableAt" <= ${now}
    ORDER BY "createdAt" ASC, "id" ASC
    LIMIT ${limit}
  `;

  const result: RelayExecutionRoomProjectionsResultV1 = {
    delivered: 0,
    failed: 0,
    ignored: 0,
    processed: 0,
  };
  for (const candidate of candidates) {
    try {
      const status = await client.$transaction((db) =>
        relayExecutionRoomProjectionOnce(
          db,
          organizationId,
          requireText(candidate.id, 'outbox id'),
          now
        )
      );
      if (status === 'skipped') continue;
      result.processed += 1;
      result[status] += 1;
    } catch (error) {
      result.processed += 1;
      result.failed += 1;
      await recordRelayFailure(
        client,
        organizationId,
        candidate.id,
        now,
        error
      );
    }
  }
  return result;
}

export function parseExecutionRoomProjectionPayloadV1(
  topic: unknown,
  value: unknown
): ExecutionRoomProjectionPayloadV1 {
  const type = requireProjectionType(topic);
  if (!isRecord(value) || Object.keys(value).some((key) => !ALLOWED_PAYLOAD_KEYS.has(key))) {
    throw new Error('Stored Execution projection payload is invalid.');
  }
  if (value.schemaVersion !== 1) {
    throw new Error('Stored Execution projection schema version is invalid.');
  }
  const jobId = requireText(value.jobId, 'projection jobId');
  const jobStatus = requireText(value.jobStatus, 'projection jobStatus');
  const jobRevision = readPositiveInteger(value.jobRevision, 'projection jobRevision');
  const occurredAt = requireCanonicalIso(value.occurredAt, 'projection occurredAt');
  const teamTaskId = value.teamTaskId === undefined
    ? undefined
    : requireText(value.teamTaskId, 'projection teamTaskId');

  if (type === 'execution.completed') {
    if (value.requestId !== undefined || value.inputRevision !== undefined || !isTerminalStatus(jobStatus)) {
      throw new Error('Stored execution.completed projection is invalid.');
    }
    return {
      schemaVersion: 1,
      jobId,
      jobStatus,
      jobRevision,
      occurredAt,
      ...(teamTaskId ? { teamTaskId } : {}),
    };
  }

  const requestId = requireText(value.requestId, 'projection requestId');
  const inputRevision = readPositiveInteger(
    value.inputRevision,
    'projection inputRevision'
  );
  const expectedStatus = type === 'execution.input_requested'
    ? 'waiting_input'
    : type === 'execution.input_answered'
      ? 'queued'
      : 'cancelled';
  if (jobStatus !== expectedStatus) {
    throw new Error(`Stored ${type} job status is invalid.`);
  }
  return {
    schemaVersion: 1,
    jobId,
    requestId,
    jobStatus,
    jobRevision,
    inputRevision,
    occurredAt,
    ...(teamTaskId ? { teamTaskId } : {}),
  };
}

export function executionRoomEventId(outboxId: string): string {
  return `execution:${requireText(outboxId, 'outbox id')}`;
}

async function relayExecutionRoomProjectionOnce(
  db: RawSqlDb,
  organizationId: string,
  outboxId: string,
  now: Date
): Promise<'delivered' | 'ignored' | 'skipped'> {
  const claimed = await db.$executeRaw`
    UPDATE "ExecutionOutbox"
    SET "status" = 'delivering',
      "attempts" = "attempts" + 1,
      "lastError" = NULL,
      "updatedAt" = ${now}
    WHERE "id" = ${outboxId}
      AND "organizationId" = ${organizationId}
      AND "status" = 'pending'
      AND "availableAt" <= ${now}
  `;
  if (claimed !== 1) return 'skipped';

  const rows = await db.$queryRaw<ExecutionOutboxRow[]>`
    SELECT "id", "organizationId", "jobId", "roomId",
      "topic", "dedupeKey", "payloadJson", "status",
      "attempts", "availableAt"
    FROM "ExecutionOutbox"
    WHERE "id" = ${outboxId}
      AND "organizationId" = ${organizationId}
    LIMIT 1
  `;
  const outbox = rows[0];
  if (!outbox || outbox.status !== 'delivering') {
    throw new Error('Claimed Execution projection could not be loaded.');
  }
  const rawPayload = safeJsonParse<unknown | typeof INVALID_PAYLOAD>(
    outbox.payloadJson,
    INVALID_PAYLOAD
  );
  if (rawPayload === INVALID_PAYLOAD) {
    throw new Error('Stored Execution projection payload is not valid JSON.');
  }
  const payload = parseExecutionRoomProjectionPayloadV1(outbox.topic, rawPayload);
  if (payload.jobId !== outbox.jobId) {
    throw new Error('Stored Execution projection job identity is invalid.');
  }

  if (!outbox.roomId) {
    await markIgnored(db, organizationId, outbox.id, now, 'no-room');
    return 'ignored';
  }
  const roomRows = await db.$queryRaw<Array<{ eventSequence: number }>>`
    SELECT "eventSequence"
    FROM "Room"
    WHERE "id" = ${outbox.roomId}
      AND "organizationId" = ${organizationId}
    LIMIT 1
  `;
  if (!roomRows[0]) {
    await markIgnored(db, organizationId, outbox.id, now, 'room-not-found');
    return 'ignored';
  }

  const eventId = executionRoomEventId(outbox.id);
  const existingRows = await db.$queryRaw<RoomEventRow[]>`
    SELECT "id", "organizationId", "roomId", "sequence",
      "type", "dataJson", "createdAt"
    FROM "RoomEvent"
    WHERE "id" = ${eventId}
    LIMIT 1
  `;
  let event = existingRows[0] ?? null;
  if (event) {
    if (
      event.organizationId !== organizationId ||
      event.roomId !== outbox.roomId ||
      event.type !== outbox.topic ||
      event.dataJson !== outbox.payloadJson
    ) {
      throw new Error('Execution projection Room event identity has conflicting content.');
    }
  } else {
    const updated = await db.$executeRaw`
      UPDATE "Room"
      SET "eventSequence" = "eventSequence" + 1,
        "updatedAt" = ${now}
      WHERE "id" = ${outbox.roomId}
        AND "organizationId" = ${organizationId}
    `;
    if (updated !== 1) {
      throw new Error('Execution projection Room sequence could not be allocated.');
    }
    const allocatedRows = await db.$queryRaw<Array<{ eventSequence: number }>>`
      SELECT "eventSequence"
      FROM "Room"
      WHERE "id" = ${outbox.roomId}
        AND "organizationId" = ${organizationId}
      LIMIT 1
    `;
    const sequence = readPositiveInteger(
      allocatedRows[0]?.eventSequence,
      'room event sequence'
    );
    await db.$executeRaw`
      INSERT INTO "RoomEvent" (
        "id", "organizationId", "roomId", "sequence",
        "type", "dataJson", "createdAt"
      ) VALUES (
        ${eventId}, ${organizationId}, ${outbox.roomId}, ${sequence},
        ${outbox.topic}, ${outbox.payloadJson}, ${now}
      )
    `;
    event = {
      id: eventId,
      organizationId,
      roomId: outbox.roomId,
      sequence,
      type: outbox.topic,
      dataJson: outbox.payloadJson,
      createdAt: now,
    };
  }

  const roomEnvelope = {
    schemaVersion: 1,
    eventId: event.id,
    organizationId: event.organizationId,
    roomId: event.roomId,
    sequence: readPositiveInteger(event.sequence, 'room event sequence'),
    type: event.type,
    createdAt: toIso(event.createdAt, 'room event createdAt'),
    data: payload,
  };
  await db.$executeRaw`
    INSERT INTO "RoomOutbox" (
      "id", "organizationId", "roomId", "topic",
      "dedupeKey", "payloadJson", "status", "attempts",
      "availableAt", "createdAt", "updatedAt"
    ) VALUES (
      ${`room:${outbox.id}`}, ${organizationId}, ${outbox.roomId},
      ${outbox.topic}, ${event.id}, ${JSON.stringify(roomEnvelope)},
      'pending', 0, ${now}, ${now}, ${now}
    )
    ON CONFLICT ("organizationId", "topic", "dedupeKey")
    DO NOTHING
  `;
  const delivered = await db.$executeRaw`
    UPDATE "ExecutionOutbox"
    SET "status" = 'delivered', "deliveredAt" = ${now},
      "roomEventId" = ${event.id}, "ignoredReason" = NULL,
      "lastError" = NULL, "updatedAt" = ${now}
    WHERE "id" = ${outbox.id}
      AND "organizationId" = ${organizationId}
      AND "status" = 'delivering'
  `;
  if (delivered !== 1) {
    throw new Error('Execution projection delivery marker could not be persisted.');
  }
  return 'delivered';
}

async function markIgnored(
  db: RawSqlDb,
  organizationId: string,
  outboxId: string,
  now: Date,
  reason: 'no-room' | 'room-not-found'
) {
  const updated = await db.$executeRaw`
    UPDATE "ExecutionOutbox"
    SET "status" = 'ignored', "deliveredAt" = ${now},
      "ignoredReason" = ${reason}, "lastError" = NULL,
      "updatedAt" = ${now}
    WHERE "id" = ${outboxId}
      AND "organizationId" = ${organizationId}
      AND "status" = 'delivering'
  `;
  if (updated !== 1) {
    throw new Error('Execution projection ignore marker could not be persisted.');
  }
}

async function recordRelayFailure(
  client: TransactionalRawSqlDb,
  organizationId: string,
  outboxId: string,
  now: Date,
  error: unknown
) {
  const message = (error instanceof Error ? error.message : String(error))
    .slice(0, MAX_LAST_ERROR_LENGTH);
  const retryAt = new Date(now.valueOf() + 1_000);
  await client.$executeRaw`
    UPDATE "ExecutionOutbox"
    SET "attempts" = "attempts" + 1, "lastError" = ${message},
      "availableAt" = ${retryAt}, "updatedAt" = ${now}
    WHERE "id" = ${outboxId}
      AND "organizationId" = ${organizationId}
      AND "status" = 'pending'
  `;
}

function assertOriginPair(job: ProjectionJobRow) {
  if (Boolean(job.originRoomId) !== Boolean(job.originRoomMessageId)) {
    throw new Error('Stored Execution origin Room references are incomplete.');
  }
}

function assertProjectionState(
  type: ExecutionRoomProjectionTypeV1,
  job: ProjectionJobRow,
  request: ProjectionInputRow | null
) {
  if (type === 'execution.completed') {
    if (!isTerminalStatus(job.status) || request) {
      throw new Error('Execution completion projection state is invalid.');
    }
    return;
  }
  const expected = type === 'execution.input_requested'
    ? { job: 'waiting_input', request: 'pending' }
    : type === 'execution.input_answered'
      ? { job: 'queued', request: 'answered' }
      : { job: 'cancelled', request: 'cancelled' };
  if (!request || job.status !== expected.job || request.status !== expected.request) {
    throw new Error(`${type} projection state is invalid.`);
  }
}

type TerminalTaskStatus = Extract<
  TeamTaskStatus,
  'blocked' | 'cancelled' | 'review'
>;
type TerminalExecutionStatus = 'cancelled' | 'failed' | 'succeeded';

type ExpectedTaskProjectionActivity = {
  activityId: string;
  activityType: string;
  actorId: string;
  message: string;
  metadataJson: string;
  organizationId: string;
  taskId: string;
};

function assertTaskProjectionActivity(
  existing: TaskActivityRow | undefined,
  expected: ExpectedTaskProjectionActivity
) {
  if (
    !existing ||
    existing.id !== expected.activityId ||
    existing.organizationId !== expected.organizationId ||
    existing.taskId !== expected.taskId ||
    existing.type !== expected.activityType ||
    existing.message !== expected.message ||
    existing.actorType !== 'agent' ||
    existing.actorId !== expected.actorId ||
    existing.metadataJson !== expected.metadataJson
  ) {
    throw new Error('Execution task projection activity has conflicting content.');
  }
}

function terminalTaskProjection(
  jobStatus: TerminalExecutionStatus
): { activityType: string; message: string; targetStatus: TerminalTaskStatus } {
  if (jobStatus === 'succeeded') {
    return {
      activityType: 'delivery',
      message: 'Linked execution job delivered output for human review.',
      targetStatus: 'review',
    };
  }
  if (jobStatus === 'failed') {
    return {
      activityType: 'execution_failed',
      message: 'Linked execution job failed.',
      targetStatus: 'blocked',
    };
  }
  return {
    activityType: 'execution_cancelled',
    message: 'Linked execution job was cancelled.',
    targetStatus: 'cancelled',
  };
}

function shouldTransitionTask(
  currentStatus: string,
  targetStatus: TerminalTaskStatus
): boolean {
  if (!isTeamTaskStatus(currentStatus)) {
    throw new Error(`Stored linked TeamTask status is invalid: ${currentStatus}.`);
  }
  if (currentStatus === targetStatus || currentStatus === 'done' || currentStatus === 'cancelled') {
    return false;
  }
  const validSourceStatuses: Record<
    TerminalTaskStatus,
    readonly TeamTaskStatus[]
  > = {
    blocked: ['claimed', 'in_progress'],
    cancelled: ['open', 'claimed', 'in_progress', 'blocked', 'review'],
    review: ['in_progress'],
  };
  if (!validSourceStatuses[targetStatus].includes(currentStatus)) {
    throw new Error(
      `Linked TeamTask cannot transition from ${currentStatus} to ${targetStatus}.`
    );
  }
  return true;
}

function requireProjectionType(value: unknown): ExecutionRoomProjectionTypeV1 {
  if (
    typeof value !== 'string' ||
    !EXECUTION_ROOM_PROJECTION_TYPES_V1.some((type) => type === value)
  ) {
    throw new Error('Execution Room projection type is invalid.');
  }
  return value as ExecutionRoomProjectionTypeV1;
}

function isTerminalStatus(value: string): value is 'cancelled' | 'failed' | 'succeeded' {
  return value === 'cancelled' || value === 'failed' || value === 'succeeded';
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function readPositiveInteger(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return number;
}

function readLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_RELAY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RELAY_LIMIT) {
    throw new Error(`limit must be an integer from 1 to ${MAX_RELAY_LIMIT}.`);
  }
  return limit;
}

function readDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new Error(`${field} must be a valid Date.`);
  }
  return value;
}

function requireCanonicalIso(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a canonical ISO timestamp.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) {
    throw new Error(`${field} must be a canonical ISO timestamp.`);
  }
  return value;
}

function toIso(value: Date | string, field: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error(`${field} is invalid.`);
  }
  return date.toISOString();
}
