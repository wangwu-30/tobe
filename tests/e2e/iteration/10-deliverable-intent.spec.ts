import { expect, test } from '@playwright/test';
import { apiRequest, primeClientState, readSeedState } from './helpers';

test('legacy code create requests fold back into document defaults', async ({
  page: _page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();

  const created = await apiRequest<{
    primaryFile: { kind: string; path: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      deliverableType: 'code',
      goal: `兼容旧 code 创建请求 ${suffix}`,
      title: `Legacy Code Fallback ${suffix}`,
    },
    method: 'POST',
  });

  expect(created.primaryFile.path).toBe('main');
  expect(created.primaryFile.kind).toBe('richtext');

  const files = await apiRequest<
    Array<{ isPrimary: boolean; kind: string; path: string }>
  >(baseURL, `/api/workspaces/${created.workspace.id}/files`);
  const primaryFile = files.find((file) => file.isPrimary) || null;

  expect(primaryFile?.path).toBe('main');
  expect(primaryFile?.kind).toBe('richtext');
  expect(files.some((file) => file.path === 'index.ts')).toBe(false);
});

test('C2-C7: status panel no longer exposes manual result-shape switching', async ({
  page,
}, testInfo) => {
  const seedState = readSeedState();
  const workspace = seedState.intentSwitchWorkspace;
  const baseURL = String(testInfo.project.use.baseURL);

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}&assistant=status`
  );

  const statusPanel = page.getByRole('tabpanel', { name: /状态|Status/ });

  await expect(statusPanel.getByRole('button', { name: '文档' })).toHaveCount(0);
  await expect(statusPanel.getByRole('button', { name: '幻灯片' })).toHaveCount(0);
  await expect(statusPanel.getByRole('button', { name: '网页' })).toHaveCount(0);
  await expect(
    statusPanel.getByRole('button', { name: /按新类型重整结果|Regenerate for this type/ })
  ).toHaveCount(0);

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
});
