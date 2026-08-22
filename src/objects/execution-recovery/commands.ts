import { randomUUID } from 'node:crypto';

import { ConflictError, NotFoundError, ValidationError } from '@/framework/resilience';
import { prisma } from '@/lib/db/prisma';

import {
  isExecutionRecoveryActionV1,
  isExecutionRecoveryClassificationV1,
  isExecutionRecoveryStageV1,
  mapExecutionRecoveryIncidentV1,
  type ExecutionRecoveryActionV1,
  type ExecutionRecoveryClassificationV1,
  type ExecutionRecoveryIncidentDtoV1,
  type ExecutionRecoveryIncidentRecordV1,
  type ExecutionRecoveryResolutionV1,
  type ExecutionRecoveryStageV1,
} from './schema';
import {
  requireExecutionRecoveryOperator,
  type ExecutionRecoveryActorV1,
} from './queries';

export type QuarantineExecutionWorkspaceRecoveryInputV1 = {
  attemptId: string;
  workerId: string;
  generation: number;
  stage: ExecutionRecoveryStageV1;
  reasonCode: string;
  classification: ExecutionRecoveryClassificationV1;
  discardable: boolean;
};

export type RequestExecutionRecoveryActionInputV1 = {
  incidentId: string;
  action: ExecutionRecoveryActionV1;
  expectedRevision: number;
};

export type ResolveExecutionRecoveryInputV1 = {
  incidentId: string;
  attemptId: string;
  resolution: ExecutionRecoveryResolutionV1;
};

type QuarantineAttemptRow = {
  id: string;
  jobId: string;
  runtimeId: string | null;
  capacityReserved: boolean | number;
};

type ActionIncidentRow = ExecutionRecoveryIncidentRecordV1 & {
  attemptStatus: string;
  jobStatus: string;
  capacityReserved: boolean | number;
};

