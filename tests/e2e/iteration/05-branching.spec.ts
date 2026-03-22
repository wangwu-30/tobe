import { expect, test, type Page } from '@playwright/test';
import {
  apiRequest,
  buildHeading,
  buildParagraph,
  createDocumentSelectionAnchor,
  primeClientState,
  readSeedState,
  resolveBaseURL,
  resolveIterationProjectsRoot,
  type SeedWorkspace,
} from './helpers';

const BRANCH_VERSION_SURFACE_TEXT = '这个工作区用于验证从消息另开对话后，版本视图仍然保留当前交付物表面。';
const BRANCH_V2_SURFACE_TEXT = '这个工作区用于验证当前草稿已经继续到另一个版本 head。';

type BranchVersionScenario = Omit<
  SeedWorkspace,
  'ancestorInheritedThreadId' | 'secondVersionId' | 'siblingBranchThreadId' | 'versionId'
> & {
  ancestorInheritedThreadId: string;
  branchMessageId: string;
  secondVersionId: string;
  siblingBranchThreadId: string;
  versionId: string;
};

async function createBranchVersionScenario(): Promise<BranchVersionScenario> {
  const baseURL = resolveBaseURL();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = await createWorkspace(baseURL, {
    content: JSON.stringify([
      buildHeading('续写对话版本验证'),
      buildParagraph(BRANCH_VERSION_SURFACE_TEXT),
    ]),
    goal: '验证从消息另开对话后，版本视图不空白。',
    projectsRoot: resolveIterationProjectsRoot(),
    title: `迭代回归-版本续写对话-${suffix}`,
  });

  await seedDefaultReviewPlan(baseURL, workspace.id, '验证从消息另开对话后，版本视图不空白。');

  const branchVersion = await createVersion(baseURL, workspace.id, '版本里程碑 V1');
  const ancestorInheritedThread = await createThread(baseURL, workspace.id, {
    anchorText: BRANCH_VERSION_SURFACE_TEXT,
    fileId: workspace.fileId,
    firstMessage: '这个版本上的评论应该在从 V1 继续后继承下来。',
    selectionAnchor: createDocumentSelectionAnchor({
      end: { offset: 29, path: [1, 0] },
      excerpt: BRANCH_VERSION_SURFACE_TEXT,
      fileId: workspace.fileId,
      rangeState: 'single-block',
      start: { offset: 0, path: [1, 0] },
    }),
    versionId: branchVersion.id,
  });

  await updateFileContent(
    baseURL,
    workspace.id,
    workspace.fileId,
    JSON.stringify([
      buildHeading('续写对话版本验证'),
      buildParagraph(BRANCH_V2_SURFACE_TEXT),
      buildParagraph('V2 用来确认从更早里程碑继续时，live draft 会真正切回那个基点。'),
    ])
  );
  const branchVersionV2 = await createVersion(baseURL, workspace.id, '版本里程碑 V2');
  const siblingBranchThread = await createThread(baseURL, workspace.id, {
    anchorText: 'V2 用来确认从更早里程碑继续时，live draft 会真正切回那个基点。',
    fileId: workspace.fileId,
    firstMessage: '这个只属于 V2 分支的评论不应该泄漏到从 V1 继续出来的新分支。',
    selectionAnchor: createDocumentSelectionAnchor({
      end: { offset: 41, path: [2, 0] },
      excerpt: 'V2 用来确认从更早里程碑继续时，live draft 会真正切回那个基点。',
      fileId: workspace.fileId,
      rangeState: 'single-block',
      start: { offset: 0, path: [2, 0] },
    }),
    versionId: branchVersionV2.id,
  });

  await addConversationMessage(baseURL, workspace.conversationId, workspace.id, {
    content: '请把这一版再压缩成更简洁的说明。',
    role: 'user',
  });
  const assistantMessage = await addConversationMessage(
    baseURL,
    workspace.conversationId,
    workspace.id,
    {
      content: '已经整理出一个更简洁的方向。',
      role: 'assistant',
    }
  );

  return {
    ...workspace,
    ancestorInheritedThreadId: ancestorInheritedThread.id,
    branchMessageId: assistantMessage.id,
    secondVersionId: branchVersionV2.id,
    siblingBranchThreadId: siblingBranchThread.id,
    versionId: branchVersion.id,
  };
}

