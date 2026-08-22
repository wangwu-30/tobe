import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createClient, type Client } from '@libsql/client';
import { expect, test } from '@playwright/test';

import { prisma as testPrisma } from './test-prisma';
import {
  claimKnowledgeMergeOperation,
  publishKnowledgeIndexSnapshot,
  recordKnowledgeGitMerge,
  recordKnowledgeMergeFailure,
} from './merge-worker-commands';

const ORG = 'merge-worker-org';
const OPERATION = 'merge-operation';
const CHANGE = 'change-request';
const SPACE = 'knowledge-space';
const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const ACTOR = { organizationId: ORG, authority: 'knowledge-merge-service' as const };

let client: Client;
let root: string;

test.describe.serial('knowledge merge operation persistence', () => {
  test.beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'tobe-merge-commands-'));
    const databasePath = path.join(root, 'merge.db');
    process.env.DAO_APP_DATA_ROOT = root;
    process.env.DATABASE_URL = 'file:' + databasePath;
    client = createClient({ url: 'file:' + databasePath });
    await client.executeMultiple(schemaSql());
  });

  test.beforeEach(async () => {
    await client.executeMultiple([
      'DELETE FROM "KnowledgeSnapshot"',
      'DELETE FROM "KnowledgeMergeOperation"',
      'DELETE FROM "KnowledgeChangeRequest"',
      'DELETE FROM "KnowledgeSpace"',
    ].join(';'));
    await seed();
  });

  test.afterAll(async () => {
    await client.close();
    await testPrisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  });

  test('index failure keeps active pointer unchanged and retry publishes only ready snapshot', async () => {
    const first = await claimKnowledgeMergeOperation(ACTOR, {
      operationId: OPERATION,
      workerId: 'worker-one',
    });
    await recordKnowledgeGitMerge(ACTOR, {
      operationId: OPERATION,
      workerId: 'worker-one',
      attemptCount: first.operation.attemptCount,
      mergedCommit: HEAD,
    });
    await recordKnowledgeMergeFailure(ACTOR, {
      operationId: OPERATION,
      workerId: 'worker-one',
      attemptCount: first.operation.attemptCount,
      code: 'index-write-failed',
      message: 'Simulated index failure.',
    });

    expect(await activeSnapshotId()).toBeNull();
    expect(await snapshotCount()).toBe(0);

    const retry = await claimKnowledgeMergeOperation(ACTOR, {
      operationId: OPERATION,
      workerId: 'worker-two',
      allowFailedRetry: true,
    });
    expect(retry.changeRequest).toMatchObject({ status: 'merged', mergedCommit: HEAD });
    await recordKnowledgeGitMerge(ACTOR, {
      operationId: OPERATION,
      workerId: 'worker-two',
      attemptCount: retry.operation.attemptCount,
      mergedCommit: HEAD,
    });
    const ready = await publishKnowledgeIndexSnapshot(ACTOR, {
      operationId: OPERATION,
      workerId: 'worker-two',
      attemptCount: retry.operation.attemptCount,
      artifactPath: path.join(root, 'index.json'),
      artifactSha256: 'c'.repeat(64),
      readyAt: new Date(),
    });

    expect(ready.operation.status).toBe('succeeded');
    expect(await activeSnapshotId()).toBe(ready.snapshot.id);
    expect(await snapshotCount()).toBe(1);
  });
});