/** Persists only safe codes; paths, credentials, and Git output stay private. */
export async function quarantineExecutionWorkspaceRecovery(
  actor: Pick<ExecutionRecoveryActorV1, 'organizationId'>,
  input: QuarantineExecutionWorkspaceRecoveryInputV1
): Promise<ExecutionRecoveryIncidentDtoV1> {
  const organizationId = requireText(actor.organizationId, 'organizationId');
  const normalized = normalizeQuarantineInput(input);
  const now = new Date();

  return prisma.$transaction(async (db) => {
    const replay = await findIncidentByGeneration(
      db,
      organizationId,
      normalized.attemptId,
      normalized.generation
    );
    if (replay) {
      if (
        replay.status === 'open' &&
        replay.stage === normalized.stage &&
        replay.reasonCode === normalized.reasonCode &&
        replay.classification === normalized.classification &&
        Boolean(replay.discardable) === normalized.discardable
      ) {
        return mapExecutionRecoveryIncidentV1(replay);
      }
      throw new ConflictError(
        'Execution workspace recovery is already quarantined or resolved.'
      );
    }

    const rows = await db.$queryRaw<QuarantineAttemptRow[]>`
      SELECT "id", "jobId", "runtimeId", "capacityReserved"
      FROM "ExecutionAttempt"
      WHERE "id" = ${normalized.attemptId}
        AND "organizationId" = ${organizationId}
      LIMIT 1
    `;
    const attempt = rows[0];
    if (!attempt) throw new NotFoundError('Execution attempt not found.');

    const incidentId = randomUUID();
    const publicError = JSON.stringify({
      code: 'workspace-recovery-quarantined',
      incidentId,
      reasonCode: normalized.reasonCode,
    });
    const capacityWasReserved = Boolean(attempt.capacityReserved);
    const quarantined = await db.$executeRaw`
      UPDATE "ExecutionAttempt"
      SET "status" = 'quarantined', "capacityReserved" = FALSE,
        "leaseOwnerId" = NULL, "leaseExpiresAt" = NULL,
        "errorJson" = ${publicError}, "updatedAt" = ${now}
      WHERE "id" = ${normalized.attemptId}
        AND "organizationId" = ${organizationId}
        AND "status" = 'running'
        AND "generation" = ${normalized.generation}
        AND "leaseOwnerId" = ${normalized.workerId}
        AND "leaseExpiresAt" IS NOT NULL
        AND "leaseExpiresAt" > ${now}
        AND "capacityReserved" = ${capacityWasReserved}
        AND EXISTS (
          SELECT 1 FROM "ExecutionJob" AS job
          WHERE job."id" = "ExecutionAttempt"."jobId"
            AND job."organizationId" = ${organizationId}
            AND job."status" IN ('running', 'cancel_requested')
        )
    `;
    if (quarantined !== 1) throw new ConflictError(STALE_LEASE);

    if (capacityWasReserved) {
      if (!attempt.runtimeId) {
        throw new ConflictError('A reserved attempt must have a runtime.');
      }
      const released = await db.$executeRaw`
        UPDATE "ExecutionRuntime"
        SET "capacityUsed" = "capacityUsed" - 1,
          "capacityUpdatedAt" = ${now}, "updatedAt" = ${now}
        WHERE "id" = ${attempt.runtimeId}
          AND "organizationId" = ${organizationId}
          AND "capacityUsed" > 0
      `;
      if (released !== 1) {
        throw new ConflictError(
          'Execution runtime capacity could not be released during quarantine.'
        );
      }
    }

    const blocked = await db.$executeRaw`
      UPDATE "ExecutionJob"
      SET "status" = 'blocked', "errorJson" = ${publicError},
        "revision" = "revision" + 1, "updatedAt" = ${now}
      WHERE "id" = ${attempt.jobId}
        AND "organizationId" = ${organizationId}
        AND "status" IN ('running', 'cancel_requested')
    `;
    if (blocked !== 1) {
      throw new ConflictError('Execution job changed during quarantine.');
    }

    // A requested retry that encounters another unsafe state is complete as
    // an audit fact, but not successful. The new generation owns a new open
    // incident instead of mutating the prior evidence.
    await db.$executeRaw`
      UPDATE "ExecutionRecoveryIncident"
      SET "status" = 'resolved', "resolution" = 'superseded',
        "resolvedAt" = ${now}, "revision" = "revision" + 1,
        "updatedAt" = ${now}
      WHERE "attemptId" = ${normalized.attemptId}
        AND "organizationId" = ${organizationId}
        AND "status" = 'action_requested'
        AND "requestedAction" = 'retry'
    `;

    await db.$executeRaw`
      INSERT INTO "ExecutionRecoveryIncident" (
        "id", "organizationId", "jobId", "attemptId",
        "generation", "stage", "reasonCode", "classification",
        "discardable", "status", "revision", "createdAt", "updatedAt"
      ) VALUES (
        ${incidentId}, ${organizationId}, ${attempt.jobId},
        ${normalized.attemptId}, ${normalized.generation}, ${normalized.stage},
        ${normalized.reasonCode}, ${normalized.classification},
        ${normalized.discardable}, 'open', 1, ${now}, ${now}
      )
    `;
    return requireIncidentByGeneration(
      db,
      organizationId,
      normalized.attemptId,
      normalized.generation
    );
  });
}

