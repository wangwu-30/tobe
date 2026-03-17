import { expect, test } from '@playwright/test';
import { primeClientState, readSeedState } from './helpers';

test('assistant rail surfaces show contextual first-use guidance instead of a global modal', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.baseWorkspace;

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);

  const statusGuide = page.getByTestId('first-use-guide-status');
  await expect(statusGuide).toBeVisible();
  await statusGuide.getByRole('button', { name: /知道了|Got It/ }).click();
  await expect(statusGuide).toHaveCount(0);

  await page.getByRole('tab', { name: /评审|Review/ }).click();
  await expect(page.getByTestId('first-use-guide-review')).toBeVisible();

  await page.getByRole('tab', { name: /对话|Chat/ }).click();
  await expect(page.getByTestId('first-use-guide-chat')).toBeVisible();

  await page.getByRole('tab', { name: /上下文|Context/ }).click();
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
