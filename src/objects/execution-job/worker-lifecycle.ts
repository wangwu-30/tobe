import { randomUUID } from 'node:crypto';

import type { RuntimeEventV1 } from '@/agent/execution/driver';
import {
  assertWorkspaceLifecycleAdvanceV1,
  parseStoredWorkspaceLifecycleV1,
  parseWorkspaceLifecycleV1,
  serializeWorkspaceLifecycleV1,
  type WorkspaceLifecycleV1,
  type WorkspaceRuntimeCompletionV1,
  WorkspaceLifecycleErrorV1,
} from '@/agent/execution/workspace-lifecycle';
import {
  ConflictError,
  ValidationError,
} from '@/framework/resilience/app-error';
import { isRecord, safeJsonParse } from '@/framework/resilience/safe-data';
import { prisma } from '@/lib/db/prisma';

import type { ExecutionJobActor } from './queries';
import {
  parseContextManifestV1,
  type FrozenKnowledgeBindingV1,
} from './schema';

const MAX_IDENTIFIER_LENGTH = 512;

export type PersistExecutionWorkspaceLifecycleInputV1 = {
  attemptId: string;
  workerId: string;
  generation: number;
  lifecycle: WorkspaceLifecycleV1;
};

export type LoadExecutionAttemptWorkspaceInputV1 = {
  attemptId: string;
  workerId: string;
  generation: number;
  /** False for receipt-only guards that must not depend on live binding access. */
  resolveKnowledgeWorkspace?: boolean;
};

export type LoadExecutionAttemptWorkspaceResultV1 = {
  schemaVersion: 1;
  hasKnowledgeWorkspace: boolean;
  knowledgeWorkspace: {
    binding: FrozenKnowledgeBindingV1;
    repositoryPath: string;
  } | null;
  workspaceLifecycleJson: string | null;
};

export type PersistExecutionWorkspaceLifecycleResultV1 = {
  schemaVersion: 1;
  lifecycle: WorkspaceLifecycleV1;
  replayed: boolean;
};

export type PersistExecutionTerminalEventInputV1 = {
  attemptId: string;
  workerId: string;
  generation: number;
  runtimeEventId: string;
  event: Extract<RuntimeEventV1, { type: 'attempt-completed' }>;
  runtimeCompletion: WorkspaceRuntimeCompletionV1;
  occurredAt?: Date | string;
};

