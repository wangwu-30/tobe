import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import { createClient, type Client } from '@libsql/client';
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

type StagedReviewPatch = {
  fileId: string | null;
  kind: 'richtext' | 'markdown';
  name: string;
  nextContent: string;
  operation: 'create' | 'update';
  preimage: {
    content: string;
    contentSha256: string;
    revision: number;
  } | null;
  summary: string;
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

async function openVersionTree(page: Page) {
  const versionTreeDialog = page.getByRole('dialog', { name: /版本树|Version Tree/ });
  const openVersionTreeDialog = versionTreeDialog.and(page.locator('[data-state="open"]'));
  const versionTreeButton = page.getByTestId('version-tree-button');
  const firstVersionCard = openVersionTreeDialog
    .locator('[data-testid^="version-history-card-"]')
    .first();

  if (await openVersionTreeDialog.isVisible().catch(() => false)) {
    return openVersionTreeDialog;
  }

  if (await versionTreeDialog.isVisible().catch(() => false)) {
    await expect(versionTreeDialog).toBeHidden();
  }

  await dismissVisibleFirstUseGuidance(page);
  await expect(versionTreeButton).toBeVisible();
  await expect(versionTreeButton).toBeEnabled();
  let openRequested = false;
  await expect(async () => {
    if (!openRequested && !(await openVersionTreeDialog.isVisible().catch(() => false))) {
      await dismissVisibleFirstUseGuidance(page);
      await versionTreeButton.evaluate((button) => {
        (button as HTMLButtonElement).click();
      });
      openRequested = true;
    }
    await expect(openVersionTreeDialog).toBeVisible();
    await expect(firstVersionCard).toBeVisible();
  }).toPass({ timeout: 10000 });

  return openVersionTreeDialog;
}

async function openReadOnlyVersionFromTree(page: Page, versionId: string) {
  await expect(async () => {
    const versionTreeDialog = await openVersionTree(page);
    const versionCard = versionTreeDialog.getByTestId(`version-history-card-${versionId}`);
    await expect(versionCard).toBeVisible();
    await versionCard.click();
    await expect(page).toHaveURL(new RegExp(`versionId=${versionId}`));
  }).toPass({ timeout: 15000 });
}

async function waitForConversationChange(
  page: Page,
  initialConversationId: string,
  options?: {
    expectedVersionId?: string | null;
    timeout?: number;
  }
) {
  await page.waitForFunction(
    (payload) => {
      const params = new URLSearchParams(window.location.search);
      const conversationId = params.get('conversationId');
      const versionId = params.get('versionId');

      if (!conversationId || conversationId === payload.initialConversationId) {
        return false;
      }

      if (payload.expectVersionIdMode === 'null') {
        return !versionId;
      }

      if (payload.expectVersionIdMode === 'exact') {
        return versionId === payload.expectedVersionId;
      }

      return true;
    },
    {
      expectVersionIdMode:
        options?.expectedVersionId === undefined
          ? 'any'
          : options.expectedVersionId === null
            ? 'null'
            : 'exact',
      expectedVersionId: options?.expectedVersionId ?? null,
      initialConversationId,
    },
    { timeout: options?.timeout ?? 30000 }
  );
}

async function expectWorkspaceSurfaceText(
  page: Page,
  text: string,
  options?: {
    hiddenText?: string;
    timeout?: number;
  }
) {
  const surface = page.locator('[data-workspace-outline-surface="true"]');

  await expect(async () => {
    await dismissVisibleFirstUseGuidance(page);
    await expect(surface).toBeVisible();
    await expect(surface.getByText(text)).toBeVisible();
    if (options?.hiddenText) {
      await expect(surface.getByText(options.hiddenText)).toHaveCount(0);
    }
  }).toPass({ timeout: options?.timeout ?? 30000 });
}

async function expectWorkspaceSurfaceHeading(
  page: Page,
  heading: string,
  options?: {
    timeout?: number;
  }
) {
  const surface = page.locator('[data-workspace-outline-surface="true"]');

  await expect(async () => {
    await dismissVisibleFirstUseGuidance(page);
    await expect(surface).toBeVisible();
    await expect(surface.getByRole('heading', { name: heading })).toBeVisible();
  }).toPass({ timeout: options?.timeout ?? 30000 });
}

async function continueFromVersionTree(
  page: Page,
  versionId: string,
  initialConversationId: string
) {
  const versionTreeDialog = page.getByRole('dialog', { name: /版本树|Version Tree/ });
  let continueRequested = false;

  await expect(async () => {
    if (
      !continueRequested &&
      new URL(page.url()).searchParams.get('conversationId') === initialConversationId
    ) {
      const versionTreeDialog = await openVersionTree(page);
      const continueButton = versionTreeDialog.getByTestId(`version-continue-${versionId}`);
      await expect(continueButton).toBeVisible();
      await expect(continueButton).toBeEnabled();
      await continueButton.evaluate((button) => {
        (button as HTMLButtonElement).click();
      });
      continueRequested = true;
    }

    await waitForConversationChange(page, initialConversationId, {
      expectedVersionId: null,
      timeout: 10_000,
    });
  }).toPass({ timeout: 30_000 });

  await expect(versionTreeDialog).toBeHidden({ timeout: 10_000 });
  await expect(versionTreeDialog).toHaveCount(0, { timeout: 10_000 });
}

async function switchToBranchFromVersionTree(
  page: Page,
  workspaceId: string,
  branchHeadVersionId: string,
  initialConversationId: string
) {
  const versionTreeDialog = await openVersionTree(page);
  const overviewSwitch = versionTreeDialog.getByTestId(
    `version-branch-overview-switch-${branchHeadVersionId}`
  );
  const switchButton = (await overviewSwitch.isVisible().catch(() => false))
    ? overviewSwitch
    : versionTreeDialog.getByTestId(`version-switch-branch-${branchHeadVersionId}`);

  await expect(switchButton).toBeVisible();
  await expect(switchButton).toBeEnabled();

  const switchPath =
    `/api/workspaces/${workspaceId}/versions/${branchHeadVersionId}/switch`;
  const switchResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === switchPath
  );
  await switchButton.click();
  const switchResponse = await switchResponsePromise;
  expect(switchResponse.ok()).toBe(true);

  await waitForConversationChange(page, initialConversationId, {
    expectedVersionId: null,
  });
}

