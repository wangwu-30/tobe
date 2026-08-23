import { expect, test } from '@playwright/test';

import { primeClientState } from './helpers';

test('first mobile visit dismisses onboarding before focusing and sending from Chat', async ({
  page,
}) => {
  const conversationId = 'mobile-onboarding-conversation';
  const prompt = 'Help me plan a mobile-friendly product Wiki.';
  let agentRequestBody = '';

  await page.setViewportSize({ height: 812, width: 375 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await primeClientState(page);
  await page.addInitScript(() => {
    window.localStorage.removeItem('dao-has-seen-onboarding');
  });
  await page.route('**/api/agent/run', async (route) => {
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

  await page.goto('/');

  const guide = page.getByTestId('first-use-guide-home');
  const askAssistant = guide.getByRole('button', {
    name: /问助手|Ask Assistant/i,
  });
  const dismiss = guide.getByRole('button', { name: /知道了|Got It/i });
  const composer = page.getByTestId('agent-composer-input');

  await expect(guide).toBeVisible();
  await expect(composer).toBeVisible();
  for (const target of [askAssistant, dismiss]) {
    const box = await target.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  await askAssistant.click();

  await expect(guide).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem('dao-has-seen-onboarding')
      )
    )
    .toBe('true');
  await expect(composer).toBeFocused();

  await composer.fill(prompt);
  await expect(composer).toHaveValue(prompt);
  const send = page.getByRole('button', { name: /发送消息|Send message/i });
  const sendBox = await send.boundingBox();
  expect(sendBox?.height).toBeGreaterThanOrEqual(44);
  await send.click();

  await expect.poll(() => agentRequestBody).toContain(prompt);
  await expect(guide).toBeHidden();
});

test('home onboarding create Wiki waits for explicit confirmation, preserves the onboarding Session on cancel, and submits once on confirm', async ({
  page,
}) => {
  const conversationId = 'onboarding-conversation-e2e';
  const goal = 'Build a durable product decisions Wiki for our small team.';
  const title = 'Product decisions Wiki';
  let agentRequestBody = '';
  const createRequestBodies: Array<Record<string, unknown>> = [];

  await primeClientState(page);
  await page.route('**/api/agent/run', async (route) => {
    agentRequestBody = route.request().postDataBuffer()?.toString('utf8') || '';
    await route.fulfill({
      body: 'Let us clarify the audience and the decisions this Wiki should preserve.',
      contentType: 'text/plain; charset=utf-8',
      headers: {
        'x-dao-conversation-id': conversationId,
      },
      status: 200,
    });
  });
  await page.route('**/api/workspaces/intent', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ intent: 'document', status: 'resolved' }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await page.route('**/api/workspaces', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    createRequestBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      body: JSON.stringify({
        conversation: { id: conversationId },
        initialRoomMessageReceipt: {
          messageId: 'room-message-e2e',
          roomId: 'room-e2e',
          status: 'accepted',
        },
        room: { id: 'room-e2e', projectId: 'wiki-e2e' },
        workspace: { id: 'wiki-e2e', projectId: 'wiki-e2e' },
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.goto('/');

  const onboarding = page.getByTestId('home-onboarding-chat');
  await expect(onboarding).toBeVisible();
  await expect(page.getByTestId('home-wiki-list')).toBeVisible();
  await expect(page.getByTestId('home-onboarding-create-wiki')).toBeVisible();
  await expect(onboarding.getByRole('button', { name: /附件|attachment/i })).toHaveCount(0);
  await expect(onboarding.getByRole('button', { name: /深度研究|deep research/i })).toHaveCount(0);

  await page.getByTestId('agent-composer-input').fill(goal);
  await page.getByTestId('agent-composer-input').press('Enter');

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
  await confirmationDialog.getByTestId('wiki-create-confirm').click();

  await expect.poll(() => createRequestBodies).toHaveLength(1);
  expect(createRequestBodies[0]).toMatchObject({
    conversationId,
    goal,
    title,
  });
  await expect(page).toHaveURL(
    `/workspace/wiki-e2e?node=wiki-e2e&conversationId=${conversationId}`
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
  await page
    .getByTestId('home-wiki-list')
    .getByRole('button', { name: /创建 Wiki 空间|Create Wiki Space/ })
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
