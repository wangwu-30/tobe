import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { createClient } from '@libsql/client';
import { expect, test } from '@playwright/test';

import { apiRequest, LOCAL_PLATFORM_HEADERS } from './helpers';

const IDENTITY_HEADERS = {
  'x-dao-device-id': LOCAL_PLATFORM_HEADERS['x-dao-device-id'],
  'x-dao-organization-id': LOCAL_PLATFORM_HEADERS['x-dao-organization-id'],
  'x-dao-user-id': LOCAL_PLATFORM_HEADERS['x-dao-user-id'],
};

test('onboarding chat stays document-free and its Session is adopted by Wiki creation', async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const documentCountBefore = await countOrganizationDocuments();
  const response = await postOnboardingRun(
    baseURL,
    `Help me shape a durable product decisions Wiki. ${randomUUID()}`
  );

  expect(response.status).toBe(200);
  const conversationId = response.headers.get('x-dao-conversation-id');
  expect(conversationId).toBeTruthy();
  expect(response.headers.get('x-dao-workspace-id')).toBeNull();
  expect((await response.text()).trim()).not.toBe('');

  const onboardingState = await readConversationState(conversationId!);
  expect(onboardingState.session).toMatchObject({
    activeFileId: null,
    projectId: null,
    scopeKind: 'team',
    sourceType: 'onboarding',
    wikiId: null,
  });
  expect(onboardingState.documents).toHaveLength(0);
  expect(await countOrganizationDocuments()).toBe(documentCountBefore);
  expect(onboardingState.messages.map((message) => message.role)).toEqual([
    'user',
    'assistant',
  ]);
  expect(
    onboardingState.messages.every(
      (message) => message.documentId === null && message.focusNodeId === null
    )
  ).toBe(true);
  expect(onboardingState.runs).toHaveLength(1);
  expect(onboardingState.runs[0]).toMatchObject({
    documentId: null,
    scopeKind: 'team',
    status: 'completed',
  });
  expect(onboardingState.runs[0]?.requestMessageId).toBe(
    onboardingState.messages[0]?.id
  );

  const created = await apiRequest<{
    conversation: {
      activeFileId: string | null;
      id: string;
      projectId: string | null;
      scopeKind: string;
    };
    initialRoomMessageReceipt: { status: string } | null;
    primaryFile: { id: string };
    room: { id: string; projectId: string | null };
    workspace: { id: string; projectId: string | null };
  }>(baseURL, '/api/workspaces', {
    body: {
      conversationId,
      deliverableType: 'document',
      goal: 'Keep product decisions and their rationale easy to recover.',
      title: `Onboarding Wiki ${randomUUID()}`,
    },
    headers: {
      'x-dao-idempotency-key': `onboarding-handoff-${randomUUID()}`,
    },
    method: 'POST',
  });

  expect(created.conversation).toMatchObject({
    activeFileId: created.primaryFile.id,
    id: conversationId,
    projectId: created.workspace.id,
    scopeKind: 'wiki',
  });
  expect(created.initialRoomMessageReceipt).toMatchObject({ status: 'accepted' });
  expect(created.room.projectId).toBe(created.workspace.id);
  expect(created.workspace.projectId).toBe(created.workspace.id);
  expect(await countOrganizationDocuments()).toBe(documentCountBefore + 1);
  await expect(countProjectDocuments(created.workspace.id)).resolves.toBe(1);

  const adoptedState = await readConversationState(conversationId!);
  expect(adoptedState.session).toMatchObject({
    activeFileId: created.primaryFile.id,
    activeFileWorkspaceId: created.workspace.id,
    id: conversationId,
    projectId: created.workspace.id,
    scopeKind: 'wiki',
    sourceType: 'onboarding',
    wikiId: null,
  });
  expect(adoptedState.documents).toEqual([
    expect.objectContaining({
      id: created.workspace.id,
      projectId: created.workspace.id,
      sessionId: conversationId,
    }),
  ]);
  expect(adoptedState.messages.map((message) => message.role)).toEqual([
    'user',
    'assistant',
  ]);
  expect(
    adoptedState.messages.every(
      (message) => message.documentId === null && message.focusNodeId === null
    )
  ).toBe(true);
  expect(adoptedState.runs[0]).toMatchObject({
    documentId: null,
    scopeKind: 'team',
    status: 'completed',
  });
});