async function waitForBranchOverview(
  page: Page,
  branchHeadVersionId: string,
  options?: {
    minimumCount?: number;
  }
) {
  await expect(async () => {
    const versionTreeDialog = await openVersionTree(page);
    const overviewCards = versionTreeDialog.locator('[data-testid^="version-branch-overview-card-"]');

    await expect(
      versionTreeDialog.getByTestId(`version-branch-overview-card-${branchHeadVersionId}`)
    ).toBeVisible();
    expect(await overviewCards.count()).toBeGreaterThanOrEqual(options?.minimumCount ?? 1);
  }).toPass({ timeout: 30_000 });

  return openVersionTree(page);
}

async function expectCurrentBranchOverview(page: Page, branchHeadVersionId: string) {
  await expect(async () => {
    const versionTreeDialog = await waitForBranchOverview(page, branchHeadVersionId, {
      minimumCount: 1,
    });

    await expect(
      versionTreeDialog.getByTestId(`version-branch-overview-current-${branchHeadVersionId}`)
    ).toBeVisible();
    await expect(
      versionTreeDialog.getByTestId(`version-branch-overview-switch-${branchHeadVersionId}`)
    ).toHaveCount(0);
  }).toPass({ timeout: 30_000 });

  return openVersionTree(page);
}

async function focusBranchLineageFromVersionTree(page: Page, branchHeadVersionId: string) {
  let focusRequested = false;
  await expect(async () => {
    const versionTreeDialog = await waitForBranchOverview(page, branchHeadVersionId, {
      minimumCount: 1,
    });
    const focusButton = versionTreeDialog.getByTestId(
      `version-branch-overview-focus-${branchHeadVersionId}`
    );

    await expect(focusButton).toBeVisible();
    await expect(focusButton).toBeEnabled();
    if (!focusRequested) {
      await focusButton.evaluate((button) => {
        (button as HTMLButtonElement).click();
      });
      focusRequested = true;
    }
    await expect(versionTreeDialog.getByTestId('version-branch-focus-banner')).toBeVisible();
    await expect(
      versionTreeDialog.getByTestId(`version-branch-workspace-section-${branchHeadVersionId}`)
    ).toBeVisible();
  }).toPass({ timeout: 30_000 });
}

