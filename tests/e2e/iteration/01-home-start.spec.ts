import path from 'node:path';

import { createClient } from '@libsql/client';
import { expect, test } from '@playwright/test';
import {
  apiRequest,
  extractWorkspaceIdFromLocation,
  LOCAL_PLATFORM_HEADERS,
  primeClientState,
  waitForWorkspaceRoute,
} from './helpers';

test('home starter exposes built-in workflows and can start from the research workflow', async ({
  page,
}) => {
  await primeClientState(page);
  await page.goto('/');

  await expect(page.getByRole('dialog', { name: /欢迎使用成形|Welcome/ })).toHaveCount(0);
  await expect(page.getByTestId('first-use-guide-home')).toBeVisible();

  await page.getByRole('main').getByRole('button', { name: /从目标开始|Start with a Goal/ }).click();

  const goalDialog = page.getByRole('dialog');
  await expect(goalDialog).toBeVisible();
  await expect(goalDialog.getByLabel(/目标|Goal/)).toBeVisible();
  await expect(goalDialog.getByTestId('goal-deliverable-pill')).toHaveCount(0);
  await expect(page.getByTestId('starter-option-document')).toHaveCount(0);
  await expect(page.getByTestId('starter-option-code')).toHaveCount(0);

  const workflowSelect = page.getByRole('combobox').first();
  await workflowSelect.click();
  const workflowList = page.getByRole('listbox');
  await expect(
    workflowList.getByRole('option', { name: /需求规格到网页上线|Built-in/ }).first()
  ).toBeVisible();
  await workflowList
    .getByRole('option', { name: /成形类产品市场分析报告|Built-in/ })
    .first()
    .click();

  await expect(workflowSelect).toContainText(/成形类产品市场分析报告/);
  await expect(page.getByTestId('goal-workflow-extension-tools')).toBeVisible();
  await expect(page.getByTestId('goal-workflow-extension-mcp')).toBeVisible();
  await expect(page.getByTestId('goal-workflow-extension-skills')).toBeVisible();

  await page.locator('#goal').fill('调研成形类产品的市场机会与竞争格局。');
  const createButton = page.getByRole('button', { name: /创建项目|Create Project/ });
  await expect(createButton).toBeEnabled();
  await Promise.all([
    page.waitForURL(/\/workspace\//),
    createButton.click(),
  ]);

  expect(extractWorkspaceIdFromLocation(page.url())).toBeTruthy();
  expect(new URL(page.url()).searchParams.has('autoStartFirstPass')).toBe(false);
  await expect(page.getByTestId('assistant-tab-room')).toHaveAttribute(
    'data-state',
    'active'
  );
  await expect(page.getByTestId('project-room-surface')).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByTestId('room-feed').getByText(
      '调研成形类产品的市场机会与竞争格局。',
      { exact: true }
    )
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('assistant-tab-chat')).toHaveAttribute(
    'data-state',
    'inactive'
  );
});

