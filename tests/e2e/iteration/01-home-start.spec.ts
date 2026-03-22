import { expect, test } from '@playwright/test';
import {
  apiRequest,
  extractWorkspaceIdFromLocation,
  primeClientState,
  waitForWorkspaceRoute,
} from './helpers';

test('home starter exposes built-in workflows and can start from the research workflow', async ({
  page,
}) => {
  await primeClientState(page);
  await page.goto('/');

  await expect(page.getByRole('dialog', { name: /欢迎使用成形|Welcome/ })).toHaveCount(0);
  await expect(page.getByTestId('first-use-guide-home')).toBeVisible();

  await page.getByRole('main').getByRole('button', { name: /从目标开始|Start with a Goal/ }).click();

  const goalDialog = page.getByRole('dialog');
  await expect(goalDialog).toBeVisible();
  await expect(goalDialog.getByLabel(/目标|Goal/)).toBeVisible();
  await expect(goalDialog.getByTestId('goal-deliverable-pill')).toHaveCount(0);
  await expect(page.getByTestId('starter-option-document')).toHaveCount(0);
  await expect(page.getByTestId('starter-option-code')).toHaveCount(0);

  const workflowSelect = page.getByRole('combobox').first();
  await workflowSelect.click();
  const workflowList = page.getByRole('listbox');
  await expect(
    workflowList.getByRole('option', { name: /需求规格到网页上线|Built-in/ }).first()
  ).toBeVisible();
  await workflowList
    .getByRole('option', { name: /成形类产品市场分析报告|Built-in/ })
    .first()
    .click();

  await expect(workflowSelect).toContainText(/成形类产品市场分析报告/);
  await expect(page.getByTestId('goal-workflow-extension-tools')).toBeVisible();
  await expect(page.getByTestId('goal-workflow-extension-mcp')).toBeVisible();
  await expect(page.getByTestId('goal-workflow-extension-skills')).toBeVisible();

  await page.locator('#goal').fill('调研成形类产品的市场机会与竞争格局。');
  const createButton = page.getByRole('button', { name: /创建项目|Create Project/ });
  await expect(createButton).toBeEnabled();
  await Promise.all([
    page.waitForURL(/\/workspace\//),
    createButton.click(),
  ]);

  expect(extractWorkspaceIdFromLocation(page.url())).toBeTruthy();
  await expect(
    page
      .getByRole('tabpanel', { name: /状态|Status/ })
      .getByText('成形类产品市场分析报告', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(/AI 正在启动第一版 live draft|AI is starting the first live draft/)
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /生成第一稿|Generate First Pass/ })
  ).toHaveCount(0);
});

test('home create flow surfaces clarify cards for ambiguous goals', async ({ page }) => {
  await primeClientState(page);
  await page.goto('/');

  await page.getByRole('main').getByRole('button', { name: /从目标开始|Start with a Goal/ }).click();

  const goalDialog = page.getByRole('dialog');
  await expect(goalDialog).toBeVisible();

  await goalDialog.getByLabel(/目标|Goal/).fill('介绍一下我们的服务。');
  await goalDialog.getByRole('button', { name: /创建项目|Create Project/ }).click();

  await expect(goalDialog).toContainText(/更了解你期望的结果形态|结果形态|最佳方式/);
  await expect(goalDialog.getByTestId('goal-intent-option-document')).toBeVisible();
  await expect(goalDialog.getByTestId('goal-intent-option-web')).toBeVisible();
  await expect(goalDialog.getByTestId('goal-intent-option-both')).toBeVisible();
  await expect(goalDialog.getByTestId('goal-intent-option-other')).toBeVisible();

  await Promise.all([
    page.waitForURL(/\/workspace\//),
    goalDialog
      .getByTestId('goal-intent-option-document')
      .getByRole('button', { name: /选择|Select/ })
      .click(),
  ]);
});

test('home create flow asks for goal detail before accepting an extremely vague request', async ({
  page,
}) => {
  await primeClientState(page);
  await page.goto('/');

  await page.getByRole('main').getByRole('button', { name: /从目标开始|Start with a Goal/ }).click();

  const goalDialog = page.getByRole('dialog');
  await expect(goalDialog).toBeVisible();

  await goalDialog.getByLabel(/目标|Goal/).fill('帮我弄个东西');
  await goalDialog.getByRole('button', { name: /创建项目|Create Project/ }).click();

  await expect(goalDialog.getByTestId('goal-goal-clarify')).toBeVisible();
  await expect(goalDialog.getByTestId('goal-goal-clarify')).toContainText(
    /产出什么|page, a brief, a report/
  );
  await expect(goalDialog.getByTestId('goal-goal-clarify')).toContainText(
    /给谁看|Who is it for/
  );
  await expect(goalDialog.getByTestId('goal-goal-clarify')).toContainText(
    /达成什么结果|What should it achieve/
  );
});

test('home project list summarizes deliverables and opens the latest deliverable', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const projectTitle = `项目摘要 ${suffix}`;
  const latestDeliverableTitle = `FAQ 页面 ${suffix}`;

  const firstWorkspace = await apiRequest<{
    conversation: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      deliverableType: 'document',
      goal: `${projectTitle} 的第一份交付物。`,
      title: projectTitle,
    },
    method: 'POST',
  });

  const latestWorkspace = await apiRequest<{
    conversation: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      deliverableType: 'document',
      goal: `${projectTitle} 的第二份交付物。`,
      projectId: firstWorkspace.workspace.id,
      projectTitle,
      title: latestDeliverableTitle,
    },
    method: 'POST',
  });

  await primeClientState(page);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        /\/api\/project-list(?:\?|$)/.test(response.url()) &&
        response.request().method() === 'GET',
      { timeout: 45000 }
    ),
    page.goto('/'),
  ]);

  const continueCurrentButton = page.getByTestId(
    `sidebar-project-open-${firstWorkspace.workspace.id}`
  );
  const continueNextButton = page.getByTestId(
    `sidebar-project-create-next-${firstWorkspace.workspace.id}`
  );
  await expect(continueCurrentButton).toBeVisible({ timeout: 10000 });
  await expect(continueCurrentButton).toContainText(
    /继续当前交付物|Continue Current Deliverable/
  );
  await expect(continueNextButton).toContainText(
    /继续下一份交付物|Continue to Next Deliverable/
  );
  const projectRow = continueCurrentButton.locator('..').locator('..');
  await expect(projectRow).toContainText(/2 份交付物|2 deliverables/);
  await expect(projectRow).toContainText(
    new RegExp(`最近：${latestDeliverableTitle}|Latest: ${latestDeliverableTitle}`)
  );

  await Promise.all([
    page.waitForURL(new RegExp(`/workspace/${latestWorkspace.workspace.id}`)),
    continueCurrentButton.click(),
  ]);
});