async function clearBranchLineageFocusFromVersionTree(page: Page) {
  let clearRequested = false;

  await expect(async () => {
    const versionTreeDialog = await openVersionTree(page);
    const clearButton = versionTreeDialog.getByTestId('version-branch-focus-clear');

    await expect(clearButton).toBeVisible();
    await expect(clearButton).toBeEnabled();

    if (!clearRequested) {
      await clearButton.evaluate((button) => {
        (button as HTMLButtonElement).click();
      });
      clearRequested = true;
    }

    await expect(versionTreeDialog.getByTestId('version-branch-focus-banner')).toHaveCount(0);
  }).toPass({ timeout: 30_000 });

  return openVersionTree(page);
}

async function openBranchCompareFromOverview(page: Page, branchHeadVersionId: string) {
  const compareDialog = page.getByRole('dialog', { name: /比较版本|Compare versions/ });

  await expect(async () => {
    const versionTreeDialog = await waitForBranchOverview(page, branchHeadVersionId, {
      minimumCount: 1,
    });
    const overviewCard = versionTreeDialog.getByTestId(
      `version-branch-overview-card-${branchHeadVersionId}`
    );
    const compareButton = overviewCard.getByRole('button', { name: /比较|Compare/ });

    await overviewCard.scrollIntoViewIfNeeded();
    await overviewCard.evaluate((node) => {
      node.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
    await compareButton.scrollIntoViewIfNeeded();
    await expect(compareButton).toBeVisible();
    await expect(compareButton).toBeEnabled();
    await compareButton.click({ force: true });
    await expect(compareDialog).toBeVisible();
  }).toPass({ timeout: 30_000 });

  return compareDialog;
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
    const guideTestId = await visibleGuide
      .getAttribute('data-testid', { timeout: 500 })
      .catch(() => null);
    if (!guideTestId) {
      continue;
    }

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

async function seedPendingStagedChange(
  database: Client,
  input: {
    conversationId: string;
    draftBaseVersionId: string | null;
    draftRevision: number;
    id: string;
    patches: StagedReviewPatch[];
    summary: string;
    title: string;
    workspaceId: string;
  }
) {
  const changesJson = canonicalJson(input.patches);
  const now = new Date().toISOString();

  await database.execute({
    sql: `INSERT INTO "StagedChangeSet" (
      "id", "organizationId", "documentId", "sessionId",
      "baseVersionId", "baseVersionSha256", "baseDraftRevision",
      "patchSchemaVersion", "patchSha256", "title", "summary",
      "status", "sourceType", "changesJson", "createdByUserId",
      "originDeviceId", "revision", "createdAt", "updatedAt"
    ) VALUES (?, 'local-org', ?, ?, ?, NULL, ?, 1, ?, ?, ?,
      'pending', 'acceptance-test', ?, 'local-user', 'local-device', 1, ?, ?)`,
    args: [
      input.id,
      input.workspaceId,
      input.conversationId,
      input.draftBaseVersionId,
      input.draftRevision,
      sha256(changesJson),
      input.title,
      input.summary,
      changesJson,
      now,
      now,
    ],
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function resolveIterationDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  const iterationRoot =
    process.env.ITERATION_ROOT || path.join(process.cwd(), '.tmp', 'iteration-regression');
  const appDataRoot =
    process.env.DAO_APP_DATA_ROOT || path.join(iterationRoot, 'app-data');
  return `file:${path.join(appDataRoot, 'dev.db')}`;
}

test('staged document proposal review shows multi-file diff and applies through the browser', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const originalPrimaryText = `浏览器审阅前的主稿 ${suffix}`;
  const appliedPrimaryText = `浏览器已应用的主稿 ${suffix}`;
  const createdFileText = `Supporting review evidence ${suffix}`;
  const originalPrimaryContent = JSON.stringify([
    { ...buildHeading('多文件提案审阅'), id: `review-heading-${suffix}` },
    { ...buildParagraph(originalPrimaryText), id: `review-copy-${suffix}` },
  ]);
  const appliedPrimaryContent = JSON.stringify([
    { ...buildHeading('多文件提案审阅'), id: `review-heading-${suffix}` },
    { ...buildParagraph(appliedPrimaryText), id: `review-copy-${suffix}` },
  ]);
  const createdFileName = `review-notes-${suffix}.md`;
  const proposalId = `e2e-staged-proposal-${randomUUID()}`;
  const proposalTitle = `多文件草稿提案 ${suffix}`;
  const proposalSummary = '更新主稿并补充一份审阅说明。';
  const workspace = await createWorkspace(baseURL, {
    content: originalPrimaryContent,
    goal: '验证 staged document proposal 的浏览器审阅与应用闭环。',
    projectsRoot: resolveIterationProjectsRoot(),
    title: `迭代回归-提案审阅-${suffix}`,
  });
  const initialView = await apiRequest<{
    files: Array<{
      content: string;
      id: string;
      isPrimary: boolean;
      kind: 'richtext' | 'markdown';
      name: string;
      revision: number;
    }>;
    workspace: {
      draftBaseVersionId: string | null;
      draftRevision: number;
    };
  }>(
    baseURL,
    `/api/workspaces/${workspace.id}?conversationId=${workspace.conversationId}`
  );
  const primaryFile = initialView.files.find((file) => file.id === workspace.fileId);
  expect(primaryFile).toBeTruthy();
  if (!primaryFile) throw new Error('Proposal review workspace primary file is missing.');
  expect(initialView.workspace.draftBaseVersionId).toBeNull();

  const patches: StagedReviewPatch[] = [
    {
      fileId: primaryFile.id,
      kind: primaryFile.kind,
      name: primaryFile.name,
      nextContent: appliedPrimaryContent,
      operation: 'update',
      preimage: {
        content: primaryFile.content,
        contentSha256: sha256(primaryFile.content),
        revision: primaryFile.revision,
      },
      summary: '将主稿替换为已审阅版本。',
    },
    {
      fileId: null,
      kind: 'markdown',
      name: createdFileName,
      nextContent: `# Review notes\n\n${createdFileText}`,
      operation: 'create',
      preimage: null,
      summary: '新增审阅说明文件。',
    },
  ];
  const database = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    await database.execute('PRAGMA busy_timeout = 5000');
    await seedPendingStagedChange(database, {
      conversationId: workspace.conversationId,
      draftBaseVersionId: initialView.workspace.draftBaseVersionId,
      draftRevision: initialView.workspace.draftRevision,
      id: proposalId,
      patches,
      summary: proposalSummary,
      title: proposalTitle,
      workspaceId: workspace.id,
    });
  } finally {
    await database.close();
  }

  const seededProposals = await apiRequest<
    Array<{ id: string; revision: number; status: string }>
  >(baseURL, `/api/workspaces/${workspace.id}/staged-changes`);
  expect(seededProposals).toContainEqual(
    expect.objectContaining({ id: proposalId, revision: 1, status: 'pending' })
  );

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await dismissVisibleFirstUseGuidance(page);

  const reviewTrigger = page.getByTestId('staged-review-trigger');
  await expect(reviewTrigger).toBeVisible();
  await expect(reviewTrigger).toContainText('1');
  await reviewTrigger.click();

  const reviewDialog = page.getByRole('dialog', { name: /审阅待应用修改|Review proposed changes/ });
  await expect(reviewDialog).toBeVisible();
  await expect(reviewDialog.getByTestId(`staged-change-${proposalId}`)).toHaveAttribute(
    'aria-current',
    'true'
  );
  await expect(reviewDialog.getByRole('heading', { name: proposalTitle })).toBeVisible();
  await expect(reviewDialog).toContainText(proposalSummary);
  await expect(reviewDialog).toContainText(/涉及 2 个文件|2 affected files/);
  await expect(reviewDialog).toContainText(/来源：acceptance-test|Prepared by acceptance-test/);

  const diffs = reviewDialog.getByTestId(`staged-change-diff-${proposalId}`);
  await expect(diffs).toHaveCount(2);
  await expect(diffs.nth(0)).toContainText(primaryFile.name);
  await expect(diffs.nth(0)).toContainText(originalPrimaryText);
  await expect(diffs.nth(0)).toContainText(appliedPrimaryText);
  await expect(diffs.nth(1)).toContainText(createdFileName);
  await expect(diffs.nth(1)).toContainText(createdFileText);

  const decisionPath =
    `/api/workspaces/${workspace.id}/staged-changes/${proposalId}`;
  const decisionResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === decisionPath &&
      response.request().method() === 'PATCH'
  );
  const reloadPromise = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame());
  await reviewDialog.getByTestId(`staged-change-apply-${proposalId}`).click();
  const decisionResponse = await decisionResponsePromise;

  expect(decisionResponse.status()).toBe(200);
  expect(decisionResponse.request().postDataJSON()).toEqual({
    action: 'apply',
    expectedRevision: 1,
  });
  expect(await decisionResponse.json()).toMatchObject({
    id: proposalId,
    revision: 2,
    status: 'applied',
  });
  await expect(page.getByTestId('staged-change-notice')).toContainText(
    /已将 staged changes 应用到当前草稿|Applied staged changes/
  );
  await reloadPromise;

  await expect(page.getByTestId('staged-review-trigger')).toHaveCount(0);
  await expectWorkspaceSurfaceText(page, appliedPrimaryText, {
    hiddenText: originalPrimaryText,
  });

  const [proposals, files, versions] = await Promise.all([
    apiRequest<
      Array<{
        appliedCheckpointVersionId: string | null;
        id: string;
        reviewedAt: string | null;
        reviewedByUserId: string | null;
        revision: number;
        status: string;
      }>
    >(baseURL, `/api/workspaces/${workspace.id}/staged-changes`),
    apiRequest<Array<{ content: string; id: string; name: string; revision: number }>>(
      baseURL,
      `/api/workspaces/${workspace.id}/files`
    ),
    apiRequest<
      Array<{ id: string; restorable: boolean; title: string; visible: boolean }>
    >(baseURL, `/api/workspaces/${workspace.id}/versions?scope=all`),
  ]);
  const appliedProposal = proposals.find((proposal) => proposal.id === proposalId);
  const appliedPrimaryFile = files.find((file) => file.id === primaryFile.id);
  const createdFile = files.find((file) => file.name === createdFileName);
  const recoveryCheckpoint = versions.find(
    (version) => version.id === appliedProposal?.appliedCheckpointVersionId
  );

  expect(appliedProposal).toMatchObject({
    id: proposalId,
    reviewedByUserId: 'local-user',
    revision: 2,
    status: 'applied',
  });
  expect(appliedProposal?.reviewedAt).toBeTruthy();
  expect(appliedProposal?.appliedCheckpointVersionId).toBeTruthy();
  expect(appliedPrimaryFile).toMatchObject({
    content: appliedPrimaryContent,
    revision: primaryFile.revision + 1,
  });
  expect(createdFile).toMatchObject({
    content: `# Review notes\n\n${createdFileText}`,
    revision: 1,
  });
  expect(recoveryCheckpoint).toMatchObject({
    restorable: true,
    title: 'Recovery Point before Apply',
    visible: false,
  });
});

test('opening a new chat from a message preserves the selected version surface', async ({
  page,
}) => {
  const workspace = await createBranchVersionScenario();
  const initialConversationId = workspace.conversationId;

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&versionId=${workspace.versionId}`
  );

  await expectWorkspaceSurfaceText(page, BRANCH_VERSION_SURFACE_TEXT, { timeout: 60000 });
  await page.getByTestId('assistant-tab-chat').click();

  await page
    .getByTestId(`chat-new-conversation-message-${workspace.branchMessageId}`)
    .click();

  await waitForConversationChange(page, initialConversationId, {
    expectedVersionId: workspace.versionId,
  });
  await dismissVisibleFirstUseGuidance(page);
  await expect(page).toHaveURL(new RegExp(`versionId=${workspace.versionId}`));
  await expectWorkspaceSurfaceText(page, BRANCH_VERSION_SURFACE_TEXT);
});

test('version tree cards can open a milestone as the current read-only surface', async ({
  page,
}) => {
  const workspace = await createBranchVersionScenario();

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);

  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_V2_SURFACE_TEXT)
  ).toBeVisible();

  await openReadOnlyVersionFromTree(page, workspace.versionId);
  await expectWorkspaceSurfaceText(page, BRANCH_VERSION_SURFACE_TEXT, {
    hiddenText: BRANCH_V2_SURFACE_TEXT,
  });
});

test('continuing from the version tree promotes that point into the live draft and exposes the new draft base', async ({
  page,
}) => {
  const workspace = await createBranchVersionScenario();
  const initialConversationId = workspace.conversationId;

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&versionId=${workspace.versionId}`
  );

  await dismissVisibleFirstUseGuidance(page);

  await continueFromVersionTree(page, workspace.versionId, initialConversationId);

  await page.getByTestId('assistant-tab-chat').click();
  await dismissVisibleFirstUseGuidance(page);

  await expect(page.getByTestId('chat-base-version-label')).toContainText('从 版本里程碑 V1 继续');
  await page.getByTestId('assistant-tab-status').click();
  await expect(page.getByTestId('plan-current-branch-card')).toContainText('从 版本里程碑 V1 继续');
  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_VERSION_SURFACE_TEXT)
  ).toBeVisible();

  const refreshedVersionTree = await openVersionTree(page);
  await expect(refreshedVersionTree.getByText(/当前草稿基线|Current Draft Base/).first()).toBeVisible();
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

