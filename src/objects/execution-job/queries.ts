import type { RuntimeExecutionKindV1 } from '@/agent/execution';
import { NotFoundError, ValidationError } from '@/framework/resilience/app-error';
import { isRecord, safeJsonParse } from '@/framework/resilience/safe-data';
import { prisma } from '@/lib/db/prisma';

import {
  isExecutionJsonValueV1,
  isExecutionJobStatusV1,
  mapExecutionJob,
  type ExecutionAttemptDtoV1,
  type ExecutionAttemptRecord,
  type ExecutionJobDtoV1,
  type ExecutionJobRecord,
  type ExecutionJobStatusV1,
  type ExecutionJsonValueV1,
} from './schema';

export type ExecutionJobActor = {
  deviceId?: string;
  organizationId: string;
  userId: string;
};

export type ExecutionPageInfoV1 = {
  hasNextPage: boolean;
  nextCursor: string | null;
};

export type ExecutionJobSummaryV1 = {
  schemaVersion: 1;
  id: string;
  teamTaskId: string | null;
  goal: string;
  kind: RuntimeExecutionKindV1;
  status: ExecutionJobStatusV1;
  priority: number;
  selectedRuntimeId: string | null;
  selectionReason: string | null;
  attemptCount: number;
  maxAttempts: number;
  revision: number;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type ExecutionEventReadDtoV1 = {
  schemaVersion: 1;
  id: string;
  jobId: string;
  attemptId: string | null;
  sequence: number;
  type: string;
  source: string;
  runtimeEventId: string | null;
  payload: ExecutionJsonValueV1 | null;
  payloadValid: boolean;
  occurredAt: string;
  createdAt: string;
};

export type ExecutionLogTypeV1 = 'text-delta' | 'progress';

export type ExecutionLogReadDtoV1 = {
  schemaVersion: 1;
  id: string;
  jobId: string;
  attemptId: string | null;
  sequence: number;
  type: ExecutionLogTypeV1;
  source: string;
  runtimeEventId: string | null;
  text: string | null;
  percent: number | null;
  payloadValid: boolean;
  occurredAt: string;
  createdAt: string;
};

export type ExecutionArtifactReadDtoV1 = {
  schemaVersion: 1;
  id: string;
  jobId: string;
  attemptId: string | null;
  kind: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  storage: 'inline' | 'external' | 'missing';
  externalUrl: string | null;
  metadata: ExecutionJsonValueV1 | null;
  metadataValid: boolean;
  contentAvailable: boolean;
  contentUnavailableReason: string | null;
  createdAt: string;
};

export type ExecutionArtifactContentV1 = {
  schemaVersion: 1;
  artifact: ExecutionArtifactReadDtoV1;
  content: ExecutionJsonValueV1 | null;
};

export const EXECUTION_INPUT_REQUEST_STATUSES_V1 = [
  'pending',
  'answered',
  'cancelled',
] as const;

export type ExecutionInputRequestStatusV1 =
  (typeof EXECUTION_INPUT_REQUEST_STATUSES_V1)[number];

export type ExecutionInputRequestDtoV1 = {
  schemaVersion: 1;
  id: string;
  jobId: string;
  attemptId: string;
  requestKey: string;
  prompt: string;
  inputSchema: ExecutionJsonValueV1;
  response: ExecutionJsonValueV1 | null;
  responseId: string | null;
  status: ExecutionInputRequestStatusV1;
  requestedAt: string;
  respondedAt: string | null;
  respondedById: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionCompletionProjectionV1 = {
  schemaVersion: 1;
  projection: 'execution-job-completed';
  jobId: string;
  organizationId: string;
  teamTaskId: string | null;
  status: Extract<ExecutionJobStatusV1, 'cancelled' | 'failed' | 'succeeded'>;
  revision: number;
  result: ExecutionJsonValueV1 | null;
  error: ExecutionJsonValueV1 | null;
  finishedAt: string | null;
  attempt: ExecutionAttemptDtoV1 | null;
};

export type ExecutionJobDetailV1 = {
  schemaVersion: 1;
  job: ExecutionJobDtoV1;
  events: { items: ExecutionEventReadDtoV1[]; pageInfo: ExecutionPageInfoV1 };
  artifacts: {
    items: ExecutionArtifactReadDtoV1[];
    pageInfo: ExecutionPageInfoV1;
  };
  inputRequests: {
    items: ExecutionInputRequestDtoV1[];
    pageInfo: ExecutionPageInfoV1;
  };
  completion: ExecutionCompletionProjectionV1 | null;
};

export type ListExecutionJobsInput = {
  cursor?: string | null;
  kind?: RuntimeExecutionKindV1;
  limit?: number;
  search?: string | null;
  status?: ExecutionJobStatusV1;
  teamTaskId?: string | null;
};

export type ListExecutionEventsInput = {
  afterSequence?: number | null;
  attemptId?: string | null;
  limit?: number;
};

export type ListExecutionLogsInput = ListExecutionEventsInput;

export type ListExecutionArtifactsInput = {
  attemptId?: string | null;
  cursor?: string | null;
  limit?: number;
};

export type ListExecutionInputRequestsInput = {
  cursor?: string | null;
  limit?: number;
  status?: ExecutionInputRequestStatusV1;
};

type ExecutionJobSummaryRecord = Pick<
  ExecutionJobRecord,
  | 'id'
  | 'teamTaskId'
  | 'kind'
  | 'status'
  | 'priority'
  | 'specJson'
  | 'selectedRuntimeId'
  | 'selectionReason'
  | 'maxAttempts'
  | 'queuedAt'
  | 'startedAt'
  | 'finishedAt'
  | 'revision'
  | 'updatedAt'
> & { attemptCount: number };

type ExecutionEventReadRecord = {
  id: string;
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

type ExecutionArtifactReadRecord = {
  id: string;
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

type ExecutionInputRequestRecord = {
  id: string;
  jobId: string;
  attemptId: string;
  requestKey: string;
  prompt: string;
  schemaJson: string;
  responseJson: string | null;
  responseId: string | null;
  status: string;
  requestedAt: Date | string;
  respondedAt: Date | string | null;
  respondedById: string | null;
  revision: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type DateCursorV1 = { id: string; at: string };
type InvalidJson = typeof INVALID_JSON;

const EXECUTION_KINDS: readonly RuntimeExecutionKindV1[] = [
  'coding',
  'research',
  'browser',
  'document',
  'workflow',
];
const INVALID_JSON = Symbol('invalid-execution-read-json');
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const MAX_EXECUTION_JOB_SEARCH_LENGTH = 200;
const MAX_INLINE_ARTIFACT_JSON_BYTES = 256 * 1024;
const MAX_ARTIFACT_METADATA_JSON_BYTES = 64 * 1024;

export async function listExecutionJobs(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  input: ListExecutionJobsInput = {}
): Promise<{ items: ExecutionJobSummaryV1[]; pageInfo: ExecutionPageInfoV1 }> {
  const organizationId = requireText(actor.organizationId, 'organizationId');
  const limit = readLimit(input.limit);
  const status = readOptionalStatus(input.status);
  const kind = readOptionalKind(input.kind);
  const teamTaskId = readOptionalText(input.teamTaskId, 'teamTaskId');
  const search = readOptionalSearch(input.search);
  const searchNeedle = search?.toLowerCase() ?? null;
  const cursor = decodeDateCursor(input.cursor);
  const cursorAt = cursor?.at ?? null;
  const cursorId = cursor?.id ?? null;

  const rows = await prisma.$queryRaw<ExecutionJobSummaryRecord[]>`
    SELECT
      job."id", job."teamTaskId", job."kind", job."status",
      job."priority", job."specJson", job."selectedRuntimeId",
      job."selectionReason", job."maxAttempts", job."queuedAt",
      job."startedAt", job."finishedAt", job."revision",
      job."updatedAt",
      (SELECT COUNT(*) FROM "ExecutionAttempt" AS attempt
        WHERE attempt."jobId" = job."id"
          AND attempt."organizationId" = job."organizationId")
        AS "attemptCount"
    FROM "ExecutionJob" AS job
    WHERE job."organizationId" = ${organizationId}
      AND (${status} IS NULL OR job."status" = ${status})
      AND (${kind} IS NULL OR job."kind" = ${kind})
      AND (${teamTaskId} IS NULL OR job."teamTaskId" = ${teamTaskId})
      AND (
        ${searchNeedle} IS NULL
        OR instr(lower(job."id"), ${searchNeedle}) > 0
        OR instr(lower(job."kind"), ${searchNeedle}) > 0
        OR instr(lower(job."status"), ${searchNeedle}) > 0
        OR instr(lower(COALESCE(job."selectedRuntimeId", '')), ${searchNeedle}) > 0
        OR instr(
          lower(COALESCE(
            CASE
              WHEN json_valid(job."specJson")
                THEN CAST(json_extract(job."specJson", '$.goal') AS TEXT)
              ELSE NULL
            END,
            ''
          )),
          ${searchNeedle}
        ) > 0
      )
      AND (
        ${cursorAt} IS NULL
        OR job."queuedAt" < ${cursorAt}
        OR (job."queuedAt" = ${cursorAt} AND job."id" < ${cursorId})
      )
    ORDER BY job."queuedAt" DESC, job."id" DESC
    LIMIT ${limit + 1}
  `;

  const hasNextPage = rows.length > limit;
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: visible.map(mapJobSummary),
    pageInfo: {
      hasNextPage,
      nextCursor:
        hasNextPage && last
          ? encodeDateCursor(last.queuedAt, last.id)
          : null,
    },
  };
}

export async function getExecutionJob(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  jobId: string
): Promise<ExecutionJobDtoV1 | null> {
  const organizationId = requireText(actor.organizationId, 'organizationId');
  const normalizedJobId = requireText(jobId, 'jobId');
  const jobs = await prisma.$queryRaw<ExecutionJobRecord[]>`
    SELECT
      "id", "organizationId", "teamTaskId",
      "originRoomId", "originRoomMessageId", "kind", "status",
      "priority", "specJson", "requirementsJson",
      "contextManifestJson", "selectionJson", "requestedRuntimeId",
      "selectedRuntimeId", "selectionReason", "selectedAt",
      "maxAttempts", "deadlineAt", "queuedAt", "startedAt",
      "finishedAt", "cancelRequestedAt", "resultJson", "errorJson",
      "revision", "createdAt", "updatedAt"
    FROM "ExecutionJob"
    WHERE "id" = ${normalizedJobId}
      AND "organizationId" = ${organizationId}
    LIMIT 1
  `;
  const job = jobs[0];
  if (!job) return null;

  const attempts = await prisma.$queryRaw<ExecutionAttemptRecord[]>`
    SELECT
      "id", "jobId", "runtimeId", "number", "status",
      "generation", "leaseOwnerId", "leaseExpiresAt",
      "lastHeartbeatAt", "runtimeRunId", "checkpointJson",
      "resultJson", "errorJson", "startedAt", "finishedAt",
      "createdAt", "updatedAt"
    FROM "ExecutionAttempt"
    WHERE "jobId" = ${normalizedJobId}
      AND "organizationId" = ${organizationId}
    ORDER BY "number" ASC
  `;

  return mapExecutionJob(job, attempts);
}

export async function getExecutionJobDetail(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  jobId: string
): Promise<ExecutionJobDetailV1 | null> {
  const job = await getExecutionJob(actor, jobId);
  if (!job) return null;
  const [events, artifacts, inputRequests, pendingInputRequests] = await Promise.all([
    listExecutionEvents(actor, job.id),
    listExecutionArtifacts(actor, job.id),
    listExecutionInputRequests(actor, job.id),
    listExecutionInputRequests(actor, job.id, {
      limit: MAX_PAGE_LIMIT,
      status: 'pending',
    }),
  ]);
  const visibleInputIds = new Set(inputRequests.items.map(({ id }) => id));
  const mergedInputRequests = pendingInputRequests.items.length === 0
    ? inputRequests
    : {
        items: [
          ...pendingInputRequests.items.filter(({ id }) => !visibleInputIds.has(id)),
          ...inputRequests.items,
        ],
        pageInfo: inputRequests.pageInfo,
      };
  return {
    schemaVersion: 1,
    job,
    events,
    artifacts,
    inputRequests: mergedInputRequests,
    completion: projectExecutionCompletion(job),
  };
}

export async function listExecutionEvents(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  jobId: string,
  input: ListExecutionEventsInput = {}
): Promise<{ items: ExecutionEventReadDtoV1[]; pageInfo: ExecutionPageInfoV1 }> {
  const organizationId = requireText(actor.organizationId, 'organizationId');
  const normalizedJobId = requireText(jobId, 'jobId');
  const attemptId = readOptionalText(input.attemptId, 'attemptId');
  const afterSequence = readAfterSequence(input.afterSequence);
  const limit = readLimit(input.limit);
  const rows = await prisma.$queryRaw<ExecutionEventReadRecord[]>`
    SELECT event."id", event."jobId", event."attemptId",
      event."sequence", event."type", event."source",
      event."runtimeEventId", event."payloadJson", event."occurredAt",
      event."createdAt"
    FROM "ExecutionEvent" AS event
    INNER JOIN "ExecutionJob" AS job
      ON job."id" = event."jobId"
      AND job."organizationId" = event."organizationId"
    WHERE event."organizationId" = ${organizationId}
      AND event."jobId" = ${normalizedJobId}
      AND (${attemptId} IS NULL OR event."attemptId" = ${attemptId})
      AND event."sequence" > ${afterSequence}
    ORDER BY event."sequence" ASC
    LIMIT ${limit + 1}
  `;
  const hasNextPage = rows.length > limit;
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: visible.map(mapEvent),
    pageInfo: {
      hasNextPage,
      nextCursor: hasNextPage && last ? String(last.sequence) : null,
    },
  };
}

export async function listExecutionLogs(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  jobId: string,
  input: ListExecutionLogsInput = {}
): Promise<{ items: ExecutionLogReadDtoV1[]; pageInfo: ExecutionPageInfoV1 }> {
  const organizationId = requireText(actor.organizationId, 'organizationId');
  const normalizedJobId = requireText(jobId, 'jobId');
  const attemptId = readOptionalText(input.attemptId, 'attemptId');
  const afterSequence = readAfterSequence(input.afterSequence);
  const limit = readLimit(input.limit);
  const rows = await prisma.$queryRaw<ExecutionEventReadRecord[]>`
    SELECT event."id", event."jobId", event."attemptId",
      event."sequence", event."type", event."source",
      event."runtimeEventId", event."payloadJson", event."occurredAt",
      event."createdAt"
    FROM "ExecutionEvent" AS event
    INNER JOIN "ExecutionJob" AS job
      ON job."id" = event."jobId"
      AND job."organizationId" = event."organizationId"
    WHERE event."organizationId" = ${organizationId}
      AND event."jobId" = ${normalizedJobId}
      AND event."type" IN ('text-delta', 'progress')
      AND (${attemptId} IS NULL OR event."attemptId" = ${attemptId})
      AND event."sequence" > ${afterSequence}
    ORDER BY event."sequence" ASC
    LIMIT ${limit + 1}
  `;
  const hasNextPage = rows.length > limit;
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: visible.map(mapLog),
    pageInfo: {
      hasNextPage,
      nextCursor: hasNextPage && last ? String(last.sequence) : null,
    },
  };
}

export async function listExecutionArtifacts(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  jobId: string,
  input: ListExecutionArtifactsInput = {}
): Promise<{ items: ExecutionArtifactReadDtoV1[]; pageInfo: ExecutionPageInfoV1 }> {
  const organizationId = requireText(actor.organizationId, 'organizationId');
  const normalizedJobId = requireText(jobId, 'jobId');
  const attemptId = readOptionalText(input.attemptId, 'attemptId');
  const limit = readLimit(input.limit);
  const cursor = decodeDateCursor(input.cursor);
  const cursorAt = cursor?.at ?? null;
  const cursorId = cursor?.id ?? null;
  const rows = await prisma.$queryRaw<ExecutionArtifactReadRecord[]>`
    SELECT artifact."id", artifact."jobId", artifact."attemptId",
      artifact."kind", artifact."name", artifact."storageUri",
      artifact."payloadJson", artifact."mimeType", artifact."sizeBytes",
      artifact."sha256", artifact."metadataJson", artifact."createdAt"
    FROM "ExecutionArtifact" AS artifact
    INNER JOIN "ExecutionJob" AS job
      ON job."id" = artifact."jobId"
      AND job."organizationId" = artifact."organizationId"
    WHERE artifact."organizationId" = ${organizationId}
      AND artifact."jobId" = ${normalizedJobId}
      AND (${attemptId} IS NULL OR artifact."attemptId" = ${attemptId})
      AND (
        ${cursorAt} IS NULL
        OR artifact."createdAt" > ${cursorAt}
        OR (artifact."createdAt" = ${cursorAt} AND artifact."id" > ${cursorId})
      )
    ORDER BY artifact."createdAt" ASC, artifact."id" ASC
    LIMIT ${limit + 1}
  `;
  const hasNextPage = rows.length > limit;
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: visible.map(mapArtifactMetadata),
    pageInfo: {
      hasNextPage,
      nextCursor:
        hasNextPage && last
          ? encodeDateCursor(last.createdAt, last.id)
          : null,
    },
  };
}

export async function getExecutionArtifact(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  jobId: string,
  artifactId: string
): Promise<ExecutionArtifactContentV1 | null> {
  const organizationId = requireText(actor.organizationId, 'organizationId');
  const normalizedJobId = requireText(jobId, 'jobId');
  const normalizedArtifactId = requireText(artifactId, 'artifactId');
  const rows = await prisma.$queryRaw<ExecutionArtifactReadRecord[]>`
    SELECT artifact."id", artifact."jobId", artifact."attemptId",
      artifact."kind", artifact."name", artifact."storageUri",
      artifact."payloadJson", artifact."mimeType", artifact."sizeBytes",
      artifact."sha256", artifact."metadataJson", artifact."createdAt"
    FROM "ExecutionArtifact" AS artifact
    INNER JOIN "ExecutionJob" AS job
      ON job."id" = artifact."jobId"
      AND job."organizationId" = artifact."organizationId"
    WHERE artifact."organizationId" = ${organizationId}
      AND artifact."jobId" = ${normalizedJobId}
      AND artifact."id" = ${normalizedArtifactId}
    LIMIT 1
  `;
  const record = rows[0];
  if (!record) return null;
  const artifact = mapArtifactMetadata(record);
  return {
    schemaVersion: 1,
    artifact,
    content: artifact.contentAvailable
      ? parseJsonValue(record.payloadJson).value
      : null,
  };
}

export async function listExecutionInputRequests(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  jobId: string,
  input: ListExecutionInputRequestsInput = {}
): Promise<{ items: ExecutionInputRequestDtoV1[]; pageInfo: ExecutionPageInfoV1 }> {
  const organizationId = requireText(actor.organizationId, 'organizationId');
  const normalizedJobId = requireText(jobId, 'jobId');
  const limit = readLimit(input.limit);
  const status = readOptionalInputStatus(input.status);
  const cursor = decodeDateCursor(input.cursor);
  const cursorAt = cursor ? new Date(cursor.at) : null;
  const cursorId = cursor?.id ?? null;
  const rows = await prisma.$queryRaw<ExecutionInputRequestRecord[]>`
    SELECT request."id", request."jobId", request."attemptId",
      request."requestKey", request."prompt", request."schemaJson",
      request."responseJson", request."responseId", request."status",
      request."requestedAt",
      request."respondedAt", request."respondedById", request."revision",
      request."createdAt", request."updatedAt"
    FROM "ExecutionInputRequest" AS request
    INNER JOIN "ExecutionJob" AS job
      ON job."id" = request."jobId"
      AND job."organizationId" = request."organizationId"
    WHERE request."organizationId" = ${organizationId}
      AND request."jobId" = ${normalizedJobId}
      AND (${status} IS NULL OR request."status" = ${status})
      AND (
        ${cursorAt} IS NULL
        OR request."requestedAt" > ${cursorAt}
        OR (request."requestedAt" = ${cursorAt} AND request."id" > ${cursorId})
      )
    ORDER BY request."requestedAt" ASC, request."id" ASC
    LIMIT ${limit + 1}
  `;
  const hasNextPage = rows.length > limit;
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: visible.map(mapInputRequest),
    pageInfo: {
      hasNextPage,
      nextCursor:
        hasNextPage && last
          ? encodeDateCursor(last.requestedAt, last.id)
          : null,
    },
  };
}

