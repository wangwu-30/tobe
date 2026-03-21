import { expect, test } from '@playwright/test';
import { apiRequest, primeClientState, readSeedState } from './helpers';

test('outline jump keeps the target heading near the top and status stays visible', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.baseWorkspace;

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}`
  );

  await expect(
    page.getByText('这个工作区用于验证大纲跳转、状态面板和主交付物表面。')
  ).toBeVisible();
  await expect(page.getByText('撰写主稿')).toBeVisible();

  await page.getByTestId('outline-item-heading-4').click();

  const targetHeading = page.locator(
    '[data-workspace-outline-surface="true"] h2',
    {
      hasText: '总结',
    }
  );
  const scrollViewport = page.locator(
    '[data-workspace-outline-surface="true"] [data-radix-scroll-area-viewport]'
  );

  await expect.poll(async () => {
    const [headingBox, viewportBox] = await Promise.all([
      targetHeading.boundingBox(),
      scrollViewport.boundingBox(),
    ]);
    if (!headingBox || !viewportBox) {
      return Number.POSITIVE_INFINITY;
    }

    return headingBox.y - viewportBox.y;
  }).toBeLessThan(110);
});

test('slide and web deliverables stay inside result shells instead of falling back to source', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const slidesWorkspace = await apiRequest<{
    conversation: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      content: JSON.stringify([
        {
          type: 'slide_page',
          title: '结果壳验证',
          children: [{ type: 'p', children: [{ text: '这页内容用于验证 slide 结果面。' }] }],
        },
      ]),
      deliverableType: 'document',
      goal: '验证文档中的 slide_page 会自动投影成 slide 结果面。',
      title: `Slide Projection ${suffix}`,
    },
    method: 'POST',
  });
  const webWorkspace = await apiRequest<{
    conversation: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      deliverableType: 'web',
      goal: '验证 web 结果壳稳定可见。',
      title: `Web Result Shell ${suffix}`,
    },
    method: 'POST',
  });
  const slidesView = await apiRequest<{
    deliverable: { deliverableType: string; renderAs: string };
  }>(
    baseURL,
    `/api/workspaces/${slidesWorkspace.workspace.id}?conversationId=${slidesWorkspace.conversation.id}`
  );
  const webView = await apiRequest<{
    deliverable: { deliverableType: string; renderAs: string };
  }>(
    baseURL,
    `/api/workspaces/${webWorkspace.workspace.id}?conversationId=${webWorkspace.conversation.id}`
  );

  expect(slidesView.deliverable).toMatchObject({
    deliverableType: 'document',
    renderAs: 'slides',
  });
  expect(webView.deliverable).toMatchObject({
    deliverableType: 'web',
    renderAs: 'web',
  });

  await primeClientState(page);
  await page.goto(
    `/workspace/${slidesWorkspace.workspace.id}?conversationId=${slidesWorkspace.conversation.id}`
  );
  await expect(page.getByTestId('slides-deliverable-canvas')).toBeVisible();
  await expect(page.getByTestId('source-deliverable-canvas')).toHaveCount(0);
  await expect(page.getByText(/^#\s*交付物总览$/)).toHaveCount(0);

  await page.goto(
    `/workspace/${webWorkspace.workspace.id}?conversationId=${webWorkspace.conversation.id}`
  );
  await expect(page.getByTestId('web-deliverable-canvas')).toBeVisible();
  await expect(page.getByTestId('source-deliverable-canvas')).toHaveCount(0);
});
