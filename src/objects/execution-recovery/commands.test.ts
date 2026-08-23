import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createClient, type Client } from '@libsql/client';
import { expect, test } from '@playwright/test';

import { ConflictError, ForbiddenError } from '@/framework/resilience';

import {
  quarantineExecutionWorkspaceRecovery,
  requestExecutionRecoveryAction,
  resolveExecutionRecovery,
} from './commands';
import { inspectExecutionRecoveryIncidents } from './queries';
import { prisma as testPrisma } from './test-prisma';

const ORG = 'recovery-test-org';
const USER = 'recovery-test-owner';
const RUNTIME = 'recovery-test-runtime';
let client: Client;
let temporaryRoot: string;

test.describe.serial('durable execution workspace recovery', () => {
  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tobe-execution-recovery-')
    );
    const databaseUrl = `file:${path.join(temporaryRoot, 'recovery.db')}`;
    process.env.DATABASE_URL = databaseUrl;
    client = createClient({ url: databaseUrl });
    await client.executeMultiple(SCHEMA);
    const now = new Date().toISOString();
    await client.batch(
      [
        {
          sql: 'INSERT INTO "OrganizationMembership" ("id", "organizationId", "userId", "role") VALUES (?, ?, ?, ?)',
          args: ['membership-owner', ORG, USER, 'owner'],
        },
        {
          sql: 'INSERT INTO "ExecutionRuntime" ("id", "organizationId", "capacityUsed", "createdAt", "updatedAt") VALUES (?, ?, 5, ?, ?)',
          args: [RUNTIME, ORG, now, now],
        },
        ...executionRows('retry', now),
        ...executionRows('discard', now),
        ...executionRows('partial', now),
        ...executionRows('fenced', now, { generation: 2 }),
        ...executionRows('unreserved', now, { capacityReserved: false }),
        ...executionRows('reclaimed', now),
        ...executionRows('repeated', now),
      ],
      'write'
    );
  });

  test.afterAll(async () => {
    await client.close();
    await testPrisma.$disconnect();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  test('quarantines once, releases only the owned slot, and remains non-claimable', async () => {
    const incident = await quarantineExecutionWorkspaceRecovery(
      { organizationId: ORG },
      {
        attemptId: 'attempt-retry',
        workerId: 'worker-retry',
        generation: 1,
        stage: 'prepare',
        reasonCode: 'worktree-state-changed',
        classification: 'prepared-dirty',
        discardable: true,
      }
    );

    expect(incident).toMatchObject({
      attemptId: 'attempt-retry',
      generation: 1,
      classification: 'prepared-dirty',
      status: 'open',
      revision: 1,
    });
    expect(await readState('retry')).toMatchObject({
      attemptStatus: 'quarantined',
      jobStatus: 'blocked',
      capacityReserved: 0,
      capacityUsed: 4,
      leaseOwnerId: null,
      incidentCount: 1,
    });

    await expect(
      quarantineExecutionWorkspaceRecovery(
        { organizationId: ORG },
        {
          attemptId: 'attempt-retry',
          workerId: 'worker-retry',
          generation: 1,
          stage: 'prepare',
          reasonCode: 'worktree-state-changed',
          classification: 'prepared-dirty',
          discardable: true,
        }
      )
    ).resolves.toEqual(incident);
    expect((await readState('retry')).capacityUsed).toBe(4);
  });

  test('fails a stale generation without changing capacity or incident state', async () => {
    await expect(
      quarantineExecutionWorkspaceRecovery(
        { organizationId: ORG },
        {
          attemptId: 'attempt-fenced',
          workerId: 'worker-fenced',
          generation: 1,
          stage: 'cleanup',
          reasonCode: 'worktree-state-changed',
          classification: 'drifted',
          discardable: false,
        }
      )
    ).rejects.toThrow(ConflictError);
    expect(await readState('fenced')).toMatchObject({
      attemptStatus: 'running',
      capacityReserved: 1,
      capacityUsed: 4,
      incidentCount: 0,
    });
  });

  test('does not decrement capacity for an unreserved recovery attempt', async () => {
    await quarantineExecutionWorkspaceRecovery(
      { organizationId: ORG },
      {
        attemptId: 'attempt-unreserved',
        workerId: 'worker-unreserved',
        generation: 1,
        stage: 'prepare',
        reasonCode: 'worktree-path-conflict',
        classification: 'partial',
        discardable: false,
      }
    );
    expect(await readState('unreserved')).toMatchObject({
      attemptStatus: 'quarantined',
      capacityReserved: 0,
      capacityUsed: 4,
    });
  });

  test('requires an operator, supports exact retry replay, and audits resolution', async () => {
    const inspected = await inspectExecutionRecoveryIncidents(
      { organizationId: ORG, userId: USER },
      'job-retry'
    );
    expect(inspected.current).toMatchObject({
      classification: 'prepared-dirty',
      discardable: true,
      reasonCode: 'worktree-state-changed',
    });
    expect(JSON.stringify(inspected)).not.toContain('/');

    await expect(
      inspectExecutionRecoveryIncidents(
        { organizationId: ORG, userId: 'not-a-member' },
        'job-retry'
      )
    ).rejects.toThrow(ForbiddenError);

    const requested = await requestExecutionRecoveryAction(
      { organizationId: ORG, userId: USER },
      'job-retry',
      {
        incidentId: inspected.current!.id,
        action: 'retry',
        expectedRevision: 1,
      }
    );
    expect(requested).toMatchObject({
      status: 'action_requested',
      requestedAction: 'retry',
      resolution: null,
      revision: 2,
    });
    await expect(
      requestExecutionRecoveryAction(
        { organizationId: ORG, userId: USER },
        'job-retry',
        {
          incidentId: inspected.current!.id,
          action: 'retry',
          expectedRevision: 1,
        }
      )
    ).resolves.toEqual(requested);
    expect(await readState('retry')).toMatchObject({
      attemptStatus: 'pending',
      jobStatus: 'queued',
      capacityReserved: 0,
      capacityUsed: 4,
    });
    await claimForRecoveryRetry('retry');

    await expect(
      resolveExecutionRecovery(
        { organizationId: ORG },
        {
          incidentId: requested.id,
          attemptId: requested.attemptId,
          workerId: 'recovery-retry',
          generation: 2,
          resolution: 'retried',
        }
      )
    ).resolves.toBe('resolved');
    const history = await inspectExecutionRecoveryIncidents(
      { organizationId: ORG, userId: USER },
      'job-retry'
    );
    expect(history.current).toBeNull();
    expect(history.items[0]).toMatchObject({
      status: 'resolved',
      requestedAction: 'retry',
      resolution: 'retried',
      revision: 3,
    });
  });

  test('fences retry resolution when a checked lease is reclaimed by a new generation', async () => {
    const incident = await quarantineExecutionWorkspaceRecovery(
      { organizationId: ORG },
      {
        attemptId: 'attempt-reclaimed',
        workerId: 'worker-reclaimed',
        generation: 1,
        stage: 'prepare',
        reasonCode: 'worktree-state-changed',
        classification: 'prepared-dirty',
        discardable: true,
      }
    );
    const requested = await requestExecutionRecoveryAction(
      { organizationId: ORG, userId: USER },
      'job-reclaimed',
      { incidentId: incident.id, action: 'retry', expectedRevision: 1 }
    );
    await claimForRecoveryRetry('reclaimed');
    expect(
      await hasRecoveryLease('reclaimed', 'recovery-reclaimed', 2)
    ).toBe(true);

    await reclaimRecoveryLease('reclaimed', {
      previousGeneration: 2,
      previousWorkerId: 'recovery-reclaimed',
      workerId: 'replacement-reclaimed',
    });

    await expect(
      resolveExecutionRecovery(
        { organizationId: ORG },
        {
          incidentId: requested.id,
          attemptId: requested.attemptId,
          workerId: 'recovery-reclaimed',
          generation: 2,
          resolution: 'retried',
        }
      )
    ).resolves.toBe('fenced');
    const stillRequested = await inspectExecutionRecoveryIncidents(
      { organizationId: ORG, userId: USER },
      'job-reclaimed'
    );
    expect(stillRequested.current).toMatchObject({
      id: requested.id,
      status: 'action_requested',
      requestedAction: 'retry',
      resolution: null,
      resolvedAt: null,
      revision: 2,
    });

    await expect(
      resolveExecutionRecovery(
        { organizationId: ORG },
        {
          incidentId: requested.id,
          attemptId: requested.attemptId,
          workerId: 'replacement-reclaimed',
          generation: 3,
          resolution: 'retried',
        }
      )
    ).resolves.toBe('resolved');
  });

  test('allows discard only for a verified discardable workspace', async () => {
    const discard = await quarantineExecutionWorkspaceRecovery(
      { organizationId: ORG },
      {
        attemptId: 'attempt-discard',
        workerId: 'worker-discard',
        generation: 1,
        stage: 'cleanup',
        reasonCode: 'worktree-state-changed',
        classification: 'prepared-dirty',
        discardable: true,
      }
    );
    const requested = await requestExecutionRecoveryAction(
      { organizationId: ORG, userId: USER },
      'job-discard',
      { incidentId: discard.id, action: 'discard', expectedRevision: 1 }
    );
    expect(requested).toMatchObject({
      status: 'action_requested',
      requestedAction: 'discard',
    });

    const partial = await quarantineExecutionWorkspaceRecovery(
      { organizationId: ORG },
      {
        attemptId: 'attempt-partial',
        workerId: 'worker-partial',
        generation: 1,
        stage: 'prepare',
        reasonCode: 'worktree-path-conflict',
        classification: 'partial',
        discardable: false,
      }
    );
    await expect(
      requestExecutionRecoveryAction(
        { organizationId: ORG, userId: USER },
        'job-partial',
        { incidentId: partial.id, action: 'discard', expectedRevision: 1 }
      )
    ).rejects.toThrow(ConflictError);
    expect(await readState('partial')).toMatchObject({
      attemptStatus: 'quarantined',
      jobStatus: 'blocked',
    });
  });

  test('records a repeated failed retry as superseded before the new quarantine', async () => {
    const first = await quarantineExecutionWorkspaceRecovery(
      { organizationId: ORG },
      {
        attemptId: 'attempt-repeated',
        workerId: 'worker-repeated',
        generation: 1,
        stage: 'prepare',
        reasonCode: 'worktree-state-changed',
        classification: 'prepared-dirty',
        discardable: true,
      }
    );
    await requestExecutionRecoveryAction(
      { organizationId: ORG, userId: USER },
      'job-repeated',
      { incidentId: first.id, action: 'retry', expectedRevision: 1 }
    );
    await claimForRecoveryRetry('repeated');

    const second = await quarantineExecutionWorkspaceRecovery(
      { organizationId: ORG },
      {
        attemptId: 'attempt-repeated',
        workerId: 'recovery-repeated',
        generation: 2,
        stage: 'prepare',
        reasonCode: 'worktree-state-changed',
        classification: 'prepared-dirty',
        discardable: true,
      }
    );
    const history = await inspectExecutionRecoveryIncidents(
      { organizationId: ORG, userId: USER },
      'job-repeated'
    );
    expect(history.current?.id).toBe(second.id);
    expect(history.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: second.id, status: 'open' }),
        expect.objectContaining({
          id: first.id,
          status: 'resolved',
          resolution: 'superseded',
          requestedAction: 'retry',
        }),
      ])
    );
  });
});

