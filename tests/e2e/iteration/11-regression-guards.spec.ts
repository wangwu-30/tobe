import { expect, test } from '@playwright/test';
import { primeClientState, readSeedState } from './helpers';

test('D3: old reply mode selector and bulk AI reply buttons are absent', async ({ page }) => {
  const seedState = readSeedState();
  const workspace = seedState.baseWorkspace;

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await page.getByRole('tab', { name: /评审|Review/ }).click();

  // D3 asserts the legacy UI elements are strictly gone
  const legacySelect = page.locator('select, [role="combobox"]').filter({ hasText: /自动关联|手动确认|Manual|Auto/ });
  await expect(legacySelect).toHaveCount(0);

  const bulkAiBtn = page.getByRole('button', { name: /让 AI 回复|AI Reply|批量/ });
  await expect(bulkAiBtn).toHaveCount(0);
});

test('D9: mention dropdown UI experience is smooth', async ({ page }) => {
  const seedState = readSeedState();
  const workspace = seedState.commentsAgentWorkspace;

  await primeClientState(page, {
    commentAgents: [
      {
        id: 'my-reviewer',
        handle: '@my-reviewer',
        name: 'My Reviewer',
        systemPrompt: 'Review the requested change and reply concisely.',
        enabled: true,
        builtin: false,
      },
    ],
  });
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await page.getByRole('tab', { name: /评审|Review/ }).click();

  const thread = page.getByTestId(`comment-thread-${workspace.waitingThreadId}`);
  const composer = thread.getByPlaceholder(/继续告诉 AI 要怎么改|继续告诉我怎么改|Reply/i);
  await expect(composer).toHaveAttribute('aria-haspopup', 'listbox');
  await expect(composer).toHaveAttribute('autocomplete', 'off');
  await expect(composer).toHaveAttribute('name', 'comment-follow-up');
  await composer.fill('@');

  // Verify list appears quickly (< 300ms visually, playwright waits for it)
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible({ timeout: 1000 });
  const listboxId = await listbox.getAttribute('id');
  expect(listboxId).toBeTruthy();
  await expect(composer).toHaveAttribute('aria-controls', String(listboxId));
  await expect(composer).toHaveAttribute('aria-expanded', 'true');
  await expect(listbox).toContainText('@assistant');
  await expect(listbox).toContainText('@my-reviewer');

  // Typing filtering 
  await composer.fill('@my');
  await expect(listbox).toBeVisible();
  await expect(composer).toHaveAttribute(
    'aria-activedescendant',
    /-agent-suggestions-option-/
  );

  // Select via Enter
  await page.keyboard.press('Enter');

  // The dropdown should be gone, text inserted
  await expect(listbox).toBeHidden();
  await expect(composer).not.toHaveAttribute('aria-controls', /.+/);
  expect(await composer.inputValue()).toMatch(/@my-reviewer\s/);
});
