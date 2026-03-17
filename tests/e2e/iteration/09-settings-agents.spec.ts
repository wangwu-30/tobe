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
  await expect(customCard.getByLabel('@句柄')).toHaveValue('@test-reviewer');

  await customCard.getByLabel('@句柄').fill('@senior-reviewer');
  await expect(customCard.getByLabel('@句柄')).toHaveValue('@senior-reviewer');
  await expect(page.getByText('@test-reviewer')).toHaveCount(0);

  const toggle = customCard.locator('[data-testid^="comment-agent-toggle-"]');
  await expect(toggle).toContainText('已启用');
  await toggle.click();
  await expect(toggle).toContainText('已停用');

  await customCard.locator('[data-testid^="comment-agent-delete-"]').click();
  await expect(cards).toHaveCount(initialCount);
});
