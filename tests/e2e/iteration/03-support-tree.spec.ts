import { expect, test } from '@playwright/test';
import { primeClientState, readSeedState } from './helpers';

test('support material create, rename, delete, and URL sync stay aligned', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.supportWorkspace;

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}`
  );

  await expect(page.getByTestId('support-tree-empty')).toBeVisible();

  const supportAddTrigger = page.getByTestId('support-tree-add-trigger');
  await supportAddTrigger.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/fileId=/);
  const fileId = new URL(page.url()).searchParams.get('fileId');
  expect(fileId).toBeTruthy();

  const supportNode = page.getByTestId(`support-tree-node-${fileId}`);
  await expect(supportNode).toContainText('支持资料');

  await supportNode.hover();
  await page.getByTestId(`support-tree-actions-${fileId}`).click();
  await page.getByRole('menuitem', { name: /重命名资料|Rename/ }).click();
  await page
    .getByPlaceholder(/输入支持资料名称|Enter support material name/)
    .fill('整理后的支持资料');
  await page.getByRole('button', { name: /保存名称|Save Name/ }).click();
  await expect(supportNode).toContainText('整理后的支持资料');

  page.once('dialog', (dialog) => dialog.accept());
  await supportNode.hover();
  await page.getByTestId(`support-tree-actions-${fileId}`).click();
  await page.getByRole('menuitem', { name: /删除资料|Delete/ }).click();

  await expect(page.getByTestId(`support-tree-node-${fileId}`)).toHaveCount(0);
  await expect(page).not.toHaveURL(/fileId=/);
});