/**
 * Stable, organization-scoped seam for completion outbox publishers. It is a
 * pure projection: this slice deliberately does not enqueue Room messages.
 */
export async function getExecutionCompletionProjection(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  jobId: string
): Promise<ExecutionCompletionProjectionV1 | null> {
  const job = await getExecutionJob(actor, jobId);
  return job ? projectExecutionCompletion(job) : null;
}

export async function requireExecutionJob(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  jobId: string
) {
  const job = await getExecutionJob(actor, jobId);
  if (!job) throw new NotFoundError('Execution job not found.');
  return job;
}

function projectExecutionCompletion(
  job: ExecutionJobDtoV1
): ExecutionCompletionProjectionV1 | null {
  if (
    job.status !== 'cancelled' &&
    job.status !== 'failed' &&
    job.status !== 'succeeded'
  ) {
    return null;
  }
  const attempt = [...job.attempts]
    .reverse()
    .find((candidate) =>
      ['cancelled', 'failed', 'succeeded'].includes(candidate.status)
    ) ?? null;
  return {
    schemaVersion: 1,
    projection: 'execution-job-completed',
    jobId: job.id,
    organizationId: job.organizationId,
    teamTaskId: job.teamTaskId,
    status: job.status,
    revision: job.revision,
    result: job.result,
    error: job.error,
    finishedAt: job.finishedAt,
    attempt,
  };
}