async function openVersionHistory(page: Page) {
  const historyDialog = page.getByRole('dialog', { name: /历史|History/ });
  const historyButton = page.getByTestId('version-history-button');

  if (await historyDialog.isVisible().catch(() => false)) {
    return historyDialog;
  }

  await dismissVisibleFirstUseGuidance(page);
  await expect(historyButton).toBeVisible();
  await expect(historyButton).toBeEnabled();
  await expect(async () => {
    if (!(await historyDialog.isVisible().catch(() => false))) {
      await dismissVisibleFirstUseGuidance(page);
      await historyButton.click();
    }
    await expect(historyDialog).toBeVisible();
  }).toPass({ timeout: 5000 });
  await expect(historyDialog.locator('[data-testid^="version-history-card-"]').first()).toBeVisible();

  return historyDialog;
}

async function openReadOnlyVersionFromHistory(page: Page, versionId: string) {
  await expect(async () => {
    const historyDialog = await openVersionHistory(page);
    const historyCard = historyDialog.getByTestId(`version-history-card-${versionId}`);
    await expect(historyCard).toBeVisible();
    await historyCard.click();
    await expect(page).toHaveURL(new RegExp(`versionId=${versionId}`));
  }).toPass({ timeout: 7000 });
}

async function continueFromHistory(page: Page, versionId: string, initialConversationId: string) {
  await expect(async () => {
    if (new URL(page.url()).searchParams.get('conversationId') === initialConversationId) {
      const historyDialog = await openVersionHistory(page);
      const continueButton = historyDialog.getByTestId(`version-continue-${versionId}`);
      await expect(continueButton).toBeVisible();
      await continueButton.click();
    }

    await expect.poll(() => {
      return new URL(page.url()).searchParams.get('conversationId');
    }).not.toBe(initialConversationId);
    await expect.poll(() => {
      return new URL(page.url()).searchParams.get('versionId');
    }).toBeNull();
  }).toPass({ timeout: 7000 });
}

async function switchToBranchFromHistory(
  page: Page,
  branchHeadVersionId: string,
  initialConversationId: string
) {
  await expect(async () => {
    if (new URL(page.url()).searchParams.get('conversationId') === initialConversationId) {
      const historyDialog = await openVersionHistory(page);
      const overviewSwitch = historyDialog.getByTestId(
        `version-branch-overview-switch-${branchHeadVersionId}`
      );

      if (await overviewSwitch.isVisible().catch(() => false)) {
        await overviewSwitch.click();
      } else {
        const switchButton = historyDialog.getByTestId(`version-switch-branch-${branchHeadVersionId}`);
        await expect(switchButton).toBeVisible();
        await switchButton.click();
      }
    }

    await expect.poll(() => {
      return new URL(page.url()).searchParams.get('conversationId');
    }).not.toBe(initialConversationId);
    await expect.poll(() => {
      return new URL(page.url()).searchParams.get('versionId');
    }).toBeNull();
  }).toPass({ timeout: 7000 });
}

async function dismissVisibleFirstUseGuidance(page: Page) {
  let clearChecks = 0;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const visibleGuide = page.locator('[data-testid^="first-use-guide-"]:visible').first();

    if (!(await visibleGuide.isVisible().catch(() => false))) {
      clearChecks += 1;
      if (clearChecks >= 2) {
        return;
      }
      await page.waitForTimeout(120);
      continue;
    }

    clearChecks = 0;
    const guideTestId = await visibleGuide.getAttribute('data-testid');
    expect(guideTestId).not.toBeNull();

    const guide = page.getByTestId(guideTestId!);
    await guide.getByRole('button', { name: /知道了|Got It/ }).click();
    await expect(guide).toHaveCount(0);
  }
}

async function addConversationMessage(
  baseURL: string,
  conversationId: string,
  workspaceId: string,
  params: {
    content: string;
    role: 'assistant' | 'user';
  }
) {
  return apiRequest<{ id: string }>(baseURL, `/api/conversations/${conversationId}/messages`, {
    body: {
      content: params.content,
      role: params.role,
      workspaceId,
    },
    method: 'POST',
  });
}

async function createThread(
  baseURL: string,
  workspaceId: string,
  params: {
    anchorText: string;
    fileId: string;
    firstMessage: string;
    selectionAnchor: string;
    versionId?: string;
  }
) {
  return apiRequest<{ id: string }>(baseURL, '/api/threads', {
    body: {
      anchorText: params.anchorText,
      documentId: workspaceId,
      fileId: params.fileId,
      firstMessage: params.firstMessage,
      selectionAnchor: params.selectionAnchor,
      versionId: params.versionId,
      workspaceId,
    },
    method: 'POST',
  });
}

