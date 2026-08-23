import { expect, test } from '@playwright/test';
import { buildWorkspaceRoute } from '@/lib/workspace/route';
import {
  apiRequest,
  createDocumentSelectionAnchor,
  primeClientState,
  readSeedState,
  type SeedWorkspace,
} from './helpers';

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
  const threadId = await createDraftThread(baseURL, workspace, {
    anchorText: '第二段用于验证 @assistant 会进入等待态，并且可以手动停止监听。',
    firstMessage: '@assistant 请先帮我检查这条独立测试线程。',
    path: [2, 0],
  });

  await primeClientState(page, { commentAgents: [CUSTOM_AGENT] });
  await page.goto(buildWorkspaceRoute({
    assistant: 'review',
    conversationId: workspace.conversationId,
    nodeId: workspace.id,
    projectId: workspace.id,
  }));
  await expect(page.getByTestId('assistant-tab-review')).toHaveAttribute(
    'aria-selected',
    'true'
  );

  const thread = page.getByTestId(`comment-thread-${threadId}`);
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
    const matchedThread = threads.find((item) => item.id === threadId);
    return matchedThread?.agentBindings.map((binding) => binding.agentId) || [];
  }).toContain('my-reviewer');

  await expect(
    thread.getByTestId(`comment-agent-chip-${threadId}-my-reviewer`)
  ).toBeVisible();
});

test('A6: multiple role mentions add multiple bindings in mention order', async ({ page }, testInfo) => {
  const seedState = readSeedState();
  const workspace = seedState.commentsAgentWorkspace;
  const baseURL = String(testInfo.project.use.baseURL);
  const threadId = await createDraftThread(baseURL, workspace, {
    anchorText: '第一段用于验证不 @ 角色时只保留人工讨论，不会自动触发回复。',
    firstMessage: '为多角色 mention 顺序测试创建独立讨论。',
    path: [1, 0],
  });

  await primeClientState(page, { commentAgents: [CUSTOM_AGENT] });
  await page.goto(buildWorkspaceRoute({
    assistant: 'review',
    conversationId: workspace.conversationId,
    nodeId: workspace.id,
    projectId: workspace.id,
  }));
  await expect(page.getByTestId('assistant-tab-review')).toHaveAttribute(
    'aria-selected',
    'true'
  );

  const thread = page.getByTestId(`comment-thread-${threadId}`);
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
      `/api/threads/${threadId}/messages`
    );
    const latestUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === 'user' && message.content.includes('同时看看'));
    return latestUserMessage?.mentionedAgents?.map((agent) => agent.agentId) || [];
  }).toEqual(['assistant', 'my-reviewer']);

  await expect(
    thread.getByTestId(`comment-agent-chip-${threadId}-assistant`)
  ).toBeVisible();
  await expect(
    thread.getByTestId(`comment-agent-chip-${threadId}-my-reviewer`)
  ).toBeVisible();
});

test('A7: missing agent profile keeps the thread usable', async ({ page }) => {
  const seedState = readSeedState();
  const workspace = seedState.agentMissingWorkspace;

  await primeClientState(page);
  await page.goto(buildWorkspaceRoute({
    assistant: 'review',
    conversationId: workspace.conversationId,
    nodeId: workspace.id,
    projectId: workspace.id,
  }));
  await expect(page.getByTestId('assistant-tab-review')).toHaveAttribute(
    'aria-selected',
    'true'
  );

  const thread = page.getByTestId(`comment-thread-${workspace.blockedAgentThreadId}`);
  await expect(thread).toBeVisible();
  await expect(thread).toContainText(/已删除角色|deleted/i);

  const input = thread.getByPlaceholder(/继续告诉 AI 要怎么改|继续告诉我怎么改|Reply/i);
  await expect(input).toBeVisible();
});

async function createDraftThread(
  baseURL: string,
  workspace: Pick<SeedWorkspace, 'fileId' | 'id'>,
  params: {
    anchorText: string;
    firstMessage: string;
    path: number[];
  }
) {
  const thread = await apiRequest<{ id: string }>(baseURL, '/api/threads', {
    body: {
      anchorText: params.anchorText,
      documentId: workspace.id,
      fileId: workspace.fileId,
      firstMessage: params.firstMessage,
      selectionAnchor: createDocumentSelectionAnchor({
        end: { offset: params.anchorText.length, path: params.path },
        excerpt: params.anchorText,
        fileId: workspace.fileId,
        rangeState: 'single-block',
        start: { offset: 0, path: params.path },
      }),
      workspaceId: workspace.id,
    },
    method: 'POST',
  });

  return thread.id;
}
