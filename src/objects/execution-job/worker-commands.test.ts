import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createClient, type Client } from '@libsql/client';
import { expect, test } from '@playwright/test';

import { ConflictError } from '@/framework/resilience';

import { cancelExecutionJob } from './commands';
import { getExecutionJob } from './queries';
import { prisma as testPrisma } from './test-prisma';
import { appendExecutionEvent } from './worker-events';
import {
  claimExecutionAttempt,
  completeExecutionAttempt,
  heartbeatExecutionAttempt,
} from './worker-commands';

const ACTOR = { organizationId: 'worker-test-org' };
const RUNTIME_ID = 'worker-test-runtime';
const JOB_ID = 'worker-test-job';
const ATTEMPT_ID = 'worker-test-attempt';
const FULL_RUNTIME_ID = 'worker-test-full-runtime';
const FULL_JOB_ID = 'worker-test-full-job';
const FULL_ATTEMPT_ID = 'worker-test-full-attempt';
const CANCEL_RUNTIME_ID = 'worker-test-cancel-runtime';
const CANCEL_JOB_ID = 'worker-test-cancel-job';
const CANCEL_ATTEMPT_ID = 'worker-test-cancel-attempt';
const QUEUED_JOB_ID = 'worker-test-queued-cancel-job';
const QUEUED_ATTEMPT_ID = 'worker-test-queued-cancel-attempt';
const DELIVERY_RUNTIME_ID = 'worker-test-delivery-runtime';
const DELIVERY_JOB_ID = 'worker-test-delivery-job';
const DELIVERY_ATTEMPT_ID = 'worker-test-delivery-attempt';
const DELIVERY_TASK_ID = 'worker-test-delivery-task';
const INVALID_TASK_RUNTIME_ID = 'worker-test-invalid-task-runtime';
const INVALID_TASK_JOB_ID = 'worker-test-invalid-task-job';
const INVALID_TASK_ATTEMPT_ID = 'worker-test-invalid-task-attempt';
const INVALID_TASK_ID = 'worker-test-invalid-task';

let client: Client;
let temporaryRoot: string;

