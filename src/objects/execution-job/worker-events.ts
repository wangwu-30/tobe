import { randomUUID } from 'node:crypto';

import type { RuntimeEventV1 } from '@/agent/execution/driver';
import { ConflictError, ValidationError } from '@/framework/resilience/app-error';
import { isRecord, safeJsonParse } from '@/framework/resilience/safe-data';
import { prisma } from '@/lib/db/prisma';

import type { ExecutionJobActor } from './queries';
import { enqueueExecutionRoomProjection } from './room-projection';
import {
  isExecutionJsonValueV1,
  type ExecutionJsonValueV1,
} from './schema';

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_ARTIFACT_KIND_LENGTH = 128;
const MAX_ARTIFACT_NAME_LENGTH = 255;
const MAX_ARTIFACT_URI_LENGTH = 8_192;
const MAX_MIME_TYPE_LENGTH = 255;
const MAX_ARTIFACT_SIZE_BYTES = 2_147_483_647;
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const ARTIFACT_KIND = /^[a-z0-9][a-z0-9._:/-]*$/i;
const MIME_TYPE =
  /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+*-]+(?:\s*;\s*[a-z0-9!#$&^_.+-]+=(?:[a-z0-9!#$&^_.+*-]+|"[^"\r\n]*"))*$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const INVALID_STORED_JSON = Symbol('invalid-stored-execution-json');

export type ExecutionEventDtoV1 = {
  schemaVersion: 1;
  id: string;
  organizationId: string;
  jobId: string;
  attemptId: string;
  sequence: number;
  type: RuntimeEventV1['type'];
  source: 'runtime';
  runtimeEventId: string;
  payload: ExecutionJsonValueV1;
  occurredAt: string;
  createdAt: string;
};

export type ExecutionArtifactDtoV1 = {
  schemaVersion: 1;
  id: string;
  organizationId: string;
  jobId: string;
  attemptId: string;
  kind: string;
  name: string;
  uri: string | null;
  payload: ExecutionJsonValueV1 | null;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  createdAt: string;
};

export type AppendExecutionEventInput = {
  attemptId: string;
  workerId: string;
  generation: number;
  runtimeEventId: string;
  event: RuntimeEventV1;
  occurredAt?: Date | string;
};

export type AppendExecutionEventResultV1 = {
  schemaVersion: 1;
  state: 'appended' | 'suspended';
  event: ExecutionEventDtoV1;
  artifact: ExecutionArtifactDtoV1 | null;
  replayed: boolean;
};

export type ExecutionArtifactInputV1 = {
  kind: string;
  name: string;
  /** A durable URI and payload are mutually exclusive storage forms. */
  uri?: string | null;
  /** An inline JSON value. Explicit null is a valid inline payload. */
  payload?: ExecutionJsonValueV1 | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
};

export type PersistExecutionArtifactInput = {
  attemptId: string;
  workerId: string;
  generation: number;
  artifact: ExecutionArtifactInputV1;
};

type AttemptFenceRow = {
  id: string;
  jobId: string;
  runtimeId: string | null;
};

type ExecutionEventRecord = {
  id: string;
  organizationId: string;
  jobId: string;
  attemptId: string | null;
  sequence: number;
  type: string;
  source: string;
  runtimeEventId: string | null;
  payloadJson: string;
  occurredAt: Date | string;
  createdAt: Date | string;
};

type ExecutionArtifactRecord = {
  id: string;
  organizationId: string;
  jobId: string;
  attemptId: string | null;
  kind: string;
  name: string;
  storageUri: string | null;
  payloadJson: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  metadataJson: string;
  createdAt: Date | string;
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

type NormalizedArtifact = {
  id: string;
  kind: string;
  name: string;
  storageUri: string | null;
  payloadJson: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  metadataJson: string;
};

type NormalizedRuntimeEvent = {
  type: RuntimeEventV1['type'];
  payload: ExecutionJsonValueV1;
  payloadJson: string;
  checkpointJson: string | null;
  artifact: NormalizedArtifact | null;
};

/**
 * Appends a runtime fact while the worker still owns the unexpired attempt
 * lease. Runtime completion events are deliberately facts only: the separate
 * complete command remains the sole authority that transitions attempt, Job,
 * and any linked Task state.
 */
export async function appendExecutionEvent(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  input: AppendExecutionEventInput
): Promise<AppendExecutionEventResultV1> {
  const organizationId = requireIdentifier(
    actor.organizationId,
    'organizationId is required.'
  );
  const attemptId = requireIdentifier(input.attemptId, 'attemptId is required.');
  const workerId = requireIdentifier(input.workerId, 'workerId is required.');
  const generation = readGeneration(input.generation);
  const runtimeEventId = requireIdentifier(
    input.runtimeEventId,
    'runtimeEventId is required.'
  );
  const occurredAt = readOccurredAt(input.occurredAt);
  const normalized = normalizeRuntimeEvent(input.event);
  const cancellationCompletion =
    normalized.type === 'attempt-completed' &&
    isRecord(normalized.payload) &&
    normalized.payload.status === 'interrupted';
  const now = new Date();

  return prisma.$transaction(async (db) => {
    // A waiting transition deliberately releases the worker lease. Check for
    // its exact replay before fencing so a lost response can be retried.
    if (normalized.type === 'waiting-for-human') {
      const replay = await loadExistingRuntimeEvent(
        db,
        organizationId,
        attemptId,
        runtimeEventId
      );
      if (replay) {
        assertRuntimeEventReplay(replay, normalized);
        return {
          schemaVersion: 1,
          state: 'suspended',
          event: mapEvent(replay),
          artifact: null,
          replayed: true,
        };
      }
    }

    const attempt = await fenceAttempt(db, {
      attemptId,
      generation,
      organizationId,
      workerId,
      now,
      allowCancelRequested: cancellationCompletion,
    });

    const existingRows = await db.$queryRaw<ExecutionEventRecord[]>`
      SELECT
        "id", "organizationId", "jobId", "attemptId",
        "sequence", "type", "source", "runtimeEventId",
        "payloadJson", "occurredAt", "createdAt"
      FROM "ExecutionEvent"
      WHERE "attemptId" = ${attemptId}
        AND "runtimeEventId" = ${runtimeEventId}
      LIMIT 1
    `;
    const existing = existingRows[0];
    if (existing) {
      assertRuntimeEventReplay(existing, normalized, attempt.jobId);
      const artifact = normalized.artifact
        ? await loadArtifact(db, normalized.artifact.id)
        : null;
      return {
        schemaVersion: 1,
        state: 'appended',
        event: mapEvent(existing),
        artifact: artifact ? mapArtifact(artifact) : null,
        replayed: true,
      };
    }

    if (normalized.checkpointJson !== null) {
      const checkpointUpdated = await db.$executeRaw`
        UPDATE "ExecutionAttempt"
        SET
          "checkpointJson" = ${normalized.checkpointJson},
          "updatedAt" = ${now}
        WHERE "id" = ${attemptId}
          AND "organizationId" = ${organizationId}
          AND "status" = 'running'
          AND "generation" = ${generation}
          AND "leaseOwnerId" = ${workerId}
          AND "leaseExpiresAt" IS NOT NULL
          AND "leaseExpiresAt" > ${now}
      `;
      if (checkpointUpdated !== 1) throw fencedError();
    }

    let artifact: ExecutionArtifactRecord | null = null;
    if (normalized.artifact) {
      artifact = await persistNormalizedArtifact(
        db,
        organizationId,
        attempt.jobId,
        attemptId,
        normalized.artifact,
        now,
        true
      );
    }

    const sequenceRows = await db.$queryRaw<Array<{ sequence: number }>>`
      SELECT COALESCE(MAX("sequence"), 0) + 1 AS "sequence"
      FROM "ExecutionEvent"
      WHERE "jobId" = ${attempt.jobId}
    `;
    const sequence = Number(sequenceRows[0]?.sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error('Execution event sequence could not be allocated.');
    }

    const eventId = randomUUID();
    await db.$executeRaw`
      INSERT INTO "ExecutionEvent" (
        "id", "organizationId", "jobId", "attemptId",
        "sequence", "type", "source", "runtimeEventId",
        "payloadJson", "occurredAt", "createdAt"
      ) VALUES (
        ${eventId}, ${organizationId}, ${attempt.jobId}, ${attemptId},
        ${sequence}, ${normalized.type}, 'runtime', ${runtimeEventId},
        ${normalized.payloadJson}, ${occurredAt}, ${now}
      )
    `;

    if (normalized.type === 'attempt-started') {
      await persistRuntimeRunId(db, {
        attemptId,
        generation,
        normalized,
        organizationId,
        workerId,
        now,
      });
    }

    if (normalized.type === 'waiting-for-human') {
      await pauseExecutionForInput(db, {
        attempt,
        generation,
        normalized,
        organizationId,
        workerId,
        now,
      });
    }

    return {
      schemaVersion: 1,
      state:
        normalized.type === 'waiting-for-human'
          ? 'suspended'
          : 'appended',
      event: {
        schemaVersion: 1,
        id: eventId,
        organizationId,
        jobId: attempt.jobId,
        attemptId,
        sequence,
        type: normalized.type,
        source: 'runtime',
        runtimeEventId,
        payload: normalized.payload,
        occurredAt: occurredAt.toISOString(),
        createdAt: now.toISOString(),
      },
      artifact: artifact ? mapArtifact(artifact) : null,
      replayed: false,
    };
  });
}

/** Persists a URI-backed or inline artifact under the fenced attempt. */
export async function persistExecutionArtifact(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  input: PersistExecutionArtifactInput
): Promise<ExecutionArtifactDtoV1> {
  const organizationId = requireIdentifier(
    actor.organizationId,
    'organizationId is required.'
  );
  const attemptId = requireIdentifier(input.attemptId, 'attemptId is required.');
  const workerId = requireIdentifier(input.workerId, 'workerId is required.');
  const generation = readGeneration(input.generation);
  const artifact = normalizeDirectArtifact(input.artifact);
  const now = new Date();

  return prisma.$transaction(async (db) => {
    const attempt = await fenceAttempt(db, {
      attemptId,
      generation,
      organizationId,
      workerId,
      now,
      allowCancelRequested: false,
    });
    const persisted = await persistNormalizedArtifact(
      db,
      organizationId,
      attempt.jobId,
      attemptId,
      artifact,
      now,
      false
    );
    return mapArtifact(persisted);
  });
}

async function fenceAttempt(
  db: RawSqlDb,
  input: {
    attemptId: string;
    generation: number;
    organizationId: string;
    workerId: string;
    now: Date;
    allowCancelRequested: boolean;
  }
): Promise<AttemptFenceRow> {
  // The no-op write both checks every ownership predicate and takes the same
  // transaction write lock used by reclaim/complete before any fact is stored.
  const fenced = await db.$executeRaw`
    UPDATE "ExecutionAttempt"
    SET "generation" = "generation"
    WHERE "id" = ${input.attemptId}
      AND "organizationId" = ${input.organizationId}
      AND "status" = 'running'
      AND "generation" = ${input.generation}
      AND "leaseOwnerId" = ${input.workerId}
      AND "leaseExpiresAt" IS NOT NULL
      AND "leaseExpiresAt" > ${input.now}
      AND "capacityReserved" = TRUE
      AND EXISTS (
        SELECT 1 FROM "ExecutionJob" AS job
        WHERE job."id" = "ExecutionAttempt"."jobId"
          AND job."organizationId" = ${input.organizationId}
          AND (
            job."status" = 'running'
            OR (
              ${input.allowCancelRequested ? 1 : 0} = 1
              AND job."status" = 'cancel_requested'
            )
          )
      )
  `;
  if (fenced !== 1) throw fencedError();

  const rows = await db.$queryRaw<AttemptFenceRow[]>`
    SELECT attempt."id", attempt."jobId", attempt."runtimeId"
    FROM "ExecutionAttempt" AS attempt
    INNER JOIN "ExecutionJob" AS job
      ON job."id" = attempt."jobId"
      AND job."organizationId" = attempt."organizationId"
    WHERE attempt."id" = ${input.attemptId}
      AND attempt."organizationId" = ${input.organizationId}
    LIMIT 1
  `;
  if (!rows[0]) throw fencedError();
  return rows[0];
}

async function loadExistingRuntimeEvent(
  db: RawSqlDb,
  organizationId: string,
  attemptId: string,
  runtimeEventId: string
): Promise<ExecutionEventRecord | null> {
  const rows = await db.$queryRaw<ExecutionEventRecord[]>`
    SELECT event."id", event."organizationId", event."jobId",
      event."attemptId", event."sequence", event."type",
      event."source", event."runtimeEventId", event."payloadJson",
      event."occurredAt", event."createdAt"
    FROM "ExecutionEvent" AS event
    INNER JOIN "ExecutionAttempt" AS attempt
      ON attempt."id" = event."attemptId"
      AND attempt."organizationId" = event."organizationId"
    WHERE event."organizationId" = ${organizationId}
      AND event."attemptId" = ${attemptId}
      AND event."runtimeEventId" = ${runtimeEventId}
    LIMIT 1
  `;
  return rows[0] || null;
}

function assertRuntimeEventReplay(
  existing: ExecutionEventRecord,
  normalized: NormalizedRuntimeEvent,
  expectedJobId?: string
) {
  if (
    (expectedJobId !== undefined && existing.jobId !== expectedJobId) ||
    existing.type !== normalized.type ||
    existing.source !== 'runtime' ||
    existing.payloadJson !== normalized.payloadJson
  ) {
    throw new ConflictError(
      'runtimeEventId was already used with different event content.'
    );
  }
}

async function pauseExecutionForInput(
  db: RawSqlDb,
  input: {
    attempt: AttemptFenceRow;
    generation: number;
    normalized: NormalizedRuntimeEvent;
    organizationId: string;
    workerId: string;
    now: Date;
  }
) {
  if (!isRecord(input.normalized.payload)) {
    throw new Error('Normalized waiting input payload is invalid.');
  }
  const requestId = requireIdentifier(
    input.normalized.payload.requestId,
    'waiting-for-human requestId is required.'
  );
  const prompt = requireText(
    input.normalized.payload.prompt,
    'waiting-for-human prompt is required.',
    65_536
  );
  if (!input.attempt.runtimeId) {
    throw new ConflictError(
      'A running execution attempt must have a runtime before waiting for input.'
    );
  }

  const existingRequests = await db.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "ExecutionInputRequest"
    WHERE "id" = ${requestId}
       OR ("attemptId" = ${input.attempt.id} AND "requestKey" = ${requestId})
    LIMIT 1
  `;
  if (existingRequests[0]) {
    throw new ConflictError('Execution input request id is already in use.');
  }

  await db.$executeRaw`
    INSERT INTO "ExecutionInputRequest" (
      "id", "organizationId", "jobId", "attemptId",
      "requestKey", "prompt", "schemaJson", "status",
      "requestedAt", "revision", "createdAt", "updatedAt"
    ) VALUES (
      ${requestId}, ${input.organizationId}, ${input.attempt.jobId},
      ${input.attempt.id}, ${requestId}, ${prompt}, '{}', 'pending',
      ${input.now}, 1, ${input.now}, ${input.now}
    )
  `;

  const attemptUpdated = await db.$executeRaw`
    UPDATE "ExecutionAttempt"
    SET
      "status" = 'waiting_input',
      "generation" = "generation" + 1,
      "capacityReserved" = FALSE,
      "leaseOwnerId" = NULL,
      "leaseExpiresAt" = NULL,
      "updatedAt" = ${input.now}
    WHERE "id" = ${input.attempt.id}
      AND "organizationId" = ${input.organizationId}
      AND "status" = 'running'
      AND "generation" = ${input.generation}
      AND "leaseOwnerId" = ${input.workerId}
      AND "capacityReserved" = TRUE
  `;
  if (attemptUpdated !== 1) throw fencedError();

  const released = await db.$executeRaw`
    UPDATE "ExecutionRuntime"
    SET
      "capacityUsed" = "capacityUsed" - 1,
      "capacityUpdatedAt" = ${input.now},
      "updatedAt" = ${input.now}
    WHERE "id" = ${input.attempt.runtimeId}
      AND "organizationId" = ${input.organizationId}
      AND "capacityUsed" > 0
  `;
  if (released !== 1) {
    throw new ConflictError(
      'Execution runtime capacity could not be released while waiting for input.'
    );
  }

  const jobUpdated = await db.$executeRaw`
    UPDATE "ExecutionJob"
    SET
      "status" = 'waiting_input',
      "revision" = "revision" + 1,
      "updatedAt" = ${input.now}
    WHERE "id" = ${input.attempt.jobId}
      AND "organizationId" = ${input.organizationId}
      AND "status" = 'running'
  `;
  if (jobUpdated !== 1) {
    throw new ConflictError(
      'Execution job changed while waiting for input was persisted.'
    );
  }

  await enqueueExecutionRoomProjection(db, {
    organizationId: input.organizationId,
    jobId: input.attempt.jobId,
    requestId,
    type: 'execution.input_requested',
    occurredAt: input.now,
  });
}

async function persistRuntimeRunId(
  db: RawSqlDb,
  input: {
    attemptId: string;
    generation: number;
    normalized: NormalizedRuntimeEvent;
    organizationId: string;
    workerId: string;
    now: Date;
  }
) {
  if (!isRecord(input.normalized.payload)) {
    throw new Error('Normalized attempt-started payload is invalid.');
  }
  const runtimeRunId = requireIdentifier(
    input.normalized.payload.runtimeAttemptId,
    'attempt-started runtimeAttemptId is required.'
  );
  const updated = await db.$executeRaw`
    UPDATE "ExecutionAttempt"
    SET "runtimeRunId" = ${runtimeRunId}, "updatedAt" = ${input.now}
    WHERE "id" = ${input.attemptId}
      AND "organizationId" = ${input.organizationId}
      AND "status" = 'running'
      AND "generation" = ${input.generation}
      AND "leaseOwnerId" = ${input.workerId}
      AND "leaseExpiresAt" IS NOT NULL
      AND "leaseExpiresAt" > ${input.now}
      AND "capacityReserved" = TRUE
      AND ("runtimeRunId" IS NULL OR "runtimeRunId" = ${runtimeRunId})
  `;
  if (updated !== 1) {
    throw new ConflictError(
      'Execution runtime run identity conflicts with durable attempt state.'
    );
  }
}

function fencedError() {
  return new ConflictError(
    'Execution attempt lease is stale, expired, or owned by another worker.'
  );
}

async function persistNormalizedArtifact(
  db: RawSqlDb,
  organizationId: string,
  jobId: string,
  attemptId: string,
  artifact: NormalizedArtifact,
  now: Date,
  allowIdenticalExisting: boolean
): Promise<ExecutionArtifactRecord> {
  const existing = await loadArtifact(db, artifact.id);
  if (existing) {
    if (allowIdenticalExisting && artifactMatches(existing, {
      ...artifact,
      organizationId,
      jobId,
      attemptId,
    })) {
      return existing;
    }
    throw new ConflictError('Execution artifact id is already in use.');
  }

  await db.$executeRaw`
    INSERT INTO "ExecutionArtifact" (
      "id", "organizationId", "jobId", "attemptId", "kind",
      "name", "storageUri", "payloadJson", "mimeType",
      "sizeBytes", "sha256", "metadataJson", "createdAt"
    ) VALUES (
      ${artifact.id}, ${organizationId}, ${jobId}, ${attemptId},
      ${artifact.kind}, ${artifact.name}, ${artifact.storageUri},
      ${artifact.payloadJson}, ${artifact.mimeType}, ${artifact.sizeBytes},
      ${artifact.sha256}, ${artifact.metadataJson}, ${now}
    )
  `;

  return {
    id: artifact.id,
    organizationId,
    jobId,
    attemptId,
    kind: artifact.kind,
    name: artifact.name,
    storageUri: artifact.storageUri,
    payloadJson: artifact.payloadJson,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    metadataJson: artifact.metadataJson,
    createdAt: now,
  };
}

async function loadArtifact(
  db: RawSqlDb,
  artifactId: string
): Promise<ExecutionArtifactRecord | null> {
  const rows = await db.$queryRaw<ExecutionArtifactRecord[]>`
    SELECT
      "id", "organizationId", "jobId", "attemptId", "kind",
      "name", "storageUri", "payloadJson", "mimeType",
      "sizeBytes", "sha256", "metadataJson", "createdAt"
    FROM "ExecutionArtifact"
    WHERE "id" = ${artifactId}
    LIMIT 1
  `;
  return rows[0] || null;
}

function artifactMatches(
  existing: ExecutionArtifactRecord,
  expected: NormalizedArtifact & {
    organizationId: string;
    jobId: string;
    attemptId: string;
  }
) {
  return (
    existing.organizationId === expected.organizationId &&
    existing.jobId === expected.jobId &&
    existing.attemptId === expected.attemptId &&
    existing.kind === expected.kind &&
    existing.name === expected.name &&
    existing.storageUri === expected.storageUri &&
    existing.payloadJson === expected.payloadJson &&
    existing.mimeType === expected.mimeType &&
    existing.sizeBytes === expected.sizeBytes &&
    existing.sha256 === expected.sha256 &&
    existing.metadataJson === expected.metadataJson
  );
}

function normalizeRuntimeEvent(event: RuntimeEventV1): NormalizedRuntimeEvent {
  const value: unknown = event;
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new ValidationError('event must be a runtime event object.');
  }

  let payload: ExecutionJsonValueV1;
  let checkpointJson: string | null = null;
  let artifact: NormalizedArtifact | null = null;

  switch (value.type) {
    case 'attempt-started':
      payload = {
        runtimeAttemptId: requireIdentifier(
          value.runtimeAttemptId,
          'attempt-started runtimeAttemptId is required.'
        ),
      };
      break;
    case 'text-delta':
      if (typeof value.text !== 'string') {
        throw new ValidationError('text-delta text must be a string.');
      }
      payload = { text: value.text };
      break;
    case 'progress': {
      const message = requireText(
        value.message,
        'progress message is required.',
        16_384
      );
      if (
        value.percent !== undefined &&
        (typeof value.percent !== 'number' ||
          !Number.isFinite(value.percent) ||
          value.percent < 0 ||
          value.percent > 100)
      ) {
        throw new ValidationError('progress percent must be from 0 to 100.');
      }
      payload = {
        message,
        ...(typeof value.percent === 'number'
          ? { percent: value.percent }
          : {}),
      };
      break;
    }
    case 'checkpoint': {
      const checkpointRef = requireIdentifier(
        value.checkpointRef,
        'checkpoint checkpointRef is required.'
      );
      payload = { checkpointRef };
      checkpointJson = stableSerialize(checkpointRef, 'checkpoint');
      break;
    }
    case 'artifact': {
      if (!isRecord(value.artifact)) {
        throw new ValidationError('artifact event must include an artifact.');
      }
      const artifactId = requireIdentifier(
        value.artifact.artifactId,
        'artifact artifactId is required.'
      );
      const kind = readArtifactKind(value.artifact.kind);
      const storageUri = readArtifactUri(value.artifact.uri, true);
      const mimeType = readMimeType(value.artifact.mediaType);
      artifact = {
        id: artifactId,
        kind,
        name: readArtifactName(artifactId),
        storageUri,
        payloadJson: null,
        mimeType,
        sizeBytes: null,
        sha256: null,
        metadataJson: stableSerialize(
          { runtimeArtifactId: artifactId },
          'artifact metadata'
        ),
      };
      payload = {
        artifact: {
          artifactId,
          kind,
          ...(mimeType ? { mediaType: mimeType } : {}),
          uri: storageUri,
        },
      };
      break;
    }
    case 'waiting-for-human':
      payload = {
        requestId: requireIdentifier(
          value.requestId,
          'waiting-for-human requestId is required.'
        ),
        prompt: requireText(
          value.prompt,
          'waiting-for-human prompt is required.',
          65_536
        ),
      };
      break;
    case 'attempt-completed':
      if (!['succeeded', 'failed', 'interrupted'].includes(String(value.status))) {
        throw new ValidationError('attempt-completed status is invalid.');
      }
      if (value.message !== undefined && typeof value.message !== 'string') {
        throw new ValidationError(
          'attempt-completed message must be a string when provided.'
        );
      }
      payload = {
        status: value.status as 'succeeded' | 'failed' | 'interrupted',
        ...(typeof value.message === 'string' ? { message: value.message } : {}),
      };
      break;
    default:
      throw new ValidationError('Runtime event type is invalid.');
  }

  return {
    type: value.type as RuntimeEventV1['type'],
    payload,
    payloadJson: stableSerialize(payload, 'event payload'),
    checkpointJson,
    artifact,
  };
}

function normalizeDirectArtifact(
  input: ExecutionArtifactInputV1
): NormalizedArtifact {
  if (!isRecord(input)) {
    throw new ValidationError('artifact must be an object.');
  }
  const kind = readArtifactKind(input.kind);
  const name = readArtifactName(input.name);
  const hasUri = input.uri !== undefined && input.uri !== null;
  const hasPayload =
    Object.prototype.hasOwnProperty.call(input, 'payload') &&
    input.payload !== undefined;
  if (hasUri === hasPayload) {
    throw new ValidationError(
      'artifact must contain exactly one of uri or inline payload.'
    );
  }
  const storageUri = hasUri ? readArtifactUri(input.uri, true) : null;
  const payloadJson = hasPayload
    ? stableSerialize(input.payload ?? null, 'artifact payload')
    : null;

  return {
    id: randomUUID(),
    kind,
    name,
    storageUri,
    payloadJson,
    mimeType: readMimeType(input.mimeType),
    sizeBytes: readSizeBytes(input.sizeBytes),
    sha256: readSha256(input.sha256),
    metadataJson: '{}',
  };
}

function readArtifactKind(value: unknown) {
  const kind = requireText(
    value,
    'artifact kind is required.',
    MAX_ARTIFACT_KIND_LENGTH
  );
  if (!ARTIFACT_KIND.test(kind)) {
    throw new ValidationError('artifact kind contains invalid characters.');
  }
  return kind;
}

function readArtifactName(value: unknown) {
  const name = requireText(
    value,
    'artifact name is required.',
    MAX_ARTIFACT_NAME_LENGTH
  );
  if (/[\/\\\u0000-\u001f]/.test(name)) {
    throw new ValidationError('artifact name contains invalid characters.');
  }
  return name;
}

function readArtifactUri(value: unknown, required: boolean): string | null {
  if (value === undefined || value === null) {
    if (required) throw new ValidationError('artifact uri is required.');
    return null;
  }
  const uri = requireText(
    value,
    'artifact uri is required.',
    MAX_ARTIFACT_URI_LENGTH
  );
  if (!URI_SCHEME.test(uri)) {
    throw new ValidationError('artifact uri must be an absolute URI.');
  }
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === 'data:' || parsed.protocol === 'javascript:') {
      throw new Error('Inline and executable URIs are not artifact storage.');
    }
  } catch {
    throw new ValidationError('artifact uri must be a valid URI.');
  }
  return uri;
}

function readMimeType(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const mimeType = requireText(
    value,
    'artifact mimeType must be a non-empty string.',
    MAX_MIME_TYPE_LENGTH
  );
  if (!MIME_TYPE.test(mimeType)) {
    throw new ValidationError('artifact mimeType is invalid.');
  }
  return mimeType.toLowerCase();
}

function readSizeBytes(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_ARTIFACT_SIZE_BYTES
  ) {
    throw new ValidationError(
      `artifact sizeBytes must be an integer from 0 to ${MAX_ARTIFACT_SIZE_BYTES}.`
    );
  }
  return value;
}

function readSha256(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new ValidationError(
      'artifact sha256 must be a 64-character hexadecimal digest.'
    );
  }
  return value.toLowerCase();
}

function readGeneration(value: number) {
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationError('generation must be a positive integer.');
  }
  return value;
}

function readOccurredAt(value: Date | string | undefined): Date {
  const occurredAt = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(occurredAt.valueOf())) {
    throw new ValidationError('occurredAt must be a valid date.');
  }
  return occurredAt;
}

function requireIdentifier(value: unknown, message: string) {
  return requireText(value, message, MAX_IDENTIFIER_LENGTH);
}

function requireText(
  value: unknown,
  message: string,
  maxLength: number
): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(message);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new ValidationError(`Value must not exceed ${maxLength} characters.`);
  }
  return text;
}

function stableSerialize(value: unknown, field: string): string {
  const normalized = normalizeJsonValue(value, field, new WeakSet<object>());
  return JSON.stringify(normalized);
}

function normalizeJsonValue(
  value: unknown,
  field: string,
  ancestors: WeakSet<object>
): ExecutionJsonValueV1 {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ValidationError(`${field} must be JSON-compatible.`);
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new ValidationError(`${field} must be JSON-compatible.`);
  }
  if (ancestors.has(value)) {
    throw new ValidationError(`${field} must be JSON-compatible.`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => normalizeJsonValue(entry, field, ancestors));
    }
    if (!isRecord(value)) {
      throw new ValidationError(`${field} must be JSON-compatible.`);
    }
    const normalized: Record<string, ExecutionJsonValueV1> = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalizeJsonValue(value[key], field, ancestors);
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

function mapEvent(record: ExecutionEventRecord): ExecutionEventDtoV1 {
  if (
    !record.attemptId ||
    !record.runtimeEventId ||
    record.source !== 'runtime' ||
    !isRuntimeEventType(record.type)
  ) {
    throw new Error('Stored execution runtime event is invalid.');
  }
  return {
    schemaVersion: 1,
    id: record.id,
    organizationId: record.organizationId,
    jobId: record.jobId,
    attemptId: record.attemptId,
    sequence: Number(record.sequence),
    type: record.type,
    source: 'runtime',
    runtimeEventId: record.runtimeEventId,
    payload: parseStoredJson(record.payloadJson),
    occurredAt: toIsoString(record.occurredAt),
    createdAt: toIsoString(record.createdAt),
  };
}

function mapArtifact(record: ExecutionArtifactRecord): ExecutionArtifactDtoV1 {
  if (!record.attemptId) {
    throw new Error('Stored execution artifact is not attached to an attempt.');
  }
  return {
    schemaVersion: 1,
    id: record.id,
    organizationId: record.organizationId,
    jobId: record.jobId,
    attemptId: record.attemptId,
    kind: record.kind,
    name: record.name,
    uri: record.storageUri,
    payload:
      record.payloadJson === null ? null : parseStoredJson(record.payloadJson),
    mimeType: record.mimeType,
    sizeBytes:
      record.sizeBytes === null ? null : Number(record.sizeBytes),
    sha256: record.sha256,
    createdAt: toIsoString(record.createdAt),
  };
}

function parseStoredJson(value: string): ExecutionJsonValueV1 {
  const parsed = safeJsonParse<unknown | typeof INVALID_STORED_JSON>(
    value,
    INVALID_STORED_JSON
  );
  if (
    parsed === INVALID_STORED_JSON ||
    !isExecutionJsonValueV1(parsed)
  ) {
    throw new Error('Stored execution JSON is invalid.');
  }
  return parsed;
}

function toIsoString(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error('Stored execution timestamp is invalid.');
  }
  return date.toISOString();
}

function isRuntimeEventType(value: string): value is RuntimeEventV1['type'] {
  return [
    'attempt-started',
    'text-delta',
    'progress',
    'checkpoint',
    'artifact',
    'waiting-for-human',
    'attempt-completed',
  ].includes(value);
}
