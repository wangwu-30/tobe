import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createClient, type Client } from '@libsql/client';
import { expect, test } from '@playwright/test';

import { prisma } from '@/lib/db/prisma';
import {
  AssistantRunTransitionError,
  createAssistantRun,
  updateAssistantRun,
} from '@/objects/conversation/commands';
import { runWithAssistantRunFailureBoundary } from './assistant-run-lifecycle';

const run = promisify(execFile);
const ACTOR = {
  deviceId: 'assistant-run-device',
  organizationId: 'assistant-run-org',
  userId: 'assistant-run-user',
};
const CONVERSATION_ID = 'assistant-run-conversation';

let client: Client;
let temporaryRoot = '';

test.describe.serial('assistant run lifecycle', () => {
  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tobe-assistant-run-')
    );
    const databasePath = path.join(temporaryRoot, 'dev.db');
    process.env.DAO_APP_DATA_ROOT = temporaryRoot;
    process.env.DATABASE_URL = 'file:' + databasePath;
    await run(
      process.execPath,
      ['scripts/bootstrap-local-db.mjs', '--app-data-root', temporaryRoot],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DAO_APP_DATA_ROOT: temporaryRoot,
          DATABASE_URL: 'file:' + databasePath,
        },
      }
    );
    client = createClient({ url: 'file:' + databasePath });
  });

  test.beforeEach(async () => {
    await client.execute('DELETE FROM "Organization"');
    const now = new Date();
    await client.batch(
      [
        {
          sql: 'INSERT INTO "Organization" ("id", "slug", "name", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)',
          args: [
            ACTOR.organizationId,
            'assistant-run-org',
            'Assistant Run Org',
            now,
            now,
          ],
        },
        {
          sql: 'INSERT INTO "Session" ("id", "organizationId", "scopeKind", "title", "sourceType", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
          args: [
            CONVERSATION_ID,
            ACTOR.organizationId,
            'team',
            'Onboarding',
            'onboarding',
            now,
            now,
          ],
        },
      ],
      'write'
    );
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
    await client.close();
    await fs.rm(temporaryRoot, { force: true, recursive: true });
  });

  test('terminalizes a persisted queued run when stream initialization fails', async () => {
    const assistantRun = await createAssistantRun(ACTOR, {
      conversationId: CONVERSATION_ID,
      mode: 'run',
      scopeKind: 'team',
      title: 'Initialize provider',
      workspaceId: null,
    });

    await expect(
      runWithAssistantRunFailureBoundary({
        actor: ACTOR,
        assistantRunId: assistantRun.id,
        operation: async () => {
          throw new Error('provider initialization failed');
        },
      })
    ).rejects.toThrow('provider initialization failed');

    const persisted = await prisma.assistantRun.findUniqueOrThrow({
      where: { id: assistantRun.id },
    });
    expect(persisted).toMatchObject({
      status: 'failed',
      summary: 'provider initialization failed',
    });
    expect(persisted.finishedAt).not.toBeNull();
  });

  test('creates an initialized terminal run atomically', async () => {
    const assistantRun = await createAssistantRun(ACTOR, {
      conversationId: CONVERSATION_ID,
      mode: 'run',
      scopeKind: 'team',
      status: 'completed',
      summary: 'Proposal ready',
      title: 'Prepare proposal',
      workspaceId: null,
    });

    expect(assistantRun).toMatchObject({
      revision: 1,
      status: 'completed',
      summary: 'Proposal ready',
    });
    expect(assistantRun.finishedAt).not.toBeNull();
  });

  test('rejects a late running update after completion', async () => {
    const assistantRun = await createAssistantRun(ACTOR, {
      conversationId: CONVERSATION_ID,
      mode: 'run',
      scopeKind: 'team',
      title: 'Race run',
      workspaceId: null,
    });
    const finishedAt = new Date('2026-08-24T00:00:00.000Z');

    await updateAssistantRun(ACTOR, {
      finishedAt,
      runId: assistantRun.id,
      status: 'completed',
      summary: 'Final answer',
    });
    await expect(
      updateAssistantRun(ACTOR, {
        runId: assistantRun.id,
        status: 'running',
      })
    ).rejects.toBeInstanceOf(AssistantRunTransitionError);

    const persisted = await prisma.assistantRun.findUniqueOrThrow({
      where: { id: assistantRun.id },
    });
    expect(persisted).toMatchObject({
      revision: 2,
      status: 'completed',
      summary: 'Final answer',
    });
    expect(new Date(persisted.finishedAt || 0).toISOString()).toBe(
      finishedAt.toISOString()
    );
  });
});
