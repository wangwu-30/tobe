import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/framework/resilience/app-error';
import { isRecord } from '@/framework/resilience/safe-data';
import { prisma } from '@/lib/db/prisma';

import { getExecutionJob, listExecutionInputRequests } from './queries';
import type {
  ExecutionInputRequestDtoV1,
  ExecutionJobActor,
} from './queries';
import { enqueueExecutionRoomProjection } from './room-projection';
import { isExecutionJsonValueV1, type ExecutionJsonValueV1 } from './schema';

export type AnswerExecutionInputRequestInput = {
  expectedInputRevision: number;
  expectedJobRevision: number;
  /** Stable identity for this immutable answer receipt. */
  responseId?: string;
  response: ExecutionJsonValueV1;
};

export type AnswerExecutionInputRequestResultV1 = {
  schemaVersion: 1;
  inputRequest: ExecutionInputRequestDtoV1;
  job: NonNullable<Awaited<ReturnType<typeof getExecutionJob>>>;
  resume: {
    attemptId: string;
    generation: number;
    state: 'queued';
  };
};

type InputControlRow = {
  id: string;
  jobId: string;
  attemptId: string;
  status: string;
  revision: number;
  responseJson: string | null;
  responseId: string | null;
  respondedById: string | null;
  jobStatus: string;
  jobRevision: number;
  attemptStatus: string;
  attemptGeneration: number;
};

/**
 * Stores a human answer and returns the suspended attempt to the ordinary
 * dequeue path. The user identity is always taken from the server actor.
 */
