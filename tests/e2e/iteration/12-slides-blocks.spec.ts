import { expect, test } from '@playwright/test';

import { apiRequest, primeClientState } from './helpers';

test('slide_page content renders as structured slide cards', async ({ page }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const payload = await apiRequest<{
    conversation: { id: string };
    primaryFile: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      content: JSON.stringify([
        {
          type: 'slide_page',
          title: '市场机会',
          children: [
            { type: 'p', children: [{ text: '先用一句话交代增长窗口。' }] },
            { type: 'p', children: [{ text: '再补充两个最关键的判断。' }] },
          ],
          notes: '演讲时先讲行业拐点，再讲我们的切入优势。',
        },
        {
          type: 'slide_page',
          title: '产品方案',
          children: [
            { type: 'p', children: [{ text: '聚焦一个主流程，不要把所有能力堆在一页。' }] },
          ],
        },
      ]),
      deliverableType: 'document',
      goal: '验证文档里的 slide_page block 会投影成幻灯片结果面。',
      title: `Slide Page Projection ${suffix}`,
    },
    method: 'POST',
  });

  await apiRequest(baseURL, `/api/workspaces/${payload.workspace.id}/plan`, {
    body: {
      activeStageId: 'review',
      deliverableType: 'document',
      goal: '验证文档里的 slide_page block 会投影成幻灯片结果面。',
      stages: [
        {
          checkpoint: true,
          description: '结构化 slide_page 已经进入结果面。',
          id: 'review',
          kind: 'review',
          status: 'in_progress',
          title: '审阅幻灯片',
        },
      ],
      status: 'reviewing',
    },
    method: 'POST',
  });

  await primeClientState(page);
  await page.goto(
    `/workspace/${payload.workspace.id}?conversationId=${payload.conversation.id}`
  );

  const slidesCanvas = page.getByTestId('slides-deliverable-canvas');
  await expect(slidesCanvas).toBeVisible();
  await expect(page.getByText(/幻灯片视图|Slide View/)).toBeVisible();
  await expect(page.getByText(/演示稿|Presentation/)).toHaveCount(0);
  await expect(slidesCanvas.getByText('市场机会')).toBeVisible();
  await expect(slidesCanvas.getByText('先用一句话交代增长窗口。')).toBeVisible();
  await expect(
    slidesCanvas.getByText('演讲时先讲行业拐点，再讲我们的切入优势。')
  ).toBeVisible();
  await expect(slidesCanvas.getByText('产品方案')).toBeVisible();
  await expect(slidesCanvas).not.toContainText(/按新类型重整结果|Regenerate for this type/);
});

test('legacy stored slides still render through the unified slide surface', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const payload = await apiRequest<{
    conversation: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      content: JSON.stringify([
        {
          type: 'h1',
          children: [{ text: '封面' }],
        },
        {
          type: 'p',
          children: [{ text: '一句话讲清楚品牌定位与核心价值。' }],
        },
        {
          type: 'h1',
          children: [{ text: '方案' }],
        },
        {
          type: 'p',
          children: [{ text: '第二页强调主流程、关键能力和转化路径。' }],
        },
      ]),
      deliverableType: 'document',
      goal: '验证 legacy slides 仍会通过统一 slide surface 渲染。',
      title: `Legacy Slide Compatibility ${suffix}`,
    },
    method: 'POST',
  });

  await setStoredWorkspaceDeliverableType(baseURL, payload.workspace.id, 'slides');

  await primeClientState(page);
  await page.goto(
    `/workspace/${payload.workspace.id}?conversationId=${payload.conversation.id}`
  );

  const slidesCanvas = page.getByTestId('slides-deliverable-canvas');
  await expect(slidesCanvas).toBeVisible();
  await expect(page.getByText(/幻灯片视图|Slide View/)).toBeVisible();
  await expect(slidesCanvas.getByText('封面')).toBeVisible();
  await expect(slidesCanvas.getByText('一句话讲清楚品牌定位与核心价值。')).toBeVisible();
  await expect(slidesCanvas.getByText('方案')).toBeVisible();
  await expect(slidesCanvas.getByText('第二页强调主流程、关键能力和转化路径。')).toBeVisible();
});

async function setStoredWorkspaceDeliverableType(
  baseURL: string,
  workspaceId: string,
  deliverableType: 'document' | 'web' | 'slides' | 'code'
) {
  return apiRequest<{ ok: true }>(baseURL, `/api/debug/workspaces/${workspaceId}/plan`, {
    body: {
      deliverableType,
    },
    method: 'PATCH',
  });
}
