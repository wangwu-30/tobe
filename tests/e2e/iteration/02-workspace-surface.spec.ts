import { expect, test } from '@playwright/test';
import { primeClientState, readSeedState } from './helpers';

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

test('deliverable type switch keeps slides and web inside result shells instead of falling back to source', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.baseWorkspace;

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}`
  );

  const statusPanel = page.getByRole('tabpanel', { name: /状态|Status/ });

  await statusPanel.getByRole('button', { name: '幻灯片' }).click();
  await expect(page.getByTestId('slides-deliverable-canvas')).toBeVisible();
  await expect(page.getByTestId('source-deliverable-canvas')).toHaveCount(0);
  await expect(page.getByText(/^#\s*交付物总览$/)).toHaveCount(0);

  await statusPanel.getByRole('button', { name: '网页' }).click();
  await expect(page.getByTestId('web-deliverable-canvas')).toBeVisible();
  await expect(page.getByTestId('source-deliverable-canvas')).toHaveCount(0);
});
