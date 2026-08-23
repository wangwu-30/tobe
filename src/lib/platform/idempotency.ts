import type { Prisma } from '@/generated/prisma/client';

import { prisma } from '@/lib/db/prisma';
import { ConflictError } from '@/framework/resilience/app-error';
import { safeJsonParse } from '@/framework/resilience/safe-data';

const IDEMPOTENCY_WAIT_INTERVAL_MS = 150;
const IDEMPOTENCY_WAIT_TIMEOUT_MS = 30_000;

type MutationRequestRow = {
  createdAt: string;
  errorMessage: string | null;
  id: string;
  operation: string;
  organizationId: string;
  requestHash: string;
  requestKey: string;
  resourceId: string | null;
  resourceType: string | null;
  responseJson: string | null;
  status: 'completed' | 'failed' | 'in_progress';
  updatedAt: string;
  userId: string;
};

const INVALID_JSON = Symbol('invalid-json');

type IdempotencyDb = Prisma.TransactionClient | typeof prisma;

type IdempotencyResource<T> = (result: T) => {
  resourceId?: string | null;
  resourceType?: string | null;
};

type AtomicIdempotencyResolution<T> =
  | { kind: 'resolved'; result: T }
  | { kind: 'retry' }
  | { kind: 'wait' };

export class IdempotencyConflictError extends ConflictError {
  constructor() {
    super('This request key is already being used for a different operation.');
    this.name = new.target.name;
  }
}

export class IdempotencyInProgressError extends Error {
  constructor() {
    super('This request is still in progress.');
    this.name = new.target.name;
  }
}

export async function withIdempotency<T>(params: {
  action: () => Promise<T>;
  key?: string | null;
  operation: string;
  organizationId: string;
  requestHash: string;
  resource?: (result: T) => { resourceId?: string | null; resourceType?: string | null };
  userId: string;
}) {
  const requestKey = params.key?.trim();
  if (!requestKey) {
    return params.action();
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const created = await createMutationRequest({
      operation: params.operation,
      organizationId: params.organizationId,
      requestHash: params.requestHash,
      requestKey,
      userId: params.userId,
    });

    if (created) {
      return executeOwnedMutation(created.id, params);
    }

    const existing = await getMutationRequest({
      operation: params.operation,
      organizationId: params.organizationId,
      requestKey,
      userId: params.userId,
    });

    if (!existing) {
      continue;
    }

    assertMatchingHash(existing, params.requestHash);

    if (existing.status === 'completed' && existing.responseJson) {
      return parseStoredMutationResponse<T>(existing.responseJson);
    }

    if (existing.status === 'failed') {
      const reclaimed = await reclaimFailedMutation(existing.id);
      if (reclaimed) {
        return executeOwnedMutation(existing.id, params);
      }

      continue;
    }

    const resolved = await waitForMutationRequest({
      operation: params.operation,
      organizationId: params.organizationId,
      requestHash: params.requestHash,
      requestKey,
      userId: params.userId,
    });

    if (resolved?.status === 'completed' && resolved.responseJson) {
      return parseStoredMutationResponse<T>(resolved.responseJson);
    }

    if (resolved?.status === 'failed') {
      const reclaimed = await reclaimFailedMutation(resolved.id);
      if (reclaimed) {
        return executeOwnedMutation(resolved.id, params);
      }
    }
  }

  throw new IdempotencyInProgressError();
}

/**
 * Runs an idempotent mutation and its MutationRequest bookkeeping in one
 * transaction. This is intentionally opt-in: existing callers of
 * withIdempotency keep their current non-transactional action contract.
 */
export async function withAtomicIdempotency<T>(params: {
  action: (db: Prisma.TransactionClient) => Promise<T>;
  key?: string | null;
  operation: string;
  organizationId: string;
  requestHash: string;
  resource?: IdempotencyResource<T>;
  userId: string;
}): Promise<T> {
  const requestKey = params.key?.trim();
  if (!requestKey) {
    return prisma.$transaction((db) => params.action(db));
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const resolution = await prisma.$transaction(
      async (db): Promise<AtomicIdempotencyResolution<T>> => {
        const created = await createMutationRequest(
          {
            operation: params.operation,
            organizationId: params.organizationId,
            requestHash: params.requestHash,
            requestKey,
            userId: params.userId,
          },
          db
        );

        if (created) {
          const result = await executeOwnedAtomicMutation(
            created.id,
            params,
            db
          );
          return { kind: 'resolved', result };
        }

        const existing = await getMutationRequest(
          {
            operation: params.operation,
            organizationId: params.organizationId,
            requestKey,
            userId: params.userId,
          },
          db
        );

        if (!existing) {
          return { kind: 'retry' };
        }

        assertMatchingHash(existing, params.requestHash);

        if (existing.status === 'completed' && existing.responseJson) {
          return {
            kind: 'resolved',
            result: parseStoredMutationResponse<T>(existing.responseJson),
          };
        }

        if (existing.status === 'failed') {
          const reclaimed = await reclaimFailedMutation(existing.id, db);
          if (reclaimed) {
            const result = await executeOwnedAtomicMutation(
              existing.id,
              params,
              db
            );
            return { kind: 'resolved', result };
          }

          return { kind: 'retry' };
        }

        return { kind: 'wait' };
      }
    );

    if (resolution.kind === 'resolved') {
      return resolution.result;
    }

    if (resolution.kind === 'retry') {
      continue;
    }

    const resolved = await waitForMutationRequest({
      operation: params.operation,
      organizationId: params.organizationId,
      requestHash: params.requestHash,
      requestKey,
      userId: params.userId,
    });

    if (resolved?.status === 'completed' && resolved.responseJson) {
      return parseStoredMutationResponse<T>(resolved.responseJson);
    }

    if (resolved?.status === 'failed') {
      continue;
    }
  }

  throw new IdempotencyInProgressError();
}