function executionRows(
  suffix: string,
  now: string,
  options: { generation?: number; capacityReserved?: boolean } = {}
) {
  const generation = options.generation ?? 1;
  const capacityReserved = options.capacityReserved ?? true;
  return [
    {
      sql: `INSERT INTO "ExecutionJob" ("id", "organizationId", "status", "revision", "createdAt", "updatedAt") VALUES (?, ?, 'running', 1, ?, ?)`,
      args: [`job-${suffix}`, ORG, now, now],
    },
    {
      sql: `INSERT INTO "ExecutionAttempt" ("id", "organizationId", "jobId", "runtimeId", "status", "generation", "leaseOwnerId", "leaseExpiresAt", "capacityReserved", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)`,
      args: [
        `attempt-${suffix}`,
        ORG,
        `job-${suffix}`,
        RUNTIME,
        generation,
        `worker-${suffix}`,
        new Date(Date.now() + 60_000).toISOString(),
        capacityReserved,
        now,
        now,
      ],
    },
  ];
}

async function readState(suffix: string) {
  const result = await client.execute({
    sql: `SELECT attempt."status" AS "attemptStatus",
      attempt."capacityReserved", attempt."leaseOwnerId",
      job."status" AS "jobStatus", runtime."capacityUsed",
      (SELECT COUNT(*) FROM "ExecutionRecoveryIncident" AS incident
        WHERE incident."attemptId" = attempt."id") AS "incidentCount"
      FROM "ExecutionAttempt" AS attempt
      JOIN "ExecutionJob" AS job ON job."id" = attempt."jobId"
      JOIN "ExecutionRuntime" AS runtime ON runtime."id" = attempt."runtimeId"
      WHERE attempt."id" = ?`,
    args: [`attempt-${suffix}`],
  });
  return result.rows[0];
}

