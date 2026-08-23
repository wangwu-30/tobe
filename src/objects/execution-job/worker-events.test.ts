import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createClient, type Client } from '@libsql/client';
import { expect, test } from '@playwright/test';

import { ConflictError, ValidationError } from '@/framework/resilience';

import { prisma as testPrisma } from './test-prisma';
import { appendExecutionEvent, persistExecutionArtifact } from './worker-events';

const ACTOR = { organizationId: 'worker-events-org' };
const JOB_ID = 'worker-events-job';
const ATTEMPT_A_ID = 'worker-events-attempt-a';
const ATTEMPT_B_ID = 'worker-events-attempt-b';
const WORKER_ID = 'worker-events-current';
const GENERATION = 2;

let client: Client;
let temporaryRoot: string;

test.describe.serial('execution runtime event and artifact ingestion', () => {
  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tobe-execution-events-')
    );
    const databasePath = path.join(temporaryRoot, 'events.db');
    process.env.DAO_APP_DATA_ROOT = temporaryRoot;
    process.env.DATABASE_URL = `file:${databasePath}`;
    client = createClient({ url: `file:${databasePath}` });

    await client.executeMultiple(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE "ExecutionJob" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "teamTaskId" TEXT,
        "originRoomId" TEXT,
        "originRoomMessageId" TEXT,
        "selectedRuntimeId" TEXT,
        "status" TEXT NOT NULL,
        "revision" INTEGER NOT NULL DEFAULT 1,
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL
      );

      CREATE TABLE "ExecutionAttempt" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "jobId" TEXT NOT NULL,
        "runtimeId" TEXT,
        "status" TEXT NOT NULL,
        "generation" INTEGER NOT NULL,
        "capacityReserved" BOOLEAN NOT NULL DEFAULT true,
        "leaseOwnerId" TEXT,
        "leaseExpiresAt" DATETIME,
        "runtimeRunId" TEXT,
        "checkpointJson" TEXT,
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL,
        FOREIGN KEY ("jobId") REFERENCES "ExecutionJob" ("id")
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
        "createdAt" DATETIME NOT NULL,
        FOREIGN KEY ("jobId") REFERENCES "ExecutionJob" ("id"),
        FOREIGN KEY ("attemptId") REFERENCES "ExecutionAttempt" ("id")
      );
      CREATE UNIQUE INDEX "ExecutionEvent_jobId_sequence_key"
        ON "ExecutionEvent" ("jobId", "sequence");
      CREATE UNIQUE INDEX "ExecutionEvent_attemptId_runtimeEventId_key"
        ON "ExecutionEvent" ("attemptId", "runtimeEventId");

      CREATE TABLE "ExecutionArtifact" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "jobId" TEXT NOT NULL,
        "attemptId" TEXT,
        "kind" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "storageUri" TEXT,
        "payloadJson" TEXT,
        "mimeType" TEXT,
        "sizeBytes" INTEGER,
        "sha256" TEXT,
        "metadataJson" TEXT NOT NULL DEFAULT '{}',
        "createdAt" DATETIME NOT NULL,
        FOREIGN KEY ("jobId") REFERENCES "ExecutionJob" ("id"),
        FOREIGN KEY ("attemptId") REFERENCES "ExecutionAttempt" ("id")
      );

      CREATE TABLE "ExecutionRuntime" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "capacityUsed" INTEGER NOT NULL DEFAULT 0,
        "capacityUpdatedAt" DATETIME,
        "updatedAt" DATETIME NOT NULL
      );

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
    `);

    const now = new Date();
    const leaseExpiresAt = new Date(now.valueOf() + 60_000);
    await client.batch(
      [
        {
          sql: `INSERT INTO "ExecutionRuntime" ("id", "organizationId", "capacityUsed", "updatedAt") VALUES ('worker-events-runtime', ?, 2, ?)`,
          args: [ACTOR.organizationId, now],
        },
        {
          sql: `INSERT INTO "ExecutionJob" (
            "id", "organizationId", "status", "createdAt", "updatedAt"
          ) VALUES (?, ?, 'running', ?, ?)`,
          args: [JOB_ID, ACTOR.organizationId, now, now],
        },
        attemptInsert(ATTEMPT_A_ID, now, leaseExpiresAt),
        attemptInsert(ATTEMPT_B_ID, now, leaseExpiresAt),
      ],
      'write'
    );
  });

  test.afterAll(async () => {
    await client.close();
    await testPrisma.$disconnect();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  test('rejects stale generation before writing any fact', async () => {
    await expect(
      appendExecutionEvent(ACTOR, {
        attemptId: ATTEMPT_A_ID,
        workerId: WORKER_ID,
        generation: GENERATION - 1,
        runtimeEventId: 'stale-1',
        event: { type: 'text-delta', text: 'must not persist' },
      })
    ).rejects.toBeInstanceOf(ConflictError);

    expect(await countRows('ExecutionEvent')).toBe(0);
  });

  test('allocates a monotonically increasing sequence within the Job', async () => {
    const first = await appendExecutionEvent(ACTOR, {
      attemptId: ATTEMPT_A_ID,
      workerId: WORKER_ID,
      generation: GENERATION,
      runtimeEventId: 'event-1',
      event: { type: 'text-delta', text: 'hello' },
      occurredAt: '2026-08-21T01:02:03.000Z',
    });
    const second = await appendExecutionEvent(ACTOR, {
      attemptId: ATTEMPT_B_ID,
      workerId: WORKER_ID,
      generation: GENERATION,
      runtimeEventId: 'event-2',
      event: { type: 'progress', message: 'Working', percent: 25 },
    });

    expect(first).toMatchObject({
      state: 'appended',
      replayed: false,
      event: {
        jobId: JOB_ID,
        attemptId: ATTEMPT_A_ID,
        sequence: 1,
        type: 'text-delta',
        payload: { text: 'hello' },
        occurredAt: '2026-08-21T01:02:03.000Z',
      },
    });
    expect(second.event).toMatchObject({
      jobId: JOB_ID,
      attemptId: ATTEMPT_B_ID,
      sequence: 2,
      payload: { message: 'Working', percent: 25 },
    });
    expect(second.state).toBe('appended');
  });

  test('replays identical runtimeEventId and conflicts on different payload', async () => {
    const replay = await appendExecutionEvent(ACTOR, {
      attemptId: ATTEMPT_A_ID,
      workerId: WORKER_ID,
      generation: GENERATION,
      runtimeEventId: 'event-1',
      event: { type: 'text-delta', text: 'hello' },
    });
    expect(replay).toMatchObject({ replayed: true, event: { sequence: 1 } });

    await expect(
      appendExecutionEvent(ACTOR, {
        attemptId: ATTEMPT_A_ID,
        workerId: WORKER_ID,
        generation: GENERATION,
        runtimeEventId: 'event-1',
        event: { type: 'text-delta', text: 'different' },
      })
    ).rejects.toBeInstanceOf(ConflictError);

    expect(await countRows('ExecutionEvent')).toBe(2);
  });

  test('stores checkpoint and completion facts without ending control state', async () => {
    const checkpoint = await appendExecutionEvent(ACTOR, {
      attemptId: ATTEMPT_A_ID,
      workerId: WORKER_ID,
      generation: GENERATION,
      runtimeEventId: 'event-checkpoint',
      event: { type: 'checkpoint', checkpointRef: 'checkpoint-42' },
    });
    const completed = await appendExecutionEvent(ACTOR, {
      attemptId: ATTEMPT_A_ID,
      workerId: WORKER_ID,
      generation: GENERATION,
      runtimeEventId: 'event-completed',
      event: {
        type: 'attempt-completed',
        status: 'succeeded',
        message: 'runtime is done',
      },
    });

    expect(checkpoint.event.sequence).toBe(3);
    expect(completed.event.sequence).toBe(4);
    const rows = await client.execute({
      sql: `SELECT attempt."status" AS "attemptStatus",
                   attempt."checkpointJson", job."status" AS "jobStatus"
            FROM "ExecutionAttempt" AS attempt
            JOIN "ExecutionJob" AS job ON job."id" = attempt."jobId"
            WHERE attempt."id" = ?`,
      args: [ATTEMPT_A_ID],
    });
    expect(rows.rows[0]).toMatchObject({
      attemptStatus: 'running',
      checkpointJson: JSON.stringify('checkpoint-42'),
      jobStatus: 'running',
    });
  });

  test('persists attempt-started and runtimeRunId in the same transaction', async () => {
    const started = await appendExecutionEvent(ACTOR, {
      attemptId: ATTEMPT_A_ID,
      workerId: WORKER_ID,
      generation: GENERATION,
      runtimeEventId: 'event-attempt-started',
      event: { type: 'attempt-started', runtimeAttemptId: 'runtime-run-a' },
    });
    expect(started).toMatchObject({
      state: 'appended',
      replayed: false,
      event: {
        type: 'attempt-started',
        payload: { runtimeAttemptId: 'runtime-run-a' },
      },
    });
    const attempt = await client.execute({
      sql: 'SELECT "runtimeRunId" FROM "ExecutionAttempt" WHERE "id" = ?',
      args: [ATTEMPT_A_ID],
    });
    expect(attempt.rows[0]).toMatchObject({ runtimeRunId: 'runtime-run-a' });

    await expect(
      appendExecutionEvent(ACTOR, {
        attemptId: ATTEMPT_A_ID,
        workerId: WORKER_ID,
        generation: GENERATION,
        runtimeEventId: 'event-attempt-started-conflict',
        event: { type: 'attempt-started', runtimeAttemptId: 'runtime-run-other' },
      })
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await countRuntimeEvents('event-attempt-started-conflict')).toBe(0);
  });

  test('persists event and direct artifacts under organization/job/attempt', async () => {
    const eventResult = await appendExecutionEvent(ACTOR, {
      attemptId: ATTEMPT_A_ID,
      workerId: WORKER_ID,
      generation: GENERATION,
      runtimeEventId: 'event-artifact',
      event: {
        type: 'artifact',
        artifact: {
          artifactId: 'runtime-artifact-1',
          kind: 'report',
          mediaType: 'text/markdown',
          uri: 's3://execution-artifacts/report.md',
        },
      },
    });
    expect(eventResult.artifact).toMatchObject({
      id: 'runtime-artifact-1',
      organizationId: ACTOR.organizationId,
      jobId: JOB_ID,
      attemptId: ATTEMPT_A_ID,
      kind: 'report',
      name: 'runtime-artifact-1',
      uri: 's3://execution-artifacts/report.md',
      mimeType: 'text/markdown',
    });

    const inline = await persistExecutionArtifact(ACTOR, {
      attemptId: ATTEMPT_A_ID,
      workerId: WORKER_ID,
      generation: GENERATION,
      artifact: {
        kind: 'structured-result',
        name: 'result.json',
        payload: { ok: true, values: [1, 2] },
        mimeType: 'application/json',
        sizeBytes: 26,
        sha256: 'A'.repeat(64),
      },
    });
    expect(inline).toMatchObject({
      organizationId: ACTOR.organizationId,
      jobId: JOB_ID,
      attemptId: ATTEMPT_A_ID,
      payload: { ok: true, values: [1, 2] },
      uri: null,
      sha256: 'a'.repeat(64),
    });

    const persisted = await client.execute({
      sql: `SELECT "organizationId", "jobId", "attemptId"
            FROM "ExecutionArtifact" ORDER BY "createdAt", "id"`,
      args: [],
    });
    expect(persisted.rows).toHaveLength(2);
    expect(persisted.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: ACTOR.organizationId,
          jobId: JOB_ID,
          attemptId: ATTEMPT_A_ID,
        }),
      ])
    );
  });

  test('validates artifact storage form, digest, size, and name', async () => {
    const base = {
      attemptId: ATTEMPT_A_ID,
      workerId: WORKER_ID,
      generation: GENERATION,
    };

    await expect(
      persistExecutionArtifact(ACTOR, {
        ...base,
        artifact: {
          kind: 'report',
          name: 'ambiguous.txt',
          uri: 'https://example.com/ambiguous.txt',
          payload: 'inline',
        },
      })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      persistExecutionArtifact(ACTOR, {
        ...base,
        artifact: {
          kind: 'report',
          name: '../unsafe.txt',
          uri: 'relative/path',
          sizeBytes: -1,
          sha256: 'not-a-digest',
        },
      })
    ).rejects.toBeInstanceOf(ValidationError);

    expect(await countRows('ExecutionArtifact')).toBe(2);
  });

  test('atomically pauses for human input, releases capacity, and replays safely', async () => {
    const event = {
      type: 'waiting-for-human' as const,
      requestId: 'approval-request-1',
      prompt: 'Approve the proposed change?',
    };
    const first = await appendExecutionEvent(ACTOR, {
      attemptId: ATTEMPT_B_ID,
      workerId: WORKER_ID,
      generation: GENERATION,
      runtimeEventId: 'event-waiting-input',
      event,
    });
    expect(first).toMatchObject({
      state: 'suspended',
      replayed: false,
      event: { type: 'waiting-for-human', payload: {
        requestId: 'approval-request-1',
        prompt: 'Approve the proposed change?',
      } },
    });

    const state = await client.execute({
      sql: `SELECT attempt."status" AS "attemptStatus",
                   attempt."generation", attempt."leaseOwnerId",
                   attempt."leaseExpiresAt", attempt."capacityReserved",
                   job."status" AS "jobStatus",
                   job."revision", runtime."capacityUsed"
            FROM "ExecutionAttempt" AS attempt
            JOIN "ExecutionJob" AS job ON job."id" = attempt."jobId"
            JOIN "ExecutionRuntime" AS runtime ON runtime."id" = attempt."runtimeId"
            WHERE attempt."id" = ?`,
      args: [ATTEMPT_B_ID],
    });
    expect(state.rows[0]).toMatchObject({
      attemptStatus: 'waiting_input',
      generation: GENERATION + 1,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      capacityReserved: 0,
      jobStatus: 'waiting_input',
      revision: 2,
      capacityUsed: 1,
    });
    const request = await client.execute({
      sql: `SELECT "id", "requestKey", "prompt", "status", "revision"
            FROM "ExecutionInputRequest" WHERE "id" = ?`,
      args: [event.requestId],
    });
    expect(request.rows[0]).toMatchObject({
      id: event.requestId,
      requestKey: event.requestId,
      prompt: event.prompt,
      status: 'pending',
      revision: 1,
    });

    const replay = await appendExecutionEvent(ACTOR, {
      attemptId: ATTEMPT_B_ID,
      workerId: WORKER_ID,
      generation: GENERATION,
      runtimeEventId: 'event-waiting-input',
      event,
    });
    expect(replay).toMatchObject({
      state: 'suspended',
      replayed: true,
      event: { id: first.event.id },
    });
    expect(await countRows('ExecutionInputRequest')).toBe(1);
  });

  test('allows only an interrupted completion fact after cancellation is requested', async () => {
    await client.execute({
      sql: `UPDATE "ExecutionJob" SET "status" = 'cancel_requested' WHERE "id" = ?`,
      args: [JOB_ID],
    });
    const before = await countRows('ExecutionEvent');

    const rejectedEvents = [
      { type: 'attempt-started', runtimeAttemptId: 'too-late' },
      { type: 'text-delta', text: 'too late' },
      { type: 'progress', message: 'too late' },
      { type: 'checkpoint', checkpointRef: 'too-late' },
      {
        type: 'artifact',
        artifact: {
          artifactId: 'too-late-artifact',
          kind: 'report',
          uri: 's3://execution-artifacts/too-late',
        },
      },
      { type: 'attempt-completed', status: 'succeeded' },
      { type: 'attempt-completed', status: 'failed' },
    ] as const;
    for (const [index, event] of rejectedEvents.entries()) {
      await expect(
        appendExecutionEvent(ACTOR, {
          attemptId: ATTEMPT_A_ID,
          workerId: WORKER_ID,
          generation: GENERATION,
          runtimeEventId: `cancel-rejected-${index}`,
          event,
        })
      ).rejects.toBeInstanceOf(ConflictError);
    }
    await expect(
      persistExecutionArtifact(ACTOR, {
        attemptId: ATTEMPT_A_ID,
        workerId: WORKER_ID,
        generation: GENERATION,
        artifact: { kind: 'report', name: 'too-late.txt', payload: 'too late' },
      })
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await countRows('ExecutionEvent')).toBe(before);
    expect(await countRows('ExecutionArtifact')).toBe(2);

    const interrupted = await appendExecutionEvent(ACTOR, {
      attemptId: ATTEMPT_A_ID,
      workerId: WORKER_ID,
      generation: GENERATION,
      runtimeEventId: 'cancel-interrupted',
      event: { type: 'attempt-completed', status: 'interrupted' },
    });
    expect(interrupted.event).toMatchObject({
      type: 'attempt-completed',
      payload: { status: 'interrupted' },
    });
    expect(await countRows('ExecutionEvent')).toBe(before + 1);
  });
});

function attemptInsert(
  attemptId: string,
  now: Date,
  leaseExpiresAt: Date
) {
  return {
    sql: `INSERT INTO "ExecutionAttempt" (
      "id", "organizationId", "jobId", "runtimeId", "status", "generation",
      "capacityReserved", "leaseOwnerId", "leaseExpiresAt", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, 'worker-events-runtime', 'running', ?, TRUE, ?, ?, ?, ?)`,
    args: [
      attemptId,
      ACTOR.organizationId,
      JOB_ID,
      GENERATION,
      WORKER_ID,
      leaseExpiresAt,
      now,
      now,
    ],
  };
}

async function countRows(
  table: 'ExecutionEvent' | 'ExecutionArtifact' | 'ExecutionInputRequest'
) {
  const result = await client.execute(`SELECT COUNT(*) AS count FROM "${table}"`);
  return Number(result.rows[0]?.count);
}

async function countRuntimeEvents(runtimeEventId: string) {
  const result = await client.execute({
    sql: 'SELECT COUNT(*) AS count FROM "ExecutionEvent" WHERE "runtimeEventId" = ?',
    args: [runtimeEventId],
  });
  return Number(result.rows[0]?.count);
}
