import { expect, test, type Page } from '@playwright/test';
import { primeClientState, readSeedState } from './helpers';

const BRANCH_VERSION_SURFACE_TEXT = '这个工作区用于验证从消息另开对话后，版本视图仍然保留当前交付物表面。';
const BRANCH_V2_SURFACE_TEXT = '这个工作区用于验证当前草稿已经继续到另一个版本 head。';

async function openVersionHistory(page: Page) {
  const historyDialog = page.getByRole('dialog', { name: /历史|History/ });
  const historyButton = page.getByTestId('version-history-button');

  if (await historyDialog.isVisible().catch(() => false)) {
    return historyDialog;
  }

  await expect(historyButton).toBeVisible();
  await expect(historyButton).toBeEnabled();
  await expect(async () => {
    if (!(await historyDialog.isVisible().catch(() => false))) {
      await historyButton.click();
    }
    await expect(historyDialog).toBeVisible();
  }).toPass({ timeout: 5000 });

  return historyDialog;
}

test('opening a new chat from a message preserves the selected version surface', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.branchVersionWorkspace;
  const initialConversationId = workspace.conversationId;

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&versionId=${workspace.versionId}`
  );

  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_VERSION_SURFACE_TEXT)
  ).toBeVisible();
  await page.getByTestId('assistant-tab-chat').click();

  await page
    .getByTestId(`chat-new-conversation-message-${workspace.branchMessageId}`)
    .click();

  await expect(page).toHaveURL(new RegExp(`versionId=${workspace.versionId}`));
  await expect.poll(() => {
    return new URL(page.url()).searchParams.get('conversationId');
  }).not.toBe(initialConversationId);
  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_VERSION_SURFACE_TEXT)
  ).toBeVisible();
});

test('version history cards can open a milestone as the current read-only surface', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.branchVersionWorkspace;

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);

  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_V2_SURFACE_TEXT)
  ).toBeVisible();

  const historyDialog = await openVersionHistory(page);
  await historyDialog.getByTestId(`version-history-card-${workspace.versionId}`).click();

  await expect(page).toHaveURL(new RegExp(`versionId=${workspace.versionId}`));
  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_VERSION_SURFACE_TEXT)
  ).toBeVisible();
  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_V2_SURFACE_TEXT)
  ).toHaveCount(0);
});

test('continuing from version history promotes that point into the live draft and exposes the new draft base', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.branchVersionWorkspace;
  const initialConversationId = workspace.conversationId;

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&versionId=${workspace.versionId}`
  );

  const gotIt = page.getByRole('button', { name: /知道了|Got It/ }).first();
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
  }

  const historyDialog = await openVersionHistory(page);
  await expect(historyDialog.getByTestId(`version-continue-${workspace.versionId}`)).toBeEnabled();
  await historyDialog.getByTestId(`version-continue-${workspace.versionId}`).click();

  await expect.poll(() => {
    return new URL(page.url()).searchParams.get('conversationId');
  }).not.toBe(initialConversationId);
  await expect.poll(() => {
    return new URL(page.url()).searchParams.get('versionId');
  }).toBeNull();

  await page.getByTestId('assistant-tab-chat').click();
  const chatGotIt = page.getByRole('button', { name: /知道了|Got It/ }).first();
  if (await chatGotIt.isVisible().catch(() => false)) {
    await chatGotIt.click();
  }

  await expect(page.getByTestId('chat-base-version-label')).toContainText('从 版本里程碑 V1 继续');
  await page.getByTestId('assistant-tab-status').click();
  await expect(page.getByTestId('plan-current-branch-card')).toContainText('从 版本里程碑 V1 继续');
  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_VERSION_SURFACE_TEXT)
  ).toBeVisible();

  const refreshedHistoryDialog = await openVersionHistory(page);
  await expect(refreshedHistoryDialog.getByText(/当前草稿基线|Current Draft Base/).first()).toBeVisible();
  await expect(page.getByTestId(`version-history-card-${workspace.versionId}`)).toHaveAttribute(
    'data-lineage-depth',
    '0'
  );
  await expect(
    page.getByTestId(`version-history-card-${workspace.secondVersionId!}`)
  ).toHaveAttribute('data-lineage-depth', '1');
  await expect(
    page.getByTestId(`version-branch-head-${workspace.secondVersionId!}`)
  ).toBeVisible();
  await expect(
    page
      .locator('[data-testid^="version-history-card-"]')
      .filter({ hasText: '从 版本里程碑 V1 继续' })
      .first()
  ).toHaveAttribute('data-lineage-depth', '1');
});