function mapJobSummary(row: ExecutionJobSummaryRecord): ExecutionJobSummaryV1 {
  const spec = safeJsonParse<unknown>(row.specJson, null);
  const goal = isRecord(spec) && typeof spec.goal === 'string'
    ? spec.goal.trim()
    : '';
  if (!isExecutionJobStatusV1(row.status)) {
    throw new Error('Stored execution job status is invalid.');
  }
  if (!EXECUTION_KINDS.includes(row.kind as RuntimeExecutionKindV1)) {
    throw new Error('Stored execution job kind is invalid.');
  }
  return {
    schemaVersion: 1,
    id: row.id,
    teamTaskId: row.teamTaskId,
    goal: goal || 'Untitled execution',
    kind: row.kind as RuntimeExecutionKindV1,
    status: row.status,
    priority: Number(row.priority),
    selectedRuntimeId: row.selectedRuntimeId,
    selectionReason: row.selectionReason,
    attemptCount: Number(row.attemptCount),
    maxAttempts: Number(row.maxAttempts),
    revision: Number(row.revision),
    queuedAt: toRequiredIso(row.queuedAt),
    startedAt: toIso(row.startedAt),
    finishedAt: toIso(row.finishedAt),
    updatedAt: toRequiredIso(row.updatedAt),
  };
}