test.describe.serial('execution worker generation fencing', () => {
  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tobe-execution-worker-')
    );
    const databasePath = path.join(temporaryRoot, 'worker.db');
    process.env.DAO_APP_DATA_ROOT = temporaryRoot;
    process.env.DATABASE_URL = `file:${databasePath}`;
    client = createClient({ url: `file:${databasePath}` });

    await client.executeMultiple(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE "ExecutionRuntime" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "capabilitiesJson" TEXT NOT NULL DEFAULT '{}',
        "capacityTotal" INTEGER NOT NULL DEFAULT 1,
        "capacityUsed" INTEGER NOT NULL DEFAULT 0,
        "capacityUpdatedAt" DATETIME,
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL
      );

      CREATE TABLE "ExecutionJob" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "teamTaskId" TEXT,
        "originRoomId" TEXT,
        "originRoomMessageId" TEXT,
        "kind" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "priority" INTEGER NOT NULL DEFAULT 0,
        "specJson" TEXT NOT NULL,
        "requirementsJson" TEXT NOT NULL DEFAULT '{}',
        "contextManifestJson" TEXT NOT NULL DEFAULT '{}',
        "selectionJson" TEXT NOT NULL DEFAULT '{}',
        "requestedRuntimeId" TEXT,
        "selectedRuntimeId" TEXT,
        "selectionReason" TEXT,
        "selectedAt" DATETIME,
        "maxAttempts" INTEGER NOT NULL DEFAULT 1,
        "deadlineAt" DATETIME,
        "queuedAt" DATETIME NOT NULL,
        "startedAt" DATETIME,
        "finishedAt" DATETIME,
        "cancelRequestedAt" DATETIME,
        "resultJson" TEXT,
        "errorJson" TEXT,
        "revision" INTEGER NOT NULL DEFAULT 1,
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL
      );

      CREATE TABLE "ExecutionAttempt" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "jobId" TEXT NOT NULL,
        "runtimeId" TEXT,
        "number" INTEGER NOT NULL,
        "status" TEXT NOT NULL,
        "generation" INTEGER NOT NULL DEFAULT 0,
        "capacityReserved" BOOLEAN NOT NULL DEFAULT false,
        "leaseOwnerId" TEXT,
        "leaseExpiresAt" DATETIME,
        "lastHeartbeatAt" DATETIME,
        "runtimeRunId" TEXT,
        "checkpointJson" TEXT,
        "workspaceLifecycleJson" TEXT,
        "resultJson" TEXT,
        "errorJson" TEXT,
        "startedAt" DATETIME,
        "finishedAt" DATETIME,
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL
      );

      CREATE TABLE "ExecutionEvent" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "jobId" TEXT NOT NULL,
        "attemptId" TEXT,
        "sequence" INTEGER NOT NULL,
        "type" TEXT NOT NULL,
        "source" TEXT NOT NULL DEFAULT 'runtime',
        "runtimeEventId" TEXT,
        "payloadJson" TEXT NOT NULL DEFAULT '{}',
        "occurredAt" DATETIME NOT NULL,
        "createdAt" DATETIME NOT NULL
      );
      CREATE UNIQUE INDEX "ExecutionEvent_jobId_sequence_key"
        ON "ExecutionEvent" ("jobId", "sequence");
      CREATE UNIQUE INDEX "ExecutionEvent_attemptId_runtimeEventId_key"
        ON "ExecutionEvent" ("attemptId", "runtimeEventId");

      CREATE TABLE "ExecutionInputRequest" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "jobId" TEXT NOT NULL,
        "attemptId" TEXT NOT NULL,
        "requestKey" TEXT NOT NULL,
        "prompt" TEXT NOT NULL,
        "schemaJson" TEXT NOT NULL DEFAULT '{}',
        "responseJson" TEXT,
        "responseId" TEXT UNIQUE,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "requestedAt" DATETIME NOT NULL,
        "respondedAt" DATETIME,
        "respondedById" TEXT,
        "revision" INTEGER NOT NULL DEFAULT 1,
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL
      );

      CREATE TABLE "ExecutionOutbox" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "jobId" TEXT NOT NULL,
        "roomId" TEXT,
        "topic" TEXT NOT NULL,
        "dedupeKey" TEXT NOT NULL,
        "payloadJson" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "availableAt" DATETIME NOT NULL,
        "deliveredAt" DATETIME,
        "roomEventId" TEXT,
        "ignoredReason" TEXT,
        "lastError" TEXT,
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL
      );
      CREATE UNIQUE INDEX "ExecutionOutbox_organizationId_topic_dedupeKey_key"
        ON "ExecutionOutbox" ("organizationId", "topic", "dedupeKey");

      CREATE TABLE "TeamTask" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "blockedReason" TEXT,
        "completedAt" DATETIME,
        "revision" INTEGER NOT NULL,
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL
      );

      CREATE TABLE "TaskActivity" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "taskId" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "actorType" TEXT NOT NULL,
        "actorId" TEXT NOT NULL,
        "metadataJson" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL
      );
    `);

    const now = new Date().toISOString();
    await client.batch(
      [
        runtimeInsert(RUNTIME_ID, now, 0),
        runtimeInsert(FULL_RUNTIME_ID, now, 1),
        runtimeInsert(CANCEL_RUNTIME_ID, now, 0),
        runtimeInsert(DELIVERY_RUNTIME_ID, now, 1),
        runtimeInsert(INVALID_TASK_RUNTIME_ID, now, 1),
        {
          sql: `INSERT INTO "ExecutionJob" (
            "id", "organizationId", "kind", "status",
            "specJson", "requirementsJson", "contextManifestJson",
            "selectionJson", "queuedAt", "revision", "createdAt",
            "updatedAt"
          ) VALUES (?, ?, 'coding', 'queued', ?, '{}', ?, ?, ?, 1, ?, ?)`,
          args: [
            JOB_ID,
            ACTOR.organizationId,
            JSON.stringify({
              schemaVersion: 1,
              goal: 'Verify generation fencing',
              kind: 'coding',
              requirements: {},
            }),
            JSON.stringify(contextManifest(now, 'Verify generation fencing')),
            JSON.stringify(matchedSelection(RUNTIME_ID)),
            now,
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO "ExecutionAttempt" (
            "id", "organizationId", "jobId", "runtimeId", "number",
            "status", "generation", "createdAt", "updatedAt"
          ) VALUES (?, ?, ?, ?, 1, 'pending', 0, ?, ?)`,
          args: [
            ATTEMPT_ID,
            ACTOR.organizationId,
            JOB_ID,
            RUNTIME_ID,
            now,
            now,
          ],
        },
        jobInsert(FULL_JOB_ID, now, 'Verify capacity rejection'),
        {
          sql: `INSERT INTO "ExecutionAttempt" (
            "id", "organizationId", "jobId", "runtimeId", "number",
            "status", "generation", "createdAt", "updatedAt"
          ) VALUES (?, ?, ?, ?, 1, 'pending', 0, ?, ?)`,
          args: [
            FULL_ATTEMPT_ID,
            ACTOR.organizationId,
            FULL_JOB_ID,
            FULL_RUNTIME_ID,
            now,
            now,
          ],
        },
      ],
      'write'
    );
  });

  test.afterAll(async () => {
    await client.close();
    await testPrisma.$disconnect();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  test('requires the assigned runtime and rejects a runtime at capacity', async () => {
    await expect(
      claimExecutionAttempt(ACTOR, {
        attemptId: ATTEMPT_ID,
        runtimeId: 'worker-test-wrong-runtime',
        workerId: 'worker-wrong-runtime',
      })
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(
      claimExecutionAttempt(ACTOR, {
        attemptId: FULL_ATTEMPT_ID,
        runtimeId: FULL_RUNTIME_ID,
        workerId: 'worker-full-runtime',
      })
    ).rejects.toBeInstanceOf(ConflictError);

    expect(await readRuntimeCapacity(RUNTIME_ID)).toBe(0);
    expect(await readRuntimeCapacity(FULL_RUNTIME_ID)).toBe(1);
    expect(await readAttemptStatus(FULL_ATTEMPT_ID)).toBe('pending');
  });

  test('increments generation and fences the stale worker after reclaim', async () => {
    const firstClaim = await claimExecutionAttempt(ACTOR, {
      attemptId: ATTEMPT_ID,
      runtimeId: RUNTIME_ID,
      workerId: 'worker-old',
      leaseDurationMs: 10_000,
    });
    expect(firstClaim).toMatchObject({
      id: ATTEMPT_ID,
      status: 'running',
      generation: 1,
      leaseOwnerId: 'worker-old',
    });
    expect(await readRuntimeCapacity(RUNTIME_ID)).toBe(1);

    await heartbeatExecutionAttempt(ACTOR, {
      attemptId: ATTEMPT_ID,
      workerId: 'worker-old',
      generation: 1,
      runtimeRunId: 'runtime-run-old',
    });

    const expiredAt = new Date(Date.now() - 5_000);
    await testPrisma.$executeRaw`
      UPDATE "ExecutionAttempt"
      SET "leaseExpiresAt" = ${expiredAt}, "updatedAt" = ${expiredAt}
      WHERE "id" = ${ATTEMPT_ID}
    `;

    const secondClaim = await claimExecutionAttempt(ACTOR, {
      attemptId: ATTEMPT_ID,
      runtimeId: RUNTIME_ID,
      workerId: 'worker-current',
      leaseDurationMs: 30_000,
    });
    expect(secondClaim).toMatchObject({
      id: ATTEMPT_ID,
      status: 'running',
      generation: 2,
      leaseOwnerId: 'worker-current',
      runtimeRunId: null,
    });
    expect(await readRuntimeCapacity(RUNTIME_ID)).toBe(1);

    await expect(
      heartbeatExecutionAttempt(ACTOR, {
        attemptId: ATTEMPT_ID,
        workerId: 'worker-old',
        generation: 1,
      })
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(
      completeExecutionAttempt(ACTOR, {
        attemptId: ATTEMPT_ID,
        workerId: 'worker-old',
        generation: 1,
        status: 'succeeded',
        result: { stale: true },
      })
    ).rejects.toBeInstanceOf(ConflictError);

    const heartbeat = await heartbeatExecutionAttempt(ACTOR, {
      attemptId: ATTEMPT_ID,
      workerId: 'worker-current',
      generation: 2,
      checkpoint: { cursor: 12 },
      runtimeRunId: 'runtime-run-current',
    });
    expect(heartbeat).toMatchObject({
      generation: 2,
      leaseOwnerId: 'worker-current',
      checkpoint: { cursor: 12 },
      runtimeRunId: 'runtime-run-current',
    });

    const completed = await completeExecutionAttempt(ACTOR, {
      attemptId: ATTEMPT_ID,
      workerId: 'worker-current',
      generation: 2,
      status: 'succeeded',
      result: { artifactCount: 1 },
    });
    expect(completed.attempt).toMatchObject({
      id: ATTEMPT_ID,
      generation: 2,
      status: 'succeeded',
      leaseOwnerId: null,
      leaseExpiresAt: null,
      result: { artifactCount: 1 },
    });
    expect(completed.job).toMatchObject({
      id: JOB_ID,
      status: 'succeeded',
      revision: 3,
      result: { artifactCount: 1 },
    });
    expect(await readRuntimeCapacity(RUNTIME_ID)).toBe(0);

    const persisted = await getExecutionJob(ACTOR, JOB_ID);
    expect(persisted).toMatchObject({
      status: 'succeeded',
      revision: 3,
      attempts: [
        {
          id: ATTEMPT_ID,
          generation: 2,
          status: 'succeeded',
        },
      ],
    });
  });

  test('retains the exact runtime run id when reclaiming durable workspace completion', async () => {
    const now = new Date().toISOString();
    const jobId = 'worker-test-terminal-reclaim-job';
    const attemptId = 'worker-test-terminal-reclaim-attempt';
    const runtimeRunId = 'runtime-run-terminal-receipt';
    const expiredAt = new Date(Date.now() - 5_000);
    await client.batch(
      [
        jobInsert(jobId, now, 'Recover durable workspace completion'),
        {
          sql: `INSERT INTO "ExecutionAttempt" (
            "id", "organizationId", "jobId", "runtimeId", "number",
            "status", "generation", "capacityReserved",
            "leaseOwnerId", "leaseExpiresAt", "runtimeRunId",
            "workspaceLifecycleJson", "createdAt", "updatedAt"
          ) VALUES (?, ?, ?, ?, 1, 'running', 1, true, ?, ?, ?, ?, ?, ?)`,
          args: [
            attemptId,
            ACTOR.organizationId,
            jobId,
            RUNTIME_ID,
            'worker-terminal-old',
            expiredAt,
            runtimeRunId,
            JSON.stringify(terminalWorkspaceLifecycle(jobId, attemptId, runtimeRunId)),
            now,
            expiredAt,
          ],
        },
        {
          sql: `UPDATE "ExecutionJob"
            SET "status" = 'running', "revision" = 2, "startedAt" = ?,
              "updatedAt" = ?
            WHERE "id" = ?`,
          args: [now, now, jobId],
        },
        {
          sql: `UPDATE "ExecutionRuntime"
            SET "capacityUsed" = 1, "updatedAt" = ?
            WHERE "id" = ?`,
          args: [now, RUNTIME_ID],
        },
      ],
      'write'
    );

    const reclaimed = await claimExecutionAttempt(ACTOR, {
      attemptId,
      runtimeId: RUNTIME_ID,
      workerId: 'worker-terminal-recovery',
      leaseDurationMs: 30_000,
    });

    expect(reclaimed).toMatchObject({
      id: attemptId,
      status: 'running',
      generation: 2,
      leaseOwnerId: 'worker-terminal-recovery',
      runtimeRunId,
    });
    expect(await readRuntimeCapacity(RUNTIME_ID)).toBe(1);
  });

  test('cancels a queued job without reserving capacity', async () => {
    const now = new Date().toISOString();
    await client.batch(
      [
        jobInsert(QUEUED_JOB_ID, now, 'Verify queued cancellation'),
        {
          sql: `INSERT INTO "ExecutionAttempt" (
            "id", "organizationId", "jobId", "runtimeId", "number",
            "status", "generation", "createdAt", "updatedAt"
          ) VALUES (?, ?, ?, ?, 1, 'pending', 0, ?, ?)`,
          args: [
            QUEUED_ATTEMPT_ID,
            ACTOR.organizationId,
            QUEUED_JOB_ID,
            CANCEL_RUNTIME_ID,
            now,
            now,
          ],
        },
      ],
      'write'
    );

    const cancelled = await cancelExecutionJob(ACTOR, QUEUED_JOB_ID, {
      expectedRevision: 1,
    });
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      revision: 2,
      attempts: [
        {
          id: QUEUED_ATTEMPT_ID,
          status: 'cancelled',
          generation: 0,
          leaseOwnerId: null,
          leaseExpiresAt: null,
        },
      ],
    });
    expect(await readRuntimeCapacity(CANCEL_RUNTIME_ID)).toBe(0);

    const retried = await cancelExecutionJob(ACTOR, QUEUED_JOB_ID, {
      expectedRevision: 1,
    });
    expect(retried).toMatchObject({ status: 'cancelled', revision: 2 });
    expect(await readRuntimeCapacity(CANCEL_RUNTIME_ID)).toBe(0);
  });

  test('projects a successful linked execution to TeamTask review in the completion transaction', async () => {
    const now = new Date().toISOString();
    await seedClaimedLinkedExecution({
      attemptId: DELIVERY_ATTEMPT_ID,
      jobId: DELIVERY_JOB_ID,
      runtimeId: DELIVERY_RUNTIME_ID,
      taskId: DELIVERY_TASK_ID,
      taskStatus: 'in_progress',
      now,
    });

    const completed = await completeExecutionAttempt(ACTOR, {
      attemptId: DELIVERY_ATTEMPT_ID,
      workerId: 'worker-delivery',
      generation: 1,
      status: 'succeeded',
      result: { delivery: true },
    });

    expect(completed.attempt.status).toBe('succeeded');
    expect(completed.job.status).toBe('succeeded');
    expect(await readLinkedCompletionState(DELIVERY_TASK_ID, DELIVERY_JOB_ID)).toMatchObject({
      attemptStatus: 'succeeded',
      jobStatus: 'succeeded',
      taskStatus: 'review',
      taskCompletedAt: null,
      deliveryActivities: 1,
    });
    expect(await readRuntimeCapacity(DELIVERY_RUNTIME_ID)).toBe(0);
  });

  test('rolls back completion when a linked TeamTask has an invalid claimed state', async () => {
    const now = new Date().toISOString();
    await seedClaimedLinkedExecution({
      attemptId: INVALID_TASK_ATTEMPT_ID,
      jobId: INVALID_TASK_JOB_ID,
      runtimeId: INVALID_TASK_RUNTIME_ID,
      taskId: INVALID_TASK_ID,
      taskStatus: 'claimed',
      now,
    });

    await expect(
      completeExecutionAttempt(ACTOR, {
        attemptId: INVALID_TASK_ATTEMPT_ID,
        workerId: 'worker-invalid-task',
        generation: 1,
        status: 'succeeded',
      })
    ).rejects.toThrow(/cannot transition from claimed to review/);

    expect(await readLinkedCompletionState(INVALID_TASK_ID, INVALID_TASK_JOB_ID)).toMatchObject({
      attemptStatus: 'running',
      jobStatus: 'running',
      taskStatus: 'claimed',
      deliveryActivities: 0,
    });
    expect(await readRuntimeCapacity(INVALID_TASK_RUNTIME_ID)).toBe(1);
  });

  test('recovers a requested running cancellation and releases capacity once', async () => {
    const now = new Date().toISOString();
    await client.batch(
      [
        {
          sql: `INSERT INTO "ExecutionJob" (
            "id", "organizationId", "kind", "status",
            "specJson", "requirementsJson", "contextManifestJson",
            "selectionJson", "queuedAt", "revision", "createdAt",
            "updatedAt"
          ) VALUES (?, ?, 'coding', 'queued', ?, '{}', ?, ?, ?, 1, ?, ?)`,
          args: [
            CANCEL_JOB_ID,
            ACTOR.organizationId,
            JSON.stringify({
              schemaVersion: 1,
              goal: 'Verify running cancellation fencing',
              kind: 'coding',
              requirements: {},
            }),
            JSON.stringify(
              contextManifest(now, 'Verify running cancellation fencing')
            ),
            JSON.stringify(matchedSelection(CANCEL_RUNTIME_ID)),
            now,
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO "ExecutionAttempt" (
            "id", "organizationId", "jobId", "runtimeId", "number",
            "status", "generation", "createdAt", "updatedAt"
          ) VALUES (?, ?, ?, ?, 1, 'pending', 0, ?, ?)`,
          args: [
            CANCEL_ATTEMPT_ID,
            ACTOR.organizationId,
            CANCEL_JOB_ID,
            CANCEL_RUNTIME_ID,
            now,
            now,
          ],
        },
      ],
      'write'
    );

    const claimed = await claimExecutionAttempt(ACTOR, {
      attemptId: CANCEL_ATTEMPT_ID,
      runtimeId: CANCEL_RUNTIME_ID,
      workerId: 'worker-cancelled',
      leaseDurationMs: 30_000,
    });
    expect(claimed).toMatchObject({
      status: 'running',
      generation: 1,
      leaseOwnerId: 'worker-cancelled',
    });
    expect(await readRuntimeCapacity(CANCEL_RUNTIME_ID)).toBe(1);

    const cancellationRequested = await cancelExecutionJob(ACTOR, CANCEL_JOB_ID, {
      expectedRevision: 2,
    });
    expect(cancellationRequested).toMatchObject({
      id: CANCEL_JOB_ID,
      status: 'cancel_requested',
      revision: 3,
      cancelRequestedAt: expect.any(String),
      finishedAt: null,
      attempts: [
        {
          id: CANCEL_ATTEMPT_ID,
          status: 'running',
          generation: 1,
          leaseOwnerId: 'worker-cancelled',
          leaseExpiresAt: claimed.leaseExpiresAt,
          finishedAt: null,
        },
      ],
    });
    expect(await readRuntimeCapacity(CANCEL_RUNTIME_ID)).toBe(1);

    const retried = await cancelExecutionJob(ACTOR, CANCEL_JOB_ID, {
      expectedRevision: 2,
    });
    expect(retried).toMatchObject({
      status: 'cancel_requested',
      revision: 3,
      cancelRequestedAt: cancellationRequested.cancelRequestedAt,
      finishedAt: null,
    });
    expect(await readRuntimeCapacity(CANCEL_RUNTIME_ID)).toBe(1);

    const heartbeat = await heartbeatExecutionAttempt(ACTOR, {
      attemptId: CANCEL_ATTEMPT_ID,
      workerId: 'worker-cancelled',
      generation: 1,
      checkpoint: { mustNotAdvance: true },
      runtimeRunId: 'runtime-run-cancelled',
    });
    expect(heartbeat).toMatchObject({
      generation: 1,
      leaseOwnerId: 'worker-cancelled',
      cancelRequested: true,
      checkpoint: null,
      runtimeRunId: 'runtime-run-cancelled',
    });

    await expect(
      appendExecutionEvent(ACTOR, {
        attemptId: CANCEL_ATTEMPT_ID,
        workerId: 'worker-cancelled',
        generation: 1,
        runtimeEventId: 'stale-after-cancel',
        event: { type: 'text-delta', text: 'must not persist' },
      })
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await countAttemptEvents(CANCEL_ATTEMPT_ID)).toBe(0);

    await expect(
      completeExecutionAttempt(ACTOR, {
        attemptId: CANCEL_ATTEMPT_ID,
        workerId: 'worker-cancelled',
        generation: 1,
        status: 'succeeded',
        result: { stale: true },
      })
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      completeExecutionAttempt(ACTOR, {
        attemptId: CANCEL_ATTEMPT_ID,
        workerId: 'worker-cancelled',
        generation: 1,
        status: 'failed',
        error: { stale: true },
      })
    ).rejects.toBeInstanceOf(ConflictError);

    const expiredAt = new Date(Date.now() - 5_000);
    await testPrisma.$executeRaw`
      UPDATE "ExecutionAttempt"
      SET "leaseExpiresAt" = ${expiredAt}, "updatedAt" = ${expiredAt}
      WHERE "id" = ${CANCEL_ATTEMPT_ID}
    `;

    const recoveryClaim = await claimExecutionAttempt(ACTOR, {
      attemptId: CANCEL_ATTEMPT_ID,
      runtimeId: CANCEL_RUNTIME_ID,
      workerId: 'worker-cancel-cleanup',
      leaseDurationMs: 30_000,
    });
    expect(recoveryClaim).toMatchObject({
      status: 'running',
      generation: 2,
      leaseOwnerId: 'worker-cancel-cleanup',
      cancelRequested: true,
    });
    expect(await readRuntimeCapacity(CANCEL_RUNTIME_ID)).toBe(1);

    await expect(
      heartbeatExecutionAttempt(ACTOR, {
        attemptId: CANCEL_ATTEMPT_ID,
        workerId: 'worker-cancelled',
        generation: 1,
      })
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      appendExecutionEvent(ACTOR, {
        attemptId: CANCEL_ATTEMPT_ID,
        workerId: 'worker-cancelled',
        generation: 1,
        runtimeEventId: 'stale-interrupted-after-reclaim',
        event: { type: 'attempt-completed', status: 'interrupted' },
      })
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      completeExecutionAttempt(ACTOR, {
        attemptId: CANCEL_ATTEMPT_ID,
        workerId: 'worker-cancelled',
        generation: 1,
        status: 'cancelled',
      })
    ).rejects.toBeInstanceOf(ConflictError);

    const interrupted = await appendExecutionEvent(ACTOR, {
      attemptId: CANCEL_ATTEMPT_ID,
      workerId: 'worker-cancel-cleanup',
      generation: 2,
      runtimeEventId: 'cancel-interrupted',
      event: {
        type: 'attempt-completed',
        status: 'interrupted',
        message: 'cancel requested',
      },
    });
    expect(interrupted.event).toMatchObject({
      type: 'attempt-completed',
      payload: { status: 'interrupted', message: 'cancel requested' },
    });

    const completed = await completeExecutionAttempt(ACTOR, {
      attemptId: CANCEL_ATTEMPT_ID,
      workerId: 'worker-cancel-cleanup',
      generation: 2,
      status: 'cancelled',
      result: { mustNotPersist: true },
      error: { message: 'cancel requested' },
    });
    expect(completed.job).toMatchObject({
      status: 'cancelled',
      revision: 4,
      result: null,
      error: { message: 'cancel requested' },
    });
    expect(completed.attempt).toMatchObject({
      status: 'cancelled',
      generation: 2,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      result: null,
    });
    expect(await readRuntimeCapacity(CANCEL_RUNTIME_ID)).toBe(0);

    await expect(
      completeExecutionAttempt(ACTOR, {
        attemptId: CANCEL_ATTEMPT_ID,
        workerId: 'worker-cancel-cleanup',
        generation: 2,
        status: 'cancelled',
      })
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await readRuntimeCapacity(CANCEL_RUNTIME_ID)).toBe(0);

    const persisted = await getExecutionJob(ACTOR, CANCEL_JOB_ID);
    expect(persisted).toMatchObject({
      status: 'cancelled',
      revision: 4,
      result: null,
      error: { message: 'cancel requested' },
      attempts: [
        {
          status: 'cancelled',
          generation: 2,
          leaseOwnerId: null,
          leaseExpiresAt: null,
          result: null,
          error: { message: 'cancel requested' },
        },
      ],
    });
  });
});

function runtimeInsert(id: string, now: string, capacityUsed: number) {
  const capabilities = {
    schemaVersion: 1,
    kinds: ['coding'],
    nativeResume: false,
    checkpoint: false,
    streaming: 'typed-events',
    interrupt: 'process-kill',
    workspace: 'none',
    sandbox: 'host',
    structuredArtifacts: false,
    waitingForHuman: false,
    supportedModels: [],
  };
  return {
    sql: `INSERT INTO "ExecutionRuntime" (
      "id", "organizationId", "enabled", "capabilitiesJson", "capacityTotal",
      "capacityUsed", "createdAt", "updatedAt"
    ) VALUES (?, ?, true, ?, 1, ?, ?, ?)`,
    args: [id, ACTOR.organizationId, JSON.stringify(capabilities), capacityUsed, now, now],
  };
}

function jobInsert(id: string, now: string, goal: string) {
  const runtimeId =
    id === FULL_JOB_ID
      ? FULL_RUNTIME_ID
      : id === QUEUED_JOB_ID
        ? CANCEL_RUNTIME_ID
        : RUNTIME_ID;
  return {
    sql: `INSERT INTO "ExecutionJob" (
      "id", "organizationId", "kind", "status",
      "specJson", "requirementsJson", "contextManifestJson",
      "selectionJson", "queuedAt", "revision", "createdAt",
      "updatedAt"
    ) VALUES (?, ?, 'coding', 'queued', ?, '{}', ?, ?, ?, 1, ?, ?)`,
    args: [
      id,
      ACTOR.organizationId,
      JSON.stringify({
        schemaVersion: 1,
        goal,
        kind: 'coding',
        requirements: {},
      }),
      JSON.stringify(contextManifest(now, goal)),
      JSON.stringify(matchedSelection(runtimeId)),
      now,
      now,
      now,
    ],
  };
}

async function seedClaimedLinkedExecution(input: {
  attemptId: string;
  jobId: string;
  runtimeId: string;
  taskId: string;
  taskStatus: string;
  now: string;
}) {
  const leaseExpiresAt = new Date(Date.now() + 30_000).toISOString();
  const selection = matchedSelection(input.runtimeId);
  await client.batch(
    [
      {
        sql: `INSERT INTO "TeamTask" (
          "id", "organizationId", "status", "revision",
          "createdAt", "updatedAt"
        ) VALUES (?, ?, ?, 1, ?, ?)`,
        args: [input.taskId, ACTOR.organizationId, input.taskStatus, input.now, input.now],
      },
      {
        sql: `INSERT INTO "ExecutionJob" (
          "id", "organizationId", "teamTaskId", "kind", "status",
          "specJson", "requirementsJson", "contextManifestJson",
          "selectionJson", "selectedRuntimeId", "queuedAt", "startedAt",
          "revision", "createdAt", "updatedAt"
        ) VALUES (?, ?, ?, 'coding', 'running', ?, '{}', ?, ?, ?, ?, ?, 2, ?, ?)`,
        args: [
          input.jobId,
          ACTOR.organizationId,
          input.taskId,
          JSON.stringify({
            schemaVersion: 1,
            goal: `Complete linked task ${input.taskId}`,
            kind: 'coding',
            requirements: {},
          }),
          JSON.stringify(contextManifest(input.now, `Complete linked task ${input.taskId}`)),
          JSON.stringify(selection),
          input.runtimeId,
          input.now,
          input.now,
          input.now,
          input.now,
        ],
      },
      {
        sql: `INSERT INTO "ExecutionAttempt" (
          "id", "organizationId", "jobId", "runtimeId", "number",
          "status", "generation", "capacityReserved", "leaseOwnerId",
          "leaseExpiresAt", "startedAt", "createdAt", "updatedAt"
        ) VALUES (?, ?, ?, ?, 1, 'running', 1, true, ?, ?, ?, ?, ?)`,
        args: [
          input.attemptId,
          ACTOR.organizationId,
          input.jobId,
          input.runtimeId,
          input.taskId === DELIVERY_TASK_ID ? 'worker-delivery' : 'worker-invalid-task',
          leaseExpiresAt,
          input.now,
          input.now,
          input.now,
        ],
      },
    ],
    'write'
  );
}

function matchedSelection(runtimeId: string) {
  const candidate = {
    descriptor: {
      schemaVersion: 1,
      runtimeId,
      displayName: runtimeId,
      runtimeVersion: 'test',
      capabilities: {
        schemaVersion: 1,
        kinds: ['coding'],
        nativeResume: false,
        checkpoint: false,
        streaming: 'typed-events',
        interrupt: 'process-kill',
        workspace: 'none',
        sandbox: 'host',
        structuredArtifacts: false,
        waitingForHuman: false,
        supportedModels: [],
      },
    },
    health: { state: 'healthy', acceptingNewAttempts: true },
    capacity: { availableSlots: 1 },
  };
  return {
    schemaVersion: 1,
    matched: true,
    selected: candidate,
    selectedBy: 'automatic-ranking',
    evaluations: [
      { candidate, eligible: true, preferenceRank: null, rejectionReasons: [] },
    ],
  };
}

async function readLinkedCompletionState(taskId: string, jobId: string) {
  const result = await client.execute({
    sql: `SELECT task."status" AS "taskStatus",
                 task."completedAt" AS "taskCompletedAt",
                 job."status" AS "jobStatus",
                 attempt."status" AS "attemptStatus",
                 (SELECT COUNT(*) FROM "TaskActivity" AS activity
                  WHERE activity."taskId" = task."id"
                    AND activity."type" = 'delivery') AS "deliveryActivities"
          FROM "TeamTask" AS task
          INNER JOIN "ExecutionJob" AS job ON job."teamTaskId" = task."id"
          INNER JOIN "ExecutionAttempt" AS attempt ON attempt."jobId" = job."id"
          WHERE task."id" = ? AND job."id" = ?`,
    args: [taskId, jobId],
  });
  const row = result.rows[0];
  return {
    attemptStatus: String(row?.attemptStatus),
    deliveryActivities: Number(row?.deliveryActivities),
    jobStatus: String(row?.jobStatus),
    taskCompletedAt: row?.taskCompletedAt ?? null,
    taskStatus: String(row?.taskStatus),
  };
}

async function readRuntimeCapacity(runtimeId: string) {
  const result = await client.execute({
    sql: `SELECT "capacityUsed" FROM "ExecutionRuntime" WHERE "id" = ?`,
    args: [runtimeId],
  });
  return Number(result.rows[0]?.capacityUsed);
}

async function readAttemptStatus(attemptId: string) {
  const result = await client.execute({
    sql: `SELECT "status" FROM "ExecutionAttempt" WHERE "id" = ?`,
    args: [attemptId],
  });
  return String(result.rows[0]?.status);
}

async function countAttemptEvents(attemptId: string) {
  const result = await client.execute({
    sql: `SELECT COUNT(*) AS count FROM "ExecutionEvent" WHERE "attemptId" = ?`,
    args: [attemptId],
  });
  return Number(result.rows[0]?.count);
}

function contextManifest(frozenAt: string, goal: string) {
  const emptySha256 =
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  return {
    schemaVersion: 1,
    goal,
    frozenAt,
    source: {
      type: 'workspace-draft',
      workspaceId: 'worker-test-workspace',
      conversationId: null,
      documentVersionId: null,
    },
    workspace: {
      id: 'worker-test-workspace',
      projectId: 'worker-test-workspace',
      title: 'Worker Test',
      draftRevision: 1,
      revision: 1,
    },
    document: {
      id: 'worker-test-workspace',
      title: 'Worker Test',
      versionId: null,
      revision: 1,
      content: '',
      contentSha256: emptySha256,
    },
    files: [],
    roomWatermark: null,
    knowledgeCommit: null,
  };
}

function terminalWorkspaceLifecycle(
  jobId: string,
  attemptId: string,
  runtimeRunId: string
) {
  const baseCommit = '1'.repeat(40);
  return {
    schemaVersion: 1,
    kind: 'git-worktree',
    binding: {
      schemaVersion: 1,
      bindingId: 'worker-test-binding',
      spaceId: 'worker-test-space',
      workspaceId: 'worker-test-workspace',
      agentId: null,
      mountPath: '/',
      defaultBranch: 'main',
      baseCommit,
    },
    prepared: {
      schemaVersion: 1,
      spaceId: 'worker-test-space',
      mountPath: '/',
      repositoryPath: '/private/worker-test-repository',
      worktreePath: '/private/worker-test-worktree',
      defaultBranch: 'main',
      branch: `job/${jobId}/attempt/1`,
      baseCommit,
      jobId,
      attemptId,
      attemptNumber: 1,
    },
    runtimeCompletion: {
      status: 'succeeded',
      runtimeRunId,
      result: { text: 'durable terminal result' },
    },
  };
}