function parseStoredMutationResponse<T>(responseJson: string): T {
  const parsed = safeJsonParse<T | typeof INVALID_JSON>(responseJson, INVALID_JSON);
  if (parsed === INVALID_JSON) {
    throw new Error('Stored mutation response could not be parsed.');
  }

  return parsed as T;
}

async function executeOwnedMutation<T>(
  mutationRequestId: string,
  params: {
    action: () => Promise<T>;
    resource?: (result: T) => { resourceId?: string | null; resourceType?: string | null };
  }
) {
  try {
    const result = await params.action();
    const resource = params.resource?.(result);

    await prisma.$executeRaw`
      UPDATE "MutationRequest"
      SET
        "status" = 'completed',
        "responseJson" = ${JSON.stringify(result)},
        "resourceType" = ${resource?.resourceType || null},
        "resourceId" = ${resource?.resourceId || null},
        "errorMessage" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${mutationRequestId}
    `;

    return result;
  } catch (error) {
    await prisma.$executeRaw`
      UPDATE "MutationRequest"
      SET
        "status" = 'failed',
        "responseJson" = NULL,
        "resourceType" = NULL,
        "resourceId" = NULL,
        "errorMessage" = ${formatMutationError(error)},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${mutationRequestId}
    `;

    throw error;
  }
}

async function executeOwnedAtomicMutation<T>(
  mutationRequestId: string,
  params: {
    action: (db: Prisma.TransactionClient) => Promise<T>;
    resource?: IdempotencyResource<T>;
  },
  db: Prisma.TransactionClient
) {
  const result = await params.action(db);
  const resource = params.resource?.(result);
  const updated = await db.$executeRaw`
    UPDATE "MutationRequest"
    SET
      "status" = 'completed',
      "responseJson" = ${JSON.stringify(result)},
      "resourceType" = ${resource?.resourceType || null},
      "resourceId" = ${resource?.resourceId || null},
      "errorMessage" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${mutationRequestId}
      AND "status" = 'in_progress'
  `;

  if (updated !== 1) {
    throw new Error('Owned mutation request could not be completed.');
  }

  return result;
}

async function createMutationRequest(params: {
  operation: string;
  organizationId: string;
  requestHash: string;
  requestKey: string;
  userId: string;
}, db: IdempotencyDb = prisma) {
  const id = crypto.randomUUID();
  const inserted = await db.$executeRaw`
    INSERT OR IGNORE INTO "MutationRequest" (
      "id",
      "organizationId",
      "userId",
      "operation",
      "requestKey",
      "requestHash",
      "status",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${id},
      ${params.organizationId},
      ${params.userId},
      ${params.operation},
      ${params.requestKey},
      ${params.requestHash},
      'in_progress',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `;

  return inserted > 0 ? { id } : null;
}

async function reclaimFailedMutation(
  id: string,
  db: IdempotencyDb = prisma
) {
  const updated = await db.$executeRaw`
    UPDATE "MutationRequest"
    SET
      "status" = 'in_progress',
      "responseJson" = NULL,
      "resourceType" = NULL,
      "resourceId" = NULL,
      "errorMessage" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}
      AND "status" = 'failed'
  `;

  return updated > 0;
}

async function getMutationRequest(params: {
  operation: string;
  organizationId: string;
  requestKey: string;
  userId: string;
}, db: IdempotencyDb = prisma) {
  const rows = await db.$queryRaw<MutationRequestRow[]>`
    SELECT
      "id",
      "organizationId",
      "userId",
      "operation",
      "requestKey",
      "requestHash",
      "status",
      "responseJson",
      "resourceType",
      "resourceId",
      "errorMessage",
      "createdAt",
      "updatedAt"
    FROM "MutationRequest"
    WHERE
      "organizationId" = ${params.organizationId}
      AND "userId" = ${params.userId}
      AND "operation" = ${params.operation}
      AND "requestKey" = ${params.requestKey}
    LIMIT 1
  `;

  return rows[0] || null;
}

async function waitForMutationRequest(params: {
  operation: string;
  organizationId: string;
  requestHash: string;
  requestKey: string;
  userId: string;
}) {
  const deadline = Date.now() + IDEMPOTENCY_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(IDEMPOTENCY_WAIT_INTERVAL_MS);

    const existing = await getMutationRequest(params);
    if (!existing) {
      return null;
    }

    assertMatchingHash(existing, params.requestHash);

    if (existing.status === 'completed' || existing.status === 'failed') {
      return existing;
    }
  }

  return null;
}

function assertMatchingHash(existing: Pick<MutationRequestRow, 'requestHash'>, requestHash: string) {
  if (existing.requestHash !== requestHash) {
    throw new IdempotencyConflictError();
  }
}

function formatMutationError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Mutation request failed.';
}

function sleep(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
