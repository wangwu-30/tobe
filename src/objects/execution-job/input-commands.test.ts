import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createClient, type Client } from '@libsql/client';
import { expect, test } from '@playwright/test';

import { ConflictError } from '@/framework/resilience';

import { answerExecutionInputRequest } from './input-commands';
import { prisma as testPrisma } from './test-prisma';
import { claimExecutionAttempt } from './worker-commands';
import { appendExecutionEvent } from './worker-events';

const ACTOR = { organizationId: 'input-command-org', userId: 'server-user' };
const JOB_ID = 'input-command-job';
const ATTEMPT_ID = 'input-command-attempt';
const REQUEST_ID = 'input-command-request';
const NOW = '2026-08-21T12:00:00.000Z';

let client: Client;
let temporaryRoot: string;

test.describe.serial('execution input answer transition', () => {
  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tobe-input-command-'));
    const databasePath = path.join(temporaryRoot, 'input.db');
    process.env.DATABASE_URL = `file:${databasePath}`;
    client = createClient({ url: `file:${databasePath}` });
    await client.executeMultiple(schemaSql());
  });

  test.beforeEach(async () => {
    await client.execute('DELETE FROM "ExecutionOutbox"');
    await client.execute('DELETE FROM "ExecutionEvent"');
    await client.execute('DELETE FROM "ExecutionInputRequest"');
    await client.execute('DELETE FROM "ExecutionAttempt"');
    await client.execute('DELETE FROM "ExecutionJob"');
    await client.execute('DELETE FROM "ExecutionRuntime"');
    await client.batch([runtimeInsert(), jobInsert(), attemptInsert(), requestInsert()], 'write');
  });

  test.afterAll(async () => {
    await client.close();
    await testPrisma.$disconnect();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  test('stores the server actor and atomically requeues the suspended attempt', async () => {
    const responseId = 'response-input-command-request';
    const result = await answerExecutionInputRequest(ACTOR, JOB_ID, REQUEST_ID, {
      expectedInputRevision: 1,
      expectedJobRevision: 4,
      responseId,
      response: { approved: true, note: 'continue' },
    });

    expect(result).toMatchObject({
      inputRequest: {
        id: REQUEST_ID,
        status: 'answered',
        revision: 2,
        respondedById: ACTOR.userId,
        responseId,
        response: { approved: true, note: 'continue' },
      },
      job: { status: 'queued', revision: 5 },
      resume: { attemptId: ATTEMPT_ID, generation: 7, state: 'queued' },
    });
    const attempt = await client.execute({
      sql: 'SELECT "status", "generation", "leaseOwnerId", "leaseExpiresAt", "runtimeRunId", "checkpointJson" FROM "ExecutionAttempt" WHERE "id" = ?',
      args: [ATTEMPT_ID],
    });
    expect(attempt.rows[0]).toMatchObject({
      status: 'pending',
      generation: 7,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      runtimeRunId: 'runtime-run-1',
      checkpointJson: JSON.stringify('checkpoint-1'),
    });

    const claimed = await claimExecutionAttempt(ACTOR, {
      attemptId: ATTEMPT_ID,
      runtimeId: 'runtime-1',
      workerId: 'resume-worker',
    });
    expect(claimed).toMatchObject({
      status: 'running',
      generation: 8,
      runtimeRunId: 'runtime-run-1',
      checkpoint: 'checkpoint-1',
      resumeInput: {
        requestId: REQUEST_ID,
        responseId,
        response: { approved: true, note: 'continue' },
      },
    });
  });

  test('preserves the exact answer receipt across claim and later revisions', async () => {
    const input = {
      expectedInputRevision: 1,
      expectedJobRevision: 4,
      responseId: 'stable-response-id',
      response: { approved: true },
    } as const;
    const first = await answerExecutionInputRequest(ACTOR, JOB_ID, REQUEST_ID, input);
    expect(first).toMatchObject({
      inputRequest: { responseId: input.responseId, response: input.response },
      job: { status: 'queued', revision: 5 },
      resume: { attemptId: ATTEMPT_ID, generation: 7 },
    });

    const claimed = await claimExecutionAttempt(ACTOR, {
      attemptId: ATTEMPT_ID,
      runtimeId: 'runtime-1',
      workerId: 'resume-worker',
    });
    expect(claimed).toMatchObject({
      generation: 8,
      resumeInput: {
        requestId: REQUEST_ID,
        responseId: input.responseId,
        response: input.response,
      },
    });

    const replay = await answerExecutionInputRequest(ACTOR, JOB_ID, REQUEST_ID, input);
    expect(replay).toMatchObject({
      inputRequest: { responseId: input.responseId, response: input.response },
      job: { status: 'running', revision: 6 },
      resume: { attemptId: ATTEMPT_ID, generation: 8 },
    });

    await expect(
      answerExecutionInputRequest(ACTOR, JOB_ID, REQUEST_ID, {
        ...input,
        response: { approved: false },
      })
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      answerExecutionInputRequest(ACTOR, JOB_ID, REQUEST_ID, {
        ...input,
        responseId: 'different-response-id',
      })
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      answerExecutionInputRequest(
        { ...ACTOR, userId: 'different-user' },
        JOB_ID,
        REQUEST_ID,
        input
      )
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test('delivers an accepted answer after a real suspend-answer-claim cycle', async () => {
    await client.execute({
      sql: 'DELETE FROM "ExecutionInputRequest" WHERE "id" = ?',
      args: [REQUEST_ID],
    });
    const leaseExpiresAt = new Date(Date.now() + 60_000);
    await client.batch(
      [
        {
          sql: `UPDATE "ExecutionJob"
                SET "status" = 'running'
                WHERE "id" = ?`,
          args: [JOB_ID],
        },
        {
          sql: `UPDATE "ExecutionAttempt"
                SET "status" = 'running', "capacityReserved" = TRUE,
                    "leaseOwnerId" = 'suspend-worker', "leaseExpiresAt" = ?
                WHERE "id" = ?`,
          args: [leaseExpiresAt, ATTEMPT_ID],
        },
        {
          sql: `UPDATE "ExecutionRuntime"
                SET "capacityUsed" = 1
                WHERE "id" = 'runtime-1'`,
          args: [],
        },
      ],
      'write'
    );

    const suspended = await appendExecutionEvent(ACTOR, {
      attemptId: ATTEMPT_ID,
      workerId: 'suspend-worker',
      generation: 7,
      runtimeEventId: 'waiting-input-e2e',
      event: {
        type: 'waiting-for-human',
        requestId: REQUEST_ID,
        prompt: 'Continue the exact attempt?',
      },
    });
    expect(suspended).toMatchObject({ state: 'suspended', replayed: false });

    const responseId = 'response-waiting-input-e2e';
    const response = { approved: true, nested: { reason: 'ship it' } };
    const answered = await answerExecutionInputRequest(
      ACTOR,
      JOB_ID,
      REQUEST_ID,
      {
        expectedInputRevision: 1,
        expectedJobRevision: 5,
        responseId,
        response,
      }
    );
    expect(answered).toMatchObject({
      inputRequest: { status: 'answered', responseId, response },
      job: { status: 'queued', revision: 6 },
      resume: { attemptId: ATTEMPT_ID, generation: 8 },
    });

    const claimed = await claimExecutionAttempt(ACTOR, {
      attemptId: ATTEMPT_ID,
      runtimeId: 'runtime-1',
      workerId: 'resume-worker-e2e',
    });
    expect(claimed).toMatchObject({
      id: ATTEMPT_ID,
      status: 'running',
      generation: 9,
      runtimeRunId: 'runtime-run-1',
      resumeInput: { requestId: REQUEST_ID, responseId, response },
    });

    const durable = await client.execute({
      sql: `SELECT request."responseId", request."responseJson",
                   attempt."generation", attempt."capacityReserved",
                   runtime."capacityUsed"
            FROM "ExecutionInputRequest" AS request
            JOIN "ExecutionAttempt" AS attempt ON attempt."id" = request."attemptId"
            JOIN "ExecutionRuntime" AS runtime ON runtime."id" = attempt."runtimeId"
            WHERE request."id" = ?`,
      args: [REQUEST_ID],
    });
    expect(durable.rows[0]).toMatchObject({
      responseId,
      responseJson: JSON.stringify(response),
      generation: 9,
      capacityReserved: 1,
      capacityUsed: 1,
    });
  });
});

function schemaSql() {
  return `
    CREATE TABLE "ExecutionJob" (
      "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL,
      "teamTaskId" TEXT, "originRoomId" TEXT, "originRoomMessageId" TEXT,
      "kind" TEXT NOT NULL, "status" TEXT NOT NULL,
      "priority" INTEGER NOT NULL DEFAULT 0, "specJson" TEXT NOT NULL,
      "requirementsJson" TEXT NOT NULL DEFAULT '{}',
      "contextManifestJson" TEXT NOT NULL DEFAULT '{}',
      "selectionJson" TEXT NOT NULL DEFAULT '{}',
      "requestedRuntimeId" TEXT, "selectedRuntimeId" TEXT,
      "selectionReason" TEXT, "selectedAt" DATETIME,
      "maxAttempts" INTEGER NOT NULL DEFAULT 1, "deadlineAt" DATETIME,
      "queuedAt" DATETIME NOT NULL, "startedAt" DATETIME,
      "finishedAt" DATETIME, "cancelRequestedAt" DATETIME,
      "resultJson" TEXT, "errorJson" TEXT,
      "revision" INTEGER NOT NULL, "createdAt" DATETIME NOT NULL,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "ExecutionRuntime" (
      "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL,
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "capacityTotal" INTEGER NOT NULL DEFAULT 1,
      "capacityUsed" INTEGER NOT NULL DEFAULT 0,
      "capacityUpdatedAt" DATETIME, "createdAt" DATETIME NOT NULL,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "ExecutionAttempt" (
      "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL,
      "jobId" TEXT NOT NULL, "runtimeId" TEXT, "number" INTEGER NOT NULL,
      "status" TEXT NOT NULL, "generation" INTEGER NOT NULL,
      "capacityReserved" BOOLEAN NOT NULL DEFAULT false,
      "leaseOwnerId" TEXT, "leaseExpiresAt" DATETIME,
      "lastHeartbeatAt" DATETIME, "runtimeRunId" TEXT,
      "checkpointJson" TEXT, "workspaceLifecycleJson" TEXT,
      "resultJson" TEXT, "errorJson" TEXT,
      "startedAt" DATETIME, "finishedAt" DATETIME,
      "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "ExecutionInputRequest" (
      "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL,
      "jobId" TEXT NOT NULL, "attemptId" TEXT NOT NULL,
      "requestKey" TEXT NOT NULL, "prompt" TEXT NOT NULL,
      "schemaJson" TEXT NOT NULL DEFAULT '{}', "responseJson" TEXT,
      "responseId" TEXT UNIQUE,
      "status" TEXT NOT NULL, "requestedAt" DATETIME NOT NULL,
      "respondedAt" DATETIME, "respondedById" TEXT,
      "revision" INTEGER NOT NULL, "createdAt" DATETIME NOT NULL,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "ExecutionEvent" (
      "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL,
      "jobId" TEXT NOT NULL, "attemptId" TEXT,
      "sequence" INTEGER NOT NULL, "type" TEXT NOT NULL,
      "source" TEXT NOT NULL DEFAULT 'runtime', "runtimeEventId" TEXT,
      "payloadJson" TEXT NOT NULL DEFAULT '{}',
      "occurredAt" DATETIME NOT NULL, "createdAt" DATETIME NOT NULL
    );
    CREATE UNIQUE INDEX "ExecutionEvent_jobId_sequence_key"
      ON "ExecutionEvent" ("jobId", "sequence");
    CREATE UNIQUE INDEX "ExecutionEvent_attemptId_runtimeEventId_key"
      ON "ExecutionEvent" ("attemptId", "runtimeEventId");
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
  `;
}

function runtimeInsert() {
  return {
    sql: `INSERT OR IGNORE INTO "ExecutionRuntime" ("id", "organizationId", "enabled", "capacityTotal", "capacityUsed", "createdAt", "updatedAt") VALUES ('runtime-1', ?, TRUE, 1, 0, ?, ?)`,
    args: [ACTOR.organizationId, NOW, NOW],
  };
}

function jobInsert() {
  return {
    sql: `INSERT INTO "ExecutionJob" ("id", "organizationId", "kind", "status", "specJson", "requirementsJson", "contextManifestJson", "selectionJson", "queuedAt", "startedAt", "revision", "createdAt", "updatedAt") VALUES (?, ?, 'coding', 'waiting_input', ?, '{}', ?, ?, ?, ?, 4, ?, ?)`,
    args: [JOB_ID, ACTOR.organizationId, JSON.stringify({ schemaVersion: 1, goal: 'Answer the runtime', kind: 'coding', requirements: {} }), JSON.stringify(manifest()), JSON.stringify({ schemaVersion: 1, matched: false, selected: null, evaluations: [], failure: { code: 'no-compatible-runtime', message: 'fixture' } }), NOW, NOW, NOW, NOW],
  };
}

function attemptInsert() {
  return {
    sql: `INSERT INTO "ExecutionAttempt" ("id", "organizationId", "jobId", "runtimeId", "number", "status", "generation", "runtimeRunId", "checkpointJson", "startedAt", "createdAt", "updatedAt") VALUES (?, ?, ?, 'runtime-1', 1, 'waiting_input', 7, 'runtime-run-1', ?, ?, ?, ?)`,
    args: [ATTEMPT_ID, ACTOR.organizationId, JOB_ID, JSON.stringify('checkpoint-1'), NOW, NOW, NOW],
  };
}

function requestInsert() {
  return {
    sql: `INSERT INTO "ExecutionInputRequest" ("id", "organizationId", "jobId", "attemptId", "requestKey", "prompt", "schemaJson", "status", "requestedAt", "revision", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, 'Continue?', '{}', 'pending', ?, 1, ?, ?)`,
    args: [REQUEST_ID, ACTOR.organizationId, JOB_ID, ATTEMPT_ID, REQUEST_ID, NOW, NOW, NOW],
  };
}

function manifest() {
  const content = 'fixture';
  return {
    schemaVersion: 1, goal: 'Answer the runtime', frozenAt: NOW,
    source: { type: 'workspace-draft', workspaceId: 'workspace-1', conversationId: null, documentVersionId: null },
    workspace: { id: 'workspace-1', projectId: null, title: 'Fixture', draftRevision: 1, revision: 1 },
    document: { id: 'workspace-1', title: 'Fixture', versionId: null, revision: 1, content, contentSha256: 'f16d05ec6b29248d2c61adb1e9263f78e4f7bace1b955014a2d17872cfe4064d' },
    files: [], roomWatermark: null, knowledgeCommit: null,
  };
}