test('home project cards can continue the next deliverable inside the same project', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const projectTitle = `项目继续 ${suffix}`;

  const firstWorkspace = await apiRequest<{
    conversation: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      deliverableType: 'document',
      goal: `${projectTitle} 的当前交付物。`,
      title: projectTitle,
    },
    method: 'POST',
  });

  await apiRequest<{
    conversation: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      deliverableType: 'document',
      goal: `${projectTitle} 的延续交付物。`,
      projectId: firstWorkspace.workspace.id,
      projectTitle,
      title: `当前交付物 ${suffix}`,
    },
    method: 'POST',
  });

  await primeClientState(page);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        /\/api\/project-list(?:\?|$)/.test(response.url()) &&
        response.request().method() === 'GET',
      { timeout: 45000 }
    ),
    page.goto('/'),
  ]);

  await page
    .getByTestId(`sidebar-project-create-next-${firstWorkspace.workspace.id}`)
    .click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(projectTitle);
  await expect(dialog).toContainText(/沿着|continues inside/i);
  await expect(
    dialog.getByRole('button', { name: /创建交付物|Create Deliverable/ })
  ).toBeVisible();

  await dialog.getByLabel(/目标|Goal/).fill('沿着当前项目继续下一份摘要交付物。');
  await dialog.getByRole('button', { name: /创建交付物|Create Deliverable/ }).click();
  const clarifyAfterNextDeliverable = dialog.getByTestId('goal-intent-option-document');
  if (
    await clarifyAfterNextDeliverable
      .waitFor({ state: 'visible', timeout: 1500 })
      .then(() => true)
      .catch(() => false)
  ) {
    await clarifyAfterNextDeliverable.getByRole('button', { name: /选择|Select/ }).click();
  }

  const nextRoute = await waitForWorkspaceRoute(page, {
    excludeConversationId: firstWorkspace.conversation.id,
    excludeWorkspaceId: firstWorkspace.workspace.id,
  });
  const nextWorkspaceId = nextRoute.workspaceId;
  const nextConversationId = nextRoute.conversationId;

  expect(nextRoute.pathname).toMatch(/^\/workspace\/[^/]+$/);

  const nextView = await getWorkspaceView(baseURL, nextWorkspaceId, nextConversationId);

  expect(nextView.currentProject?.id).toBe(firstWorkspace.workspace.id);
  expect(nextView.workspace?.projectId).toBe(firstWorkspace.workspace.id);
});

async function getWorkspaceView(
  baseURL: string,
  workspaceId: string,
  conversationId: string
) {
  return apiRequest<{
    currentProject: { id: string; title: string } | null;
    workspace: {
      projectId: string;
      title?: string | null;
    } | null;
  }>(baseURL, `/api/workspaces/${workspaceId}?conversationId=${conversationId}`);
}
