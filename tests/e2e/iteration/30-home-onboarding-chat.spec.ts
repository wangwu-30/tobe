import { expect, test } from '@playwright/test';

import { apiRequest, primeClientState, waitForWorkspaceRoute } from './helpers';

test('first mobile visit can chat directly without creating a Wiki', async ({
  page,
}) => {
  const conversationId = 'mobile-onboarding-conversation';
  const prompt = 'Help me plan a mobile-friendly product Wiki.';
  let agentRequestBody = '';
  let agentRunPostCount = 0;
  let createWorkspacePostCount = 0;

  await page.setViewportSize({ height: 812, width: 375 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await primeClientState(page);
  await page.route('**/api/agent/run', async (route) => {
    agentRunPostCount += 1;
    agentRequestBody = route.request().postDataBuffer()?.toString('utf8') || '';
    await route.fulfill({
      body: 'Let us shape that Wiki together.',
      contentType: 'text/plain; charset=utf-8',
      headers: {
        'x-dao-conversation-id': conversationId,
      },
      status: 200,
    });
  });
  await page.route('**/api/workspaces', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    createWorkspacePostCount += 1;
    await route.abort();
  });

  await page.goto('/');

  const composer = page.getByTestId('agent-composer-input');

  await expect(page.getByTestId('first-use-guide-home')).toHaveCount(0);
  await expect(composer).toBeVisible();
  await expect(page.getByTestId('home-onboarding-chat').getByRole('log')).toHaveCount(0);

  await composer.focus();
  await composer.fill(prompt);
  await expect(composer).toHaveValue(prompt);
  const send = page.getByRole('button', { name: /发送消息|Send message/i });
  const sendBox = await send.boundingBox();
  expect(sendBox?.height).toBeGreaterThanOrEqual(44);
  await send.click();

  await expect.poll(() => agentRequestBody).toContain(prompt);
  await expect(page.getByText('Let us shape that Wiki together.')).toBeVisible();
  await expect(page.getByTestId('home-onboarding-chat').getByRole('log')).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('onboardingConversationId'))
    .toBe(conversationId);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.sessionStorage.getItem('dao-home-onboarding-conversation-id')
      )
    )
    .toBe(conversationId);
  expect(agentRequestBody).toContain('name="scope"');
  expect(agentRequestBody).toContain('onboarding');
  expect(agentRequestBody).not.toContain('name="attachments"');
  expect(agentRunPostCount).toBe(1);
  expect(createWorkspacePostCount).toBe(0);
});