export async function answerExecutionInputRequest(
  actor: ExecutionJobActor,
  jobId: string,
  requestId: string,
  input: AnswerExecutionInputRequestInput
): Promise<AnswerExecutionInputRequestResultV1> {
  const organizationId = requireText(actor.organizationId, 'organizationId');
  const userId = requireText(actor.userId, 'userId');
  const normalizedJobId = requireText(jobId, 'jobId');
  const normalizedRequestId = requireText(requestId, 'requestId');
  const expectedJobRevision = readRevision(
    input.expectedJobRevision,
    'expectedJobRevision'
  );
  const expectedInputRevision = readRevision(
    input.expectedInputRevision,
    'expectedInputRevision'
  );
  const responseJson = serializeResponse(input.response);
  const responseId = normalizeResponseId(input.responseId, normalizedRequestId);
  const now = new Date();

  const resume = await prisma.$transaction(async (db) => {
    const rows = await db.$queryRaw<InputControlRow[]>`
      SELECT request."id", request."jobId", request."attemptId",
        request."status", request."revision", request."responseJson",
        request."responseId", request."respondedById",
        job."status" AS "jobStatus",
        job."revision" AS "jobRevision",
        attempt."status" AS "attemptStatus",
        attempt."generation" AS "attemptGeneration"
      FROM "ExecutionInputRequest" AS request
      INNER JOIN "ExecutionJob" AS job
        ON job."id" = request."jobId"
        AND job."organizationId" = request."organizationId"
      INNER JOIN "ExecutionAttempt" AS attempt
        ON attempt."id" = request."attemptId"
        AND attempt."organizationId" = request."organizationId"
      WHERE request."id" = ${normalizedRequestId}
        AND request."jobId" = ${normalizedJobId}
        AND request."organizationId" = ${organizationId}
      LIMIT 1
    `;
    const current = rows[0];
    if (!current) {
      throw new NotFoundError('Execution input request not found.');
    }

    // Exact retries are safe after a successful response. The actor is part
    // of the replay identity so one user cannot impersonate another's answer.
    if (
      current.status === 'answered' &&
      current.revision === expectedInputRevision + 1 &&
      current.responseId === responseId &&
      current.responseJson === responseJson &&
      current.respondedById === userId
    ) {
      return {
        attemptId: current.attemptId,
        generation: Number(current.attemptGeneration),
      };
    }

    if (
      current.status !== 'pending' ||
      Number(current.revision) !== expectedInputRevision ||
      current.jobStatus !== 'waiting_input' ||
      Number(current.jobRevision) !== expectedJobRevision ||
      current.attemptStatus !== 'waiting_input'
    ) {
      throw new ConflictError(
        'Execution input request changed before the answer was accepted.'
      );
    }

    const requestUpdated = await db.$executeRaw`
      UPDATE "ExecutionInputRequest"
      SET
        "responseJson" = ${responseJson},
        "responseId" = ${responseId},
        "status" = 'answered',
        "respondedAt" = ${now},
        "respondedById" = ${userId},
        "revision" = "revision" + 1,
        "updatedAt" = ${now}
      WHERE "id" = ${normalizedRequestId}
        AND "organizationId" = ${organizationId}
        AND "jobId" = ${normalizedJobId}
        AND "status" = 'pending'
        AND "revision" = ${expectedInputRevision}
    `;
    if (requestUpdated !== 1) {
      throw new ConflictError(
        'Execution input request changed before the answer was accepted.'
      );
    }

    const attemptUpdated = await db.$executeRaw`
      UPDATE "ExecutionAttempt"
      SET
        "status" = 'pending',
        "leaseOwnerId" = NULL,
        "leaseExpiresAt" = NULL,
        "updatedAt" = ${now}
      WHERE "id" = ${current.attemptId}
        AND "organizationId" = ${organizationId}
        AND "jobId" = ${normalizedJobId}
        AND "status" = 'waiting_input'
        AND "generation" = ${current.attemptGeneration}
    `;
    if (attemptUpdated !== 1) {
      throw new ConflictError(
        'Execution attempt changed before the answer was accepted.'
      );
    }

    const jobUpdated = await db.$executeRaw`
      UPDATE "ExecutionJob"
      SET
        "status" = 'queued',
        "queuedAt" = ${now},
        "revision" = "revision" + 1,
        "updatedAt" = ${now}
      WHERE "id" = ${normalizedJobId}
        AND "organizationId" = ${organizationId}
        AND "status" = 'waiting_input'
        AND "revision" = ${expectedJobRevision}
    `;
    if (jobUpdated !== 1) {
      throw new ConflictError(
        'Execution job changed before the answer was accepted.'
      );
    }

    await enqueueExecutionRoomProjection(db, {
      organizationId,
      jobId: normalizedJobId,
      requestId: normalizedRequestId,
      type: 'execution.input_answered',
      occurredAt: now,
    });

    return {
      attemptId: current.attemptId,
      generation: Number(current.attemptGeneration),
    };
  });

  const [job, requests] = await Promise.all([
    getExecutionJob(actor, normalizedJobId),
    listExecutionInputRequests(actor, normalizedJobId, { limit: 100 }),
  ]);
  if (!job) throw new NotFoundError('Execution job not found.');
  const inputRequest = requests.items.find(
    (candidate) => candidate.id === normalizedRequestId
  );
  if (!inputRequest) {
    throw new NotFoundError('Execution input request not found.');
  }

  return {
    schemaVersion: 1,
    inputRequest,
    job,
    resume: { ...resume, state: 'queued' },
  };
}

function serializeResponse(value: unknown) {
  if (!isExecutionJsonValueV1(value)) {
    throw new ValidationError('response must be a JSON-compatible value.');
  }
  return JSON.stringify(sortJson(value));
}

function normalizeResponseId(value: unknown, requestId: string): string {
  if (value === undefined) return `response:${requestId}`;
  return requireText(value, 'responseId');
}

function sortJson(value: ExecutionJsonValueV1): ExecutionJsonValueV1 {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child as ExecutionJsonValueV1)])
  );
}

function readRevision(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new ValidationError(`${field} must be a positive integer.`);
  }
  return Number(value);
}

function requireText(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