test('home create flow surfaces clarify cards for ambiguous goals', async ({ page }) => {
  await primeClientState(page);
  await page.goto('/');

  await page.getByRole('main').getByRole('button', { name: /从目标开始|Start with a Goal/ }).click();

  const goalDialog = page.getByRole('dialog');
  await expect(goalDialog).toBeVisible();

  await goalDialog.getByLabel(/目标|Goal/).fill('介绍一下我们的服务。');
  await goalDialog.getByRole('button', { name: /创建项目|Create Project/ }).click();

  await expect(goalDialog).toContainText(/更了解你期望的结果形态|结果形态|最佳方式/);
  await expect(goalDialog.getByTestId('goal-intent-option-document')).toBeVisible();
  await expect(goalDialog.getByTestId('goal-intent-option-web')).toBeVisible();
  await expect(goalDialog.getByTestId('goal-intent-option-both')).toBeVisible();
  await expect(goalDialog.getByTestId('goal-intent-option-other')).toBeVisible();

  await Promise.all([
    page.waitForURL(/\/workspace\//),
    goalDialog
      .getByTestId('goal-intent-option-document')
      .getByRole('button', { name: /选择|Select/ })
      .click(),
  ]);
});

test('home create flow asks for goal detail before accepting an extremely vague request', async ({
  page,
}) => {
  await primeClientState(page);
  await page.goto('/');

  await page.getByRole('main').getByRole('button', { name: /从目标开始|Start with a Goal/ }).click();

  const goalDialog = page.getByRole('dialog');
  await expect(goalDialog).toBeVisible();

  await goalDialog.getByLabel(/目标|Goal/).fill('帮我弄个东西');
  await goalDialog.getByRole('button', { name: /创建项目|Create Project/ }).click();

  await expect(goalDialog.getByTestId('goal-goal-clarify')).toBeVisible();
  await expect(goalDialog.getByTestId('goal-goal-clarify')).toContainText(
    /产出什么|page, a brief, a report/
  );
  await expect(goalDialog.getByTestId('goal-goal-clarify')).toContainText(
    /给谁看|Who is it for/
  );
  await expect(goalDialog.getByTestId('goal-goal-clarify')).toContainText(
    /达成什么结果|What should it achieve/
  );
});

test('workspace creation persists the initial goal as the first human Project Room message', async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const goal = `精确持久化项目初始目标 ${suffix}。`;
  const created = await apiRequest<{
    initialRoomMessageReceipt: {
      eventSequence: number;
      messageId: string;
      messageSequence: number;
      roomId: string;
      schemaVersion: 1;
      status: 'accepted';
    };
    room: { id: string; projectId: string | null };
    workspace: { id: string; projectId: string | null };
  }>(baseURL, '/api/workspaces', {
    body: {
      deliverableType: 'document',
      goal: `  ${goal}  `,
      title: `初始目标持久化 ${suffix}`,
    },
    method: 'POST',
  });

  expect(created.room.projectId).toBe(created.workspace.id);
  expect(created.workspace.projectId).toBe(created.workspace.id);
  expect(created.initialRoomMessageReceipt).toMatchObject({
    eventSequence: 1,
    messageSequence: 1,
    roomId: created.room.id,
    schemaVersion: 1,
    status: 'accepted',
  });

  const [plan, roomMessages] = await Promise.all([
    apiRequest<{
      createdByUserId: string | null;
      goal: string;
      organizationId: string;
      originDeviceId: string | null;
      workspaceId: string;
    }>(baseURL, `/api/workspaces/${created.workspace.id}/plan`),
    apiRequest<{
      messages: Array<{
        actor: { type: string; userId: string };
        attachments: unknown[];
        createdAt: string;
        envelopeType: string;
        mentions: unknown[];
        messageId: string;
        metadata?: unknown;
        organizationId: string;
        roomId: string;
        schemaVersion: number;
        sequence: number;
        text: string;
      }>;
      schemaVersion: number;
    }>(
      baseURL,
      `/api/rooms/${encodeURIComponent(created.room.id)}/messages?after=0&limit=10`
    ),
  ]);

  expect(plan).toMatchObject({
    createdByUserId: 'local-user',
    goal,
    organizationId: 'local-org',
    originDeviceId: 'local-device',
    workspaceId: created.workspace.id,
  });
  expect(roomMessages.schemaVersion).toBe(1);
  expect(roomMessages.messages).toHaveLength(1);
  expect(roomMessages.messages[0]).toEqual({
    actor: { type: 'human', userId: 'local-user' },
    attachments: [],
    createdAt: expect.any(String),
    envelopeType: 'room.message',
    mentions: [],
    messageId: created.initialRoomMessageReceipt.messageId,
    metadata: {
      source: 'project-creation',
      workspaceId: created.workspace.id,
    },
    organizationId: 'local-org',
    roomId: created.room.id,
    schemaVersion: 1,
    sequence: 1,
    text: goal,
  });
});

