import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createClient, type Client } from '@libsql/client';
import { expect, test } from '@playwright/test';

import { safeJsonParse } from '@/framework/resilience/safe-data';

import { prisma as testPrisma } from './test-prisma';
import {
  enqueueExecutionRoomProjection,
  projectExecutionStartToTeamTask,
  projectExecutionTerminalToTeamTask,
  relayExecutionRoomProjections,
} from './room-projection';

const ORGANIZATION_ID = 'execution-projection-org';
const ROOM_ID = 'execution-projection-room';
const MESSAGE_ID = 'execution-projection-message';
const JOB_ID = 'execution-projection-job';
const REQUEST_ID = 'execution-projection-request';
const TEAM_TASK_ID = 'execution-projection-task';
const NOW = new Date('2026-08-21T12:00:00.000Z');

let client: Client;
let temporaryRoot: string;

test.describe.serial('Execution durable Room projection', () => {
  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tobe-execution-room-projection-')
    );
    const databasePath = path.join(temporaryRoot, 'projection.db');
    process.env.DATABASE_URL = `file:${databasePath}`;
    client = createClient({ url: `file:${databasePath}` });
    await client.executeMultiple(schemaSql());
  });

  test.beforeEach(async () => {
    await resetAndSeed();
  });

  test.afterAll(async () => {
    await client.close();
    await testPrisma.$disconnect();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  test('rolls back a crash window then relays exactly once without private input data', async () => {
    await testPrisma.$transaction((db) =>
      enqueueExecutionRoomProjection(db, {
        organizationId: ORGANIZATION_ID,
        jobId: JOB_ID,
        requestId: REQUEST_ID,
        type: 'execution.input_answered',
        occurredAt: NOW,
      })
    );

    const stored = await one(
      'SELECT "payloadJson" FROM "ExecutionOutbox" WHERE "jobId" = ?',
      [JOB_ID]
    );
    const payload = parseObject(stored.payloadJson);
    expect(payload).toEqual({
      schemaVersion: 1,
      jobId: JOB_ID,
      requestId: REQUEST_ID,
      jobStatus: 'queued',
      jobRevision: 5,
      inputRevision: 2,
      occurredAt: NOW.toISOString(),
      teamTaskId: TEAM_TASK_ID,
    });
    expect(stored.payloadJson).not.toContain('Keep this answer private');
    expect(stored.payloadJson).not.toContain('Private approval prompt');
    expect(Object.keys(payload).sort()).toEqual([
      'inputRevision',
      'jobId',
      'jobRevision',
      'jobStatus',
      'occurredAt',
      'requestId',
      'schemaVersion',
      'teamTaskId',
    ]);

    const crashed = await relayExecutionRoomProjections(
      { organizationId: ORGANIZATION_ID },
      { limit: 10, now: NOW },
      crashBeforeDeliveryMarkerClient()
    );
    expect(crashed).toEqual({
      delivered: 0,
      failed: 1,
      ignored: 0,
      processed: 1,
    });
    await expect(count('RoomEvent')).resolves.toBe(0);
    await expect(count('RoomOutbox')).resolves.toBe(0);
    await expect(roomSequence()).resolves.toBe(0);
    await expect(outboxState(JOB_ID)).resolves.toMatchObject({
      status: 'pending',
      attempts: 1,
      roomEventId: null,
    });

    const retryAt = new Date(NOW.valueOf() + 2_000);
    const retried = await relayExecutionRoomProjections(
      { organizationId: ORGANIZATION_ID },
      { limit: 10, now: retryAt },
      testPrisma
    );
    expect(retried).toEqual({
      delivered: 1,
      failed: 0,
      ignored: 0,
      processed: 1,
    });
    await expect(count('RoomEvent')).resolves.toBe(1);
    await expect(count('RoomOutbox')).resolves.toBe(1);
    await expect(roomSequence()).resolves.toBe(1);
    await expect(outboxState(JOB_ID)).resolves.toMatchObject({
      status: 'delivered',
      attempts: 2,
      ignoredReason: null,
      roomEventId: expect.stringMatching(/^execution:/),
    });

    const replay = await relayExecutionRoomProjections(
      { organizationId: ORGANIZATION_ID },
      { limit: 10, now: new Date(retryAt.valueOf() + 2_000) },
      testPrisma
    );
    expect(replay.processed).toBe(0);
    await expect(count('RoomEvent')).resolves.toBe(1);
    await expect(count('RoomOutbox')).resolves.toBe(1);
    await expect(roomSequence()).resolves.toBe(1);

    const roomEvent = await one(
      'SELECT "type", "dataJson" FROM "RoomEvent" LIMIT 1'
    );
    expect(roomEvent.type).toBe('execution.input_answered');
    expect(parseObject(roomEvent.dataJson)).toEqual(payload);
    const roomOutbox = await one(
      'SELECT "payloadJson" FROM "RoomOutbox" LIMIT 1'
    );
    expect(roomOutbox.payloadJson).not.toContain('Keep this answer private');
    expect(roomOutbox.payloadJson).not.toContain('Private approval prompt');
  });

  test('durably ignores a projection with no origin Room', async () => {
    await client.execute({
      sql: `UPDATE "ExecutionJob"
        SET "status" = 'succeeded', "revision" = 6,
          "originRoomId" = NULL, "originRoomMessageId" = NULL
        WHERE "id" = ?`,
      args: [JOB_ID],
    });
    await testPrisma.$transaction((db) =>
      enqueueExecutionRoomProjection(db, {
        organizationId: ORGANIZATION_ID,
        jobId: JOB_ID,
        type: 'execution.completed',
        occurredAt: NOW,
      })
    );

    await expect(
      relayExecutionRoomProjections(
        { organizationId: ORGANIZATION_ID },
        { now: NOW },
        testPrisma
      )
    ).resolves.toEqual({
      delivered: 0,
      failed: 0,
      ignored: 1,
      processed: 1,
    });
    await expect(outboxState(JOB_ID)).resolves.toMatchObject({
      status: 'ignored',
      ignoredReason: 'no-room',
      roomEventId: null,
    });
    await expect(count('RoomEvent')).resolves.toBe(0);
    await expect(roomSequence()).resolves.toBe(0);
  });

  for (const sourceStatus of ['open', 'claimed'] as const) {
    test(`atomically starts a linked ${sourceStatus} TeamTask and records one activity`, async () => {
      await client.execute({
        sql: `UPDATE "TeamTask"
          SET "status" = ?, "revision" = 4
          WHERE "id" = ?`,
        args: [sourceStatus, TEAM_TASK_ID],
      });

      await testPrisma.$transaction(async (db) => {
        await projectExecutionStartToTeamTask(db, {
          organizationId: ORGANIZATION_ID,
          jobId: JOB_ID,
          occurredAt: NOW,
        });
        await projectExecutionStartToTeamTask(db, {
          organizationId: ORGANIZATION_ID,
          jobId: JOB_ID,
          occurredAt: NOW,
        });
      });

      await expect(taskState()).resolves.toMatchObject({
        status: 'in_progress',
        completedAt: null,
        revision: 5,
      });
      await expect(count('TaskActivity')).resolves.toBe(1);
      await expect(
        one('SELECT "type", "message", "metadataJson" FROM "TaskActivity" LIMIT 1')
      ).resolves.toMatchObject({
        type: 'execution_started',
        message: 'Linked execution job started.',
      });
    });
  }

  test('keeps an already in-progress task stable while recording the start link', async () => {
    await projectExecutionStartToTeamTask(testPrisma, {
      organizationId: ORGANIZATION_ID,
      jobId: JOB_ID,
      occurredAt: NOW,
    });

    await expect(taskState()).resolves.toMatchObject({
      status: 'in_progress',
      revision: 3,
    });
    await expect(count('TaskActivity')).resolves.toBe(1);
  });

  for (const forbiddenStatus of ['blocked', 'review', 'done', 'cancelled'] as const) {
    test(`rejects starting Execution from a ${forbiddenStatus} linked TeamTask`, async () => {
      await client.execute({
        sql: `UPDATE "TeamTask"
          SET "status" = ?, "revision" = 4
          WHERE "id" = ?`,
        args: [forbiddenStatus, TEAM_TASK_ID],
      });

      await expect(
        projectExecutionStartToTeamTask(testPrisma, {
          organizationId: ORGANIZATION_ID,
          jobId: JOB_ID,
          occurredAt: NOW,
        })
      ).rejects.toThrow(
        `Linked TeamTask cannot start Execution from ${forbiddenStatus}.`
      );
      await expect(taskState()).resolves.toMatchObject({
        status: forbiddenStatus,
        revision: 4,
      });
      await expect(count('TaskActivity')).resolves.toBe(0);
    });
  }

  test('fences a concurrent TeamTask update while starting Execution', async () => {
    await client.execute({
      sql: `UPDATE "TeamTask"
        SET "status" = 'claimed', "revision" = 4
        WHERE "id" = ?`,
      args: [TEAM_TASK_ID],
    });
    const raced = staleTaskReadClient(async () => {
      await client.execute({
        sql: `UPDATE "TeamTask"
          SET "revision" = 5, "updatedAt" = ?
          WHERE "id" = ?`,
        args: [new Date(NOW.valueOf() + 500), TEAM_TASK_ID],
      });
    });

    await expect(
      projectExecutionStartToTeamTask(raced, {
        organizationId: ORGANIZATION_ID,
        jobId: JOB_ID,
        occurredAt: NOW,
      })
    ).rejects.toThrow('Linked TeamTask changed while Execution was starting.');
    await expect(taskState()).resolves.toMatchObject({
      status: 'claimed',
      revision: 5,
    });
    await expect(count('TaskActivity')).resolves.toBe(0);
  });

  test('projects successful output as one delivery awaiting human review', async () => {
    await setJobTerminal('succeeded');

    await testPrisma.$transaction((db) =>
      projectExecutionTerminalToTeamTask(db, {
        organizationId: ORGANIZATION_ID,
        jobId: JOB_ID,
        occurredAt: NOW,
      })
    );

    await expect(taskState()).resolves.toMatchObject({
      status: 'review',
      blockedReason: null,
      completedAt: null,
      revision: 4,
    });
    await expect(count('TaskActivity')).resolves.toBe(1);
    const activity = await one(
      'SELECT "type", "message", "actorType", "metadataJson" FROM "TaskActivity" LIMIT 1'
    );
    expect(activity).toMatchObject({
      type: 'delivery',
      message: 'Linked execution job delivered output for human review.',
      actorType: 'agent',
    });
    expect(parseObject(activity.metadataJson)).toEqual({
      schemaVersion: 1,
      jobId: JOB_ID,
      jobStatus: 'succeeded',
      jobRevision: 6,
    });
  });

  test('does not replay an old successful delivery over a human review decision', async () => {
    await setJobTerminal('succeeded');
    await testPrisma.$transaction((db) =>
      projectExecutionTerminalToTeamTask(db, {
        organizationId: ORGANIZATION_ID,
        jobId: JOB_ID,
        occurredAt: NOW,
      })
    );
    await client.execute({
      sql: `UPDATE "TeamTask"
        SET "status" = 'in_progress', "revision" = 5, "updatedAt" = ?
        WHERE "id" = ?`,
      args: [new Date(NOW.valueOf() + 500), TEAM_TASK_ID],
    });
    await testPrisma.$transaction((db) =>
      projectExecutionTerminalToTeamTask(db, {
        organizationId: ORGANIZATION_ID,
        jobId: JOB_ID,
        occurredAt: new Date(NOW.valueOf() + 1_000),
      })
    );

    await expect(taskState()).resolves.toMatchObject({
      status: 'in_progress',
      blockedReason: null,
      completedAt: null,
      revision: 5,
    });
    await expect(count('TaskActivity')).resolves.toBe(1);
  });

  test('projects failure as blocked with one idempotent activity', async () => {
    await setJobTerminal('failed');

    await testPrisma.$transaction(async (db) => {
      await projectExecutionTerminalToTeamTask(db, {
        organizationId: ORGANIZATION_ID,
        jobId: JOB_ID,
        occurredAt: NOW,
      });
      await projectExecutionTerminalToTeamTask(db, {
        organizationId: ORGANIZATION_ID,
        jobId: JOB_ID,
        occurredAt: NOW,
      });
    });

    await expect(taskState()).resolves.toMatchObject({
      status: 'blocked',
      blockedReason: `Execution job ${JOB_ID} failed.`,
      completedAt: null,
      revision: 4,
    });
    await expect(count('TaskActivity')).resolves.toBe(1);
    const activity = await one(
      'SELECT "type", "actorType", "metadataJson" FROM "TaskActivity" LIMIT 1'
    );
    expect(activity).toMatchObject({
      type: 'execution_failed',
      actorType: 'agent',
    });
    expect(parseObject(activity.metadataJson)).toEqual({
      schemaVersion: 1,
      jobId: JOB_ID,
      jobStatus: 'failed',
      jobRevision: 6,
    });
  });

  test('projects cancellation as cancelled and keeps it idempotent', async () => {
    await setJobTerminal('cancelled');

    await testPrisma.$transaction(async (db) => {
      await projectExecutionTerminalToTeamTask(db, {
        organizationId: ORGANIZATION_ID,
        jobId: JOB_ID,
        occurredAt: NOW,
      });
      await projectExecutionTerminalToTeamTask(db, {
        organizationId: ORGANIZATION_ID,
        jobId: JOB_ID,
        occurredAt: new Date(NOW.valueOf() + 1_000),
      });
    });

    await expect(taskState()).resolves.toMatchObject({
      status: 'cancelled',
      blockedReason: null,
      completedAt: null,
      revision: 4,
    });
    await expect(count('TaskActivity')).resolves.toBe(1);
    await expect(
      one('SELECT "type", "message" FROM "TaskActivity" LIMIT 1')
    ).resolves.toMatchObject({
      type: 'execution_cancelled',
      message: 'Linked execution job was cancelled.',
    });
  });

  test('does not let a stale projection overwrite a concurrent human task update', async () => {
    await setJobTerminal('succeeded');
    const raced = staleTaskReadClient(async () => {
      await client.execute({
        sql: `UPDATE "TeamTask"
          SET "revision" = 4, "updatedAt" = ?
          WHERE "id" = ?`,
        args: [new Date(NOW.valueOf() + 500), TEAM_TASK_ID],
      });
    });

    await expect(
      projectExecutionTerminalToTeamTask(raced, {
        organizationId: ORGANIZATION_ID,
        jobId: JOB_ID,
        occurredAt: NOW,
      })
    ).rejects.toThrow(
      'Linked TeamTask changed while Execution was being projected.'
    );

    await expect(taskState()).resolves.toMatchObject({
      status: 'in_progress',
      revision: 4,
    });
    await expect(count('TaskActivity')).resolves.toBe(0);
  });

  test('fences a concurrent task status change even when its revision is unchanged', async () => {
    await setJobTerminal('succeeded');
    const raced = staleTaskReadClient(async () => {
      await client.execute({
        sql: `UPDATE "TeamTask"
          SET "status" = 'blocked', "updatedAt" = ?
          WHERE "id" = ?`,
        args: [new Date(NOW.valueOf() + 500), TEAM_TASK_ID],
      });
    });

    await expect(
      projectExecutionTerminalToTeamTask(raced, {
        organizationId: ORGANIZATION_ID,
        jobId: JOB_ID,
        occurredAt: NOW,
      })
    ).rejects.toThrow(
      'Linked TeamTask changed while Execution was being projected.'
    );

    await expect(taskState()).resolves.toMatchObject({
      status: 'blocked',
      revision: 3,
    });
    await expect(count('TaskActivity')).resolves.toBe(0);
  });

  for (const terminalStatus of ['done', 'cancelled'] as const) {
    test(`does not overwrite a ${terminalStatus} TeamTask`, async () => {
      await setJobTerminal('failed');
      await client.execute({
        sql: `UPDATE "TeamTask"
          SET "status" = ?, "completedAt" = ?, "revision" = 4
          WHERE "id" = ?`,
        args: [
          terminalStatus,
          terminalStatus === 'done' ? NOW : null,
          TEAM_TASK_ID,
        ],
      });

      await expect(
        projectExecutionTerminalToTeamTask(testPrisma, {
          organizationId: ORGANIZATION_ID,
          jobId: JOB_ID,
          occurredAt: NOW,
        })
      ).resolves.toBe('projected');

      await expect(taskState()).resolves.toMatchObject({
        status: terminalStatus,
        revision: 4,
      });
      const persisted = await taskState();
      if (terminalStatus === 'done') {
        expect(persisted.completedAt).not.toBeNull();
      } else {
        expect(persisted.completedAt).toBeNull();
      }
      await expect(count('TaskActivity')).resolves.toBe(1);
    });
  }

  test('fails closed when a terminal projection would bypass the TeamTask state machine', async () => {
    await setJobTerminal('succeeded');
    await client.execute({
      sql: `UPDATE "TeamTask"
        SET "status" = 'claimed', "revision" = 4
        WHERE "id" = ?`,
      args: [TEAM_TASK_ID],
    });

    await expect(
      projectExecutionTerminalToTeamTask(testPrisma, {
        organizationId: ORGANIZATION_ID,
        jobId: JOB_ID,
        occurredAt: NOW,
      })
    ).rejects.toThrow('Linked TeamTask cannot transition from claimed to review.');
    await expect(taskState()).resolves.toMatchObject({
      status: 'claimed',
      revision: 4,
    });
    await expect(count('TaskActivity')).resolves.toBe(0);
  });
});