test('both creation rolls back a failed companion and safely retries the same idempotency key', async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const conversationId = `onboarding-both-${randomUUID()}`;
  const idempotencyKey = `onboarding-both-retry-${randomUUID()}`;
  const title = `Atomic Pair ${randomUUID().slice(0, 8)}`;
  const body = {
    conversationId,
    createMode: 'both',
    goal: 'Create a document and its companion site as one project.',
    title,
  };
  const database = createClient({ url: resolveIterationDatabaseUrl() });

  await seedOnboardingConversation({ conversationId, organizationId: 'local-org' });
  const initialState = await readConversationState(conversationId);
  const documentCountBefore = await countOrganizationDocuments();

  try {
    await database.execute(`
      CREATE TRIGGER reject_companion_workspace
      BEFORE INSERT ON "Document"
      WHEN NEW."title" = '${title.replaceAll("'", "''")} Companion Site'
      BEGIN
        SELECT RAISE(ABORT, 'forced companion workspace failure');
      END
    `);

    const failed = await postWorkspace(baseURL, body, idempotencyKey);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({
      error: 'Could not create the project.',
    });

    expect(await countOrganizationDocuments()).toBe(documentCountBefore);
    expect(await readConversationState(conversationId)).toEqual(initialState);
    expect(await countMutationRequests(idempotencyKey)).toBe(0);
  } finally {
    await database.execute('DROP TRIGGER IF EXISTS reject_companion_workspace');
    await database.close();
  }

  const retryResponse = await postWorkspace(baseURL, body, idempotencyKey);
  expect(retryResponse.status).toBe(200);
  const retry = await retryResponse.json() as {
    conversation: { id: string; scopeKind: string };
    createdDeliverables: Array<{
      primaryFile: { id: string };
      workspace: { id: string; projectId: string; title: string };
    }>;
    workspace: { id: string; projectId: string };
  };

  expect(retry.conversation).toMatchObject({
    id: conversationId,
    scopeKind: 'wiki',
  });
  expect(retry.createdDeliverables).toHaveLength(2);
  expect(retry.createdDeliverables.map((item) => item.workspace.title)).toEqual([
    title,
    `${title} Companion Site`,
  ]);
  expect(
    retry.createdDeliverables.every(
      (item) => item.workspace.projectId === retry.workspace.id
    )
  ).toBe(true);
  expect(await countOrganizationDocuments()).toBe(documentCountBefore + 2);
  await expect(countProjectDocuments(retry.workspace.id)).resolves.toBe(2);
  expect(await countMutationRequests(idempotencyKey)).toBe(1);

  const replayResponse = await postWorkspace(baseURL, body, idempotencyKey);
  expect(replayResponse.status).toBe(200);
  await expect(replayResponse.json()).resolves.toEqual(retry);
  expect(await countOrganizationDocuments()).toBe(documentCountBefore + 2);
  await expect(countProjectDocuments(retry.workspace.id)).resolves.toBe(2);
  expect(await countMutationRequests(idempotencyKey)).toBe(1);
});

