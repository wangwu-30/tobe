import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createClient, type Client } from '@libsql/client';
import { expect, test } from '@playwright/test';

import { ValidationError } from '@/framework/resilience';

import { prisma as testPrisma } from './test-prisma';
import {
  getExecutionArtifact,
  getExecutionCompletionProjection,
  getExecutionJobDetail,
  listExecutionArtifacts,
  listExecutionEvents,
  listExecutionLogs,
  listExecutionJobs,
} from './queries';

const ACTOR = { organizationId: 'read-model-org' };
const JOB_ID = 'read-model-job';
const OLDER_JOB_ID = 'read-model-older-job';
const TIED_JOB_ID = 'read-model-tied-job';
const ATTEMPT_ID = 'read-model-attempt';
const NOW = '2026-08-21T12:00:00.000Z';

let client: Client;
let temporaryRoot: string;

test.describe.serial('execution product read models', () => {
  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tobe-execution-read-'));
    const databasePath = path.join(temporaryRoot, 'read.db');
    process.env.DATABASE_URL = `file:${databasePath}`;
    client = createClient({ url: `file:${databasePath}` });
    await client.executeMultiple(schemaSql());
    await seed();
  });

  test.afterAll(async () => {
    await client.close();
    await testPrisma.$disconnect();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  test('lists only organization jobs with an opaque cursor', async () => {
    const first = await listExecutionJobs(ACTOR, { limit: 1 });
    expect(first).toMatchObject({
      items: [{ id: TIED_JOB_ID }],
      pageInfo: { hasNextPage: true, nextCursor: expect.any(String) },
    });
    const second = await listExecutionJobs(ACTOR, {
      limit: 1,
      cursor: first.pageInfo.nextCursor,
    });
    expect(second).toMatchObject({
      items: [{ id: JOB_ID, goal: 'Read a finished execution', attemptCount: 1 }],
      pageInfo: { hasNextPage: true, nextCursor: expect.any(String) },
    });
    const third = await listExecutionJobs(ACTOR, {
      limit: 1,
      cursor: second.pageInfo.nextCursor,
    });
    expect(third).toMatchObject({
      items: [{ id: OLDER_JOB_ID }],
      pageInfo: { hasNextPage: false, nextCursor: null },
    });
    await expect(
      listExecutionJobs(ACTOR, { cursor: 'not-a-cursor' })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('searches server-side across goal, id, kind, status, and selected runtime', async () => {
    const cases: Array<[string, string]> = [
      ['  FINISHED execution  ', JOB_ID],
      ['OLDER-JOB', OLDER_JOB_ID],
      ['research', TIED_JOB_ID],
      ['blocked', TIED_JOB_ID],
      ['runtime-special', TIED_JOB_ID],
    ];

    for (const [search, id] of cases) {
      const result = await listExecutionJobs(ACTOR, { search });
      expect(result.items.map((job) => job.id)).toEqual([id]);
      expect(result.pageInfo).toEqual({ hasNextPage: false, nextCursor: null });
    }
    await expect(
      listExecutionJobs(ACTOR, { search: 'Must stay hidden' })
    ).resolves.toMatchObject({ items: [] });

    await expect(
      listExecutionJobs(ACTOR, { search: 'x'.repeat(201) })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('keeps search pagination stable when queued times tie', async () => {
    const first = await listExecutionJobs(ACTOR, { limit: 1, search: 'read-model' });
    expect(first.items.map((job) => job.id)).toEqual([TIED_JOB_ID]);
    expect(first.pageInfo).toMatchObject({ hasNextPage: true });

    const second = await listExecutionJobs(ACTOR, {
      cursor: first.pageInfo.nextCursor,
      limit: 1,
      search: 'read-model',
    });
    expect(second.items.map((job) => job.id)).toEqual([JOB_ID]);
    expect(second.pageInfo).toMatchObject({ hasNextPage: true });

    const third = await listExecutionJobs(ACTOR, {
      cursor: second.pageInfo.nextCursor,
      limit: 1,
      search: 'read-model',
    });
    expect(third.items.map((job) => job.id)).toEqual([OLDER_JOB_ID]);
    expect(third.pageInfo).toEqual({ hasNextPage: false, nextCursor: null });
  });

  test('returns detailed attempts, paged events/artifacts, and input requests', async () => {
    const detail = await getExecutionJobDetail(ACTOR, JOB_ID);
    expect(detail).toMatchObject({
      job: { id: JOB_ID, status: 'succeeded', attempts: [{ id: ATTEMPT_ID }] },
      inputRequests: {
        items: [{ id: 'input-1', status: 'answered', response: 'continue' }],
      },
      completion: {
        projection: 'execution-job-completed',
        jobId: JOB_ID,
        status: 'succeeded',
        revision: 7,
      },
    });
    expect(detail?.events.items).toHaveLength(4);
    expect(detail?.events.items[0]).toMatchObject({
      id: 'event-valid',
      payload: { text: 'hello' },
      payloadValid: true,
    });
    expect(detail?.events.items[1]).toMatchObject({
      id: 'event-invalid',
      payload: null,
      payloadValid: false,
    });
    expect(detail?.artifacts.items).toHaveLength(2);
    expect(detail?.artifacts.items[0]).toMatchObject({
      id: 'artifact-inline',
      storage: 'inline',
      contentAvailable: true,
      metadataValid: true,
    });
    expect(detail?.artifacts.items[1]).toMatchObject({
      id: 'artifact-private',
      storage: 'external',
      externalUrl: null,
      contentAvailable: false,
    });
  });

  test('keeps the newest pending input actionable beyond the history page', async () => {
    const history = Array.from({ length: 50 }, (_, index) => {
      const requestedAt = new Date(
        new Date(NOW).valueOf() + (index + 1) * 60_000
      ).toISOString();
      return {
        sql: `INSERT INTO "ExecutionInputRequest" ("id", "organizationId", "jobId", "attemptId", "requestKey", "prompt", "schemaJson", "responseJson", "status", "requestedAt", "respondedAt", "respondedById", "revision", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, 'Historical answer', '{}', 'true', 'answered', ?, ?, 'server-user', 2, ?, ?)`,
        args: [
          `input-history-${index}`,
          ACTOR.organizationId,
          JOB_ID,
          ATTEMPT_ID,
          `input-history-${index}`,
          requestedAt,
          requestedAt,
          requestedAt,
          requestedAt,
        ],
      };
    });
    const pendingAt = new Date(
      new Date(NOW).valueOf() + 60 * 60_000
    ).toISOString();
    await client.batch(
      [
        ...history,
        {
          sql: `INSERT INTO "ExecutionInputRequest" ("id", "organizationId", "jobId", "attemptId", "requestKey", "prompt", "schemaJson", "status", "requestedAt", "revision", "createdAt", "updatedAt") VALUES ('input-pending-latest', ?, ?, ?, 'input-pending-latest', 'Newest approval', '{}', 'pending', ?, 1, ?, ?)`,
          args: [
            ACTOR.organizationId,
            JOB_ID,
            ATTEMPT_ID,
            pendingAt,
            pendingAt,
            pendingAt,
          ],
        },
      ],
      'write'
    );

    const detail = await getExecutionJobDetail(ACTOR, JOB_ID);
    expect(detail?.inputRequests.items[0]).toMatchObject({
      id: 'input-pending-latest',
      status: 'pending',
    });
    expect(detail?.inputRequests.pageInfo.hasNextPage).toBe(true);
  });

  test('paginates events and artifacts and exposes only safe artifact content', async () => {
    const eventPage = await listExecutionEvents(ACTOR, JOB_ID, { limit: 1 });
    expect(eventPage).toMatchObject({
      items: [{ sequence: 1 }],
      pageInfo: { hasNextPage: true, nextCursor: '1' },
    });
    const nextEvents = await listExecutionEvents(ACTOR, JOB_ID, {
      afterSequence: Number(eventPage.pageInfo.nextCursor),
      limit: 1,
    });
    expect(nextEvents.items[0]?.sequence).toBe(2);

    const artifactPage = await listExecutionArtifacts(ACTOR, JOB_ID, { limit: 1 });
    expect(artifactPage.pageInfo).toMatchObject({
      hasNextPage: true,
      nextCursor: expect.any(String),
    });
    const nextArtifacts = await listExecutionArtifacts(ACTOR, JOB_ID, {
      cursor: artifactPage.pageInfo.nextCursor,
      limit: 1,
    });
    expect(nextArtifacts.items).toHaveLength(1);

    await expect(getExecutionArtifact(ACTOR, JOB_ID, 'artifact-inline')).resolves.toMatchObject({
      content: { ok: true },
    });
    await expect(getExecutionArtifact(ACTOR, JOB_ID, 'artifact-private')).resolves.toMatchObject({
      content: null,
      artifact: { externalUrl: null, contentAvailable: false },
    });
  });

  test('projects and paginates only log-like events without trusting payload JSON', async () => {
    const first = await listExecutionLogs(ACTOR, JOB_ID, { limit: 2 });
    expect(first).toEqual({
      items: [
        expect.objectContaining({
          id: 'event-valid',
          sequence: 1,
          type: 'text-delta',
          text: 'hello',
          percent: null,
          payloadValid: true,
        }),
        expect.objectContaining({
          id: 'event-invalid',
          sequence: 2,
          type: 'progress',
          text: null,
          percent: null,
          payloadValid: false,
        }),
      ],
      pageInfo: { hasNextPage: true, nextCursor: '2' },
    });

    const second = await listExecutionLogs(ACTOR, JOB_ID, {
      afterSequence: Number(first.pageInfo.nextCursor),
      limit: 2,
    });
    expect(second).toEqual({
      items: [
        expect.objectContaining({
          id: 'event-progress',
          sequence: 4,
          type: 'progress',
          text: 'Finishing',
          percent: 90,
          payloadValid: true,
        }),
      ],
      pageInfo: { hasNextPage: false, nextCursor: null },
    });
    await expect(
      listExecutionLogs({ organizationId: 'foreign-org' }, JOB_ID)
    ).resolves.toEqual({
      items: [],
      pageInfo: { hasNextPage: false, nextCursor: null },
    });
  });

  test('completion projection is terminal-only and organization scoped', async () => {
    await expect(getExecutionCompletionProjection(ACTOR, JOB_ID)).resolves.toMatchObject({
      jobId: JOB_ID,
      status: 'succeeded',
      attempt: { id: ATTEMPT_ID, status: 'succeeded' },
    });
    await expect(
      getExecutionCompletionProjection(ACTOR, OLDER_JOB_ID)
    ).resolves.toBeNull();
    await expect(
      getExecutionJobDetail({ organizationId: 'foreign-org' }, JOB_ID)
    ).resolves.toBeNull();
  });
});

async function seed() {
  const older = '2026-08-20T12:00:00.000Z';
  await client.batch([
    job(JOB_ID, ACTOR.organizationId, 'succeeded', NOW, 7, 'Read a finished execution'),
    job(
      TIED_JOB_ID,
      ACTOR.organizationId,
      'blocked',
      NOW,
      3,
      'Research tie-match',
      'research',
      'runtime-special'
    ),
    job(OLDER_JOB_ID, ACTOR.organizationId, 'queued', older, 1, 'Older queued execution'),
    job('foreign-job', 'foreign-org', 'failed', '2026-08-22T12:00:00.000Z', 2, 'Must stay hidden'),
    {
      sql: `INSERT INTO "ExecutionAttempt" ("id", "organizationId", "jobId", "runtimeId", "number", "status", "generation", "resultJson", "startedAt", "finishedAt", "createdAt", "updatedAt") VALUES (?, ?, ?, 'runtime-1', 1, 'succeeded', 2, ?, ?, ?, ?, ?)`,
      args: [ATTEMPT_ID, ACTOR.organizationId, JOB_ID, JSON.stringify({ ok: true }), NOW, NOW, NOW, NOW],
    },
    {
      sql: `INSERT INTO "ExecutionEvent" ("id", "organizationId", "jobId", "attemptId", "sequence", "type", "source", "runtimeEventId", "payloadJson", "occurredAt", "createdAt") VALUES ('event-valid', ?, ?, ?, 1, 'text-delta', 'runtime', 'runtime-event-1', ?, ?, ?)`,
      args: [ACTOR.organizationId, JOB_ID, ATTEMPT_ID, JSON.stringify({ text: 'hello' }), NOW, NOW],
    },
    {
      sql: `INSERT INTO "ExecutionEvent" ("id", "organizationId", "jobId", "attemptId", "sequence", "type", "source", "runtimeEventId", "payloadJson", "occurredAt", "createdAt") VALUES ('event-invalid', ?, ?, ?, 2, 'progress', 'runtime', 'runtime-event-2', '{invalid', ?, ?)`,
      args: [ACTOR.organizationId, JOB_ID, ATTEMPT_ID, NOW, NOW],
    },
    {
      sql: `INSERT INTO "ExecutionEvent" ("id", "organizationId", "jobId", "attemptId", "sequence", "type", "source", "runtimeEventId", "payloadJson", "occurredAt", "createdAt") VALUES ('event-checkpoint', ?, ?, ?, 3, 'checkpoint', 'runtime', 'runtime-event-3', ?, ?, ?)`,
      args: [ACTOR.organizationId, JOB_ID, ATTEMPT_ID, JSON.stringify({ checkpointRef: 'checkpoint-1' }), NOW, NOW],
    },
    {
      sql: `INSERT INTO "ExecutionEvent" ("id", "organizationId", "jobId", "attemptId", "sequence", "type", "source", "runtimeEventId", "payloadJson", "occurredAt", "createdAt") VALUES ('event-progress', ?, ?, ?, 4, 'progress', 'runtime', 'runtime-event-4', ?, ?, ?)`,
      args: [ACTOR.organizationId, JOB_ID, ATTEMPT_ID, JSON.stringify({ message: 'Finishing', percent: 90 }), NOW, NOW],
    },
    {
      sql: `INSERT INTO "ExecutionArtifact" ("id", "organizationId", "jobId", "attemptId", "kind", "name", "payloadJson", "mimeType", "sizeBytes", "sha256", "metadataJson", "createdAt") VALUES ('artifact-inline', ?, ?, ?, 'result', 'result.json', ?, 'application/json', 11, ?, ?, ?)`,
      args: [ACTOR.organizationId, JOB_ID, ATTEMPT_ID, JSON.stringify({ ok: true }), 'a'.repeat(64), JSON.stringify({ source: 'runtime' }), NOW],
    },
    {
      sql: `INSERT INTO "ExecutionArtifact" ("id", "organizationId", "jobId", "attemptId", "kind", "name", "storageUri", "mimeType", "metadataJson", "createdAt") VALUES ('artifact-private', ?, ?, ?, 'log', 'worker.log', 'file:///private/worker.log', 'text/plain', '{}', ?)`,
      args: [ACTOR.organizationId, JOB_ID, ATTEMPT_ID, '2026-08-21T12:01:00.000Z'],
    },
    {
      sql: `INSERT INTO "ExecutionInputRequest" ("id", "organizationId", "jobId", "attemptId", "requestKey", "prompt", "schemaJson", "responseJson", "status", "requestedAt", "respondedAt", "respondedById", "revision", "createdAt", "updatedAt") VALUES ('input-1', ?, ?, ?, 'input-1', 'Continue?', '{}', ?, 'answered', ?, ?, 'server-user', 2, ?, ?)`,
      args: [ACTOR.organizationId, JOB_ID, ATTEMPT_ID, JSON.stringify('continue'), NOW, NOW, NOW, NOW],
    },
  ], 'write');
}

function job(
  id: string,
  organizationId: string,
  status: string,
  at: string,
  revision: number,
  goal: string,
  kind = 'coding',
  selectedRuntimeId = 'runtime-1'
) {
  return {
    sql: `INSERT INTO "ExecutionJob" ("id", "organizationId", "kind", "status", "priority", "specJson", "requirementsJson", "contextManifestJson", "selectionJson", "selectedRuntimeId", "maxAttempts", "queuedAt", "startedAt", "finishedAt", "resultJson", "revision", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, 1, ?, '{}', ?, ?, ?, 2, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, organizationId, kind, status, JSON.stringify({ schemaVersion: 1, goal, kind, requirements: {} }), JSON.stringify(manifest(goal, at)), JSON.stringify(matchedSelection(selectedRuntimeId)), selectedRuntimeId, at, status === 'queued' ? null : at, status === 'succeeded' ? at : null, status === 'succeeded' ? JSON.stringify({ delivered: true }) : null, revision, at, at],
  };
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
        streaming: 'none',
        interrupt: 'none',
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

function manifest(goal: string, at: string) {
  const content = 'read model fixture';
  return {
    schemaVersion: 1, goal, frozenAt: at,
    source: { type: 'workspace-draft', workspaceId: 'workspace-1', conversationId: null, documentVersionId: null },
    workspace: { id: 'workspace-1', projectId: null, title: 'Fixture', draftRevision: 1, revision: 1 },
    document: { id: 'workspace-1', title: 'Fixture', versionId: null, revision: 1, content, contentSha256: createHash('sha256').update(content).digest('hex') },
    files: [], roomWatermark: null, knowledgeCommit: null,
  };
}

function schemaSql() {
  return `
    CREATE TABLE "ExecutionJob" ("id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "teamTaskId" TEXT, "originRoomId" TEXT, "originRoomMessageId" TEXT, "kind" TEXT NOT NULL, "status" TEXT NOT NULL, "priority" INTEGER NOT NULL, "specJson" TEXT NOT NULL, "requirementsJson" TEXT NOT NULL, "contextManifestJson" TEXT NOT NULL, "selectionJson" TEXT NOT NULL, "requestedRuntimeId" TEXT, "selectedRuntimeId" TEXT, "selectionReason" TEXT, "selectedAt" DATETIME, "maxAttempts" INTEGER NOT NULL, "deadlineAt" DATETIME, "queuedAt" DATETIME NOT NULL, "startedAt" DATETIME, "finishedAt" DATETIME, "cancelRequestedAt" DATETIME, "resultJson" TEXT, "errorJson" TEXT, "revision" INTEGER NOT NULL, "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL);
    CREATE TABLE "ExecutionAttempt" ("id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "jobId" TEXT NOT NULL, "runtimeId" TEXT, "number" INTEGER NOT NULL, "status" TEXT NOT NULL, "generation" INTEGER NOT NULL, "leaseOwnerId" TEXT, "leaseExpiresAt" DATETIME, "lastHeartbeatAt" DATETIME, "runtimeRunId" TEXT, "checkpointJson" TEXT, "resultJson" TEXT, "errorJson" TEXT, "startedAt" DATETIME, "finishedAt" DATETIME, "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL);
    CREATE TABLE "ExecutionEvent" ("id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "jobId" TEXT NOT NULL, "attemptId" TEXT, "sequence" INTEGER NOT NULL, "type" TEXT NOT NULL, "source" TEXT NOT NULL, "runtimeEventId" TEXT, "payloadJson" TEXT NOT NULL, "occurredAt" DATETIME NOT NULL, "createdAt" DATETIME NOT NULL);
    CREATE TABLE "ExecutionArtifact" ("id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "jobId" TEXT NOT NULL, "attemptId" TEXT, "kind" TEXT NOT NULL, "name" TEXT NOT NULL, "storageUri" TEXT, "payloadJson" TEXT, "mimeType" TEXT, "sizeBytes" INTEGER, "sha256" TEXT, "metadataJson" TEXT NOT NULL, "createdAt" DATETIME NOT NULL);
    CREATE TABLE "ExecutionInputRequest" ("id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "jobId" TEXT NOT NULL, "attemptId" TEXT NOT NULL, "requestKey" TEXT NOT NULL, "prompt" TEXT NOT NULL, "schemaJson" TEXT NOT NULL, "responseJson" TEXT, "responseId" TEXT, "status" TEXT NOT NULL, "requestedAt" DATETIME NOT NULL, "respondedAt" DATETIME, "respondedById" TEXT, "revision" INTEGER NOT NULL, "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL);
  `;
}