function mapEvent(row: ExecutionEventReadRecord): ExecutionEventReadDtoV1 {
  const parsed = parseJsonValue(row.payloadJson);
  return {
    schemaVersion: 1,
    id: row.id,
    jobId: row.jobId,
    attemptId: row.attemptId,
    sequence: Number(row.sequence),
    type: row.type,
    source: row.source,
    runtimeEventId: row.runtimeEventId,
    payload: parsed.value,
    payloadValid: parsed.valid,
    occurredAt: toRequiredIso(row.occurredAt),
    createdAt: toRequiredIso(row.createdAt),
  };
}

function mapLog(row: ExecutionEventReadRecord): ExecutionLogReadDtoV1 {
  const type = row.type as ExecutionLogTypeV1;
  const payload = projectLogPayload(type, row.payloadJson);
  return {
    schemaVersion: 1,
    id: row.id,
    jobId: row.jobId,
    attemptId: row.attemptId,
    sequence: Number(row.sequence),
    type,
    source: row.source,
    runtimeEventId: row.runtimeEventId,
    text: payload.text,
    percent: payload.percent,
    payloadValid: payload.valid,
    occurredAt: toRequiredIso(row.occurredAt),
    createdAt: toRequiredIso(row.createdAt),
  };
}

function projectLogPayload(
  type: ExecutionLogTypeV1,
  raw: string
): { valid: boolean; text: string | null; percent: number | null } {
  const parsed = parseJsonValue(raw);
  if (!parsed.valid || !isRecord(parsed.value)) {
    return { valid: false, text: null, percent: null };
  }

  if (type === 'text-delta') {
    return typeof parsed.value.text === 'string'
      ? { valid: true, text: parsed.value.text, percent: null }
      : { valid: false, text: null, percent: null };
  }

  const percent = parsed.value.percent;
  if (
    typeof parsed.value.message !== 'string' ||
    (percent !== undefined &&
      (typeof percent !== 'number' ||
        !Number.isFinite(percent) ||
        percent < 0 ||
        percent > 100))
  ) {
    return { valid: false, text: null, percent: null };
  }
  return {
    valid: true,
    text: parsed.value.message,
    percent: typeof percent === 'number' ? percent : null,
  };
}