test('home project cards summarize the latest node and open the canonical project route', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const projectTitle = `项目摘要 ${suffix}`;
  const latestDeliverableTitle = `FAQ 页面 ${suffix}`;

  const firstWorkspace = await apiRequest<{
    conversation: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      deliverableType: 'document',
      goal: `${projectTitle} 的第一份交付物。`,
      title: projectTitle,
    },
    method: 'POST',
  });

  const latestWorkspace = await apiRequest<{
    conversation: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      deliverableType: 'document',
      goal: `${projectTitle} 的第二份交付物。`,
      projectId: firstWorkspace.workspace.id,
      projectTitle,
      title: latestDeliverableTitle,
    },
    method: 'POST',
  });

  await primeClientState(page);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        /\/api\/project-list(?:\?|$)/.test(response.url()) &&
        response.request().method() === 'GET',
      { timeout: 45000 }
    ),
    page.goto('/'),
  ]);

  const projectCard = page.getByTestId(`home-project-card-${firstWorkspace.workspace.id}`);
  await expect(page.getByTestId('home-project-wall')).toBeVisible({ timeout: 10000 });
  await expect(projectCard).toBeVisible();
  await expect(projectCard).toContainText(projectTitle);
  await expect(projectCard).toContainText(/2 份内容|2 nodes/);
  await expect(projectCard).toContainText(
    /最近活跃内容|Latest active content/
  );
  await expect(projectCard).toContainText(latestDeliverableTitle);
  await expect(projectCard).toContainText(
    /打开|Open/
  );
  await expect(projectCard).toContainText(
    /新建内容|New Item/
  );

  await page.getByTestId(`home-project-open-${firstWorkspace.workspace.id}`).click();
  await expect
    .poll(() => {
      const currentUrl = new URL(page.url());
      return {
        nodeId:
          currentUrl.searchParams.get('node') ||
          currentUrl.pathname.split('/').pop() ||
          '',
        projectId: currentUrl.pathname.split('/').pop() || '',
      };
    })
    .toEqual({
      nodeId: latestWorkspace.workspace.id,
      projectId: firstWorkspace.workspace.id,
    });
});

test('home project cards can continue the next deliverable inside the same project', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const projectTitle = `项目继续 ${suffix}`;

  const firstWorkspace = await apiRequest<{
    conversation: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      deliverableType: 'document',
      goal: `${projectTitle} 的当前交付物。`,
      title: projectTitle,
    },
    method: 'POST',
  });

  await apiRequest<{
    conversation: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      deliverableType: 'document',
      goal: `${projectTitle} 的延续交付物。`,
      projectId: firstWorkspace.workspace.id,
      projectTitle,
      title: `当前交付物 ${suffix}`,
    },
    method: 'POST',
  });

  await primeClientState(page);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        /\/api\/project-list(?:\?|$)/.test(response.url()) &&
        response.request().method() === 'GET',
      { timeout: 45000 }
    ),
    page.goto('/'),
  ]);

  await page.getByTestId(`home-project-next-${firstWorkspace.workspace.id}`).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(projectTitle);
  await expect(dialog).toContainText(/沿着|continues inside/i);
  await expect(
    dialog.getByRole('button', { name: /创建内容|Create Content/ })
  ).toBeVisible();

  await dialog.getByLabel(/目标|Goal/).fill('沿着当前项目继续下一份摘要交付物。');
  await dialog.getByRole('button', { name: /创建内容|Create Content/ }).click();
  const clarifyAfterNextDeliverable = dialog.getByTestId('goal-intent-option-document');
  if (
    await clarifyAfterNextDeliverable
      .waitFor({ state: 'visible', timeout: 1500 })
      .then(() => true)
      .catch(() => false)
  ) {
    await clarifyAfterNextDeliverable.getByRole('button', { name: /选择|Select/ }).click();
  }

  const nextRoute = await waitForWorkspaceRoute(page, {
    excludeConversationId: firstWorkspace.conversation.id,
    excludeWorkspaceId: firstWorkspace.workspace.id,
  });
  const nextWorkspaceId = nextRoute.workspaceId;
  const nextConversationId = nextRoute.conversationId;

  expect(nextRoute.pathname).toMatch(/^\/workspace\/[^/]+$/);

  const nextView = await getWorkspaceView(baseURL, nextWorkspaceId, nextConversationId);

  expect(nextView.currentProject?.id).toBe(firstWorkspace.workspace.id);
  expect(nextView.workspace?.projectId).toBe(firstWorkspace.workspace.id);
});

