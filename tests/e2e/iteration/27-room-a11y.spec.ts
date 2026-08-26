import { expect, test } from '@playwright/test';

import { apiRequest, LOCAL_PLATFORM_HEADERS, primeClientState } from './helpers';

type WorkspaceCreateResponse = {
  conversation: { id: string };
  room: { id: string; projectId: string | null };
  workspace: { id: string };
};

test('room feed exposes log semantics and a jump-to-latest control when new messages arrive off-bottom', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const created = await createRoomWorkspace(baseURL, `Room A11y Feed ${suffix}`);

  await seedRoomMessages(baseURL, created.roomId, 18);

  await primeClientState(page);
  await page.goto(
    `/workspace/${created.workspaceId}?conversationId=${created.conversationId}&assistant=room`
  );

  await expect(page.getByTestId('assistant-tab-room')).toHaveCount(0);
  const chatHref = await page.getByTestId('room-back-to-chat').getAttribute('href');
  expect(chatHref).not.toBeNull();
  const chatUrl = new URL(chatHref!, baseURL);
  expect(chatUrl.pathname).toBe(`/workspace/${created.workspaceId}`);
  expect(chatUrl.searchParams.get('conversationId')).toBe(created.conversationId);
  expect(chatUrl.searchParams.has('assistant')).toBe(false);
  const roomFeed = page.getByTestId('room-feed');
  await expect(roomFeed).toHaveAttribute('role', 'log');
  await expect(roomFeed).toHaveAttribute('aria-relevant', 'additions text');
  await expect(roomFeed.locator('[data-room-feed-item="message"]').first()).toHaveAttribute(
    'aria-roledescription',
    '消息'
  );

  await roomFeed.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });

  await postRoomMessage(baseURL, created.roomId, {
    correlationId: `room-a11y-off-bottom-${suffix}`,
    text: `Off-bottom update ${suffix}`,
  });

  const jumpButton = page.getByTestId('room-feed-jump-to-latest');
  await expect(jumpButton).toBeVisible();
  await expect(jumpButton).toContainText('回到最新消息');
  await expect(jumpButton).toContainText('1');

  await jumpButton.click();

  await expect(jumpButton).toHaveCount(0);
  await expect(
    roomFeed.getByText(`Off-bottom update ${suffix}`, { exact: true })
  ).toBeVisible();
});

test('room composer uses a standalone agent listbox and keeps keyboard mention insertion working', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const created = await createRoomWorkspace(baseURL, `Room A11y Composer ${suffix}`);

  await primeClientState(page);
  await page.goto(
    `/workspace/${created.workspaceId}?conversationId=${created.conversationId}&assistant=room`
  );

  const input = page.getByTestId('room-message-input');
  await expect(input).not.toHaveAttribute('role', 'combobox');

  await input.click();
  await input.fill('@');

  const selectorTrigger = page.getByRole('button', { name: '选择 Agent' });
  await expect(selectorTrigger).toHaveAttribute('aria-haspopup', 'listbox');
  await expect(page.getByRole('listbox', { name: '选择 Agent' })).toBeVisible();

  await input.press('ArrowDown');
  await expect(page.getByRole('option').first()).toBeFocused();

  await page.keyboard.press('Enter');

  await expect(page.getByRole('listbox', { name: '选择 Agent' })).toHaveCount(0);
  await expect(page.getByLabel(/移除 .*?/).first()).toBeVisible();
  await expect(input).toHaveValue(/@\S+\s/);
});

async function createRoomWorkspace(baseURL: string, title: string) {
  const payload = await apiRequest<WorkspaceCreateResponse>(baseURL, '/api/workspaces', {
    body: {
      deliverableType: 'document',
      goal: `${title} 的 Room 需要验证无障碍语义。`,
      title,
    },
    method: 'POST',
  });

  return {
    conversationId: payload.conversation.id,
    roomId: payload.room.id,
    workspaceId: payload.workspace.id,
  };
}

async function seedRoomMessages(baseURL: string, roomId: string, count: number) {
  for (let index = 0; index < count; index += 1) {
    await postRoomMessage(baseURL, roomId, {
      correlationId: `room-a11y-seed-${Date.now()}-${index}`,
      text: `Seed message ${index + 1}`,
    });
  }
}

async function postRoomMessage(
  baseURL: string,
  roomId: string,
  params: {
    correlationId: string;
    text: string;
  }
) {
  const response = await fetch(
    new URL(`/api/rooms/${encodeURIComponent(roomId)}/messages`, baseURL),
    {
      body: JSON.stringify({
        attachments: [],
        correlationId: params.correlationId,
        mentions: [],
        schemaVersion: 1,
        text: params.text,
      }),
      headers: {
        ...LOCAL_PLATFORM_HEADERS,
        'x-dao-idempotency-key': params.correlationId,
      },
      method: 'POST',
    }
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `POST /api/rooms/${roomId}/messages failed with ${response.status}: ${text.slice(0, 500)}`
    );
  }
}