async function createVersion(baseURL: string, workspaceId: string, title: string) {
  return apiRequest<{ id: string }>(baseURL, `/api/workspaces/${workspaceId}/versions`, {
    body: { title },
    method: 'POST',
  });
}

async function createWorkspace(
  baseURL: string,
  params: {
    content: string;
    goal: string;
    projectsRoot: string;
    title: string;
  }
) {
  const payload = await apiRequest<{
    conversation: { id: string };
    primaryFile: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      content: params.content,
      deliverableType: 'document',
      goal: params.goal,
      projectParentPath: params.projectsRoot,
      title: params.title,
    },
    method: 'POST',
  });

  await updateFileContent(baseURL, payload.workspace.id, payload.primaryFile.id, params.content);

  return {
    conversationId: payload.conversation.id,
    fileId: payload.primaryFile.id,
    id: payload.workspace.id,
  };
}

async function updateFileContent(
  baseURL: string,
  workspaceId: string,
  fileId: string,
  content: string
) {
  await apiRequest(baseURL, `/api/workspaces/${workspaceId}/files/${fileId}`, {
    body: { content },
    method: 'PATCH',
  });
}

async function updatePlan(
  baseURL: string,
  workspaceId: string,
  params: {
    activeStageId: string;
    goal: string;
    stages: Array<{
      checkpoint: boolean;
      description: string;
      id: string;
      kind: string;
      status: 'blocked' | 'completed' | 'in_progress' | 'pending';
      title: string;
    }>;
    status: string;
  }
) {
  await apiRequest(baseURL, `/api/workspaces/${workspaceId}/plan`, {
    body: params,
    method: 'PATCH',
  });
}

async function seedDefaultReviewPlan(baseURL: string, workspaceId: string, goal: string) {
  await updatePlan(baseURL, workspaceId, {
    activeStageId: 'review-2',
    goal,
    stages: [
      {
        checkpoint: true,
        description: '明确目标和边界',
        id: 'review-1',
        kind: 'milestone',
        status: 'completed',
        title: '确认范围',
      },
      {
        checkpoint: true,
        description: '当前草稿已准备好进入局部审阅',
        id: 'review-2',
        kind: 'milestone',
        status: 'in_progress',
        title: '审阅当前草稿',
      },
      {
        checkpoint: true,
        description: '完成确认并保存稳定版本',
        id: 'review-3',
        kind: 'milestone',
        status: 'pending',
        title: '定稿保存',
      },
    ],
    status: 'reviewing',
  });
}

test('opening a new chat from a message preserves the selected version surface', async ({
  page,
}) => {
  const workspace = await createBranchVersionScenario();
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
  const workspace = await createBranchVersionScenario();

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);

  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_V2_SURFACE_TEXT)
  ).toBeVisible();

  await openReadOnlyVersionFromHistory(page, workspace.versionId);
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
  const workspace = await createBranchVersionScenario();
  const initialConversationId = workspace.conversationId;

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&versionId=${workspace.versionId}`
  );

  await dismissVisibleFirstUseGuidance(page);

  await continueFromHistory(page, workspace.versionId, initialConversationId);

  await page.getByTestId('assistant-tab-chat').click();
  await dismissVisibleFirstUseGuidance(page);

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
  const workspace = await createBranchVersionScenario();
  const initialConversationId = workspace.conversationId;

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&versionId=${workspace.versionId}`
  );

  await dismissVisibleFirstUseGuidance(page);

  await continueFromHistory(page, workspace.versionId, initialConversationId);
  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_VERSION_SURFACE_TEXT)
  ).toBeVisible();

  const continuedConversationId = new URL(page.url()).searchParams.get('conversationId');
  expect(continuedConversationId).not.toBeNull();

  const switchedBranchId = workspace.secondVersionId!;
  await switchToBranchFromHistory(page, switchedBranchId, continuedConversationId!);

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
  await dismissVisibleFirstUseGuidance(page);
  await expect(page.getByTestId('chat-base-version-label')).toContainText(/版本里程碑 V2/);
  await page.getByTestId('assistant-tab-status').click();
  await expect(page.getByTestId('plan-current-branch-card')).toContainText(/版本里程碑 V2/);
});