test('node relation deletion is scoped to the route workspace', async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const projectA = await apiRequest<{ workspace: { id: string } }>(
    baseURL,
    '/api/workspaces',
    {
      body: {
        deliverableType: 'document',
        goal: `验证项目 A 的节点关系删除边界 ${suffix}`,
        title: `节点关系项目 A ${suffix}`,
      },
      method: 'POST',
    }
  );
  const projectANode = await apiRequest<{ workspace: { id: string } }>(
    baseURL,
    '/api/workspaces',
    {
      body: {
        deliverableType: 'document',
        goal: `创建项目 A 的关系目标节点 ${suffix}`,
        projectId: projectA.workspace.id,
        title: `节点关系项目 A 子节点 ${suffix}`,
      },
      method: 'POST',
    }
  );
  const projectB = await apiRequest<{ workspace: { id: string } }>(
    baseURL,
    '/api/workspaces',
    {
      body: {
        deliverableType: 'document',
        goal: `验证项目 B 不能删除项目 A 的节点关系 ${suffix}`,
        title: `节点关系项目 B ${suffix}`,
      },
      method: 'POST',
    }
  );
  const relation = await apiRequest<{
    id: string;
    kind: string;
    sourceNodeId: string;
    targetNodeId: string;
  }>(baseURL, `/api/workspaces/${projectA.workspace.id}/node-relations`, {
    body: {
      kind: 'dependency',
      sourceNodeId: projectA.workspace.id,
      targetNodeId: projectANode.workspace.id,
    },
    method: 'POST',
  });

  const crossWorkspaceDelete = await fetch(
    new URL(
      `/api/workspaces/${projectB.workspace.id}/node-relations?id=${encodeURIComponent(relation.id)}`,
      baseURL
    ),
    { headers: LOCAL_PLATFORM_HEADERS, method: 'DELETE' }
  );

  expect(crossWorkspaceDelete.status).toBe(404);
  await expect(crossWorkspaceDelete.json()).resolves.toEqual({
    error: 'Relation not found.',
  });

  const afterRejectedDelete = await apiRequest<{
    relations: Array<{ id: string }>;
  }>(baseURL, `/api/workspaces/${projectA.workspace.id}/node-relations`);
  expect(afterRejectedDelete.relations.map(({ id }) => id)).toContain(relation.id);

  await expect(
    apiRequest<{ ok: boolean }>(
      baseURL,
      `/api/workspaces/${projectA.workspace.id}/node-relations?id=${encodeURIComponent(relation.id)}`,
      { method: 'DELETE' }
    )
  ).resolves.toEqual({ ok: true });

  const afterValidDelete = await apiRequest<{
    relations: Array<{ id: string }>;
  }>(baseURL, `/api/workspaces/${projectA.workspace.id}/node-relations`);
  expect(afterValidDelete.relations.map(({ id }) => id)).not.toContain(relation.id);
});

