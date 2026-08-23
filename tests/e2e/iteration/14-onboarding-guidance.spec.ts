import { expect, test } from '@playwright/test';
import { buildWorkspaceRoute } from '@/lib/workspace/route';
import { primeClientState, readSeedState } from './helpers';

test('assistant rail surfaces show contextual first-use guidance instead of a global modal', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.baseWorkspace;

  await primeClientState(page);
  await page.goto(buildWorkspaceRoute({
    assistant: 'status',
    conversationId: workspace.conversationId,
    nodeId: workspace.id,
    projectId: workspace.id,
  }));
  await expect(page.getByTestId('assistant-tab-status')).toHaveAttribute(
    'aria-selected',
    'true'
  );

  const statusGuide = page.getByTestId('first-use-guide-status');
  await expect(statusGuide).toBeVisible();
  await statusGuide.getByRole('button', { name: /知道了|Got It/ }).click();
  await expect(statusGuide).toHaveCount(0);

  const reviewTab = page.getByTestId('assistant-tab-review');
  await reviewTab.click();
  await expect(page).toHaveURL(/(?:\?|&)assistant=review(?:&|$)/);
  await expect(reviewTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('first-use-guide-review')).toBeVisible();

  const chatTab = page.getByTestId('assistant-tab-chat');
  await chatTab.click();
  await expect(page).toHaveURL(/(?:\?|&)assistant=chat(?:&|$)/);
  await expect(chatTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('first-use-guide-chat')).toBeVisible();

  const contextTab = page.getByTestId('assistant-tab-context');
  await contextTab.click();
  await expect(page).toHaveURL(/(?:\?|&)assistant=context(?:&|$)/);
  await expect(contextTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('first-use-guide-context')).toBeVisible();
  const workflowGuide = page.getByTestId('first-use-guide-workflow');
  await workflowGuide.scrollIntoViewIfNeeded();
  await expect(workflowGuide).toBeVisible();
});

test('opening a read-only milestone shows the version first-use guide', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.branchVersionWorkspace;

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&versionId=${workspace.versionId}`
  );

  await expect(page.getByTestId('first-use-guide-version')).toBeVisible();
});