test('switching to another visible branch head from history moves the live draft onto that branch', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.branchVersionWorkspace;
  const initialConversationId = workspace.conversationId;

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&versionId=${workspace.versionId}`
  );

  const gotIt = page.getByRole('button', { name: /知道了|Got It/ }).first();
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
  }

  const historyDialog = await openVersionHistory(page);
  await historyDialog.getByTestId(`version-continue-${workspace.versionId}`).click();

  await expect.poll(() => {
    return new URL(page.url()).searchParams.get('conversationId');
  }).not.toBe(initialConversationId);
  await expect.poll(() => {
    return new URL(page.url()).searchParams.get('versionId');
  }).toBeNull();
  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_VERSION_SURFACE_TEXT)
  ).toBeVisible();

  const continuedConversationId = new URL(page.url()).searchParams.get('conversationId');
  expect(continuedConversationId).not.toBeNull();

  const branchHistoryDialog = await openVersionHistory(page);
  const targetBranchOverviewSwitch = branchHistoryDialog
    .locator('[data-testid^="version-branch-overview-card-"]')
    .filter({ hasText: '版本里程碑 V2' })
    .locator('[data-testid^="version-branch-overview-switch-"]')
    .first();
  await expect(targetBranchOverviewSwitch).toBeVisible();
  const switchedBranchTestId = await targetBranchOverviewSwitch.getAttribute('data-testid');
  expect(switchedBranchTestId).not.toBeNull();
  const switchedBranchId = switchedBranchTestId!.replace('version-branch-overview-switch-', '');
  const switchButton = branchHistoryDialog.getByTestId(`version-switch-branch-${switchedBranchId}`);
  await expect(switchButton).toBeVisible();
  await switchButton.click();

  await expect.poll(() => {
    return new URL(page.url()).searchParams.get('conversationId');
  }).not.toBe(continuedConversationId);
  await expect.poll(() => {
    return new URL(page.url()).searchParams.get('versionId');
  }).toBeNull();

  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_V2_SURFACE_TEXT)
  ).toBeVisible();
  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_VERSION_SURFACE_TEXT)
  ).toHaveCount(0);

  const refreshedHistoryDialog = await openVersionHistory(page);
  await expect(refreshedHistoryDialog.getByTestId(`version-draft-base-${switchedBranchId}`)).toBeVisible();
  await expect(refreshedHistoryDialog.getByTestId(`version-switch-branch-${switchedBranchId}`)).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByTestId('assistant-tab-chat').click();
  const chatGotIt = page.getByRole('button', { name: /知道了|Got It/ }).first();
  if (await chatGotIt.isVisible().catch(() => false)) {
    await chatGotIt.click();
  }
  await expect(page.getByTestId('chat-base-version-label')).toContainText(/版本里程碑 V2/);
  await page.getByTestId('assistant-tab-status').click();
  await expect(page.getByTestId('plan-current-branch-card')).toContainText(/版本里程碑 V2/);
});

test('branch overview groups visible heads and can switch the live draft to another branch', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.branchVersionWorkspace;
  const initialConversationId = workspace.conversationId;

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&versionId=${workspace.versionId}`
  );

  const gotIt = page.getByRole('button', { name: /知道了|Got It/ }).first();
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
  }

  const historyDialog = await openVersionHistory(page);
  await historyDialog.getByTestId(`version-continue-${workspace.versionId}`).click();

  await expect.poll(() => {
    return new URL(page.url()).searchParams.get('conversationId');
  }).not.toBe(initialConversationId);
  await expect.poll(() => {
    return new URL(page.url()).searchParams.get('versionId');
  }).toBeNull();
  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_VERSION_SURFACE_TEXT)
  ).toBeVisible();

  const continuedConversationId = new URL(page.url()).searchParams.get('conversationId');
  expect(continuedConversationId).not.toBeNull();

  const branchHistoryDialog = await openVersionHistory(page);
  await expect(branchHistoryDialog.getByText(/^分支$|^Branches$/)).toBeVisible();
  expect(
    await branchHistoryDialog.locator('[data-testid^="version-branch-overview-card-"]').count()
  ).toBeGreaterThanOrEqual(2);
  await expect(
    branchHistoryDialog.getByTestId(`version-branch-overview-card-${workspace.secondVersionId!}`)
  ).toContainText('版本里程碑 V1');
  await expect(
    branchHistoryDialog.getByTestId(`version-branch-overview-card-${workspace.secondVersionId!}`)
  ).toContainText('版本里程碑 V2');

  await branchHistoryDialog
    .getByTestId(`version-branch-overview-switch-${workspace.secondVersionId!}`)
    .click();

  await expect.poll(() => {
    return new URL(page.url()).searchParams.get('conversationId');
  }).not.toBe(continuedConversationId);
  await expect.poll(() => {
    return new URL(page.url()).searchParams.get('versionId');
  }).toBeNull();

  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_V2_SURFACE_TEXT)
  ).toBeVisible();

  const refreshedHistoryDialog = await openVersionHistory(page);
  await expect(
    refreshedHistoryDialog.getByTestId(`version-branch-overview-current-${workspace.secondVersionId!}`)
  ).toBeVisible();
  await expect(
    refreshedHistoryDialog.getByTestId(`version-branch-overview-switch-${workspace.secondVersionId!}`)
  ).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByTestId('assistant-tab-chat').click();
  const chatGotIt = page.getByRole('button', { name: /知道了|Got It/ }).first();
  if (await chatGotIt.isVisible().catch(() => false)) {
    await chatGotIt.click();
  }
  await expect(page.getByTestId('chat-base-version-label')).toContainText('版本里程碑 V2');
});

