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

test('default Project Room has no automated WCAG A or AA violations', async ({
  page,
}) => {
  const workspace = readSeedState().baseWorkspace;
  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}`
  );
  await expect(page.getByTestId('room-feed')).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('node'))
    .toBe(workspace.id);
  await expect(page.getByTestId('workspace-start-agent')).toBeEnabled();
  await expectNoAccessibilityViolations(page, 'Project Room');
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