function crashBeforeDeliveryMarkerClient() {
  return {
    $executeRaw: testPrisma.$executeRaw.bind(testPrisma),
    $queryRaw: testPrisma.$queryRaw.bind(testPrisma),
    $transaction<T>(action: (db: ProjectionDb) => Promise<T>) {
      return testPrisma.$transaction((db) =>
        action({
          ...db,
          $executeRaw(strings, ...values) {
            const sql = strings.join('?');
            if (
              sql.includes('UPDATE "ExecutionOutbox"') &&
              sql.includes("\"status\" = 'delivered'")
            ) {
              throw new Error('simulated crash before delivery marker');
            }
            return db.$executeRaw(strings, ...values);
          },
        })
      );
    },
  };
}

type ProjectionDb = {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

function staleTaskReadClient(beforeTaskUpdate: () => Promise<void>): ProjectionDb {
  let raced = false;
  return {
    $executeRaw: testPrisma.$executeRaw.bind(testPrisma),
    async $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]) {
      const rows = await testPrisma.$queryRaw<T>(strings, ...values);
      if (!raced && strings.join('?').includes('FROM "TeamTask"')) {
        raced = true;
        await beforeTaskUpdate();
      }
      return rows;
    },
  };
}

async function resetAndSeed() {
  await client.executeMultiple(`
    DELETE FROM "RoomOutbox";
    DELETE FROM "RoomEvent";
    DELETE FROM "ExecutionOutbox";
    DELETE FROM "ExecutionInputRequest";
    DELETE FROM "TaskActivity";
    DELETE FROM "ExecutionJob";
    DELETE FROM "TeamTask";
    DELETE FROM "Room";
    DELETE FROM "Organization";
  `);
  await client.batch(
    [
      {
        sql: 'INSERT INTO "Organization" ("id") VALUES (?)',
        args: [ORGANIZATION_ID],
      },
      {
        sql: `INSERT INTO "Room" (
          "id", "organizationId", "eventSequence", "createdAt", "updatedAt"
        ) VALUES (?, ?, 0, ?, ?)`,
        args: [ROOM_ID, ORGANIZATION_ID, NOW, NOW],
      },
      {
        sql: `INSERT INTO "TeamTask" (
          "id", "organizationId", "status", "revision", "createdAt", "updatedAt"
        ) VALUES (?, ?, 'in_progress', 3, ?, ?)`,
        args: [TEAM_TASK_ID, ORGANIZATION_ID, NOW, NOW],
      },
      {
        sql: `INSERT INTO "ExecutionJob" (
          "id", "organizationId", "teamTaskId",
          "originRoomId", "originRoomMessageId",
          "selectedRuntimeId", "status", "revision",
          "createdAt", "updatedAt"
        ) VALUES (?, ?, ?, ?, ?, 'runtime-1', 'queued', 5, ?, ?)`,
        args: [
          JOB_ID,
          ORGANIZATION_ID,
          TEAM_TASK_ID,
          ROOM_ID,
          MESSAGE_ID,
          NOW,
          NOW,
        ],
      },
      {
        sql: `INSERT INTO "ExecutionInputRequest" (
          "id", "organizationId", "jobId", "status",
          "revision", "prompt", "responseJson"
        ) VALUES (?, ?, ?, 'answered', 2, ?, ?)`,
        args: [
          REQUEST_ID,
          ORGANIZATION_ID,
          JOB_ID,
          'Private approval prompt',
          JSON.stringify({ answer: 'Keep this answer private' }),
        ],
      },
    ],
    'write'
  );
}