test('single Wiki rolls back a late receipt failure and safely replays the same idempotency key', async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const conversationId = `onboarding-single-late-${randomUUID()}`;
  const idempotencyKey = `onboarding-single-late-${randomUUID()}`;
  const title = `Atomic Single ${randomUUID().slice(0, 8)}`;
  const body = {
    content: '[{"type":"p","children":[{"text":"Atomic initial content"}]}]',
    conversationId,
    conversationTitle: `Atomic conversation ${randomUUID().slice(0, 8)}`,
    deliverableType: 'document',
    goal: 'Create one durable Wiki atomically.',
    title,
  };
  const database = createClient({ url: resolveIterationDatabaseUrl() });

  await seedOnboardingConversation({ conversationId, organizationId: 'local-org' });
  const initialState = await readConversationState(conversationId);
  const documentCountBefore = await countOrganizationDocuments();

  try {
    await database.execute(`
      CREATE TRIGGER reject_single_wiki_receipt_completion
      BEFORE UPDATE ON "MutationRequest"
      WHEN OLD."requestKey" = '${idempotencyKey.replaceAll("'", "''")}'
        AND NEW."status" = 'completed'
      BEGIN
        SELECT RAISE(ABORT, 'forced single Wiki receipt completion failure');
      END
    `);

    const failed = await postWorkspace(baseURL, body, idempotencyKey);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({
      error: 'Could not create the project.',
    });
    expect(await countOrganizationDocuments()).toBe(documentCountBefore);
    expect(await readConversationState(conversationId)).toEqual(initialState);
    expect(await countMutationRequests(idempotencyKey)).toBe(0);
  } finally {
    await database.execute(
      'DROP TRIGGER IF EXISTS reject_single_wiki_receipt_completion'
    );
    await database.close();
  }

  const retryResponse = await postWorkspace(baseURL, body, idempotencyKey);
  expect(retryResponse.status).toBe(200);
  const retry = await retryResponse.json() as {
    conversation: { id: string; scopeKind: string };
    createdDeliverables: Array<{ workspace: { id: string } }>;
    workspace: { id: string };
  };
  expect(retry.conversation).toMatchObject({
    id: conversationId,
    scopeKind: 'wiki',
  });
  expect(retry.createdDeliverables).toHaveLength(1);
  expect(await countOrganizationDocuments()).toBe(documentCountBefore + 1);
  await expect(countProjectDocuments(retry.workspace.id)).resolves.toBe(1);
  expect(await countMutationRequests(idempotencyKey)).toBe(1);

  const replayResponse = await postWorkspace(baseURL, body, idempotencyKey);
  expect(replayResponse.status).toBe(200);
  await expect(replayResponse.json()).resolves.toEqual(retry);
  expect(await countOrganizationDocuments()).toBe(documentCountBefore + 1);
  await expect(countProjectDocuments(retry.workspace.id)).resolves.toBe(1);
  expect(await countMutationRequests(idempotencyKey)).toBe(1);
});

test('single Wiki rejects content and conversation title drift for a completed idempotency key', async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const idempotencyKey = `single-wiki-drift-${randomUUID()}`;
  const documentCountBefore = await countOrganizationDocuments();
  const body = {
    content: '[{"type":"p","children":[{"text":"Original content"}]}]',
    conversationTitle: `Original conversation ${randomUUID().slice(0, 8)}`,
    deliverableType: 'document',
    goal: 'Keep this Wiki request stable.',
    title: `Single drift ${randomUUID().slice(0, 8)}`,
  };

  const firstResponse = await postWorkspace(baseURL, body, idempotencyKey);
  expect(firstResponse.status).toBe(200);
  const first = await firstResponse.json() as { workspace: { id: string } };

  for (const changedBody of [
    {
      ...body,
      content: '[{"type":"p","children":[{"text":"Changed content"}]}]',
    },
    {
      ...body,
      conversationTitle: `Changed conversation ${randomUUID().slice(0, 8)}`,
    },
  ]) {
    const conflict = await postWorkspace(baseURL, changedBody, idempotencyKey);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      code: 'WORKSPACE_CREATE_IDEMPOTENCY_CONFLICT',
      error:
        'This project request key is already being used for a different project payload.',
    });
  }

  expect(await countOrganizationDocuments()).toBe(documentCountBefore + 1);
  await expect(countProjectDocuments(first.workspace.id)).resolves.toBe(1);
  expect(await countMutationRequests(idempotencyKey)).toBe(1);

  const replayResponse = await postWorkspace(baseURL, body, idempotencyKey);
  expect(replayResponse.status).toBe(200);
  await expect(replayResponse.json()).resolves.toEqual(first);
  expect(await countOrganizationDocuments()).toBe(documentCountBefore + 1);
  expect(await countMutationRequests(idempotencyKey)).toBe(1);
});