test('switching to another visible branch head from the version tree moves the live draft onto that branch', async ({
  page,
}) => {
  const workspace = await createBranchVersionScenario();
  const initialConversationId = workspace.conversationId;

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&versionId=${workspace.versionId}`
  );

  await dismissVisibleFirstUseGuidance(page);

  await continueFromVersionTree(page, workspace.versionId, initialConversationId);
  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_VERSION_SURFACE_TEXT)
  ).toBeVisible();

  const continuedConversationId = new URL(page.url()).searchParams.get('conversationId');
  expect(continuedConversationId).not.toBeNull();

  const switchedBranchId = workspace.secondVersionId!;
  await switchToBranchFromVersionTree(
    page,
    workspace.id,
    switchedBranchId,
    continuedConversationId!
  );

  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_V2_SURFACE_TEXT)
  ).toBeVisible();
  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_VERSION_SURFACE_TEXT)
  ).toHaveCount(0);

  const refreshedVersionTree = await expectCurrentBranchOverview(page, switchedBranchId);
  await expect(refreshedVersionTree.getByTestId(`version-switch-branch-${switchedBranchId}`)).toHaveCount(0);
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

  await continueFromVersionTree(page, workspace.versionId, initialConversationId);
  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_VERSION_SURFACE_TEXT)
  ).toBeVisible();

  const continuedConversationId = new URL(page.url()).searchParams.get('conversationId');
  expect(continuedConversationId).not.toBeNull();

  await expect(async () => {
    const branchVersionTree = await waitForBranchOverview(page, workspace.secondVersionId!, {
      minimumCount: 2,
    });
    const overviewCard = branchVersionTree.getByTestId(
      `version-branch-overview-card-${workspace.secondVersionId!}`
    );

    await expect(branchVersionTree.getByTestId('version-tree-header-stats')).toContainText(
      /正式里程碑|Saved Milestones/
    );
    await expect(branchVersionTree.getByTestId('version-tree-header-stats')).toContainText(
      /最近临时位|Latest Temporary/
    );
    await expect(branchVersionTree).toContainText(
      /保存里程碑.*可见正式版本|Save Milestone creates the visible version/
    );
    await expect(overviewCard).toBeVisible();
    await expect(overviewCard).toContainText('版本里程碑 V1');
    await expect(overviewCard).toContainText('版本里程碑 V2');
  }).toPass({ timeout: 30_000 });

  await switchToBranchFromVersionTree(
    page,
    workspace.id,
    workspace.secondVersionId!,
    continuedConversationId!
  );

  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_V2_SURFACE_TEXT)
  ).toBeVisible();

  const refreshedVersionTree = await expectCurrentBranchOverview(page, workspace.secondVersionId!);
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

  await continueFromVersionTree(page, workspace.versionId, initialConversationId);
  await expect(
    page.locator('[data-workspace-outline-surface="true"]').getByText(BRANCH_VERSION_SURFACE_TEXT)
  ).toBeVisible();

  await focusBranchLineageFromVersionTree(page, workspace.secondVersionId!);
  const branchVersionTree = await openVersionTree(page);

  await expect(async () => {
    const refreshedVersionTree = await openVersionTree(page);
    const v2BranchWorkspaceSection = refreshedVersionTree.getByTestId(
      `version-branch-workspace-section-${workspace.secondVersionId!}`
    );
    const v1BranchWorkspaceSection = refreshedVersionTree.getByTestId(
      `version-branch-workspace-section-${workspace.versionId}`
    );

    await expect(refreshedVersionTree.getByTestId('version-branch-focus-banner')).toContainText(
      '版本里程碑 V2'
    );
    await expect(refreshedVersionTree.getByTestId('version-branch-workspace')).toBeVisible();
    await expect(refreshedVersionTree.getByTestId('version-branch-workspace-stats')).toContainText(
      /1|Temporary|临时/
    );
    await expect(
      refreshedVersionTree.getByTestId(`version-history-card-${workspace.versionId}`)
    ).toBeVisible();
    await expect(
      refreshedVersionTree.getByTestId(`version-history-card-${workspace.secondVersionId!}`)
    ).toBeVisible();
    await expect(v2BranchWorkspaceSection).toBeVisible();
    await expect(v2BranchWorkspaceSection).toContainText(
      /继续前安全回退点|Safety Checkpoint before Continue/
    );
    await expect(v1BranchWorkspaceSection).toBeVisible();
    await expect(v1BranchWorkspaceSection).not.toContainText(
      /继续前安全回退点|Safety Checkpoint before Continue/
    );
    await expect(
      refreshedVersionTree
        .locator('[data-testid^="version-history-card-"]')
        .filter({ hasText: '从 版本里程碑 V1 继续' })
    ).toHaveCount(0);
  }).toPass({ timeout: 30_000 });

  const clearedVersionTree = await clearBranchLineageFocusFromVersionTree(page);
  await expect(
    clearedVersionTree
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

  await continueFromVersionTree(page, workspace.versionId, workspace.conversationId);

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

  const versionTreeDialog = await openVersionTree(page);
  await versionTreeDialog.getByRole('button', { name: /比较|Compare/ }).first().click();

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

test('branch compare stays on the selected lineage by default and only expands cross-branch explicitly', async ({
  page,
}) => {
  const workspace = await createBranchVersionScenario();

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&versionId=${workspace.versionId}`
  );

  await dismissVisibleFirstUseGuidance(page);
  await continueFromVersionTree(page, workspace.versionId, workspace.conversationId);

  const compareDialog = await openBranchCompareFromOverview(page, workspace.secondVersionId!);
  await expect(compareDialog.getByText(/默认先留在分支|Stay on branch/)).toBeVisible();
  await expect(compareDialog.getByTestId('version-compare-left-select')).toContainText(
    '里程碑 · 版本里程碑 V2'
  );
  await expect(compareDialog.getByTestId('version-compare-right-select')).toContainText(
    '里程碑 · 版本里程碑 V1'
  );

  await compareDialog.getByTestId('version-compare-right-select').click();
  await expect(page.getByRole('option', { name: '当前草稿' })).toHaveCount(0);
  await expect(page.getByRole('option', { name: '里程碑 · 版本里程碑 V1' })).toBeVisible();
  await expect(page.getByRole('option', { name: '里程碑 · 版本里程碑 V2' })).toBeVisible();
  await page.keyboard.press('Escape');

  await compareDialog.getByTestId('version-compare-scope-toggle').click();
  await expect(compareDialog.getByText('把任意可见版本与另一个可见版本或当前草稿做比较。')).toBeVisible();
  await compareDialog.getByTestId('version-compare-right-select').click();
  await expect(page.getByRole('option', { name: '当前草稿' })).toBeVisible();
  await page.keyboard.press('Escape');
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

  await expectWorkspaceSurfaceHeading(page, '支持资料续写对话文件');
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
  await expectWorkspaceSurfaceHeading(page, '支持资料续写对话文件');
});