test('continuing from an older milestone only inherits actionable review from that ancestor branch', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.branchVersionWorkspace;

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&versionId=${workspace.versionId}`
  );

  const gotIt = page.getByRole('button', { name: /知道了|Got It/ }).first();
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
  }

  const historyDialog = await openVersionHistory(page);

  const continueButton = historyDialog.getByTestId(`version-continue-${workspace.versionId}`);
  if (await continueButton.isEnabled().catch(() => false)) {
    await continueButton.click();
  } else {
    await page.keyboard.press('Escape');
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /当前草稿|Current Draft/ }).click();
  }
  await expect.poll(() => {
    return new URL(page.url()).searchParams.get('versionId');
  }).toBeNull();

  await page.getByRole('tab', { name: /评审|Review/ }).click();
  const reviewGotIt = page.getByRole('button', { name: /知道了|Got It/ }).first();
  if (await reviewGotIt.isVisible().catch(() => false)) {
    await reviewGotIt.click();
  }

  await expect(page.getByText(/继承评论上下文|Inherited Context/)).toBeVisible();
  await expect(
    page.getByTestId(`comment-thread-${workspace.ancestorInheritedThreadId!}`)
  ).toBeVisible();
  await expect(
    page.getByTestId(`comment-thread-${workspace.ancestorInheritedThreadId!}`)
  ).toContainText(/可继续处理的继承评论|Actionable Inherited/);
  await expect(
    page.getByTestId(`comment-thread-${workspace.ancestorInheritedThreadId!}`)
  ).toContainText('版本里程碑 V1');
  await expect(
    page.getByTestId(`comment-thread-${workspace.siblingBranchThreadId!}`)
  ).toHaveCount(0);
});

test('version compare supports visible milestone against visible milestone, not only current draft', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.branchVersionWorkspace;

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&versionId=${workspace.versionId}`
  );

  const gotIt = page.getByRole('button', { name: /知道了|Got It/ }).first();
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
  }

  await page.getByRole('button', { name: /比较|Compare/ }).first().click();

  await page.getByTestId('version-compare-left-select').click();
  await page.getByRole('option', { name: '里程碑 · 版本里程碑 V1' }).click();

  await page.getByTestId('version-compare-right-select').click();
  await page.getByRole('option', { name: '里程碑 · 版本里程碑 V2' }).click();

  const compareDialog = page.getByRole('dialog', { name: /比较版本|Compare versions/ });
  await expect(
    compareDialog.getByText('这个工作区用于验证从消息另开对话后，版本视图仍然保留当前交付物表面。')
  ).toBeVisible();
  await expect(
    compareDialog.getByText('这个工作区用于验证当前草稿已经继续到另一个版本 head。')
  ).toBeVisible();
});

test('switching conversations from the chat header preserves the selected support file', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.branchSupportWorkspace;

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&fileId=${workspace.supportFileId}`
  );

  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByRole('heading', {
      name: '支持资料续写对话文件',
    })
  ).toBeVisible();
  await page.getByRole('tab', { name: /对话|Chat/ }).click();

  await page.getByTestId('chat-conversation-select').click();
  await page
    .locator('[role="option"][aria-selected="false"]', {
      hasText: workspace.branchTitle,
    })
    .click();

  await expect(page).toHaveURL(
    new RegExp(`conversationId=${workspace.branchConversationId}`)
  );
  await expect(page).toHaveURL(new RegExp(`fileId=${workspace.supportFileId}`));
  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByRole('heading', {
      name: '支持资料续写对话文件',
    })
  ).toBeVisible();
});