function mapArtifactMetadata(
  row: ExecutionArtifactReadRecord
): ExecutionArtifactReadDtoV1 {
  const metadata = parseJsonValue(
    row.metadataJson.length <= MAX_ARTIFACT_METADATA_JSON_BYTES
      ? row.metadataJson
      : null
  );
  const content = readSafeArtifactContent(row);
  return {
    schemaVersion: 1,
    id: row.id,
    jobId: row.jobId,
    attemptId: row.attemptId,
    kind: row.kind,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    sha256: row.sha256,
    storage: row.payloadJson !== null
      ? 'inline'
      : row.storageUri !== null
        ? 'external'
        : 'missing',
    externalUrl: safeExternalArtifactUrl(row.storageUri),
    metadata: metadata.value,
    metadataValid: metadata.valid,
    contentAvailable: content.available,
    contentUnavailableReason: content.reason,
    createdAt: toRequiredIso(row.createdAt),
  };
}

function mapInputRequest(
  row: ExecutionInputRequestRecord
): ExecutionInputRequestDtoV1 {
  if (!EXECUTION_INPUT_REQUEST_STATUSES_V1.includes(row.status as never)) {
    throw new Error('Stored execution input request status is invalid.');
  }
  const inputSchema = parseJsonValue(row.schemaJson);
  if (!inputSchema.valid || inputSchema.value === null) {
    throw new Error('Stored execution input request schema is invalid.');
  }
  const response = row.responseJson === null
    ? { valid: true, value: null }
    : parseJsonValue(row.responseJson);
  if (!response.valid) {
    throw new Error('Stored execution input response is invalid.');
  }
  return {
    schemaVersion: 1,
    id: row.id,
    jobId: row.jobId,
    attemptId: row.attemptId,
    requestKey: row.requestKey,
    prompt: row.prompt,
    inputSchema: inputSchema.value,
    response: response.value,
    responseId: row.responseId,
    status: row.status as ExecutionInputRequestStatusV1,
    requestedAt: toRequiredIso(row.requestedAt),
    respondedAt: toIso(row.respondedAt),
    respondedById: row.respondedById,
    revision: Number(row.revision),
    createdAt: toRequiredIso(row.createdAt),
    updatedAt: toRequiredIso(row.updatedAt),
  };
}

