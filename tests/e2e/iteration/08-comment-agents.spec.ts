import { expect, test } from '@playwright/test';
import { apiRequest, primeClientState, readSeedState } from './helpers';

const CUSTOM_AGENT = {
  id: 'my-reviewer',
  handle: '@my-reviewer',
  name: 'My Reviewer',
  systemPrompt: 'Review the requested change and reply concisely.',
  enabled: true,
  builtin: false,
} as const;

test('A5: switching roles via @ in an already bound thread', async ({ page }, testInfo) => {
  const seedState = readSeedState();
  const workspace = seedState.commentsAgentWorkspace;
  const baseURL = String(testInfo.project.use.baseURL);

  await primeClientState(page, { commentAgents: [CUSTOM_AGENT] });
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await page.getByRole('tab', { name: /评审|Review/ }).click();

  const thread = page.getByTestId(`comment-thread-${workspace.waitingThreadId}`);
  await expect(thread).toBeVisible();

  await thread
    .getByPlaceholder(/继续告诉 AI 要怎么改|继续告诉我怎么改|Continue telling AI/)
    .fill('@my-reviewer 换你来看看');
  await thread.getByRole('button', { name: /发送|Send/ }).click({ force: true });

  await expect.poll(async () => {
    const threads = await apiRequest<Array<{ agentBindings: Array<{ agentId: string }>; id: string }>>(
      baseURL,
      `/api/threads?documentId=${workspace.id}&workspaceId=${workspace.id}`
    );
    const matchedThread = threads.find((item) => item.id === workspace.waitingThreadId);
    return matchedThread?.agentBindings.map((binding) => binding.agentId) || [];
  }).toContain('my-reviewer');

  await expect(
    thread.getByTestId(`comment-agent-chip-${workspace.waitingThreadId}-my-reviewer`)
  ).toBeVisible();
});

test('A6: multiple role mentions add multiple bindings in mention order', async ({ page }, testInfo) => {
  const seedState = readSeedState();
  const workspace = seedState.commentsAgentWorkspace;
  const baseURL = String(testInfo.project.use.baseURL);

  await primeClientState(page, { commentAgents: [CUSTOM_AGENT] });
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await page.getByRole('tab', { name: /评审|Review/ }).click();

  const thread = page.getByTestId(`comment-thread-${workspace.waitingThreadId}`);
  await expect(thread).toBeVisible();

  await thread
    .getByPlaceholder(/继续告诉 AI 要怎么改|继续告诉我怎么改|Continue telling AI/)
    .fill('@assistant @my-reviewer 同时看看');
  await thread.getByRole('button', { name: /发送|Send/ }).click({ force: true });

  await expect.poll(async () => {
    const messages = await apiRequest<
      Array<{
        content: string;
        mentionedAgents?: Array<{ agentId: string }>;
        role: string;
      }>
    >(
      baseURL,
      `/api/threads/${workspace.waitingThreadId}/messages`
    );
    const latestUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === 'user' && message.content.includes('同时看看'));
    return latestUserMessage?.mentionedAgents?.map((agent) => agent.agentId) || [];
  }).toEqual(['assistant', 'my-reviewer']);

  await expect(
    thread.getByTestId(`comment-agent-chip-${workspace.waitingThreadId}-assistant`)
  ).toBeVisible();
  await expect(
    thread.getByTestId(`comment-agent-chip-${workspace.waitingThreadId}-my-reviewer`)
  ).toBeVisible();
});

test('A7: missing agent profile keeps the thread usable', async ({ page }) => {
  const seedState = readSeedState();
  const workspace = seedState.agentMissingWorkspace;

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await page.getByRole('tab', { name: /评审|Review/ }).click();

  const thread = page.getByTestId(`comment-thread-${workspace.blockedAgentThreadId}`);
  await expect(thread).toBeVisible();
  await expect(thread).toContainText(/已删除角色|deleted/i);

  const input = thread.getByPlaceholder(/继续告诉 AI 要怎么改|继续告诉我怎么改|Reply/i);
  await expect(input).toBeVisible();
});
