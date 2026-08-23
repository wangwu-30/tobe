import { expect, test } from '@playwright/test';
import { buildWorkspaceRoute } from '@/lib/workspace/route';
import {
  apiRequest,
  createDocumentSelectionAnchor,
  primeClientState,
  readSeedState,
} from './helpers';

test('D3: old reply mode selector and bulk AI reply buttons are absent', async ({ page }) => {
  const seedState = readSeedState();
  const workspace = seedState.baseWorkspace;

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

  // D3 asserts the legacy UI elements are strictly gone
  const legacySelect = page.locator('select, [role="combobox"]').filter({ hasText: /自动关联|手动确认|Manual|Auto/ });
  await expect(legacySelect).toHaveCount(0);

  const bulkAiBtn = page.getByRole('button', { name: /让 AI 回复|AI Reply|批量/ });
  await expect(bulkAiBtn).toHaveCount(0);
});

test('D9: mention dropdown UI experience is smooth', async ({ page }, testInfo) => {
  const seedState = readSeedState();
  const workspace = seedState.commentsAgentWorkspace;
  const anchorText = '第二段用于验证 @assistant 会进入等待态，并且可以手动停止监听。';
  const thread = await apiRequest<{ id: string }>(
    String(testInfo.project.use.baseURL),
    '/api/threads',
    {
      body: {
        anchorText,
        documentId: workspace.id,
        fileId: workspace.fileId,
        firstMessage: '为 mention 下拉交互创建独立讨论。',
        selectionAnchor: createDocumentSelectionAnchor({
          end: { offset: anchorText.length, path: [2, 0] },
          excerpt: anchorText,
          fileId: workspace.fileId,
          rangeState: 'single-block',
          start: { offset: 0, path: [2, 0] },
        }),
        workspaceId: workspace.id,
      },
      method: 'POST',
    }
  );

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

  const threadCard = page.getByTestId(`comment-thread-${thread.id}`);
  const composer = threadCard.getByPlaceholder(/继续告诉 AI 要怎么改|继续告诉我怎么改|Reply/i);
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