async function claimForRecoveryRetry(suffix: string) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.valueOf() + 60_000);
  await client.batch(
    [
      {
        sql: `UPDATE "ExecutionRuntime" SET "capacityUsed" = "capacityUsed" + 1, "updatedAt" = ? WHERE "id" = ?`,
        args: [now, RUNTIME],
      },
      {
        sql: `UPDATE "ExecutionAttempt" SET "status" = 'running', "generation" = "generation" + 1, "leaseOwnerId" = ?, "leaseExpiresAt" = ?, "capacityReserved" = TRUE, "updatedAt" = ? WHERE "id" = ? AND "status" = 'pending'`,
        args: [`recovery-${suffix}`, leaseExpiresAt, now, `attempt-${suffix}`],
      },
      {
        sql: `UPDATE "ExecutionJob" SET "status" = 'running', "updatedAt" = ? WHERE "id" = ? AND "status" = 'queued'`,
        args: [now, `job-${suffix}`],
      },
    ],
    'write'
  );
}

async function hasRecoveryLease(
  suffix: string,
  workerId: string,
  generation: number
) {
  const result = await client.execute({
    sql: `SELECT "id" FROM "ExecutionAttempt"
      WHERE "id" = ? AND "organizationId" = ?
        AND "status" = 'running' AND "generation" = ?
        AND "leaseOwnerId" = ? AND "leaseExpiresAt" > ?
        AND "capacityReserved" = TRUE`,
    args: [`attempt-${suffix}`, ORG, generation, workerId, new Date()],
  });
  return result.rows.length === 1;
}

