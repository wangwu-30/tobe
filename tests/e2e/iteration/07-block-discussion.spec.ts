import { getCommentKey } from '@platejs/comment';
import { expect, test } from '@playwright/test';
import { buildWorkspaceRoute } from '@/lib/workspace/route';
import {
  apiRequest,
  buildHeading,
  createDocumentSelectionAnchor,
  primeClientState,
  readSeedState,
  type SeedWorkspace,
} from './helpers';

const FIRST_PARAGRAPH = '第一段要展示跨段线程的块级入口。';
const SECOND_PARAGRAPH = '第二段属于同一个跨段线程，但不应该重复显示入口。';
const CROSS_BLOCK_ANCHOR = `${FIRST_PARAGRAPH}${SECOND_PARAGRAPH}`;

test('cross-block comment-marked workspace loads without page errors and keeps the thread accessible in review', async ({
  page,
}, testInfo) => {
  const seedState = readSeedState();
  const workspace = seedState.blockDiscussionWorkspace;
  const baseURL = String(testInfo.project.use.baseURL);
  const pageErrors: string[] = [];
  const threadId = await seedCurrentDraftCrossBlockThread(baseURL, workspace);

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await primeClientState(page);
  await page.goto(buildWorkspaceRoute({
    assistant: 'review',
    conversationId: workspace.conversationId,
    nodeId: workspace.id,
    projectId: workspace.id,
  }));

  const surface = page.locator('[data-workspace-outline-surface="true"]');
  await expect(surface.getByText(FIRST_PARAGRAPH, { exact: true })).toBeVisible();
  await expect(page.getByTestId('assistant-tab-review')).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByTestId(`comment-thread-${threadId}`)).toBeVisible();
  expect(pageErrors).toEqual([]);
});

async function seedCurrentDraftCrossBlockThread(
  baseURL: string,
  workspace: SeedWorkspace
) {
  const thread = await apiRequest<{ id: string }>(baseURL, '/api/threads', {
    body: {
      anchorText: CROSS_BLOCK_ANCHOR,
      documentId: workspace.id,
      fileId: workspace.fileId,
      firstMessage: '这两段放在一起看，有一个跨段评论。',
      selectionAnchor: createDocumentSelectionAnchor({
        excerpt: CROSS_BLOCK_ANCHOR,
        fileId: workspace.fileId,
        rangeState: 'cross-block',
      }),
      workspaceId: workspace.id,
    },
    method: 'POST',
  });

  await apiRequest(
    baseURL,
    `/api/workspaces/${workspace.id}/files/${workspace.fileId}`,
    {
      body: {
        content: JSON.stringify([
          buildHeading('块级评论映射验证'),
          buildCommentMarkedParagraph(FIRST_PARAGRAPH, thread.id),
          buildCommentMarkedParagraph(SECOND_PARAGRAPH, thread.id),
        ]),
      },
      method: 'PATCH',
    }
  );
  const currentThreads = await apiRequest<
    Array<{ id: string; inheritanceState: string; scope: string }>
  >(baseURL, `/api/threads?workspaceId=${workspace.id}&draftOnly=1`);
  expect(currentThreads).toContainEqual(
    expect.objectContaining({
      id: thread.id,
      inheritanceState: 'actionable',
      scope: 'inherited',
    })
  );

  return thread.id;
}

function buildCommentMarkedParagraph(text: string, threadId: string) {
  return {
    type: 'p',
    children: [{ text, [getCommentKey(threadId)]: true }],
  };
}
