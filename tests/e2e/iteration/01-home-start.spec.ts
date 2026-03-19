import { expect, test } from '@playwright/test';
import { apiRequest, extractWorkspaceIdFromLocation, primeClientState } from './helpers';

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
    page
      .getByRole('tabpanel', { name: /状态|Status/ })
      .getByText(/^准备生成第一稿$|^Ready to generate the first pass$/)
      .first()
  ).toBeVisible();
  const firstPassButton = page.getByRole('button', {
    name: /生成第一稿|Generate First Pass/,
  });
  await expect(firstPassButton.first()).toBeVisible();
  await expect(
    page
      .getByRole('tabpanel', { name: /状态|Status/ })
      .getByRole('button', { name: /生成第一稿|Generate First Pass/ })
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
  await page.goto('/');

  const projectCard = page.getByRole('button', { name: new RegExp(projectTitle) });
  await expect(projectCard).toBeVisible();
  await expect(projectCard).toContainText(/2 份交付物|2 deliverables/);
  await expect(
    projectCard
  ).toContainText(new RegExp(`最近：${latestDeliverableTitle}|Latest: ${latestDeliverableTitle}`));

  await Promise.all([
    page.waitForURL(new RegExp(`/workspace/${latestWorkspace.workspace.id}`)),
    page.getByRole('button', { name: new RegExp(projectTitle) }).click(),
  ]);
});