async function reclaimRecoveryLease(
  suffix: string,
  input: {
    previousGeneration: number;
    previousWorkerId: string;
    workerId: string;
  }
) {
  const now = new Date();
  const results = await client.batch(
    [
      {
        sql: `UPDATE "ExecutionAttempt" SET "leaseExpiresAt" = ?
          WHERE "id" = ? AND "organizationId" = ?
            AND "generation" = ? AND "leaseOwnerId" = ?`,
        args: [
          new Date(now.valueOf() - 1),
          `attempt-${suffix}`,
          ORG,
          input.previousGeneration,
          input.previousWorkerId,
        ],
      },
      {
        sql: `UPDATE "ExecutionAttempt"
          SET "generation" = "generation" + 1, "leaseOwnerId" = ?,
            "leaseExpiresAt" = ?, "updatedAt" = ?
          WHERE "id" = ? AND "organizationId" = ?
            AND "status" = 'running' AND "generation" = ?
            AND "leaseOwnerId" = ? AND "leaseExpiresAt" <= ?
            AND "capacityReserved" = TRUE`,
        args: [
          input.workerId,
          new Date(now.valueOf() + 60_000),
          now,
          `attempt-${suffix}`,
          ORG,
          input.previousGeneration,
          input.previousWorkerId,
          now,
        ],
      },
    ],
    'write'
  );
  expect(results.map((result) => result.rowsAffected)).toEqual([1, 1]);
}

const SCHEMA = `
  PRAGMA foreign_keys = OFF;
  CREATE TABLE "OrganizationMembership" (
    "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL, "role" TEXT NOT NULL
  );
  CREATE TABLE "ExecutionRuntime" (
    "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL,
    "capacityUsed" INTEGER NOT NULL, "capacityUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL
  );
  CREATE TABLE "ExecutionJob" (
    "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL, "cancelRequestedAt" DATETIME,
    "finishedAt" DATETIME, "errorJson" TEXT, "revision" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL
  );
  CREATE TABLE "ExecutionAttempt" (
    "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL, "runtimeId" TEXT, "status" TEXT NOT NULL,
    "generation" INTEGER NOT NULL, "leaseOwnerId" TEXT,
    "leaseExpiresAt" DATETIME, "capacityReserved" BOOLEAN NOT NULL,
    "errorJson" TEXT, "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL
  );
  CREATE TABLE "ExecutionRecoveryIncident" (
    "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL, "attemptId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL, "stage" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL, "classification" TEXT NOT NULL,
    "discardable" BOOLEAN NOT NULL, "status" TEXT NOT NULL,
    "requestedAction" TEXT, "resolution" TEXT,
    "actionRequestedAt" DATETIME, "actionRequestedById" TEXT,
    "resolvedAt" DATETIME, "revision" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL
  );
  CREATE UNIQUE INDEX "ExecutionRecoveryIncident_attemptId_generation_key"
    ON "ExecutionRecoveryIncident" ("attemptId", "generation");
`;