export type PersistExecutionTerminalEventResultV1 = {
  schemaVersion: 1;
  event: {
    schemaVersion: 1;
    id: string;
    organizationId: string;
    jobId: string;
    attemptId: string;
    sequence: number;
    type: 'attempt-completed';
    source: 'runtime';
    runtimeEventId: string;
    payload: { status: 'succeeded' | 'failed' | 'interrupted'; message?: string };
    occurredAt: string;
    createdAt: string;
  };
  lifecycle: WorkspaceLifecycleV1;
  replayed: boolean;
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

type AttemptLifecycleRow = {
  id: string;
  jobId: string;
  jobStatus: string;
  workspaceLifecycleJson: string | null;
};

type AttemptWorkspaceRow = AttemptLifecycleRow & {
  contextManifestJson: string;
};

type KnowledgeWorkspaceRow = {
  id: string;
  workspaceId: string;
  agentId: string | null;
  spaceId: string;
  mountPath: string;
  access: string;
  scope: string;
  ownerAgentId: string | null;
  repositoryPath: string | null;
  repoUrl: string | null;
  defaultBranch: string;
};

type ExecutionEventRow = {
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

/**
 * Loads the private receipt and, when the frozen manifest has knowledge,
 * resolves its repository path from the live organization-scoped binding.
 * credentialRef is deliberately neither selected nor returned.
 */
export async function loadExecutionAttemptWorkspace(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  input: LoadExecutionAttemptWorkspaceInputV1
): Promise<LoadExecutionAttemptWorkspaceResultV1> {
  const organizationId = requireIdentifier(
    actor.organizationId,
    'organizationId is required.'
  );
  const attemptId = requireIdentifier(input.attemptId, 'attemptId is required.');
  const workerId = requireIdentifier(input.workerId, 'workerId is required.');
  const generation = readGeneration(input.generation);
  const now = new Date();

  return prisma.$transaction(async (db) => {
    await fenceAttempt(db, {
      organizationId,
      attemptId,
      workerId,
      generation,
      now,
      allowCancelRequested: true,
    });
    const attempts = await db.$queryRaw<AttemptWorkspaceRow[]>`
      SELECT attempt."id", attempt."jobId",
        job."status" AS "jobStatus", job."contextManifestJson",
        attempt."workspaceLifecycleJson"
      FROM "ExecutionAttempt" AS attempt
      INNER JOIN "ExecutionJob" AS job
        ON job."id" = attempt."jobId"
        AND job."organizationId" = attempt."organizationId"
      WHERE attempt."id" = ${attemptId}
        AND attempt."organizationId" = ${organizationId}
      LIMIT 1
    `;
    const attempt = attempts[0];
    if (!attempt) throw fencedError();
    const manifest = parseStoredManifest(attempt.contextManifestJson);
    const lifecycle = parseStoredWorkspaceLifecycleV1(
      attempt.workspaceLifecycleJson
    );
    const frozen = manifest.knowledgeCommit;
    if (frozen === null) {
      if (lifecycle !== null) {
        throw new ConflictError(
          'Workspace lifecycle has no frozen knowledge binding.'
        );
      }
      return {
        schemaVersion: 1,
        hasKnowledgeWorkspace: false,
        knowledgeWorkspace: null,
        workspaceLifecycleJson: null,
      };
    }
    if (
      lifecycle !== null &&
      serializeWorkspaceLifecycleV1(lifecycleWithBinding(lifecycle.binding)) !==
        serializeWorkspaceLifecycleV1(lifecycleWithBinding(frozen))
    ) {
      throw new ConflictError(
        'Workspace lifecycle no longer matches the Job context manifest.'
      );
    }
    if (input.resolveKnowledgeWorkspace === false) {
      return {
        schemaVersion: 1,
        hasKnowledgeWorkspace: true,
        knowledgeWorkspace: null,
        workspaceLifecycleJson: attempt.workspaceLifecycleJson,
      };
    }

    const rows = await db.$queryRaw<KnowledgeWorkspaceRow[]>`
      SELECT binding."id", binding."workspaceId", binding."agentId",
        binding."spaceId", binding."mountPath", binding."access",
        space."scope", space."ownerAgentId",
        space."repoPath" AS "repositoryPath", space."repoUrl",
        space."defaultBranch"
      FROM "KnowledgeBinding" AS binding
      INNER JOIN "KnowledgeSpace" AS space
        ON space."id" = binding."spaceId"
        AND space."organizationId" = binding."organizationId"
      WHERE binding."id" = ${frozen.bindingId}
        AND binding."organizationId" = ${organizationId}
      LIMIT 1
    `;
    const live = rows[0];
    if (!isAuthorizedKnowledgeWorkspace(live, frozen)) {
      throw new ConflictError(
        'Knowledge binding is no longer authorized for this attempt.'
      );
    }

    return {
      schemaVersion: 1,
      hasKnowledgeWorkspace: true,
      knowledgeWorkspace: {
        binding: frozen,
        repositoryPath: live.repositoryPath,
      },
      workspaceLifecycleJson: attempt.workspaceLifecycleJson,
    };
  });
}

/**
 * Persists exactly one private workspace stage, or accepts an exact replay.
 * Runtime completion is intentionally reserved for the atomic terminal-event
 * command below.
 */
export async function persistExecutionWorkspaceLifecycle(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  input: PersistExecutionWorkspaceLifecycleInputV1
): Promise<PersistExecutionWorkspaceLifecycleResultV1> {
  const organizationId = requireIdentifier(
    actor.organizationId,
    'organizationId is required.'
  );
  const attemptId = requireIdentifier(input.attemptId, 'attemptId is required.');
  const workerId = requireIdentifier(input.workerId, 'workerId is required.');
  const generation = readGeneration(input.generation);
  const next = parseWorkspaceLifecycleV1(input.lifecycle);
  const nextJson = serializeWorkspaceLifecycleV1(next);
  const now = new Date();

  return prisma.$transaction(async (db) => {
    const attempt = await loadFencedAttempt(db, {
      organizationId,
      attemptId,
      workerId,
      generation,
      now,
      allowCancelRequested: true,
    });
    const previous = parseStoredWorkspaceLifecycleV1(
      attempt.workspaceLifecycleJson
    );
    assertLifecycleAdvance(previous, next);
    const replayed =
      previous !== null &&
      serializeWorkspaceLifecycleV1(previous) === nextJson;
    if (!replayed && previous?.runtimeCompletion === undefined && next.runtimeCompletion) {
      throw new ConflictError(
        'Runtime completion must be persisted with its terminal event.'
      );
    }

    await compareAndSetLifecycle(db, {
      organizationId,
      attemptId,
      workerId,
      generation,
      previousJson: attempt.workspaceLifecycleJson,
      nextJson,
      now: new Date(),
      allowCancelRequested: true,
    });
    return { schemaVersion: 1, lifecycle: next, replayed };
  });
}

/** Atomically appends the runtime terminal fact and its private completion stage. */
export async function persistExecutionTerminalEvent(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  input: PersistExecutionTerminalEventInputV1
): Promise<PersistExecutionTerminalEventResultV1> {
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
  const payload = normalizeTerminalPayload(input.event);
  const payloadJson = JSON.stringify(payload);
  const completion = normalizeCompletion(input.runtimeCompletion);
  assertTerminalAlignment(payload.status, completion.status);
  const allowCancelRequested = payload.status === 'interrupted';
  const occurredAt = readOccurredAt(input.occurredAt);
  const now = new Date();

  return prisma.$transaction(async (db) => {
    const attempt = await loadFencedAttempt(db, {
      organizationId,
      attemptId,
      workerId,
      generation,
      now,
      allowCancelRequested: true,
    });
    const previous = parseStoredWorkspaceLifecycleV1(
      attempt.workspaceLifecycleJson
    );
    if (previous === null) {
      throw new ConflictError('Stored workspace lifecycle is missing.');
    }
    if (
      attempt.jobStatus === 'cancel_requested' &&
      previous.runtimeCompletion === undefined &&
      !allowCancelRequested
    ) {
      throw fencedError();
    }
    const next = previous.runtimeCompletion
      ? replayedCompletion(previous, completion)
      : parseWorkspaceLifecycleV1({
          ...previous,
          runtimeCompletion: completion,
        });
    assertLifecycleAdvance(previous, next);
    const nextJson = serializeWorkspaceLifecycleV1(next);

    const existing = await findEvent(db, attemptId, runtimeEventId);
    if (existing) {
      assertEventReplay(existing, {
        organizationId,
        jobId: attempt.jobId,
        attemptId,
        payloadJson,
      });
      await compareAndSetLifecycle(db, {
        organizationId,
        attemptId,
        workerId,
        generation,
        previousJson: attempt.workspaceLifecycleJson,
        nextJson,
        now: new Date(),
        allowCancelRequested: attempt.jobStatus === 'cancel_requested',
      });
      return {
        schemaVersion: 1,
        event: mapEvent(existing),
        lifecycle: next,
        replayed: true,
      };
    }
    if (previous.runtimeCompletion !== undefined) {
      throw new ConflictError(
        'Runtime completion was already persisted by a different terminal event.'
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
        ${sequence}, 'attempt-completed', 'runtime', ${runtimeEventId},
        ${payloadJson}, ${occurredAt}, ${now}
      )
    `;
    await compareAndSetLifecycle(db, {
      organizationId,
      attemptId,
      workerId,
      generation,
      previousJson: attempt.workspaceLifecycleJson,
      nextJson,
      now: new Date(),
      allowCancelRequested: attempt.jobStatus === 'cancel_requested',
    });

    return {
      schemaVersion: 1,
      event: {
        schemaVersion: 1,
        id: eventId,
        organizationId,
        jobId: attempt.jobId,
        attemptId,
        sequence,
        type: 'attempt-completed',
        source: 'runtime',
        runtimeEventId,
        payload,
        occurredAt: occurredAt.toISOString(),
        createdAt: now.toISOString(),
      },
      lifecycle: next,
      replayed: false,
    };
  });
}

async function loadFencedAttempt(
  db: RawSqlDb,
  input: {
    organizationId: string;
    attemptId: string;
    workerId: string;
    generation: number;
    now: Date;
    allowCancelRequested: boolean;
  }
): Promise<AttemptLifecycleRow> {
  await fenceAttempt(db, input);

  const rows = await db.$queryRaw<AttemptLifecycleRow[]>`
    SELECT attempt."id", attempt."jobId",
      job."status" AS "jobStatus", attempt."workspaceLifecycleJson"
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

async function fenceAttempt(
  db: RawSqlDb,
  input: {
    organizationId: string;
    attemptId: string;
    workerId: string;
    generation: number;
    now: Date;
    allowCancelRequested: boolean;
  }
): Promise<void> {
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
}

async function compareAndSetLifecycle(
  db: RawSqlDb,
  input: {
    organizationId: string;
    attemptId: string;
    workerId: string;
    generation: number;
    previousJson: string | null;
    nextJson: string;
    now: Date;
    allowCancelRequested: boolean;
  }
): Promise<void> {
  const changed = await db.$executeRaw`
    UPDATE "ExecutionAttempt"
    SET "workspaceLifecycleJson" = ${input.nextJson}, "updatedAt" = ${input.now}
    WHERE "id" = ${input.attemptId}
      AND "organizationId" = ${input.organizationId}
      AND "status" = 'running'
      AND "generation" = ${input.generation}
      AND "leaseOwnerId" = ${input.workerId}
      AND "leaseExpiresAt" IS NOT NULL
      AND "leaseExpiresAt" > ${input.now}
      AND (
        (${input.previousJson} IS NULL AND "workspaceLifecycleJson" IS NULL)
        OR "workspaceLifecycleJson" = ${input.previousJson}
      )
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
  if (changed !== 1) throw fencedError();
}

async function findEvent(
  db: RawSqlDb,
  attemptId: string,
  runtimeEventId: string
): Promise<ExecutionEventRow | null> {
  const rows = await db.$queryRaw<ExecutionEventRow[]>`
    SELECT
      "id", "organizationId", "jobId", "attemptId",
      "sequence", "type", "source", "runtimeEventId",
      "payloadJson", "occurredAt", "createdAt"
    FROM "ExecutionEvent"
    WHERE "attemptId" = ${attemptId}
      AND "runtimeEventId" = ${runtimeEventId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function assertEventReplay(
  existing: ExecutionEventRow,
  expected: {
    organizationId: string;
    jobId: string;
    attemptId: string;
    payloadJson: string;
  }
): void {
  if (
    existing.organizationId !== expected.organizationId ||
    existing.jobId !== expected.jobId ||
    existing.attemptId !== expected.attemptId ||
    existing.type !== 'attempt-completed' ||
    existing.source !== 'runtime' ||
    existing.payloadJson !== expected.payloadJson
  ) {
    throw new ConflictError(
      'runtimeEventId was already used with different event content.'
    );
  }
}

function parseStoredManifest(raw: string) {
  const invalidManifest = Symbol('invalid-execution-context-manifest');
  const value = safeJsonParse<unknown | typeof invalidManifest>(
    raw,
    invalidManifest
  );
  if (value === invalidManifest) {
    throw new ConflictError('Stored Job context manifest is invalid.');
  }
  try {
    return parseContextManifestV1(value);
  } catch (error) {
    throw new ConflictError('Stored Job context manifest is invalid.', {
      cause: error,
    });
  }
}

function isAuthorizedKnowledgeWorkspace(
  live: KnowledgeWorkspaceRow | undefined,
  frozen: FrozenKnowledgeBindingV1
): live is KnowledgeWorkspaceRow & { repositoryPath: string } {
  if (
    !live ||
    live.id !== frozen.bindingId ||
    live.workspaceId !== frozen.workspaceId ||
    live.agentId !== frozen.agentId ||
    live.spaceId !== frozen.spaceId ||
    live.mountPath !== frozen.mountPath ||
    live.access !== 'propose' ||
    live.defaultBranch !== frozen.defaultBranch ||
    typeof live.repositoryPath !== 'string' ||
    !live.repositoryPath.trim() ||
    live.repoUrl !== null
  ) {
    return false;
  }
  return frozen.agentId === null
    ? live.scope === 'team' && live.ownerAgentId === null
    : live.scope === 'agent' && live.ownerAgentId === frozen.agentId;
}

function assertLifecycleAdvance(
  previous: WorkspaceLifecycleV1 | null,
  next: WorkspaceLifecycleV1
): void {
  try {
    assertWorkspaceLifecycleAdvanceV1(previous, next);
  } catch (error) {
    if (
      error instanceof WorkspaceLifecycleErrorV1 &&
      error.code === 'invalid-advance'
    ) {
      throw new ConflictError(error.message, { cause: error });
    }
    throw error;
  }
}

function replayedCompletion(
  previous: WorkspaceLifecycleV1,
  completion: WorkspaceRuntimeCompletionV1
): WorkspaceLifecycleV1 {
  const candidate = parseWorkspaceLifecycleV1({
    ...previous,
    runtimeCompletion: completion,
  });
  if (
    serializeWorkspaceLifecycleV1(previous) !==
    serializeWorkspaceLifecycleV1(candidate)
  ) {
    throw new ConflictError(
      'Workspace lifecycle stage runtimeCompletion is immutable.'
    );
  }
  return previous;
}

function lifecycleWithBinding(binding: FrozenKnowledgeBindingV1) {
  return {
    schemaVersion: 1 as const,
    kind: 'git-worktree' as const,
    binding,
    prepared: {
      ...placeholderPrepared(),
      spaceId: binding.spaceId,
      defaultBranch: binding.defaultBranch,
      baseCommit: binding.baseCommit,
      ...(binding.agentId === null ? {} : { agentId: binding.agentId }),
    },
  };
}

function normalizeTerminalPayload(
  event: Extract<RuntimeEventV1, { type: 'attempt-completed' }>
): { status: 'succeeded' | 'failed' | 'interrupted'; message?: string } {
  if (
    !event ||
    event.type !== 'attempt-completed' ||
    (event.status !== 'succeeded' &&
      event.status !== 'failed' &&
      event.status !== 'interrupted')
  ) {
    throw new ValidationError('A valid attempt-completed event is required.');
  }
  if (event.message !== undefined && typeof event.message !== 'string') {
    throw new ValidationError(
      'attempt-completed message must be a string when provided.'
    );
  }
  return {
    status: event.status,
    ...(event.message === undefined ? {} : { message: event.message }),
  };
}

function normalizeCompletion(
  completion: WorkspaceRuntimeCompletionV1
): WorkspaceRuntimeCompletionV1 {
  const lifecycle = parseWorkspaceLifecycleV1({
    schemaVersion: 1,
    kind: 'git-worktree',
    binding: placeholderBinding(),
    prepared: placeholderPrepared(),
    runtimeCompletion: completion,
  });
  return lifecycle.runtimeCompletion as WorkspaceRuntimeCompletionV1;
}

function assertTerminalAlignment(
  eventStatus: 'succeeded' | 'failed' | 'interrupted',
  completionStatus: WorkspaceRuntimeCompletionV1['status']
): void {
  const expected = eventStatus === 'interrupted' ? 'cancelled' : eventStatus;
  if (completionStatus !== expected) {
    throw new ValidationError(
      'Runtime completion status must match the terminal event.'
    );
  }
}

function placeholderBinding() {
  return {
    schemaVersion: 1 as const,
    bindingId: 'validation-binding',
    spaceId: 'validation-space',
    workspaceId: 'validation-workspace',
    agentId: null,
    mountPath: '/' as const,
    defaultBranch: 'main',
    baseCommit: '0'.repeat(40),
  };
}

function placeholderPrepared() {
  return {
    schemaVersion: 1 as const,
    spaceId: 'validation-space',
    mountPath: '/' as const,
    repositoryPath: '/validation/repository',
    worktreePath: '/validation/worktree',
    defaultBranch: 'main',
    branch: 'validation-branch',
    baseCommit: '0'.repeat(40),
    jobId: 'validation-job',
    attemptId: 'validation-attempt',
    attemptNumber: 1,
  };
}

function mapEvent(row: ExecutionEventRow): PersistExecutionTerminalEventResultV1['event'] {
  const invalidPayload = Symbol('invalid-terminal-event-payload');
  const payload = safeJsonParse<unknown | typeof invalidPayload>(
    row.payloadJson,
    invalidPayload
  );
  if (
    payload === invalidPayload ||
    !isRecord(payload) ||
    (payload.status !== 'succeeded' &&
      payload.status !== 'failed' &&
      payload.status !== 'interrupted') ||
    (payload.message !== undefined && typeof payload.message !== 'string')
  ) {
    throw new Error('Stored terminal execution event is invalid.');
  }
  return {
    schemaVersion: 1,
    id: row.id,
    organizationId: row.organizationId,
    jobId: row.jobId,
    attemptId: row.attemptId as string,
    sequence: Number(row.sequence),
    type: 'attempt-completed',
    source: 'runtime',
    runtimeEventId: row.runtimeEventId as string,
    payload: {
      status: payload.status,
      ...(payload.message === undefined ? {} : { message: payload.message }),
    },
    occurredAt: new Date(row.occurredAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

function readGeneration(value: number): number {
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

function requireIdentifier(value: unknown, message: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > MAX_IDENTIFIER_LENGTH
  ) {
    throw new ValidationError(message);
  }
  return value.trim();
}

function fencedError(): ConflictError {
  return new ConflictError(
    'Execution attempt lease is stale, expired, or owned by another worker.'
  );
}