/** Records an explicit operator request and queues the trusted daemon action. */
export async function requestExecutionRecoveryAction(
  actor: ExecutionRecoveryActorV1,
  jobId: string,
  input: RequestExecutionRecoveryActionInputV1
): Promise<ExecutionRecoveryIncidentDtoV1> {
  const organizationId = requireText(actor.organizationId, 'organizationId');
  const normalizedJobId = requireText(jobId, 'jobId');
  const normalized = normalizeActionInput(input);
  await requireExecutionRecoveryOperator(actor);
  const now = new Date();

  return prisma.$transaction(async (db) => {
    const rows = await db.$queryRaw<ActionIncidentRow[]>`
      SELECT incident."id", incident."jobId", incident."attemptId",
        incident."generation", incident."stage", incident."reasonCode",
        incident."classification", incident."discardable",
        incident."status", incident."requestedAction",
        incident."resolution", incident."actionRequestedAt",
        incident."resolvedAt", incident."revision",
        incident."createdAt", incident."updatedAt",
        attempt."status" AS "attemptStatus",
        attempt."capacityReserved", job."status" AS "jobStatus"
      FROM "ExecutionRecoveryIncident" AS incident
      INNER JOIN "ExecutionAttempt" AS attempt
        ON attempt."id" = incident."attemptId"
        AND attempt."organizationId" = incident."organizationId"
      INNER JOIN "ExecutionJob" AS job
        ON job."id" = incident."jobId"
        AND job."organizationId" = incident."organizationId"
      WHERE incident."id" = ${normalized.incidentId}
        AND incident."jobId" = ${normalizedJobId}
        AND incident."organizationId" = ${organizationId}
      LIMIT 1
    `;
    const incident = rows[0];
    if (!incident) throw new NotFoundError('Execution recovery incident not found.');
    if (
      incident.status === 'action_requested' &&
      incident.requestedAction === normalized.action &&
      (incident.revision === normalized.expectedRevision ||
        incident.revision === normalized.expectedRevision + 1)
    ) {
      return mapExecutionRecoveryIncidentV1(incident);
    }
    if (incident.revision !== normalized.expectedRevision) {
      throw new ConflictError(
        'Execution recovery incident changed before the action was applied.'
      );
    }
    if (incident.status !== 'open') {
      throw new ConflictError('Execution recovery incident is already resolved.');
    }
    if (normalized.action === 'discard' && !Boolean(incident.discardable)) {
      throw new ConflictError(
        'This workspace cannot be safely discarded automatically.'
      );
    }
    if (
      incident.attemptStatus !== 'quarantined' ||
      incident.jobStatus !== 'blocked' ||
      Boolean(incident.capacityReserved)
    ) {
      throw new ConflictError(
        'Execution recovery state changed before the action was applied.'
      );
    }

    const attemptQueued = await db.$executeRaw`
      UPDATE "ExecutionAttempt"
      SET "status" = 'pending', "capacityReserved" = FALSE,
        "leaseOwnerId" = NULL, "leaseExpiresAt" = NULL,
        "errorJson" = NULL, "finishedAt" = NULL, "updatedAt" = ${now}
      WHERE "id" = ${incident.attemptId}
        AND "organizationId" = ${organizationId}
        AND "status" = 'quarantined'
        AND "generation" = ${incident.generation}
        AND "capacityReserved" = FALSE
    `;
    const jobQueued = await db.$executeRaw`
      UPDATE "ExecutionJob"
      SET "status" = 'queued', "finishedAt" = NULL,
        "errorJson" = NULL, "revision" = "revision" + 1,
        "updatedAt" = ${now}
      WHERE "id" = ${incident.jobId}
        AND "organizationId" = ${organizationId}
        AND "status" = 'blocked'
    `;
    const requested = await db.$executeRaw`
      UPDATE "ExecutionRecoveryIncident"
      SET "status" = 'action_requested',
        "requestedAction" = ${normalized.action},
        "actionRequestedAt" = ${now},
        "actionRequestedById" = ${requireText(actor.userId, 'userId')},
        "revision" = "revision" + 1, "updatedAt" = ${now}
      WHERE "id" = ${incident.id}
        AND "organizationId" = ${organizationId}
        AND "status" = 'open'
        AND "revision" = ${normalized.expectedRevision}
    `;
    if (attemptQueued !== 1 || jobQueued !== 1 || requested !== 1) {
      throw new ConflictError(
        'Execution recovery state changed before the action was applied.'
      );
    }
    return requireIncidentByGeneration(
      db,
      organizationId,
      incident.attemptId,
      incident.generation
    );
  });
}

