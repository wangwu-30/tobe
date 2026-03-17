import { expect, test } from '@playwright/test';
import { primeClientState, readSeedState } from './helpers';

test('cross-block comment-marked workspace loads without page errors and keeps the thread accessible in review', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.blockDiscussionWorkspace;
  const pageErrors: string[] = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}`
  );

  const surface = page.locator('[data-workspace-outline-surface="true"]');
  await expect(
    surface.getByText('第一段要展示跨段线程的块级入口。', { exact: true })
  ).toBeVisible();
  await page.getByRole('tab', { name: /评审|Review/ }).click();
  await expect(
    page.getByTestId(`comment-thread-${workspace.crossBlockThreadId}`)
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
});
