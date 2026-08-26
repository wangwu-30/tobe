import { expect, test } from '@playwright/test';
import { primeClientState } from './helpers';

test('B1-B4: Comment Agent settings support builtin visibility and local CRUD', async ({
  page,
}) => {
  await primeClientState(page);
  await page.goto('/settings');

  await expect(page.getByRole('heading', { name: 'Comment Agents' })).toBeVisible();

  const builtinCard = page.getByTestId('comment-agent-card-assistant');
  await expect(builtinCard).toBeVisible();
  await expect(builtinCard).toContainText('AI 助手');
  await expect(builtinCard.getByLabel('@句柄')).toHaveValue('@assistant');
  await expect(page.getByTestId('comment-agent-delete-assistant')).toHaveCount(0);

  const cards = page.locator('[data-testid^="comment-agent-card-"]');
  const initialCount = await cards.count();

  await page.getByTestId('comment-agent-add').click();
  await expect(cards).toHaveCount(initialCount + 1);

  const customCard = cards.nth(initialCount);
  await customCard.getByLabel('角色名称').fill('测试审阅员');
  await customCard.getByLabel('@句柄').fill('@test-reviewer');
  await customCard.getByLabel('角色提示词').fill('你是一个严格的审阅员。');
  await expect(customCard.getByLabel('角色名称')).toHaveAttribute('autocomplete', 'off');
  await expect(customCard.getByLabel('角色名称')).toHaveAttribute('name', /agentName-/);
  await expect(customCard.getByLabel('@句柄')).toHaveAttribute('spellcheck', 'false');
  await expect(customCard.getByLabel('@句柄')).toHaveAttribute('name', /agentHandle-/);
  await expect(customCard.getByLabel('角色提示词')).toHaveAttribute('name', /agentPrompt-/);
  await expect(customCard.getByLabel('@句柄')).toHaveValue('@test-reviewer');

  await customCard.getByLabel('@句柄').fill('@senior-reviewer');
  await expect(customCard.getByLabel('@句柄')).toHaveValue('@senior-reviewer');
  await expect(page.getByText('@test-reviewer')).toHaveCount(0);

  const toggle = customCard.locator('[data-testid^="comment-agent-toggle-"]');
  await expect(toggle).toContainText('已启用');
  await toggle.click();
  await expect(toggle).toContainText('已停用');

  const deleteAgent = customCard.locator('[data-testid^="comment-agent-delete-"]');
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('要移除评论角色 测试审阅员 吗？');
    await dialog.dismiss();
  });
  await deleteAgent.click();
  await expect(cards).toHaveCount(initialCount + 1);

  page.once('dialog', (dialog) => dialog.accept());
  await deleteAgent.click();
  await expect(cards).toHaveCount(initialCount);
});

test('settings track unsaved drafts, announce saves, and guard app navigation', async ({
  page,
}) => {
  await primeClientState(page);
  await page.goto('/settings');

  const save = page.getByRole('button', { name: /保存设置|Save Settings/ });
  await expect(save).toBeDisabled();
  await page.getByTestId('settings-provider-key-add').click();
  const providerCard = page.locator('[data-testid^="settings-provider-key-card-"]').last();
  const providerKey = providerCard.getByRole('textbox', { name: 'API Key', exact: true });
  await expect(providerKey).toHaveAttribute('autocomplete', 'off');
  await expect(providerKey).toHaveAttribute('name', /providerApiKey-/);
  await expect(providerKey).toHaveAttribute('type', 'password');
  await providerKey.fill('test-provider-secret');

  const removeProvider = providerCard.getByRole('button', { name: /移除 .* 的 API Key/ });
  await expect(removeProvider).toBeVisible();
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('要移除');
    await dialog.accept();
  });
  await removeProvider.click();
  await expect(providerCard).toHaveCount(0);

  await page.getByTestId('comment-agent-add').click();
  const customCard = page.locator('[data-testid^=\"comment-agent-card-\"]').last();
  await customCard.getByLabel('角色名称').fill('导航守卫测试角色');
  await expect(save).toBeEnabled();
  await expect(
    customCard.getByRole('button', { name: '移除评论角色 导航守卫测试角色' })
  ).toBeVisible();

  const dismissedMessages: string[] = [];
  page.once('dialog', async (dialog) => {
    dismissedMessages.push(dialog.message());
    await dialog.dismiss();
  });
  const advancedNavigation = page
    .getByTestId('sidebar-advanced-toggle')
    .locator('xpath=..');
  await advancedNavigation.getByRole('link', { name: /Git 知识|Git Knowledge/ }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(customCard.getByLabel('角色名称')).toHaveValue('导航守卫测试角色');
  expect(dismissedMessages).toEqual(['设置尚未保存，确定要离开吗？']);

  await save.click();
  await expect(save).toBeDisabled();
  await expect(page.getByTestId('settings-save-status')).toHaveText('已保存。');

  await customCard.getByLabel('角色名称').fill('再次编辑');
  await expect(save).toBeEnabled();
  await expect(page.getByTestId('settings-save-status')).toBeEmpty();

  page.once('dialog', (dialog) => dialog.accept());
  await advancedNavigation.getByRole('link', { name: /Git 知识|Git Knowledge/ }).click();
  await expect(page).toHaveURL(/\/knowledge/);
});