async function one(sql: string, args: unknown[] = []) {
  const result = await client.execute({ sql, args: args as never[] });
  const row = result.rows[0];
  if (!row) throw new Error(`Expected one row for: ${sql}`);
  return row as Record<string, string | number | null>;
}

async function count(table: 'ExecutionOutbox' | 'RoomEvent' | 'RoomOutbox' | 'TaskActivity') {
  const result = await client.execute(`SELECT COUNT(*) AS "count" FROM "${table}"`);
  return Number(result.rows[0]?.count ?? -1);
}

async function roomSequence() {
  const row = await one(
    'SELECT "eventSequence" FROM "Room" WHERE "id" = ?',
    [ROOM_ID]
  );
  return Number(row.eventSequence);
}

async function outboxState(jobId: string) {
  return one(
    `SELECT "status", "attempts", "roomEventId", "ignoredReason"
      FROM "ExecutionOutbox" WHERE "jobId" = ?`,
    [jobId]
  );
}

async function taskState() {
  return one(
    `SELECT "status", "blockedReason", "completedAt", "revision"
      FROM "TeamTask" WHERE "id" = ?`,
    [TEAM_TASK_ID]
  );
}

async function setJobTerminal(status: 'cancelled' | 'failed' | 'succeeded') {
  await client.execute({
    sql: `UPDATE "ExecutionJob"
      SET "status" = ?, "revision" = 6
      WHERE "id" = ?`,
    args: [status, JOB_ID],
  });
}

