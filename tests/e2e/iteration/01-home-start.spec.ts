import { expect, test } from '@playwright/test';
import { apiRequest, extractWorkspaceIdFromLocation, primeClientState } from './helpers';

test('home starter keeps the chosen deliverable and shows the no-workflow fallback', async ({
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

  await page.getByTestId('starter-option-slides').click();

  await expect(page.getByTestId('goal-deliverable-pill')).toHaveText(/幻灯片|Slides/);
  await expect(page.getByTestId('goal-workflow-empty-state')).toContainText(
    /当前还没有可复用 Workflow|No reusable workflow yet/
  );

  await page.locator('#goal').fill('为董事会准备一份 8 页演示稿');
  const createButton = page.getByRole('button', { name: /创建项目|Create Project/ });
  await expect(createButton).toBeEnabled();
  await Promise.all([
    page.waitForURL(/\/workspace\//),
    createButton.click(),
  ]);

  expect(extractWorkspaceIdFromLocation(page.url())).toBeTruthy();
  await expect(
    page.getByRole('heading', { name: '为董事会准备一份 8 页演示稿' })
  ).toBeVisible();
  await expect(
    page.getByText(/准备生成第一稿 · 幻灯片|Ready to generate.*Slides/)
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

  await expect(page.getByText(projectTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(/2 份交付物|2 deliverables/)).toBeVisible();
  await expect(
    page.getByText(new RegExp(`最近：${latestDeliverableTitle}|Latest: ${latestDeliverableTitle}`))
  ).toBeVisible();

  await Promise.all([
    page.waitForURL(new RegExp(`/workspace/${latestWorkspace.workspace.id}`)),
    page.getByRole('button', { name: new RegExp(projectTitle) }).click(),
  ]);
});
