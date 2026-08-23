import type { RuntimeCandidateV1 } from '@/agent/execution';

import {
  mapExecutionRuntimeCandidateV1,
  mapExecutionRuntimeV1,
  type ExecutionRuntimeMappingOptionsV1,
  type ExecutionRuntimeRow,
  type ExecutionRuntimeV1,
} from './schema';
import { ensureBuiltinExecutionRuntimes } from './registry';

export type ExecutionRuntimeActor = {
  organizationId: string;
};

/**
 * Server-owned runtime facts supplied to the pure runtime matcher. The MVP
 * policy intentionally has no wildcard: only enabled organization rows are
 * allowed, and degraded runtimes remain disabled.
 */
export type ExecutionRuntimeSelectionContextV1 = {
  readonly candidates: readonly RuntimeCandidateV1[];
  readonly organizationPolicy: {
    readonly allowedRuntimeIds: readonly string[];
    readonly allowDegradedRuntimes: false;
  };
};

export async function getExecutionRuntimeV1(
  actor: Pick<ExecutionRuntimeActor, 'organizationId'>,
  runtimeId: string
): Promise<ExecutionRuntimeV1 | null> {
  await ensureBuiltinExecutionRuntimes(actor);
  const { prisma } = await import('@/lib/db/prisma');
  const rows = await prisma.$queryRaw<ExecutionRuntimeRow[]>`
    SELECT
      "id", "organizationId", "key", "name", "driver",
      "version", "endpoint", "enabled", "registrationJson",
      "capabilitiesJson", "healthStatus", "healthJson",
      "lastHeartbeatAt", "capacityTotal", "capacityUsed",
      "capacityJson", "capacityUpdatedAt", "createdAt", "updatedAt"
    FROM "ExecutionRuntime"
    WHERE "id" = ${runtimeId}
      AND "organizationId" = ${actor.organizationId}
    LIMIT 1
  `;

  return rows[0] ? mapExecutionRuntimeV1(rows[0]) : null;
}

export async function listExecutionRuntimesV1(
  actor: Pick<ExecutionRuntimeActor, 'organizationId'>
): Promise<ExecutionRuntimeV1[]> {
  const rows = await listExecutionRuntimeRows(actor);
  return rows.map((row) => mapExecutionRuntimeV1(row));
}

/**
 * Loads one organization-scoped registry snapshot for runtime matching. All
 * rows remain candidates so a disabled runtime still receives an explainable
 * matcher evaluation, while only enabled rows enter the policy allowlist.
 * An organization with no enabled rows therefore receives an empty allowlist
 * and fails closed.
 */
export async function getExecutionRuntimeSelectionContextV1(
  actor: Pick<ExecutionRuntimeActor, 'organizationId'>
): Promise<ExecutionRuntimeSelectionContextV1> {
  const rows = await listExecutionRuntimeRows(actor);
  return deriveExecutionRuntimeSelectionContextV1(actor, rows);
}

export function deriveExecutionRuntimeSelectionContextV1(
  actor: Pick<ExecutionRuntimeActor, 'organizationId'>,
  rows: readonly ExecutionRuntimeRow[],
  mappingOptions: ExecutionRuntimeMappingOptionsV1 = {}
): ExecutionRuntimeSelectionContextV1 {
  const organizationRows = rows.filter(
    (row) => row.organizationId === actor.organizationId
  );

  return {
    candidates: organizationRows.map((row) =>
      mapExecutionRuntimeCandidateV1(row, mappingOptions)
    ),
    organizationPolicy: {
      allowedRuntimeIds: organizationRows
        .filter((row) => mapExecutionRuntimeV1(row, mappingOptions).enabled)
        .map((row) => row.id),
      allowDegradedRuntimes: false,
    },
  };
}

/**
 * Returns a point-in-time matcher snapshot for every runtime registered in
 * the organization. Disabled rows remain present for explainable explicit
 * selection, but their mapper snapshot is always offline with zero capacity.
 */
export async function listRuntimeCandidatesV1(
  actor: Pick<ExecutionRuntimeActor, 'organizationId'>
): Promise<RuntimeCandidateV1[]> {
  const rows = await listExecutionRuntimeRows(actor);
  return rows.map((row) => mapExecutionRuntimeCandidateV1(row));
}

async function listExecutionRuntimeRows(
  actor: Pick<ExecutionRuntimeActor, 'organizationId'>
): Promise<ExecutionRuntimeRow[]> {
  await ensureBuiltinExecutionRuntimes(actor);
  const { prisma } = await import('@/lib/db/prisma');
  return prisma.$queryRaw<ExecutionRuntimeRow[]>`
    SELECT
      "id", "organizationId", "key", "name", "driver",
      "version", "endpoint", "enabled", "registrationJson",
      "capabilitiesJson", "healthStatus", "healthJson",
      "lastHeartbeatAt", "capacityTotal", "capacityUsed",
      "capacityJson", "capacityUpdatedAt", "createdAt", "updatedAt"
    FROM "ExecutionRuntime"
    WHERE "organizationId" = ${actor.organizationId}
    ORDER BY "key" ASC, "id" ASC
  `;
}
