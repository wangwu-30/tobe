import { expect, test } from '@playwright/test';
import { apiRequest, primeClientState, readSeedState } from './helpers';

test('C2-C7: deliverable type switching stays non-destructive and keeps the result shell visible', async ({
  page,
}, testInfo) => {
  const seedState = readSeedState();
  const workspace = seedState.intentSwitchWorkspace;
  const baseURL = String(testInfo.project.use.baseURL);

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);

  const statusPanel = page.getByRole('tabpanel', { name: /状态|Status/ });

  await statusPanel.getByRole('button', { name: '幻灯片' }).click();
  await expect.poll(async () => {
    const plan = await apiRequest<{ deliverableType: string }>(
      baseURL,
      `/api/workspaces/${workspace.id}/plan`
    );
    return plan.deliverableType;
  }).toBe('slides');
  await expect(page.getByTestId('slides-deliverable-canvas')).toBeVisible();
  await expect(page.getByTestId('source-deliverable-canvas')).toHaveCount(0);

  await statusPanel.getByRole('button', { name: '网页' }).click();
  await expect.poll(async () => {
    const plan = await apiRequest<{ deliverableType: string }>(
      baseURL,
      `/api/workspaces/${workspace.id}/plan`
    );
    return plan.deliverableType;
  }).toBe('web');
  await expect(page.getByTestId('web-deliverable-canvas')).toBeVisible();
  await expect(page.getByTestId('source-deliverable-canvas')).toHaveCount(0);

  await expect(statusPanel.getByRole('button', { name: '文档' })).toBeEnabled();
  await statusPanel.getByRole('button', { name: '文档' }).click();
  await expect.poll(async () => {
    const plan = await apiRequest<{ deliverableType: string }>(
      baseURL,
      `/api/workspaces/${workspace.id}/plan`
    );
    return plan.deliverableType;
  }).toBe('document');

  const [files, threads, versions] = await Promise.all([
    apiRequest<Array<{ id: string }>>(baseURL, `/api/workspaces/${workspace.id}/files`),
    apiRequest<Array<{ id: string }>>(
      baseURL,
      `/api/threads?documentId=${workspace.id}&workspaceId=${workspace.id}`
    ),
    apiRequest<Array<{ id: string }>>(baseURL, `/api/workspaces/${workspace.id}/versions`),
  ]);

  expect(files.length).toBeGreaterThanOrEqual(3);
  expect(threads.length).toBe(2);
  expect(versions.length).toBe(1);

  await expect(
    statusPanel.getByRole('button', { name: /按新类型重整结果|Regenerate for this type/ })
  ).toBeVisible();
});