test('active queued, planning, and running onboarding runs block Wiki adoption without leaving a Document', async ({
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  for (const status of ['queued', 'planning', 'running'] as const) {
    const conversationId = `onboarding-active-${status}-${randomUUID()}`;
    const documentCountBefore = await countOrganizationDocuments();
    await seedOnboardingConversationWithRun({
      conversationId,
      organizationId: 'local-org',
      status,
    });

    const blocked = await fetch(new URL('/api/workspaces', baseURL), {
      body: JSON.stringify({
        conversationId,
        deliverableType: 'document',
        goal: `This must wait for the ${status} onboarding reply.`,
        title: `Blocked Wiki ${status} ${randomUUID()}`,
      }),
      headers: {
        ...LOCAL_PLATFORM_HEADERS,
        'x-dao-idempotency-key': `blocked-onboarding-handoff-${status}-${randomUUID()}`,
      },
      method: 'POST',
    });

    expect(blocked.status, status).toBe(409);
    expect(await blocked.json()).toMatchObject({
      code: 'ONBOARDING_RUN_ACTIVE',
      error: 'Wait for the onboarding reply to finish before creating a Wiki.',
    });
    const blockedState = await readConversationState(conversationId);
    expect(blockedState.documents, status).toHaveLength(0);
    expect(blockedState.session).toMatchObject({
      activeFileId: null,
      activeFileWorkspaceId: null,
      id: conversationId,
      projectId: null,
      scopeKind: 'team',
      sourceType: 'onboarding',
      wikiId: null,
    });
    expect(blockedState.runs).toEqual([
      expect.objectContaining({
        documentId: null,
        scopeKind: 'team',
        status,
      }),
    ]);
    expect(await countOrganizationDocuments(), status).toBe(documentCountBefore);
  }
});

test('onboarding rejects workspace-only capabilities with stable errors', async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);

  const workspaceTarget = await postJsonAgentRun(baseURL, {
    message: 'Use this workspace.',
    scope: 'onboarding',
    workspaceId: 'not-allowed',
  });
  expect(workspaceTarget.status).toBe(409);
  expect(await workspaceTarget.json()).toMatchObject({
    code: 'ONBOARDING_WORKSPACE_NOT_ALLOWED',
  });

  const invalidScope = await postJsonAgentRun(baseURL, {
    message: 'Invalid scope.',
    scope: 'team',
  });
  expect(invalidScope.status).toBe(400);
  expect(await invalidScope.json()).toMatchObject({ code: 'INVALID_CHAT_SCOPE' });

  const deepResearch = await postJsonAgentRun(baseURL, {
    message: 'Research this before we create anything.',
    researchMode: 'deep',
    scope: 'onboarding',
  });
  expect(deepResearch.status).toBe(400);
  expect(await deepResearch.json()).toMatchObject({
    code: 'ONBOARDING_DEEP_RESEARCH_NOT_SUPPORTED',
  });

  const attachments = new FormData();
  attachments.set('scope', 'onboarding');
  attachments.set('researchMode', 'light');
  attachments.set('message', 'Do not accept this attachment.');
  attachments.set('attachmentsMeta', JSON.stringify([{ kind: 'text' }]));
  attachments.append(
    'attachments',
    new Blob(['private context'], { type: 'text/plain' }),
    'context.txt'
  );
  const attachmentResponse = await fetch(new URL('/api/agent/run', baseURL), {
    body: attachments,
    headers: IDENTITY_HEADERS,
    method: 'POST',
  });
  expect(attachmentResponse.status).toBe(400);
  expect(await attachmentResponse.json()).toMatchObject({
    code: 'ONBOARDING_ATTACHMENTS_NOT_SUPPORTED',
  });
});

