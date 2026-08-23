import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createClient, type Client } from '@libsql/client';
import { expect, test } from '@playwright/test';

import { ValidationError } from '@/framework/resilience';

import { prisma as testPrisma } from './test-prisma';
import { listClaimableExecutionAttempts } from './worker-queries';

const ACTOR = { organizationId: 'claim-query-org' };
const OTHER_ORG = 'claim-query-other-org';
const RUNTIME_A = 'claim-query-runtime-a';
const RUNTIME_B = 'claim-query-runtime-b';

let client: Client;
let temporaryRoot: string;

test.describe.serial('claimable execution attempt query', () => {
  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tobe-claim-query-')
    );
    const databasePath = path.join(temporaryRoot, 'worker.db');
    process.env.DAO_APP_DATA_ROOT = temporaryRoot;
    process.env.DATABASE_URL = 'file:' + databasePath;
    client = createClient({ url: 'file:' + databasePath });
    await client.executeMultiple(
      'CREATE TABLE "ExecutionJob" (' +
        '"id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, ' +
        '"status" TEXT NOT NULL, "priority" INTEGER NOT NULL, ' +
        '"queuedAt" DATETIME NOT NULL);' +
        'CREATE TABLE "ExecutionAttempt" (' +
        '"id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, ' +
        '"jobId" TEXT NOT NULL, "runtimeId" TEXT, "number" INTEGER NOT NULL, ' +
        '"status" TEXT NOT NULL, "generation" INTEGER NOT NULL DEFAULT 0, ' +
        '"capacityReserved" BOOLEAN NOT NULL DEFAULT false, ' +
        '"leaseOwnerId" TEXT, "leaseExpiresAt" DATETIME, ' +
        '"lastHeartbeatAt" DATETIME, "runtimeRunId" TEXT, ' +
        '"checkpointJson" TEXT, "resultJson" TEXT, "errorJson" TEXT, ' +
        '"startedAt" DATETIME, "finishedAt" DATETIME, ' +
        '"createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL);'
    );

    const now = '2026-08-21T12:00:00.000Z';
    const expired = new Date('2026-08-21T11:59:00.000Z');
    const future = new Date('2026-08-21T12:01:00.000Z');
    await client.batch(
      [
        job('job-low', ACTOR.organizationId, 'queued', 1, '2026-08-21T10:00:00Z'),
        job('job-high-later', ACTOR.organizationId, 'queued', 9, '2026-08-21T10:01:00Z'),
        job('job-high-first', ACTOR.organizationId, 'queued', 9, '2026-08-21T09:59:00Z'),
        job('job-running', ACTOR.organizationId, 'running', 5, '2026-08-21T10:00:00Z'),
        job('job-cancel-requested', ACTOR.organizationId, 'cancel_requested', 7, now),
        job('job-waiting-cancel', ACTOR.organizationId, 'cancel_requested', 8, now),
        job('job-cancelled', ACTOR.organizationId, 'cancelled', 20, now),
        job('job-other', OTHER_ORG, 'queued', 50, now),
        attempt('attempt-low', ACTOR.organizationId, 'job-low', RUNTIME_A, 'pending', null, now),
        attempt('attempt-high-later', ACTOR.organizationId, 'job-high-later', RUNTIME_A, 'pending', null, now),
        attempt('attempt-high-first', ACTOR.organizationId, 'job-high-first', RUNTIME_B, 'pending', null, now),
        attempt('attempt-expired', ACTOR.organizationId, 'job-running', RUNTIME_A, 'running', expired, now),
        attempt('attempt-active', ACTOR.organizationId, 'job-running', RUNTIME_A, 'running', future, now),
        attempt('attempt-cancel-recovery', ACTOR.organizationId, 'job-cancel-requested', RUNTIME_A, 'running', expired, now),
        attempt('attempt-cancel-active', ACTOR.organizationId, 'job-cancel-requested', RUNTIME_A, 'running', future, now),
        attempt('attempt-waiting-cancel', ACTOR.organizationId, 'job-waiting-cancel', RUNTIME_A, 'waiting_input', null, now),
        attempt('attempt-cancelled-job', ACTOR.organizationId, 'job-cancelled', RUNTIME_A, 'pending', null, now),
        attempt('attempt-other-org', OTHER_ORG, 'job-other', RUNTIME_A, 'pending', null, now),
      ],
      'write'
    );
  });

  test.afterAll(async () => {
    await client.close();
    await testPrisma.$disconnect();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  test('is organization and configured-runtime scoped, ordered, and limited', async () => {
    const attempts = await listClaimableExecutionAttempts(ACTOR, {
      runtimeIds: [RUNTIME_A, RUNTIME_B, RUNTIME_A],
      limit: 3,
      now: new Date('2026-08-21T12:00:00.000Z'),
    });

    expect(attempts.map(({ id }) => id)).toEqual([
      'attempt-high-first',
      'attempt-high-later',
      'attempt-waiting-cancel',
    ]);
    expect(attempts[2]).toMatchObject({
      runtimeId: RUNTIME_A,
      status: 'waiting_input',
      leaseExpiresAt: null,
      cancelRequested: true,
    });
  });

  test('fails closed for no configured runtime ids', async () => {
    expect(
      await listClaimableExecutionAttempts(ACTOR, { runtimeIds: [] })
    ).toEqual([]);
  });

  test('rejects malformed limits and runtime ids', async () => {
    await expect(
      listClaimableExecutionAttempts(ACTOR, {
        runtimeIds: [RUNTIME_A],
        limit: 0,
      })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      listClaimableExecutionAttempts(ACTOR, { runtimeIds: [' '] })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

function job(
  id: string,
  organizationId: string,
  status: string,
  priority: number,
  queuedAt: string
) {
  return {
    sql: 'INSERT INTO "ExecutionJob" ("id", "organizationId", "status", "priority", "queuedAt") VALUES (?, ?, ?, ?, ?)',
    args: [id, organizationId, status, priority, queuedAt],
  };
}

function attempt(
  id: string,
  organizationId: string,
  jobId: string,
  runtimeId: string,
  status: string,
  leaseExpiresAt: Date | null,
  now: string
) {
  return {
    sql: 'INSERT INTO "ExecutionAttempt" (' +
      '"id", "organizationId", "jobId", "runtimeId", "number", ' +
      '"status", "generation", "capacityReserved", "leaseExpiresAt", "createdAt", "updatedAt"' +
      ') VALUES (?, ?, ?, ?, 1, ?, 0, ?, ?, ?, ?)',
    args: [id, organizationId, jobId, runtimeId, status, status === 'running', leaseExpiresAt, now, now],
  };
}
