import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { primeClientState, readSeedState } from './helpers';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('Settings is a top-level sidebar destination while Advanced remains collapsed until opened', async ({
  page,
}) => {
  await primeClientState(page);
  await page.goto('/');

  const settingsLink = page.getByTestId('sidebar-settings-link');
  const advancedToggle = page.getByTestId('sidebar-advanced-toggle');

  await expect(settingsLink).toBeVisible();
  await expect(settingsLink).toHaveAttribute('href', '/settings');
  await expect(advancedToggle).toBeVisible();
  await expect(advancedToggle).toHaveAttribute('aria-expanded', 'false');

  // Home sidebar hides empty workspace-only sections
  await expect(page.getByTestId('sidebar-projects-section')).toBeVisible();
  await expect(page.getByTestId('sidebar-node-search-section')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-project-tree-section')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-outline-section')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-support-section')).toHaveCount(0);

  // Collapsed Home sidebar icons expand back cleanly
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByTestId('sidebar-collapsed-projects')).toBeVisible();
  await expect(page.getByTestId('sidebar-settings-link')).toBeVisible();
  await expect(page.getByTestId('sidebar-collapsed-outline')).toHaveCount(0);
  await page.getByTestId('sidebar-collapsed-projects').click();
  await expect(page.getByTestId('sidebar-projects-section')).toBeVisible();

  // Navigating to Settings keeps Advanced collapsed, uses unified sidebar shell, and marks Settings active
  await page.getByTestId('sidebar-settings-link').click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId('sidebar-settings-link')).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect(page.getByTestId('sidebar-projects-section')).toBeVisible();
  await expect(page.getByTestId('sidebar-advanced-toggle')).toHaveAttribute(
    'aria-expanded',
    'false'
  );

  // Secondary page shares unified DeliverableSidebar collapsed expand interaction
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByTestId('sidebar-collapsed-projects')).toBeVisible();
  await page.getByTestId('sidebar-collapsed-projects').click();
  await expect(page.getByTestId('sidebar-projects-section')).toBeVisible();

  // Expanding Advanced shows team/control-plane routes without duplicating Settings
  await page.getByTestId('sidebar-advanced-toggle').click();
  const advancedContainer = page
    .getByTestId('sidebar-advanced-toggle')
    .locator('xpath=..');
  await expect(
    advancedContainer.getByRole('link', { name: /Git 知识|Git Knowledge/ })
  ).toBeVisible();
  await expect(
    advancedContainer.getByRole('link', { name: /团队任务|Team Tasks/ })
  ).toBeVisible();
  await expect(
    advancedContainer.getByRole('link', { name: /设置|Settings/ })
  ).toHaveCount(0);
});

test('workspace hides team actions in Advanced menu, fixes SplitView ARIA/resize, and restores collapsed sidebar icons and DOM order', async ({
  page,
}) => {
  const workspace = readSeedState().baseWorkspace;
  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}`
  );

  // Topbar progressive disclosure: Start Agent / Publish Task live in the Advanced dropdown
  const advancedActionsTrigger = page.getByTestId(
    'workspace-advanced-actions-trigger'
  );
  await expect(advancedActionsTrigger).toBeVisible();
  await expect(page.getByTestId('workspace-start-agent')).toHaveCount(0);
  await expect(page.getByTestId('workspace-publish-task')).toHaveCount(0);

  await advancedActionsTrigger.click();
  await expect(page.getByTestId('workspace-start-agent')).toBeVisible();
  await expect(page.getByTestId('workspace-publish-task')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('workspace-start-agent')).toHaveCount(0);

  // SplitView separator has valid ARIA range [20, 80] covering defaultRatio=68 and resizes smoothly
  const separator = page.getByRole('separator', { name: 'Resize panels' });
  await expect(separator).toBeVisible();
  await expect(separator).toHaveAttribute('aria-valuemin', '20');
  await expect(separator).toHaveAttribute('aria-valuemax', '80');
  await expect(separator).toHaveAttribute('aria-valuenow', '68');

  await separator.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', '66');
  await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '68');
  await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '70');

  // Expanded workspace sidebar sections are ordered naturally in DOM = visual order without CSS order-*
  const sectionOrderCheck = await page.evaluate(() => {
    const testIds = [
      'sidebar-node-search-section',
      'sidebar-project-tree-section',
      'sidebar-outline-section',
      'sidebar-linked-projects-section',
      'sidebar-support-section',
      'sidebar-projects-section',
    ];
    const elements = testIds
      .map((id) => ({
        el: document.querySelector<HTMLElement>(`[data-testid="${id}"]`),
        id,
      }))
      .filter(
        (entry): entry is { el: HTMLElement; id: string } => entry.el !== null
      );

    const domOrder = Array.from(
      document.querySelectorAll<HTMLElement>(
        testIds.map((id) => `[data-testid="${id}"]`).join(',')
      )
    ).map((el) => el.dataset.testid);

    const tops = elements.map(({ el }) => el.getBoundingClientRect().top);
    const cssOrders = elements.map(({ el }) => getComputedStyle(el).order);
    const isStrictlyTopToBottom = tops.every(
      (top, index) => index === 0 || top >= tops[index - 1]
    );

    return {
      cssOrders,
      domOrder,
      expectedOrder: testIds,
      isStrictlyTopToBottom,
    };
  });

  expect(sectionOrderCheck.domOrder).toEqual(sectionOrderCheck.expectedOrder);
  expect(sectionOrderCheck.isStrictlyTopToBottom).toBe(true);
  expect(sectionOrderCheck.cssOrders.every((order) => order === '0')).toBe(
    true
  );

  // Collapsed workspace sidebar quick-action icons expand the sidebar and focus search
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByTestId('sidebar-collapsed-search')).toBeVisible();
  await expect(page.getByTestId('sidebar-collapsed-tree')).toBeVisible();
  await expect(page.getByTestId('sidebar-collapsed-outline')).toBeVisible();
  await expect(page.getByTestId('sidebar-collapsed-projects')).toBeVisible();

  const collapsedAxe = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .analyze();
  expect(collapsedAxe.violations).toEqual([]);

  await page.getByTestId('sidebar-collapsed-search').click();
  await expect(page.getByTestId('sidebar-node-search-section')).toBeVisible();
  const searchInput = page
    .getByTestId('sidebar-node-search-section')
    .locator('input');
  await expect(searchInput).toBeFocused();

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await page.getByTestId('sidebar-collapsed-outline').click();
  await expect(page.getByTestId('sidebar-outline-section')).toBeVisible();

  const expandedAxe = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .analyze();
  expect(expandedAxe.violations).toEqual([]);
});