test('branch overview groups visible heads and can switch the live draft to another branch', async ({
  page,
}) => {
  const workspace = await createBranchVersionScenario();
  const initialConversationId = workspace.conversationId;

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&versionId=${workspace.versionId}`
  );

  await dismissVisibleFirstUseGuidance(page);

  await continueFromHistory(page, workspace.versionId, initialConversationId);
  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_VERSION_SURFACE_TEXT)
  ).toBeVisible();

  const continuedConversationId = new URL(page.url()).searchParams.get('conversationId');
  expect(continuedConversationId).not.toBeNull();

  const branchHistoryDialog = await openVersionHistory(page);
  await expect(
    branchHistoryDialog.getByTestId(`version-branch-overview-card-${workspace.secondVersionId!}`)
  ).toBeVisible();
  await expect.poll(async () => {
    return await branchHistoryDialog
      .locator('[data-testid^="version-branch-overview-card-"]')
      .count();
  }).toBeGreaterThanOrEqual(2);
  await expect(
    branchHistoryDialog.getByTestId(`version-branch-overview-card-${workspace.secondVersionId!}`)
  ).toContainText('版本里程碑 V1');
  await expect(
    branchHistoryDialog.getByTestId(`version-branch-overview-card-${workspace.secondVersionId!}`)
  ).toContainText('版本里程碑 V2');

  await switchToBranchFromHistory(page, workspace.secondVersionId!, continuedConversationId!);

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
  await dismissVisibleFirstUseGuidance(page);
  await expect(page.getByTestId('chat-base-version-label')).toContainText('版本里程碑 V2');
});

test('branch overview can focus the milestone list on a single branch lineage', async ({
  page,
}) => {
  const workspace = await createBranchVersionScenario();
  const initialConversationId = workspace.conversationId;

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&versionId=${workspace.versionId}`
  );

  await dismissVisibleFirstUseGuidance(page);

  await continueFromHistory(page, workspace.versionId, initialConversationId);
  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_VERSION_SURFACE_TEXT)
  ).toBeVisible();

  const branchHistoryDialog = await openVersionHistory(page);
  await branchHistoryDialog
    .getByTestId(`version-branch-overview-focus-${workspace.secondVersionId!}`)
    .click();

  await expect(branchHistoryDialog.getByTestId('version-branch-focus-banner')).toContainText(
    '版本里程碑 V2'
  );
  await expect(branchHistoryDialog.getByTestId('version-branch-workspace')).toBeVisible();
  await expect(branchHistoryDialog.getByTestId('version-branch-workspace-stats')).toContainText(
    /1|Temporary|临时/
  );
  await expect(
    branchHistoryDialog.getByTestId(`version-history-card-${workspace.versionId}`)
  ).toBeVisible();
  await expect(
    branchHistoryDialog.getByTestId(`version-history-card-${workspace.secondVersionId!}`)
  ).toBeVisible();
  await expect(
    branchHistoryDialog.getByTestId(`version-branch-workspace-section-${workspace.secondVersionId!}`)
  ).toContainText(/继续前安全回退点|Safety Checkpoint before Continue/);
  await expect(
    branchHistoryDialog.getByTestId(`version-branch-workspace-section-${workspace.versionId}`)
  ).not.toContainText(/继续前安全回退点|Safety Checkpoint before Continue/);
  await expect(
    branchHistoryDialog
      .locator('[data-testid^="version-history-card-"]')
      .filter({ hasText: '从 版本里程碑 V1 继续' })
  ).toHaveCount(0);

  await branchHistoryDialog.getByTestId('version-branch-focus-clear').click();
  await expect(
    branchHistoryDialog
      .locator('[data-testid^="version-history-card-"]')
      .filter({ hasText: '从 版本里程碑 V1 继续' })
      .first()
  ).toBeVisible();
});

test('continuing from an older milestone only inherits actionable review from that ancestor branch', async ({
  page,
}) => {
  const workspace = await createBranchVersionScenario();

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&versionId=${workspace.versionId}`
  );

  await dismissVisibleFirstUseGuidance(page);

  await continueFromHistory(page, workspace.versionId, workspace.conversationId);

  await page.getByRole('tab', { name: /评审|Review/ }).click();
  await dismissVisibleFirstUseGuidance(page);

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
  const workspace = await createBranchVersionScenario();

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&versionId=${workspace.versionId}`
  );

  await dismissVisibleFirstUseGuidance(page);

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