async function seed() {
  const now = new Date();
  await client.batch([
    {
      sql: 'INSERT INTO "KnowledgeSpace" ("id", "organizationId", "repoPath", "repoUrl", "defaultBranch", "activeSnapshotId", "updatedAt") VALUES (?, ?, ?, NULL, \'main\', NULL, ?)',
      args: [SPACE, ORG, path.join(root, 'repo'), now],
    },
    {
      sql: 'INSERT INTO "KnowledgeChangeRequest" ("id", "organizationId", "jobId", "attemptId", "spaceId", "baseCommit", "headCommit", "branchName", "status", "diffSummary", "diffMetadataJson", "reviewerId", "reviewNote", "reviewedAt", "mergedCommit", "mergedAt", "revision", "createdAt", "updatedAt") VALUES (?, ?, \'job\', \'attempt\', ?, ?, ?, \'proposal/main\', \'approved\', \'\', \'{}\', \'reviewer\', NULL, ?, NULL, NULL, 2, ?, ?)',
      args: [CHANGE, ORG, SPACE, BASE, HEAD, now, now, now],
    },
    {
      sql: 'INSERT INTO "KnowledgeMergeOperation" ("id", "organizationId", "changeRequestId", "requestedById", "expectedRevision", "expectedBaseCommit", "expectedHeadCommit", "indexVersion", "status", "attemptCount", "createdAt", "updatedAt") VALUES (?, ?, ?, \'reviewer\', 2, ?, ?, \'knowledge-index-v1\', \'queued\', 0, ?, ?)',
      args: [OPERATION, ORG, CHANGE, BASE, HEAD, now, now],
    },
  ], 'write');
}

async function activeSnapshotId() {
  const result = await client.execute({
    sql: 'SELECT "activeSnapshotId" FROM "KnowledgeSpace" WHERE "id" = ?',
    args: [SPACE],
  });
  return result.rows[0]?.activeSnapshotId ?? null;
}

async function snapshotCount() {
  const result = await client.execute('SELECT COUNT(*) AS "count" FROM "KnowledgeSnapshot"');
  return Number(result.rows[0]?.count);
}

function schemaSql() {
  return [
    'CREATE TABLE "KnowledgeSpace" ("id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "repoPath" TEXT, "repoUrl" TEXT, "defaultBranch" TEXT NOT NULL, "activeSnapshotId" TEXT, "updatedAt" DATETIME NOT NULL, UNIQUE ("id", "organizationId"))',
    'CREATE TABLE "KnowledgeChangeRequest" ("id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "jobId" TEXT NOT NULL, "attemptId" TEXT NOT NULL, "spaceId" TEXT NOT NULL, "baseCommit" TEXT NOT NULL, "headCommit" TEXT NOT NULL, "branchName" TEXT NOT NULL, "status" TEXT NOT NULL, "diffSummary" TEXT NOT NULL, "diffMetadataJson" TEXT NOT NULL, "reviewerId" TEXT, "reviewNote" TEXT, "reviewedAt" DATETIME, "mergedCommit" TEXT, "mergedAt" DATETIME, "revision" INTEGER NOT NULL, "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL, UNIQUE ("id", "organizationId"))',
    'CREATE TABLE "KnowledgeMergeOperation" ("id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "changeRequestId" TEXT NOT NULL, "requestedById" TEXT NOT NULL, "expectedRevision" INTEGER NOT NULL, "expectedBaseCommit" TEXT NOT NULL, "expectedHeadCommit" TEXT NOT NULL, "indexVersion" TEXT NOT NULL, "status" TEXT NOT NULL, "attemptCount" INTEGER NOT NULL, "leaseOwnerId" TEXT, "leaseExpiresAt" DATETIME, "mergedCommit" TEXT, "snapshotId" TEXT, "errorCode" TEXT, "errorMessage" TEXT, "startedAt" DATETIME, "completedAt" DATETIME, "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL, UNIQUE ("changeRequestId", "expectedRevision"))',
    'CREATE TABLE "KnowledgeSnapshot" ("id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "spaceId" TEXT NOT NULL, "changeRequestId" TEXT NOT NULL, "commitSha" TEXT NOT NULL, "indexVersion" TEXT NOT NULL, "artifactPath" TEXT NOT NULL, "artifactSha256" TEXT NOT NULL, "readyAt" DATETIME NOT NULL, "createdAt" DATETIME NOT NULL, UNIQUE ("spaceId", "commitSha", "indexVersion"))',
  ].join(';');
}