test('canvas layout API accepts only active project roots without partial writes', async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const created = await apiRequest<{ workspace: { id: string } }>(
    baseURL,
    '/api/workspaces',
    {
      body: {
        deliverableType: 'document',
        goal: `验证画布坐标持久化 ${suffix}`,
        title: `画布坐标 ${suffix}`,
      },
      method: 'POST',
    }
  );
  const child = await apiRequest<{ workspace: { id: string } }>(
    baseURL,
    '/api/workspaces',
    {
      body: {
        deliverableType: 'document',
        goal: `验证非项目根画布坐标被拒绝 ${suffix}`,
        projectId: created.workspace.id,
        title: `画布子交付物 ${suffix}`,
      },
      method: 'POST',
    }
  );
  const deleted = await apiRequest<{ workspace: { id: string } }>(
    baseURL,
    '/api/workspaces',
    {
      body: {
        deliverableType: 'document',
        goal: `验证已删除项目画布坐标被拒绝 ${suffix}`,
        title: `已删除画布项目 ${suffix}`,
      },
      method: 'POST',
    }
  );
  const foreignOrganizationId = `canvas-foreign-org-${suffix}`;
  const foreignProjectId = `canvas-foreign-project-${suffix}`;
  const standaloneDocumentId = `canvas-standalone-document-${suffix}`;
  await seedCanvasLayoutAclFixtures({
    deletedProjectId: deleted.workspace.id,
    foreignOrganizationId,
    foreignProjectId,
    nonRootProjectId: child.workspace.id,
    standaloneDocumentId,
    suffix,
  });

  const expectedPosition = { x: 137.5, y: -248.25 };

  await expect(
    apiRequest<{ ok: boolean }>(baseURL, '/api/canvas-layout', {
      body: {
        positions: {
          [created.workspace.id]: expectedPosition,
        },
      },
      method: 'PATCH',
    })
  ).resolves.toEqual({ ok: true });

  const persisted = await apiRequest<{
    positions: Record<string, { x: number; y: number }>;
  }>(baseURL, '/api/canvas-layout');
  expect(persisted.positions[created.workspace.id]).toEqual(expectedPosition);
  for (const projectId of [
    foreignProjectId,
    deleted.workspace.id,
    child.workspace.id,
    standaloneDocumentId,
  ]) {
    expect(persisted.positions[projectId], projectId).toBeUndefined();
  }

  const untrustedOrganizationResponse = await fetch(
    new URL('/api/canvas-layout', baseURL),
    {
      headers: {
        ...LOCAL_PLATFORM_HEADERS,
        'x-dao-organization-id': `untrusted-org-${suffix}`,
      },
    }
  );
  expect(untrustedOrganizationResponse.status).toBe(403);

  const missingProjectId = `missing-canvas-project-${suffix}`;
  const rejectedProjectIds = [
    missingProjectId,
    foreignProjectId,
    deleted.workspace.id,
    child.workspace.id,
    standaloneDocumentId,
  ];

  for (const projectId of rejectedProjectIds) {
    const response = await patchCanvasLayout(baseURL, {
      [projectId]: { x: 1, y: 2 },
    });
    expect(response.status, projectId).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Project not found.' });
  }

  const mixedBatchResponse = await patchCanvasLayout(baseURL, {
    [created.workspace.id]: { x: 900, y: 901 },
    [foreignProjectId]: { x: 3, y: 4 },
  });
  expect(mixedBatchResponse.status).toBe(404);

  const afterRejectedPatch = await apiRequest<{
    positions: Record<string, { x: number; y: number }>;
  }>(baseURL, '/api/canvas-layout');
  expect(afterRejectedPatch.positions[created.workspace.id]).toEqual(expectedPosition);
  for (const projectId of rejectedProjectIds) {
    expect(afterRejectedPatch.positions[projectId], projectId).toBeUndefined();
  }
});

test('home view mode is URL-addressable and restores with browser history', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();

  await apiRequest(baseURL, '/api/workspaces', {
    body: {
      deliverableType: 'document',
      goal: `验证首页视图 URL 状态 ${suffix}`,
      title: `首页视图 ${suffix}`,
    },
    method: 'POST',
  });

  await primeClientState(page);
  await page.goto('/');
  await expect(page.getByTestId('home-project-wall')).toBeVisible();
  await expect(page.locator('[data-testid^="home-project-open-"]').first()).toHaveAttribute(
    'href',
    /\/workspace\//
  );
  await expect(page.locator('[data-testid^="home-project-next-"]').first()).toHaveAttribute(
    'href',
    /newDeliverableProjectId=/
  );

  const canvasLayoutResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/canvas-layout' &&
      response.request().method() === 'GET'
  );
  await page.getByTestId('home-view-canvas').click();
  const canvasLayoutResponse = await canvasLayoutResponsePromise;
  expect(canvasLayoutResponse.status()).toBe(200);
  await expect(page).toHaveURL(/(?:\?|&)view=canvas(?:&|$)/);
  await expect(page.getByTestId('home-view-canvas')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('home-canvas')).toBeVisible();

  await page.getByTestId('home-view-list').click();
  await expect(page).not.toHaveURL(/(?:\?|&)view=/);
  await expect(page.getByTestId('home-view-list')).toHaveAttribute('aria-pressed', 'true');

  await page.goBack();
  await expect(page).toHaveURL(/(?:\?|&)view=canvas(?:&|$)/);
  await expect(page.getByTestId('home-view-canvas')).toHaveAttribute('aria-pressed', 'true');
});