test('home onboarding create Wiki waits for explicit confirmation, preserves the onboarding Session on cancel, and submits once on confirm', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const goal = `Build a durable product decisions Wiki for our small team. ${suffix}`;
  const title = `Decisions Wiki ${String(suffix).slice(-6)}`;
  let agentRequestBody = '';
  let agentRunPostCount = 0;
  let createWorkspacePostCount = 0;
  const createRequestBodies: Array<Record<string, unknown>> = [];

  await primeClientState(page);
  await page.addInitScript(() => {
    const current = JSON.parse(window.localStorage.getItem('ai-settings') || '{}');
    window.localStorage.setItem(
      'ai-settings',
      JSON.stringify({
        ...current,
        defaultModel: 'cerebras::gpt-oss-120b',
        language: 'zh-CN',
      })
    );
  });
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'POST' && pathname === '/api/agent/run') {
      agentRunPostCount += 1;
      agentRequestBody = request.postDataBuffer()?.toString('utf8') || '';
    }
    if (request.method() === 'POST' && pathname === '/api/workspaces') {
      createWorkspacePostCount += 1;
      createRequestBodies.push(request.postDataJSON() as Record<string, unknown>);
    }
  });

  await Promise.all([
    page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/ai/models'
    ),
    page.goto('/'),
  ]);

  const onboarding = page.getByTestId('home-onboarding-chat');
  await expect(onboarding).toBeVisible();
  await expect(page.getByTestId('home-onboarding-create-wiki')).toBeVisible();
  await expect(onboarding.getByRole('button', { name: /附件|attachment/i })).toHaveCount(0);
  await expect(onboarding.getByRole('button', { name: /深度研究|deep research/i })).toHaveCount(0);

  const agentResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/agent/run'
  );
  await page.getByTestId('agent-composer-input').fill(goal);
  await page.getByTestId('agent-composer-input').press('Enter');
  const agentResponse = await agentResponsePromise;
  expect(agentResponse.ok()).toBe(true);
  const conversationId = agentResponse.headers()['x-dao-conversation-id'];
  expect(conversationId).toBeTruthy();

  await expect
    .poll(() => new URL(page.url()).searchParams.get('onboardingConversationId'))
    .toBe(conversationId);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.sessionStorage.getItem('dao-home-onboarding-conversation-id')
      )
    )
    .toBe(conversationId);
  await expect(page.getByTestId('home-onboarding-create-wiki')).toBeEnabled({
    timeout: 20_000,
  });
  expect(agentRunPostCount).toBe(1);
  expect(createRequestBodies).toHaveLength(0);
  expect(agentRequestBody).toContain('name="scope"');
  expect(agentRequestBody).toContain('onboarding');
  expect(agentRequestBody).not.toContain('name="attachments"');

  const createWikiButton = page.getByTestId('home-onboarding-create-wiki');
  await expect(createWikiButton).toBeEnabled();
  await createWikiButton.click();
  const confirmationDialog = page.getByTestId('wiki-create-confirmation-dialog');
  await expect(confirmationDialog).toBeVisible();
  await expect(confirmationDialog).toContainText(
    /只有你点击确认后|Nothing is created until you confirm/
  );
  await expect(
    confirmationDialog.getByTestId('wiki-create-session-continuation')
  ).toBeVisible();
  await expect(
    confirmationDialog.getByTestId('wiki-create-purpose-input')
  ).toHaveValue(goal);
  expect(createRequestBodies).toHaveLength(0);

  await confirmationDialog.getByRole('button', { name: /取消|Cancel/ }).click();
  await expect(confirmationDialog).toBeHidden();
  expect(createRequestBodies).toHaveLength(0);
  await expect
    .poll(() => new URL(page.url()).searchParams.get('onboardingConversationId'))
    .toBe(conversationId);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.sessionStorage.getItem('dao-home-onboarding-conversation-id')
      )
    )
    .toBe(conversationId);

  await createWikiButton.click();
  await expect(confirmationDialog).toBeVisible();
  await expect(
    confirmationDialog.getByTestId('wiki-create-purpose-input')
  ).toHaveValue(goal);
  await confirmationDialog.getByTestId('wiki-create-name-input').fill(title);
  expect(createRequestBodies).toHaveLength(0);
  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/workspaces'
  );
  await confirmationDialog.getByTestId('wiki-create-confirm').click();
  const createResponse = await createResponsePromise;
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as {
    conversation: { id: string };
    initialRoomMessageReceipt: { status: string } | null;
    room: { id: string; projectId: string | null };
    workspace: { id: string; projectId: string | null };
  };

  await expect.poll(() => createRequestBodies).toHaveLength(1);
  expect(createWorkspacePostCount).toBe(1);
  expect(createRequestBodies[0]).toMatchObject({
    conversationId,
    goal,
    title,
  });
  expect(created.conversation.id).toBe(conversationId);
  expect(created.workspace.projectId).toBe(created.workspace.id);
  expect(created.room.projectId).toBe(created.workspace.id);
  expect(created.initialRoomMessageReceipt).toMatchObject({ status: 'accepted' });
  await expect(page).toHaveURL(
    `/workspace/${created.workspace.id}?node=${created.workspace.id}&conversationId=${conversationId}`,
    { timeout: 20_000 }
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.sessionStorage.getItem('dao-home-onboarding-conversation-id')
      )
    )
    .toBeNull();

  const createdRoute = await waitForWorkspaceRoute(page, { timeout: 20_000 });
  expect(createdRoute).toMatchObject({
    conversationId,
    projectId: created.workspace.id,
    workspaceId: created.workspace.id,
  });
  const adoptedView = await apiRequest<{
    currentConversation: {
      id: string;
      messages: Array<{ content: string; role: string }>;
      projectId: string | null;
      scopeKind: string;
      sourceType: string;
    } | null;
    workspace: { id: string; projectId: string; title: string } | null;
  }>(
    baseURL,
    `/api/workspaces/${created.workspace.id}?conversationId=${conversationId}`
  );
  expect(adoptedView.workspace).toMatchObject({
    id: created.workspace.id,
    projectId: created.workspace.id,
    title,
  });
  expect(adoptedView.currentConversation).toMatchObject({
    id: conversationId,
    projectId: created.workspace.id,
    scopeKind: 'wiki',
    sourceType: 'onboarding',
  });
  expect(adoptedView.currentConversation?.messages).toEqual(
    expect.arrayContaining([expect.objectContaining({ content: goal, role: 'user' })])
  );
});

