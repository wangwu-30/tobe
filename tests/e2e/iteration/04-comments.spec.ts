import { expect, test } from '@playwright/test';
import { buildWorkspaceRoute } from '@/lib/workspace/route';
import { apiRequest, primeClientState, readSeedState } from './helpers';

test('D0: selecting document text exposes the inline comment trigger and creates an anchored thread', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const anchorText = '先确认目标和范围，再整理信息结构。';
  const firstMessage = '请把这里改成更清楚的正式稿表达。';
  const created = await apiRequest<{
    conversation: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      content: JSON.stringify([{ type: 'p', children: [{ text: anchorText }] }]),
      deliverableType: 'document',
      goal: '验证文档划线评论入口稳定可见并能创建锚定评论。',
      title: `Inline Comment Trigger ${Date.now()}`,
    },
    method: 'POST',
  });

  await primeClientState(page);
  await page.goto(buildWorkspaceRoute({
    conversationId: created.conversation.id,
    nodeId: created.workspace.id,
    projectId: created.workspace.id,
  }));

  const editorRoot = page.locator('[data-slate-editor="true"]');
  await expect(editorRoot).toBeVisible({ timeout: 60000 });
  const anchorParagraph = editorRoot.getByText(anchorText, { exact: true });
  await expect(anchorParagraph).toBeVisible({ timeout: 60000 });
  const trigger = page.getByTestId('selection-comment-trigger');
  await expect(async () => {
    await editorRoot.focus();
    await anchorParagraph.selectText();
    await page.evaluate(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });
    await expect(trigger).toBeVisible({ timeout: 1000 });
  }).toPass({ intervals: [100, 250, 500], timeout: 10000 });
  await trigger.click();

  const composer = page.getByTestId('selection-comment-composer');
  await expect(composer).toBeVisible();
  await composer.getByPlaceholder(/告诉 AI|Tell AI/).fill(firstMessage);
  await composer.getByRole('button', { name: /评论|Comment/ }).click();

  await expect
    .poll(async () => {
      const threads = await apiRequest<Array<{ anchorText: string; id: string }>>(
        baseURL,
        `/api/threads?workspaceId=${created.workspace.id}&draftOnly=1`
      );
      return threads.some((thread) => thread.anchorText === anchorText);
    })
    .toBe(true);
});

test('D1: direct single-block comment can apply back to the source document', async ({ page }, testInfo) => {
  const seedState = readSeedState();
  const workspace = seedState.commentsApplyWorkspace;
  const baseURL = String(testInfo.project.use.baseURL);

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&assistant=review`
  );

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
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&assistant=review`
  );

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
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&assistant=review`
  );

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
  const ordinaryFollowUpText = '普通文字追问，不用带 @';
  const repeatedMentionText = '@assistant 再次召唤';
  const finalFollowUpText = '停止后再追加一条。';
  const noBindingHint =
    '想让 AI 介入时，请在消息里输入 @assistant 或其他角色句柄。';
  const noBindingStatus =
    '已经追加到线程里。如需 AI 继续介入，请在消息里 @ 一个或多个角色。';

  await page.route('**/api/agent/run', async (route) => {
    await route.fulfill({
      body: '已收到评论建议。',
      contentType: 'text/plain; charset=utf-8',
      status: 200,
    });
  });

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&assistant=review`
  );

  const thread = page.getByTestId(`comment-thread-${workspace.waitingThreadId}`);
  const waitingChip = thread.getByTestId(`comment-agent-chip-${workspace.waitingThreadId}-assistant`);
  const followUp = thread.getByPlaceholder(
    /继续告诉我怎么改|继续告诉 AI 要怎么改/
  );
  const sendButton = thread.getByRole('button', { name: /发送|Send/ });
  await expect(thread).toBeVisible();
  
  // A2 check
  await expect(waitingChip).toContainText(/@assistant/);
  // It should show waiting/replying state
  await expect(waitingChip).toContainText(/等待中|回复中/);

  // A3: follow-up without @ (assuming AI is not broken, it stays bound)
  await followUp.fill(ordinaryFollowUpText);
  await sendButton.click();
  await expect(followUp).toHaveValue('');
  await expectUserMessageToPersist({
    baseURL,
    content: ordinaryFollowUpText,
    threadId: workspace.waitingThreadId,
  });
  await expectAgentBindings({
    agentIds: ['assistant'],
    baseURL,
    threadId: workspace.waitingThreadId,
    workspaceId: workspace.id,
  });
  await expect(waitingChip).toHaveCount(1);

  // A4: Re-mentioning @assistant doesn't create duplicate bindings
  await followUp.fill(repeatedMentionText);
  await sendButton.click();
  await expect(followUp).toHaveValue('');
  await expectUserMessageToPersist({
    baseURL,
    content: repeatedMentionText,
    threadId: workspace.waitingThreadId,
  });
  await expectAgentBindings({
    agentIds: ['assistant'],
    baseURL,
    threadId: workspace.waitingThreadId,
    workspaceId: workspace.id,
  });
  await expect(waitingChip).toHaveCount(1);

  // A8: Stop listening completely removes binding
  await thread.getByTestId(`comment-stop-agent-${workspace.waitingThreadId}-assistant`).click();
  await expectAgentBindings({
    agentIds: [],
    baseURL,
    threadId: workspace.waitingThreadId,
    workspaceId: workspace.id,
  });
  await expect(waitingChip).toHaveCount(0);
  await expect(thread.getByText(noBindingHint, { exact: true })).toBeVisible();

  await followUp.fill(finalFollowUpText);
  await sendButton.click();
  await expect(followUp).toHaveValue('');
  await expectUserMessageToPersist({
    baseURL,
    content: finalFollowUpText,
    threadId: workspace.waitingThreadId,
  });

  await expect(
    thread.locator('[role="status"]').filter({ hasText: noBindingStatus })
  ).toHaveText(noBindingStatus);
  await expect(waitingChip).toHaveCount(0);
});

async function expectUserMessageToPersist(params: {
  baseURL: string;
  content: string;
  threadId: string;
}) {
  await expect.poll(async () => {
    const messages = await apiRequest<Array<{ content: string; role: string }>>(
      params.baseURL,
      `/api/threads/${params.threadId}/messages`
    );
    return messages.some(
      (message) =>
        message.role === 'user' && message.content === params.content
    );
  }).toBe(true);
}

async function expectAgentBindings(params: {
  agentIds: string[];
  baseURL: string;
  threadId: string;
  workspaceId: string;
}) {
  await expect.poll(async () => {
    const threads = await apiRequest<
      Array<{ agentBindings: Array<{ agentId: string }>; id: string }>
    >(
      params.baseURL,
      `/api/threads?documentId=${params.workspaceId}&workspaceId=${params.workspaceId}`
    );
    const matchedThread = threads.find((thread) => thread.id === params.threadId);
    return matchedThread?.agentBindings.map((binding) => binding.agentId) || [];
  }).toEqual(params.agentIds);
}