function parseObject(value: unknown): Record<string, unknown> {
  const parsed = safeJsonParse<unknown>(typeof value === 'string' ? value : null, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a stored JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function schemaSql() {
  return `
    PRAGMA foreign_keys = ON;
    CREATE TABLE "Organization" ("id" TEXT NOT NULL PRIMARY KEY);
    CREATE TABLE "Room" (
      "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL,
      "eventSequence" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "TeamTask" (
      "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL,
      "status" TEXT NOT NULL, "blockedReason" TEXT,
      "completedAt" DATETIME, "revision" INTEGER NOT NULL,
      "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "ExecutionJob" (
      "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL,
      "teamTaskId" TEXT, "originRoomId" TEXT,
      "originRoomMessageId" TEXT, "selectedRuntimeId" TEXT,
      "status" TEXT NOT NULL, "revision" INTEGER NOT NULL,
      "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "ExecutionInputRequest" (
      "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL,
      "jobId" TEXT NOT NULL, "status" TEXT NOT NULL,
      "revision" INTEGER NOT NULL, "prompt" TEXT NOT NULL,
      "responseJson" TEXT
    );
    CREATE TABLE "ExecutionOutbox" (
      "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL,
      "jobId" TEXT NOT NULL, "roomId" TEXT, "topic" TEXT NOT NULL,
      "dedupeKey" TEXT NOT NULL, "payloadJson" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "availableAt" DATETIME NOT NULL, "deliveredAt" DATETIME,
      "roomEventId" TEXT, "ignoredReason" TEXT, "lastError" TEXT,
      "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL
    );
    CREATE UNIQUE INDEX "ExecutionOutbox_dedupe"
      ON "ExecutionOutbox"("organizationId", "topic", "dedupeKey");
    CREATE TABLE "RoomEvent" (
      "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL,
      "roomId" TEXT NOT NULL, "sequence" INTEGER NOT NULL,
      "type" TEXT NOT NULL, "dataJson" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL
    );
    CREATE UNIQUE INDEX "RoomEvent_sequence"
      ON "RoomEvent"("roomId", "sequence");
    CREATE TABLE "RoomOutbox" (
      "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL,
      "roomId" TEXT NOT NULL, "topic" TEXT NOT NULL,
      "dedupeKey" TEXT NOT NULL, "payloadJson" TEXT NOT NULL,
      "status" TEXT NOT NULL, "attempts" INTEGER NOT NULL,
      "availableAt" DATETIME NOT NULL, "publishedAt" DATETIME,
      "lastError" TEXT, "createdAt" DATETIME NOT NULL,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE UNIQUE INDEX "RoomOutbox_dedupe"
      ON "RoomOutbox"("organizationId", "topic", "dedupeKey");
    CREATE TABLE "TaskActivity" (
      "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL,
      "taskId" TEXT NOT NULL, "type" TEXT NOT NULL,
      "message" TEXT NOT NULL, "actorType" TEXT NOT NULL,
      "actorId" TEXT NOT NULL, "metadataJson" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL
    );
  `;
}