test('already-bound and foreign-org onboarding conversations fail closed', async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);

  const successResponse = await postOnboardingRun(
    baseURL,
    `Adopt this onboarding conversation once and reject later retries. ${randomUUID()}`
  );
  expect(successResponse.status).toBe(200);
  const adoptedConversationId = successResponse.headers.get('x-dao-conversation-id');
  expect(adoptedConversationId).toBeTruthy();
  await expect(successResponse.text()).resolves.toContain('Wiki');

  const adopted = await apiRequest<{
    conversation: { id: string; scopeKind: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      conversationId: adoptedConversationId,
      deliverableType: 'document',
      title: `Bound Wiki ${randomUUID()}`,
    },
    headers: {
      'x-dao-idempotency-key': `bound-onboarding-handoff-${randomUUID()}`,
    },
    method: 'POST',
  });
  expect(adopted.conversation).toMatchObject({
    id: adoptedConversationId,
    scopeKind: 'wiki',
  });

  const documentCountAfterFirstAdoption = await countOrganizationDocuments();
  const alreadyBound = await fetch(new URL('/api/workspaces', baseURL), {
    body: JSON.stringify({
      conversationId: adoptedConversationId,
      deliverableType: 'document',
      title: `Rejected rebound Wiki ${randomUUID()}`,
    }),
    headers: {
      ...LOCAL_PLATFORM_HEADERS,
      'x-dao-idempotency-key': `rebound-onboarding-handoff-${randomUUID()}`,
    },
    method: 'POST',
  });
  expect(alreadyBound.status).toBe(409);
  expect(await alreadyBound.json()).toMatchObject({
    code: 'ONBOARDING_CONVERSATION_NOT_ADOPTABLE',
  });
  expect(await countOrganizationDocuments()).toBe(documentCountAfterFirstAdoption);
  await expect(countProjectDocuments(adopted.workspace.id)).resolves.toBe(1);

  const foreignAttempt = await fetch(new URL('/api/workspaces', baseURL), {
    body: JSON.stringify({
      conversationId: adoptedConversationId,
      deliverableType: 'document',
      title: `Foreign Wiki ${randomUUID()}`,
    }),
    headers: {
      ...LOCAL_PLATFORM_HEADERS,
      'x-dao-organization-id': 'foreign-org',
      'x-dao-idempotency-key': `foreign-onboarding-handoff-${randomUUID()}`,
    },
    method: 'POST',
  });
  expect(foreignAttempt.status).toBe(403);
  expect(await foreignAttempt.json()).toMatchObject({
    error: 'The request principal is not trusted by this runtime.',
  });
  expect(await countOrganizationDocuments()).toBe(documentCountAfterFirstAdoption);
});

async function postOnboardingRun(
  baseURL: string,
  message: string,
  conversationId?: string
) {
  const form = new FormData();
  form.set('activeFileId', '');
  form.set('baseVersionId', '');
  form.set('conversationId', conversationId || '');
  form.set('sessionId', conversationId || '');
  form.set('focusNodeId', '');
  form.set('researchMode', 'light');
  form.set('scope', 'onboarding');
  form.set('workspaceId', '');
  form.set('message', message);
  form.set('model', 'cerebras::gpt-oss-120b');
  form.set('attachmentsMeta', '[]');

  return fetch(new URL('/api/agent/run', baseURL), {
    body: form,
    headers: IDENTITY_HEADERS,
    method: 'POST',
  });
}

function postJsonAgentRun(baseURL: string, body: Record<string, unknown>) {
  return fetch(new URL('/api/agent/run', baseURL), {
    body: JSON.stringify(body),
    headers: {
      ...IDENTITY_HEADERS,
      'content-type': 'application/json',
    },
    method: 'POST',
  });
}

function postWorkspace(
  baseURL: string,
  body: Record<string, unknown>,
  idempotencyKey: string
) {
  return fetch(new URL('/api/workspaces', baseURL), {
    body: JSON.stringify(body),
    headers: {
      ...LOCAL_PLATFORM_HEADERS,
      'x-ai-settings': JSON.stringify({ language: 'en-US' }),
      'x-dao-idempotency-key': idempotencyKey,
    },
    method: 'POST',
  });
}

async function countOrganizationDocuments() {
  const database = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    const result = await database.execute({
      sql: 'SELECT COUNT(*) AS count FROM "Document" WHERE "organizationId" = ?',
      args: ['local-org'],
    });
    return Number(result.rows[0]?.count || 0);
  } finally {
    await database.close();
  }
}

async function countProjectDocuments(projectId: string) {
  const database = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    const result = await database.execute({
      sql: `SELECT COUNT(*) AS count
            FROM "Document"
            WHERE "organizationId" = ?
              AND "projectId" = ?
              AND "deletedAt" IS NULL`,
      args: ['local-org', projectId],
    });
    return Number(result.rows[0]?.count || 0);
  } finally {
    await database.close();
  }
}