test('creating an independent Wiki does not clear an existing Home onboarding Session', async ({
  page,
}) => {
  const conversationId = 'preserved-home-conversation';

  await primeClientState(page);
  await page.addInitScript((storedConversationId) => {
    window.sessionStorage.setItem(
      'dao-home-onboarding-conversation-id',
      storedConversationId
    );
  }, conversationId);
  await page.route(
    `**/api/conversations/${conversationId}/messages?scope=onboarding`,
    async (route) => {
      await route.fulfill({
        body: '[]',
        contentType: 'application/json',
        status: 200,
      });
    }
  );
  await page.route('**/api/project-list', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        items: [
          {
            deliverableCount: 1,
            id: 'existing-wiki',
            latestDeliverableTitle: 'Existing Wiki',
            preview: '',
            title: 'Existing Wiki',
            updatedAt: '2026-08-24T00:00:00.000Z',
            workspaceId: 'existing-wiki',
          },
        ],
      }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/workspaces', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    expect(route.request().postDataJSON()).toMatchObject({
      conversationId: null,
      title: 'Independent Wiki',
    });
    await route.fulfill({
      body: JSON.stringify({
        conversation: { id: 'independent-wiki-conversation' },
        initialRoomMessageReceipt: null,
        room: { id: 'independent-room', projectId: 'independent-wiki' },
        workspace: { id: 'independent-wiki', projectId: 'independent-wiki' },
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.goto(`/?onboardingConversationId=${conversationId}`);
  await expect(page.getByTestId('agent-composer-input')).toBeVisible();
  const wikiList = page.getByTestId('home-wiki-list');
  await expect(wikiList).toBeVisible();
  await expect(
    wikiList.getByRole('button', { name: /创建 Wiki 空间|Create Wiki Space/ })
  ).toHaveCount(0);
  await page
    .locator('aside')
    .getByRole('button', { name: /新建 Wiki 空间|New Wiki Space/ })
    .first()
    .click();
  await page.getByTestId('wiki-create-name-input').fill('Independent Wiki');
  await page.getByTestId('wiki-create-confirm').click();

  await expect(page).toHaveURL(
    '/workspace/independent-wiki?node=independent-wiki&conversationId=independent-wiki-conversation'
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.sessionStorage.getItem('dao-home-onboarding-conversation-id')
      )
    )
    .toBe(conversationId);
});

test('home onboarding can start a new conversation after restore fetch rejects', async ({
  page,
}) => {
  const staleConversationId = 'stale-onboarding-conversation';
  const freshConversationId = 'fresh-onboarding-conversation';

  await primeClientState(page);
  await page.addInitScript((conversationId) => {
    window.sessionStorage.setItem(
      'dao-home-onboarding-conversation-id',
      conversationId
    );
  }, staleConversationId);
  await page.route(
    `**/api/conversations/${staleConversationId}/messages?scope=onboarding`,
    async (route) => {
      await route.abort('failed');
    }
  );
  await page.route('**/api/agent/run', async (route) => {
    await route.fulfill({
      body: 'Let us begin a fresh onboarding conversation.',
      contentType: 'text/plain; charset=utf-8',
      headers: {
        'x-dao-conversation-id': freshConversationId,
      },
      status: 200,
    });
  });

  await page.goto(`/?onboardingConversationId=${staleConversationId}`);

  await expect(page.getByTestId('home-onboarding-chat')).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: /新对话|New Conversation/ }).click();
  await expect(page.getByTestId('agent-composer-input')).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.has('onboardingConversationId'))
    .toBe(false);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.sessionStorage.getItem('dao-home-onboarding-conversation-id')
      )
    )
    .toBeNull();

  await page.getByTestId('agent-composer-input').fill('Start a fresh Wiki conversation.');
  await page.getByTestId('agent-composer-input').press('Enter');

  await expect
    .poll(() => new URL(page.url()).searchParams.get('onboardingConversationId'))
    .toBe(freshConversationId);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.sessionStorage.getItem('dao-home-onboarding-conversation-id')
      )
    )
    .toBe(freshConversationId);
});
