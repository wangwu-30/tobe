import { expect, test } from '@playwright/test';
import { apiRequest, primeClientState, readSeedState } from './helpers';

test('D1: direct single-block comment can apply back to the source document', async ({ page }, testInfo) => {
  const seedState = readSeedState();
  const workspace = seedState.commentsApplyWorkspace;
  const baseURL = String(testInfo.project.use.baseURL);

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await page.getByRole('tab', { name: /评审|Review/ }).click();

  const thread = page.getByTestId(`comment-thread-${workspace.applyThreadId}`);
  await expect(thread).toBeVisible();

  await thread.getByTestId(`comment-apply-source-${workspace.applyThreadId}`).click();

  await expect.poll(async () => {
    const nextView = await apiRequest<{ currentFile: { content: string | null } | null }>(
      baseURL,
      `/api/workspaces/${workspace.id}?conversationId=${workspace.conversationId}`
    );
    return nextView.currentFile?.content || '';
  }, { timeout: 20000 }).toContain(workspace.replacementText);
  await expect.poll(async () => {
    const threads = await apiRequest<Array<{ id: string; status: string }>>(
      baseURL,
      `/api/threads?documentId=${workspace.id}&workspaceId=${workspace.id}`
    );
    return threads.find((item) => item.id === workspace.applyThreadId)?.status || null;
  }, { timeout: 20000 }).toBe('applied');
});

test('D2: cross-block comment shows a blocked reason before any apply attempt', async ({ page }) => {
  const seedState = readSeedState();
  const workspace = seedState.commentsBlockedWorkspace;

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await page.getByRole('tab', { name: /评审|Review/ }).click();

  const thread = page.getByTestId(`comment-thread-${workspace.blockedThreadId}`);
  await expect(thread).toBeVisible();
  await expect(thread).toContainText('跨段暂不支持直接应用');
  await expect(thread.getByTestId(`comment-apply-source-${workspace.blockedThreadId}`)).toHaveCount(0);
});

test('A1: new thread without @ only keeps manual discussion', async ({ page }, testInfo) => {
  const seedState = readSeedState();
  const workspace = seedState.commentsAgentWorkspace;
  const baseURL = String(testInfo.project.use.baseURL);

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await page.getByRole('tab', { name: /评审|Review/ }).click();

  const thread = page.getByTestId(`comment-thread-${workspace.manualThreadId}`);
  await expect(thread).toBeVisible();
  await expect(thread.getByTestId(new RegExp(`comment-agent-chip-${workspace.manualThreadId}-`))).toHaveCount(0);
  
  await expect.poll(async () => {
    const messages = await apiRequest<Array<{ content: string; role: string }>>(
      baseURL,
      `/api/threads/${workspace.manualThreadId}/messages`
    );
    return {
      count: messages.length,
      lastRole: messages.at(-1)?.role || null,
    };
  }).toEqual({
    count: 1,
    lastRole: 'user',
  });
});

test('A2-A4, A8: Agent binding lifecycle in thread (binding, ordinary follow-up, idempotent trigger, stop)', async ({ page }, testInfo) => {
  const seedState = readSeedState();
  const workspace = seedState.commentsAgentWorkspace;
  const baseURL = String(testInfo.project.use.baseURL);

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await page.getByRole('tab', { name: /评审|Review/ }).click();

  const thread = page.getByTestId(`comment-thread-${workspace.waitingThreadId}`);
  const waitingChip = thread.getByTestId(`comment-agent-chip-${workspace.waitingThreadId}-assistant`);
  await expect(thread).toBeVisible();
  
  // A2 check
  await expect(waitingChip).toContainText(/@assistant/);
  // It should show waiting/replying state
  await expect(waitingChip).toContainText(/等待中|回复中/);

  // A3: follow-up without @ (assuming AI is not broken, it stays bound)
  await thread.getByPlaceholder(/继续告诉我怎么改|继续告诉 AI 要怎么改/).fill('普通文字追问，不用带 @');
  await thread.getByRole('button', { name: /发送|Send/ }).click({ force: true });
  // We expect activeAgentId still points to assistant, without prompting "@ 角色"
  await expect(waitingChip).toBeVisible();

  // A4: Re-mentioning @assistant doesn't create duplicate bindings
  await thread.getByPlaceholder(/继续告诉/).fill('@assistant 再次召唤');
  await thread.getByRole('button', { name: /发送|Send/ }).click({ force: true });
  await expect(waitingChip).toBeVisible(); // Still just one chip for assistant

  // A8: Stop listening completely removes binding
  await thread.getByTestId(`comment-stop-agent-${workspace.waitingThreadId}-assistant`).click();
  await expect(waitingChip).toHaveCount(0);

  const finalFollowUpText = '停止后再追加一条。';
  await thread.getByPlaceholder(/继续告诉/).fill(finalFollowUpText);
  await thread.getByRole('button', { name: /发送|Send/ }).click({ force: true });

  await expect(thread).toContainText(/如需 AI .*介入，请.*角色/);
  await expect(waitingChip).toHaveCount(0);
});