function readSafeArtifactContent(row: ExecutionArtifactReadRecord): {
  available: boolean;
  reason: string | null;
  value: ExecutionJsonValueV1 | null;
} {
  if (row.payloadJson === null) {
    return {
      available: false,
      reason: row.storageUri ? 'external-content-not-fetched' : 'content-missing',
      value: null,
    };
  }
  if (Buffer.byteLength(row.payloadJson, 'utf8') > MAX_INLINE_ARTIFACT_JSON_BYTES) {
    return { available: false, reason: 'inline-content-too-large', value: null };
  }
  const parsed = parseJsonValue(row.payloadJson);
  if (!parsed.valid) {
    return { available: false, reason: 'invalid-inline-json', value: null };
  }
  return { available: true, reason: null, value: parsed.value };
}

function parseJsonValue(raw: string | null): {
  valid: boolean;
  value: ExecutionJsonValueV1 | null;
} {
  if (raw === null) return { valid: false, value: null };
  const parsed = safeJsonParse<ExecutionJsonValueV1 | InvalidJson>(
    raw,
    INVALID_JSON,
    (value): value is ExecutionJsonValueV1 | InvalidJson =>
      value === INVALID_JSON || isExecutionJsonValueV1(value)
  );
  return parsed === INVALID_JSON
    ? { valid: false, value: null }
    : { valid: true, value: parsed };
}

function safeExternalArtifactUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !url.hostname
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function readLimit(value: number | undefined) {
  const limit = value ?? DEFAULT_PAGE_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new ValidationError(
      `limit must be an integer from 1 to ${MAX_PAGE_LIMIT}.`
    );
  }
  return limit;
}

function readAfterSequence(value: number | null | undefined) {
  const sequence = value ?? 0;
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new ValidationError('afterSequence must be a non-negative integer.');
  }
  return sequence;
}

function readOptionalStatus(value: unknown): ExecutionJobStatusV1 | null {
  if (value === undefined || value === null || value === '') return null;
  if (!isExecutionJobStatusV1(value)) {
    throw new ValidationError('Invalid execution job status.');
  }
  return value;
}

function readOptionalKind(value: unknown): RuntimeExecutionKindV1 | null {
  if (value === undefined || value === null || value === '') return null;
  if (!EXECUTION_KINDS.includes(value as RuntimeExecutionKindV1)) {
    throw new ValidationError('Invalid execution job kind.');
  }
  return value as RuntimeExecutionKindV1;
}

function readOptionalInputStatus(
  value: unknown
): ExecutionInputRequestStatusV1 | null {
  if (value === undefined || value === null || value === '') return null;
  if (!EXECUTION_INPUT_REQUEST_STATUSES_V1.includes(value as never)) {
    throw new ValidationError('Invalid execution input request status.');
  }
  return value as ExecutionInputRequestStatusV1;
}

function readOptionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireText(value, field);
}

function readOptionalSearch(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new ValidationError('search must be a string.');
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > MAX_EXECUTION_JOB_SEARCH_LENGTH) {
    throw new ValidationError(
      `search must be no longer than ${MAX_EXECUTION_JOB_SEARCH_LENGTH} characters.`
    );
  }
  return normalized;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function encodeDateCursor(value: Date | string, id: string): string {
  return Buffer.from(
    JSON.stringify({ at: toRequiredIso(value), id }),
    'utf8'
  ).toString('base64url');
}

function decodeDateCursor(value: string | null | undefined): DateCursorV1 | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2_048) {
    throw new ValidationError('Invalid pagination cursor.');
  }
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const parsed = safeJsonParse<unknown>(decoded, null);
    if (
      !isRecord(parsed) ||
      typeof parsed.at !== 'string' ||
      typeof parsed.id !== 'string' ||
      !parsed.id.trim()
    ) {
      throw new Error('invalid cursor');
    }
    const at = new Date(parsed.at);
    if (Number.isNaN(at.valueOf())) throw new Error('invalid cursor');
    return { at: at.toISOString(), id: parsed.id };
  } catch {
    throw new ValidationError('Invalid pagination cursor.');
  }
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function toRequiredIso(value: Date | string): string {
  const iso = toIso(value);
  if (!iso) throw new Error('Stored execution timestamp is invalid.');
  return iso;
}
