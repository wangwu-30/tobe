import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/framework/resilience';
import { prisma } from '@/lib/db/prisma';

import {
  mapExecutionRecoveryIncidentV1,
  type ExecutionRecoveryActionV1,
  type ExecutionRecoveryIncidentDtoV1,
  type ExecutionRecoveryIncidentRecordV1,
} from './schema';

export type ExecutionRecoveryActorV1 = {
  organizationId: string;
  userId?: string;
};

export type RequestedExecutionRecoveryActionV1 = {
  incidentId: string;
  action: ExecutionRecoveryActionV1;
  cancelRequested: boolean;
};

export async function inspectExecutionRecoveryIncidents(
  actor: ExecutionRecoveryActorV1,
  jobId: string
): Promise<{
  current: ExecutionRecoveryIncidentDtoV1 | null;
  items: ExecutionRecoveryIncidentDtoV1[];
}> {
  const organizationId = requireText(actor.organizationId, 'organizationId');
  const normalizedJobId = requireText(jobId, 'jobId');
  await requireExecutionRecoveryOperator(actor);
  const jobs = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "ExecutionJob"
    WHERE "id" = ${normalizedJobId}
      AND "organizationId" = ${organizationId}
    LIMIT 1
  `;
  if (!jobs[0]) throw new NotFoundError('Execution job not found.');

  const rows = await prisma.$queryRaw<ExecutionRecoveryIncidentRecordV1[]>`
    SELECT "id", "jobId", "attemptId", "generation",
      "stage", "reasonCode", "classification", "discardable",
      "status", "requestedAction", "resolution", "actionRequestedAt",
      "actionRequestedById", "resolvedAt", "revision", "createdAt", "updatedAt"
    FROM "ExecutionRecoveryIncident"
    WHERE "organizationId" = ${organizationId}
      AND "jobId" = ${normalizedJobId}
    ORDER BY "createdAt" DESC, "id" DESC
  `;
  const items = rows.map(mapExecutionRecoveryIncidentV1);
  return {
    current:
      items.find((incident) => incident.status !== 'resolved') ?? null,
    items,
  };
}

export async function getRequestedExecutionRecoveryAction(
  actor: Pick<ExecutionRecoveryActorV1, 'organizationId'>,
  attemptId: string
): Promise<RequestedExecutionRecoveryActionV1 | null> {
  const organizationId = requireText(actor.organizationId, 'organizationId');
  const normalizedAttemptId = requireText(attemptId, 'attemptId');
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      requestedAction: string | null;
      cancelRequestedAt: Date | string | null;
    }>
  >`
    SELECT incident."id", incident."requestedAction",
      job."cancelRequestedAt"
    FROM "ExecutionRecoveryIncident" AS incident
    INNER JOIN "ExecutionJob" AS job
      ON job."id" = incident."jobId"
      AND job."organizationId" = incident."organizationId"
    WHERE incident."organizationId" = ${organizationId}
      AND incident."attemptId" = ${normalizedAttemptId}
      AND incident."status" = 'action_requested'
      AND incident."requestedAction" IN ('retry', 'discard')
    ORDER BY incident."createdAt" DESC, incident."id" DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || (row.requestedAction !== 'retry' && row.requestedAction !== 'discard')) {
    return null;
  }
  return {
    incidentId: row.id,
    action: row.requestedAction,
    cancelRequested: row.cancelRequestedAt !== null,
  };
}

export async function requireExecutionRecoveryOperator(
  actor: ExecutionRecoveryActorV1
): Promise<void> {
  const organizationId = requireText(actor.organizationId, 'organizationId');
  const userId = requireText(actor.userId, 'userId');
  const rows = await prisma.$queryRaw<Array<{ role: string }>>`
    SELECT "role" FROM "OrganizationMembership"
    WHERE "organizationId" = ${organizationId}
      AND "userId" = ${userId}
    LIMIT 1
  `;
  if (!rows[0] || !['owner', 'admin'].includes(rows[0].role)) {
    throw new ForbiddenError(
      'Execution recovery requires organization admin access.'
    );
  }
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} is required.`);
  }
  return value.trim();
}