async function countMutationRequests(requestKey: string) {
  const database = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    const result = await database.execute({
      sql: `SELECT COUNT(*) AS count
            FROM "MutationRequest"
            WHERE "organizationId" = ? AND "requestKey" = ?`,
      args: ['local-org', requestKey],
    });
    return Number(result.rows[0]?.count || 0);
  } finally {
    await database.close();
  }
}

async function readConversationState(conversationId: string) {
  const database = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    const [sessionResult, runsResult, messagesResult, documentsResult] =
      await Promise.all([
        database.execute({
          sql: `SELECT s."id", s."scopeKind", s."sourceType", s."projectId",
                       s."wikiId", s."activeFileId", s."revision",
                       f."documentId" AS "activeFileWorkspaceId"
                FROM "Session" s
                LEFT JOIN "WorkspaceFile" f
                  ON f."id" = s."activeFileId"
                 AND f."deletedAt" IS NULL
                WHERE s."id" = ? AND s."organizationId" = ?`,
          args: [conversationId, 'local-org'],
        }),
        database.execute({
          sql: `SELECT "id", "status", "scopeKind", "documentId",
                       "requestMessageId"
                FROM "AssistantRun"
                WHERE "sessionId" = ? AND "organizationId" = ?
                  AND "deletedAt" IS NULL
                ORDER BY "startedAt" ASC`,
          args: [conversationId, 'local-org'],
        }),
        database.execute({
          sql: `SELECT "id", "role", "documentId", "focusNodeId"
                FROM "ChatMessage"
                WHERE "sessionId" = ? AND "organizationId" = ?
                  AND "deletedAt" IS NULL
                ORDER BY "createdAt" ASC`,
          args: [conversationId, 'local-org'],
        }),
        database.execute({
          sql: `SELECT "id", "projectId", "sessionId"
                FROM "Document"
                WHERE "sessionId" = ? AND "organizationId" = ?
                  AND "deletedAt" IS NULL`,
          args: [conversationId, 'local-org'],
        }),
      ]);

    return {
      session: sessionResult.rows[0] || null,
      runs: runsResult.rows,
      messages: messagesResult.rows,
      documents: documentsResult.rows,
    };
  } finally {
    await database.close();
  }
}

async function seedOnboardingConversationWithRun(params: {
  conversationId: string;
  organizationId: string;
  status: 'queued' | 'planning' | 'running';
}) {
  const database = createClient({ url: resolveIterationDatabaseUrl() });
  const now = new Date().toISOString();

  try {
    await database.batch(
      [
        {
          sql: `INSERT INTO "Session" (
                  "id", "organizationId", "scopeKind", "title", "sourceType",
                  "revision", "createdAt", "updatedAt"
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            params.conversationId,
            params.organizationId,
            'team',
            `Onboarding ${params.status} ${params.conversationId}`,
            'onboarding',
            1,
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO "AssistantRun" (
                  "id", "organizationId", "sessionId", "documentId", "scopeKind",
                  "mode", "title", "status", "revision", "startedAt", "createdAt", "updatedAt"
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            `assistant-run-${params.status}-${randomUUID()}`,
            params.organizationId,
            params.conversationId,
            null,
            'team',
            'run',
            `Onboarding ${params.status} run`,
            params.status,
            1,
            now,
            now,
            now,
          ],
        },
      ],
      'write'
    );
  } finally {
    await database.close();
  }
}

async function seedOnboardingConversation(params: {
  conversationId: string;
  organizationId: string;
}) {
  const database = createClient({ url: resolveIterationDatabaseUrl() });
  const now = new Date().toISOString();

  try {
    await database.execute({
      sql: `INSERT INTO "Session" (
              "id", "organizationId", "scopeKind", "title", "sourceType",
              "revision", "createdAt", "updatedAt"
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        params.conversationId,
        params.organizationId,
        'team',
        `Onboarding pair ${params.conversationId}`,
        'onboarding',
        1,
        now,
        now,
      ],
    });
  } finally {
    await database.close();
  }
}

function resolveIterationDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  const iterationRoot =
    process.env.ITERATION_ROOT ||
    path.join(process.cwd(), '.tmp', 'iteration-regression');
  const appDataRoot =
    process.env.DAO_APP_DATA_ROOT || path.join(iterationRoot, 'app-data');
  return `file:${path.join(appDataRoot, 'dev.db')}`;
}