async function getWorkspaceView(
  baseURL: string,
  workspaceId: string,
  conversationId: string
) {
  return apiRequest<{
    currentProject: { id: string; title: string } | null;
    workspace: {
      projectId: string;
      title?: string | null;
    } | null;
  }>(baseURL, `/api/workspaces/${workspaceId}?conversationId=${conversationId}`);
}

async function patchCanvasLayout(
  baseURL: string,
  positions: Record<string, { x: number; y: number }>
) {
  return fetch(new URL('/api/canvas-layout', baseURL), {
    body: JSON.stringify({ positions }),
    headers: LOCAL_PLATFORM_HEADERS,
    method: 'PATCH',
  });
}

async function seedCanvasLayoutAclFixtures(params: {
  deletedProjectId: string;
  foreignOrganizationId: string;
  foreignProjectId: string;
  nonRootProjectId: string;
  standaloneDocumentId: string;
  suffix: number;
}) {
  const database = createClient({ url: resolveIterationDatabaseUrl() });
  const now = new Date().toISOString();
  const foreignSessionId = `canvas-foreign-session-${params.suffix}`;
  const standaloneSessionId = `canvas-standalone-session-${params.suffix}`;

  try {
    await database.batch(
      [
        {
          sql: `UPDATE "Document"
            SET "deletedAt" = ?, "updatedAt" = ?
            WHERE "id" = ? AND "organizationId" = ?`,
          args: [now, now, params.deletedProjectId, 'local-org'],
        },
        {
          sql: `INSERT INTO "Organization"
            ("id", "slug", "name", "createdAt", "updatedAt")
            VALUES (?, ?, ?, ?, ?)`,
          args: [
            params.foreignOrganizationId,
            params.foreignOrganizationId,
            'Canvas foreign organization',
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO "Session"
            ("id", "organizationId", "title", "createdAt", "updatedAt")
            VALUES (?, ?, ?, ?, ?)`,
          args: [
            foreignSessionId,
            params.foreignOrganizationId,
            'Canvas foreign session',
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO "Document"
            ("id", "organizationId", "sessionId", "projectId", "title", "createdAt", "updatedAt")
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            params.foreignProjectId,
            params.foreignOrganizationId,
            foreignSessionId,
            params.foreignProjectId,
            'Canvas foreign project',
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO "Session"
            ("id", "organizationId", "title", "createdAt", "updatedAt")
            VALUES (?, ?, ?, ?, ?)`,
          args: [
            standaloneSessionId,
            'local-org',
            'Canvas standalone session',
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO "Document"
            ("id", "organizationId", "sessionId", "projectId", "title", "createdAt", "updatedAt")
            VALUES (?, ?, ?, NULL, ?, ?, ?)`,
          args: [
            params.standaloneDocumentId,
            'local-org',
            standaloneSessionId,
            'Canvas standalone document',
            now,
            now,
          ],
        },
        ...[
          params.foreignProjectId,
          params.deletedProjectId,
          params.nonRootProjectId,
          params.standaloneDocumentId,
        ].map((projectId, index) => ({
          sql: `INSERT INTO "ProjectCanvasLayout"
            ("id", "organizationId", "projectId", "x", "y", "updatedAt")
            VALUES (?, ?, ?, ?, ?, ?)`,
          args: [
            `canvas-poisoned-layout-${params.suffix}-${index}`,
            'local-org',
            projectId,
            700 + index,
            800 + index,
            now,
          ],
        })),
      ],
      'write'
    );
  } finally {
    database.close();
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
