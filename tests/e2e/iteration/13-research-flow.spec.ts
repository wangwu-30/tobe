import { expect, test } from '@playwright/test';
import { primeClientState, readSeedState } from './helpers';

test('chat surface defaults to light search semantics and keeps deep research inside run cards', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.researchWorkspace;

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await page.getByRole('tab', { name: /对话|Chat/ }).click();

  await expect(page.getByRole('button', { name: /深度研究|Deep Research/ })).toBeVisible();
  await expect(page.getByText(/实时网页|Live Web/)).toHaveCount(0);
  const runCards = page.locator('[data-testid^="assistant-run-card-"]');
  const proposalRunCard = runCards.filter({
    has: page.getByRole('button', { name: /开始研究|Start Research/ }),
  });
  const completedRunCard = runCards.filter({
    hasText: '供应链风险研究结果',
  });
  await expect(proposalRunCard).toHaveCount(1);
  await expect(completedRunCard).toHaveCount(1);
  await expect(proposalRunCard).toContainText(/研究计划|Research Plan/);
  await expect(completedRunCard).toContainText(/研究进度|Research Progress/);
  const openReportButton = completedRunCard.getByRole('button', {
    name: /打开报告|Open Report/,
  });
  await openReportButton.scrollIntoViewIfNeeded();
  await expect(openReportButton).toBeVisible();

  await openReportButton.click();

  await expect(page).toHaveURL(new RegExp(`fileId=${workspace.reportFileId}`));
  await expect(
    page.locator('[data-testid^="support-tree-node-"]').filter({ hasText: /^研究$/ })
  ).toBeVisible();
  await expect(page.getByTestId(`support-tree-node-${workspace.reportFileId}`)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '供应链风险 研究报告', level: 1 })
  ).toBeVisible();
});

test('comment deep research stays concise in-thread and exposes the full report separately', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.researchWorkspace;

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await page.getByRole('tab', { name: /评审|Review/ }).click();

  const proposalThread = page.getByTestId(
    `comment-thread-${workspace.commentResearchProposalThreadId}`
  );
  await expect(proposalThread).toContainText(/研究计划|Research Plan/);
  await expect(proposalThread.getByRole('button', { name: /开始研究|Start Research/ })).toBeVisible();

  const completedThread = page.getByTestId(
    `comment-thread-${workspace.commentResearchCompletedThreadId}`
  );
  await expect(completedThread).toContainText(/研究进度|Research Progress/);
  await expect(completedThread).toContainText(/上游集中度|地区暴露|监管变化/);
  await completedThread
    .getByRole('button', { name: /打开完整报告|Open Full Report/ })
    .click();

  await expect(page).toHaveURL(new RegExp(`fileId=${workspace.reportFileId}`));
  await expect(
    page.locator('[data-testid^="support-tree-node-"]').filter({ hasText: /^研究$/ })
  ).toBeVisible();
  await expect(page.getByTestId(`support-tree-node-${workspace.reportFileId}`)).toBeVisible();
  await expect(page.getByText('这是研究报告原文')).toBeVisible();
});

test('blocked deep research states expose a direct settings recovery action', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.researchWorkspace;

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await page.getByRole('tab', { name: /对话|Chat/ }).click();

  const blockedRunCard = page.getByTestId(`assistant-run-card-${workspace.blockedRunId}`);
  await expect(blockedRunCard).toContainText(/联网研究当前不可用/);
  await blockedRunCard.getByRole('button', { name: /打开设置|Open Settings/ }).click();
  await expect(page).toHaveURL(/\/settings$/);

  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await page.getByRole('tab', { name: /评审|Review/ }).click();

  const blockedThread = page.getByTestId(
    `comment-thread-${workspace.commentResearchBlockedThreadId}`
  );
  await expect(blockedThread).toContainText(/联网研究当前不可用/);
  await blockedThread.getByRole('button', { name: /设置|Settings/ }).click();
  await expect(page).toHaveURL(/\/settings$/);
});
