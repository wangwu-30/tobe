import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { primeClientState, readSeedState } from './helpers';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('team Web surfaces have no automated WCAG A or AA violations', async ({
  page,
}) => {
  await primeClientState(page);

  for (const route of ['/', '/tasks', '/jobs', '/agents', '/knowledge', '/settings']) {
    await page.goto(route);
    await expect(page.locator('#main-content')).toBeVisible();
    await expectNoAccessibilityViolations(page, route);
  }
});

test('default workspace Chat has no automated WCAG A or AA violations', async ({
  page,
}) => {
  const workspace = readSeedState().baseWorkspace;
  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}`
  );
  await expect(page.getByTestId('chat-composer')).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('node'))
    .toBe(workspace.id);
  await expect(page.getByTestId('workspace-start-agent')).toBeEnabled();
  await expectNoAccessibilityViolations(page, 'workspace Chat');
});

test('mobile workspace switches between one Page and assistant panel without overflow', async ({
  page,
}) => {
  const workspace = readSeedState().baseWorkspace;
  await page.setViewportSize({ height: 812, width: 375 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}`
  );

  const pagePanelButton = page.getByTestId('workspace-mobile-pane-left');
  const assistantPanelButton = page.getByTestId('workspace-mobile-pane-right');
  await expect(pagePanelButton).toBeVisible();
  await expect(assistantPanelButton).toBeVisible();
  await expect(pagePanelButton).toHaveAttribute('aria-pressed', 'true');
  await expect(assistantPanelButton).toHaveAttribute('aria-pressed', 'false');
  const pageSurface = page.locator('[data-workspace-outline-surface="true"]');
  await expect(pageSurface).toBeVisible();
  await expect(page.getByTestId('chat-composer')).toBeHidden();

  for (const button of [pagePanelButton, assistantPanelButton]) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  await assistantPanelButton.click();
  await expect(assistantPanelButton).toHaveAttribute('aria-pressed', 'true');
  await expect(pagePanelButton).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('chat-composer')).toBeVisible();
  await expect(pageSurface).toBeHidden();

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(pageOverflow).toBe(false);
  await expectNoAccessibilityViolations(page, 'mobile workspace Chat');
});

async function expectNoAccessibilityViolations(page: Page, surface: string) {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    result.violations,
    `${surface} accessibility violations:\n${formatViolations(result.violations)}`
  ).toEqual([]);
}

function formatViolations(
  violations: ReadonlyArray<{
    help: string;
    id: string;
    nodes: ReadonlyArray<{ html: string; target: unknown }>;
  }>
) {
  return violations
    .map((violation) =>
      [
        `${violation.id}: ${violation.help}`,
        ...violation.nodes.map(
          (node) => `  ${formatTarget(node.target)}: ${node.html.slice(0, 240)}`
        ),
      ].join('\n')
    )
    .join('\n');
}

function formatTarget(target: unknown): string {
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) return target.map(formatTarget).join(' ');
  return JSON.stringify(target) ?? String(target);
}
