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

  await expect(page.getByTestId('starter-option-code')).toBeDisabled();
  await expect(page.getByTestId('starter-option-code')).toContainText(
    /敬请期待|Coming Soon/
  );

  await page.getByTestId('starter-option-document').click();

  await expect(page.getByTestId('goal-deliverable-pill')).toHaveText(/文档|Document/);
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
    page.getByText(/准备生成第一稿 · 文档|Ready to generate.*Document/)
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
