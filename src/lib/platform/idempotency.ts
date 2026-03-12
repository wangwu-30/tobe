import { prisma } from '@/lib/db/prisma';

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

export class IdempotencyConflictError extends Error {
  constructor() {
    super('This request key is already being used for a different operation.');
  }
}

export class IdempotencyInProgressError extends Error {
  constructor() {
    super('This request is still in progress.');
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
      return JSON.parse(existing.responseJson) as T;
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
      return JSON.parse(resolved.responseJson) as T;
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

async function createMutationRequest(params: {
  operation: string;
  organizationId: string;
  requestHash: string;
  requestKey: string;
  userId: string;
}) {
  const id = crypto.randomUUID();
  const inserted = await prisma.$executeRaw`
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

async function reclaimFailedMutation(id: string) {
  const updated = await prisma.$executeRaw`
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
}) {
  const rows = await prisma.$queryRaw<MutationRequestRow[]>`
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
