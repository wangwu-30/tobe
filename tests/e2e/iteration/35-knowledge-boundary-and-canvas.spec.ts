import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { apiRequest } from './helpers';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('/knowledge shows the Git Knowledge != Wiki Space boundary guide and switches cleanly between en-US and zh-CN', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'ai-settings',
      JSON.stringify({ language: 'en-US' })
    );
  });
  await page.goto('/knowledge');
  await expect(page).toHaveURL(/\/knowledge\?view=reviews/);

  const boundaryGuide = page.getByTestId('knowledge-boundary-guide');
  await expect(boundaryGuide).toBeVisible();
  await expect(boundaryGuide).toContainText('Git Knowledge is not a Wiki Space');
  await expect(
    boundaryGuide.getByRole('link', { name: 'Back to Wiki Spaces' })
  ).toHaveAttribute('href', '/');
  await expect(page.getByTestId('knowledge-reviews-tab')).toContainText('Review queue');
  await expect(page.getByTestId('knowledge-configuration-tab')).toContainText(
    'Repositories & access'
  );

  const enAxe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(enAxe.violations).toEqual([]);

  // Switch to zh-CN and verify full localization across both views.
  await page.evaluate(() => {
    window.localStorage.setItem(
      'ai-settings',
      JSON.stringify({ language: 'zh-CN' })
    );
    window.dispatchEvent(new CustomEvent('dao:ai-settings-changed'));
  });

  await expect(boundaryGuide).toContainText('Git 知识库不是 Wiki Space');
  await expect(
    boundaryGuide.getByRole('link', { name: '返回 Wiki Space' })
  ).toBeVisible();
  await expect(page.getByTestId('knowledge-reviews-tab')).toContainText('审阅队列');
  await expect(page.getByTestId('knowledge-configuration-tab')).toContainText(
    '仓库与访问权限'
  );

  await page.getByTestId('knowledge-configuration-tab').click();
  await expect(page).toHaveURL(/\/knowledge\?view=configuration$/);
  await expect(
    page.getByRole('heading', { name: 'Git 知识仓库' })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '工作区访问绑定' })
  ).toBeVisible();
});

test('ProjectCanvas keeps SVG dependency edges synced during zoom/pan and shows readable titles instead of UUIDs', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const firstTitle = 'Canvas Alpha Source';
  const secondTitle = 'Canvas Beta Target';

  const first = await apiRequest<{
    conversation: { id: string };
    workspace: { id: string; projectId: string };
  }>(baseURL, '/api/workspaces', {
    method: 'POST',
    body: {
      autoGenerateFirstDraft: false,
      goal: firstTitle,
      title: firstTitle,
    },
  });

  const projectId = first.workspace.projectId || first.workspace.id;
  const second = await apiRequest<{
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    method: 'POST',
    body: {
      autoGenerateFirstDraft: false,
      goal: secondTitle,
      projectId,
      title: secondTitle,
    },
  });

  const relation = await apiRequest<{ id: string }>(
    baseURL,
    `/api/workspaces/${projectId}/node-relations`,
    {
      method: 'POST',
      body: {
        kind: 'dependency',
        sourceNodeId: first.workspace.id,
        targetNodeId: second.workspace.id,
      },
    }
  );
  expect(relation.id).toBeTruthy();

  await page.addInitScript(() => {
    window.localStorage.setItem(
      'ai-settings',
      JSON.stringify({ language: 'en-US' })
    );
  });
  await page.goto(
    `/workspace/${projectId}?node=${first.workspace.id}&conversationId=${first.conversation.id}`
  );

  // Switch from editor surface to ProjectCanvas overview.
  await page.getByRole('button', { name: /^View$/i }).click();
  await page.getByTestId('workspace-toggle-surface-mode').click();

  const canvasRoot = page.getByTestId('project-canvas');
  await expect(canvasRoot).toBeVisible({ timeout: 15_000 });
  const tldrawCanvas = canvasRoot.getByTestId('canvas');
  const alphaCard = tldrawCanvas.getByText(firstTitle, { exact: true });
  const betaCard = tldrawCanvas.getByText(secondTitle, { exact: true });
  await expect(alphaCard).toBeVisible({ timeout: 15_000 });
  await expect(betaCard).toBeVisible({ timeout: 15_000 });

  await expect(page.getByTestId('project-canvas-edges')).toBeVisible({ timeout: 15_000 });
  const edgeLine = page.getByTestId(`project-canvas-edge-${relation.id}`);
  await expect(edgeLine).toBeAttached({ timeout: 15_000 });

  const readEdgeCoords = async () => ({
    x1: Number(await edgeLine.getAttribute('x1')),
    x2: Number(await edgeLine.getAttribute('x2')),
    y1: Number(await edgeLine.getAttribute('y1')),
    y2: Number(await edgeLine.getAttribute('y2')),
  });

  const initialCoords = await readEdgeCoords();
  const canvasBox = await canvasRoot.boundingBox();
  expect(canvasBox).toBeTruthy();

  // Pan the tldraw viewport via mouse wheel; camera subscription must move SVG coordinates in lockstep.
  await page.mouse.move(
    canvasBox!.x + canvasBox!.width / 2,
    canvasBox!.y + canvasBox!.height / 2
  );
  await page.mouse.wheel(140, 120);

  await expect
    .poll(async () => {
      const next = await readEdgeCoords();
      const movedX = Math.abs(next.x1 - initialCoords.x1);
      const movedY = Math.abs(next.y1 - initialCoords.y1);
      return movedX > 10 || movedY > 10;
    })
    .toBe(true);

  // Verify the SVG edge endpoints stay aligned with the card centers after pan.
  const [afterCoords, alphaBox, betaBox, rootBox] = await Promise.all([
    readEdgeCoords(),
    alphaCard.boundingBox(),
    betaCard.boundingBox(),
    canvasRoot.boundingBox(),
  ]);
  expect(alphaBox && betaBox && rootBox).toBeTruthy();
  const alphaCenterX = alphaBox!.x + alphaBox!.width / 2 - rootBox!.x;
  const betaCenterX = betaBox!.x + betaBox!.width / 2 - rootBox!.x;
  expect(Math.abs(afterCoords.x1 - alphaCenterX)).toBeLessThan(120);
  expect(Math.abs(afterCoords.x2 - betaCenterX)).toBeLessThan(120);

  // Right-click the source card and confirm disconnect action displays readable page title, not raw UUID.
  await alphaCard.click({ button: 'right' });
  const contextMenu = page.getByTestId('canvas-context-menu');
  await expect(contextMenu).toBeVisible();
  await expect(contextMenu).toContainText(`Disconnect from ${secondTitle}`);
  await expect(contextMenu).not.toContainText(second.workspace.id.slice(0, 6));
});