/** Marks the operator action resolved only after the trusted daemon succeeds. */
export async function resolveExecutionRecovery(
  actor: Pick<ExecutionRecoveryActorV1, 'organizationId'>,
  input: ResolveExecutionRecoveryInputV1
): Promise<'resolved' | 'fenced'> {
  const organizationId = requireText(actor.organizationId, 'organizationId');
  const incidentId = requireText(input.incidentId, 'incidentId');
  const attemptId = requireText(input.attemptId, 'attemptId');
  if (!['retried', 'discarded', 'superseded'].includes(input.resolution)) {
    throw new ValidationError('resolution is invalid.');
  }
  const expectedAction =
    input.resolution === 'discarded' ? 'discard' : 'retry';
  const now = new Date();
  const resolved = await prisma.$executeRaw`
    UPDATE "ExecutionRecoveryIncident"
    SET "status" = 'resolved', "resolution" = ${input.resolution},
      "resolvedAt" = ${now}, "revision" = "revision" + 1,
      "updatedAt" = ${now}
    WHERE "id" = ${incidentId}
      AND "attemptId" = ${attemptId}
      AND "organizationId" = ${organizationId}
      AND "status" = 'action_requested'
      AND "requestedAction" = ${expectedAction}
  `;
  return resolved === 1 ? 'resolved' : 'fenced';
}

function normalizeQuarantineInput(
  input: QuarantineExecutionWorkspaceRecoveryInputV1
): QuarantineExecutionWorkspaceRecoveryInputV1 {
  const attemptId = requireText(input.attemptId, 'attemptId');
  const workerId = requireText(input.workerId, 'workerId');
  if (!Number.isInteger(input.generation) || input.generation < 1) {
    throw new ValidationError('generation must be a positive integer.');
  }
  if (!isExecutionRecoveryStageV1(input.stage)) {
    throw new ValidationError('stage is invalid.');
  }
  if (!isExecutionRecoveryClassificationV1(input.classification)) {
    throw new ValidationError('classification is invalid.');
  }
  if (typeof input.discardable !== 'boolean') {
    throw new ValidationError('discardable must be a boolean.');
  }
  const reasonCode = requireText(input.reasonCode, 'reasonCode');
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(reasonCode)) {
    throw new ValidationError('reasonCode must be a stable kebab-case code.');
  }
  return { ...input, attemptId, workerId, reasonCode };
}

function normalizeActionInput(
  input: RequestExecutionRecoveryActionInputV1
): RequestExecutionRecoveryActionInputV1 {
  const incidentId = requireText(input.incidentId, 'incidentId');
  if (!isExecutionRecoveryActionV1(input.action)) {
    throw new ValidationError('action must be retry or discard.');
  }
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new ValidationError('expectedRevision must be a positive integer.');
  }
  return { ...input, incidentId };
}

type RawDb = {
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

async function findIncidentByGeneration(
  db: RawDb,
  organizationId: string,
  attemptId: string,
  generation: number
): Promise<ExecutionRecoveryIncidentRecordV1 | null> {
  const rows = await db.$queryRaw<ExecutionRecoveryIncidentRecordV1[]>`
    SELECT "id", "jobId", "attemptId", "generation",
      "stage", "reasonCode", "classification", "discardable",
      "status", "requestedAction", "resolution",
      "actionRequestedAt", "resolvedAt", "revision",
      "createdAt", "updatedAt"
    FROM "ExecutionRecoveryIncident"
    WHERE "organizationId" = ${organizationId}
      AND "attemptId" = ${attemptId}
      AND "generation" = ${generation}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function requireIncidentByGeneration(
  db: RawDb,
  organizationId: string,
  attemptId: string,
  generation: number
): Promise<ExecutionRecoveryIncidentDtoV1> {
  const incident = await findIncidentByGeneration(
    db,
    organizationId,
    attemptId,
    generation
  );
  if (!incident) throw new Error('Execution recovery incident was not stored.');
  return mapExecutionRecoveryIncidentV1(incident);
}

const STALE_LEASE =
  'Execution attempt lease is stale, expired, or owned by another worker.';

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} is required.`);
  }
  return value.trim();
}
