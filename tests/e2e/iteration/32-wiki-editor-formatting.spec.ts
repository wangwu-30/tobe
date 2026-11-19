import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { markdownToPlate } from '@/lib/ai/serializer';
import { apiRequest, primeClientState, readSeedState } from './helpers';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('Wiki editor renders Markdown lists, code blocks, quotes, links, and --brand token cleanly', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const markdown = [
    '# Architecture Notes',
    '',
    'Reference [Plate Docs](https://platejs.org) for **rich** `inline` formatting.',
    '',
    '- Unordered item alpha',
    '- Unordered item beta',
    '',
    '1. Ordered step one',
    '2. Ordered step two',
    '',
    '> Key architectural invariant',
    '',
    '```ts',
    'const answer = 42;',
    '```',
  ].join('\n');

  const payload = await apiRequest<{
    conversation: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      content: JSON.stringify(markdownToPlate(markdown)),
      deliverableType: 'document',
      goal: 'Verify rich Markdown rendering in Plate Wiki editor.',
      title: `Rich Wiki Formatting ${suffix}`,
    },
    method: 'POST',
  });

  await primeClientState(page);
  await page.goto(
    `/workspace/${payload.workspace.id}?conversationId=${payload.conversation.id}`
  );

  const surface = page.locator('[data-workspace-outline-surface="true"]');
  await expect(surface.getByTestId('wiki-editor-toolbar')).toBeVisible();
  await expect(surface.locator('h1', { hasText: 'Architecture Notes' })).toBeVisible();
  await expect(surface.locator('ul li', { hasText: 'Unordered item alpha' })).toBeVisible();
  await expect(surface.locator('ol li', { hasText: 'Ordered step one' })).toBeVisible();
  await expect(surface.locator('ol li', { hasText: 'Ordered step two' })).toBeVisible();
  await expect(
    surface.locator('blockquote', { hasText: 'Key architectural invariant' })
  ).toBeVisible();
  await expect(surface.locator('pre code', { hasText: 'const answer = 42;' })).toBeVisible();
  await expect(
    surface.getByRole('button', { name: 'Code language' })
  ).toContainText('TypeScript');

  const link = surface.locator('a[href^="https://platejs.org"]', {
    hasText: 'Plate Docs',
  });
  await expect(link).toBeVisible();

  const brandToken = await page.evaluate(() => ({
    brand: getComputedStyle(document.documentElement)
      .getPropertyValue('--brand')
      .trim(),
    colorBrand: getComputedStyle(document.documentElement)
      .getPropertyValue('--color-brand')
      .trim(),
  }));
  expect(brandToken.brand.length).toBeGreaterThan(0);
  expect(brandToken.colorBrand.length).toBeGreaterThan(0);

  const axeResult = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(axeResult.violations).toEqual([]);
});

test('Wiki editor renders legacy ul/ol/li Plate JSON with semantic list styles', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const legacyContent = [
    {
      type: 'ul',
      children: [
        { type: 'li', children: [{ type: 'p', children: [{ text: 'Legacy bullet item' }] }] },
      ],
    },
    {
      type: 'ol',
      children: [
        { type: 'li', children: [{ type: 'p', children: [{ text: 'Legacy ordered item' }] }] },
      ],
    },
  ];

  const payload = await apiRequest<{
    conversation: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      content: JSON.stringify(legacyContent),
      deliverableType: 'document',
      goal: 'Verify legacy ul/ol/li Plate nodes still render semantically.',
      title: `Legacy List Rendering ${suffix}`,
    },
    method: 'POST',
  });

  await primeClientState(page);
  await page.goto(
    `/workspace/${payload.workspace.id}?conversationId=${payload.conversation.id}`
  );

  const surface = page.locator('[data-workspace-outline-surface="true"]');
  const legacyBullet = surface.locator('ul > li', { hasText: 'Legacy bullet item' });
  const legacyOrdered = surface.locator('ol > li', { hasText: 'Legacy ordered item' });

  await expect(legacyBullet).toBeVisible();
  await expect(legacyOrdered).toBeVisible();

  const listStyles = await surface.evaluate((el) => {
    const ul = el.querySelector('ul');
    const ol = el.querySelector('ol');
    return {
      ol: ol ? getComputedStyle(ol).listStyleType : '',
      ul: ul ? getComputedStyle(ul).listStyleType : '',
    };
  });
  expect(listStyles.ul).toBe('disc');
  expect(listStyles.ol).toBe('decimal');
});

test('Wiki editor supports Markdown shortcuts, toolbar formatting, undo/redo, and hides toolbar when read-only', async ({
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
        { type: 'p', children: [{ text: 'Draft starter line' }] },
      ]),
      deliverableType: 'document',
      goal: 'Verify interactive Markdown shortcuts and toolbar controls.',
      title: `Interactive Wiki Editor ${suffix}`,
    },
    method: 'POST',
  });

  await primeClientState(page);
  await page.goto(
    `/workspace/${payload.workspace.id}?conversationId=${payload.conversation.id}`
  );

  const surface = page.locator('[data-workspace-outline-surface="true"]');
  const editor = surface.locator('[data-slate-editor="true"]');
  await expect(editor).toBeVisible();
  await expect(surface.getByTestId('wiki-editor-toolbar')).toBeVisible();

  await editor.getByText('Draft starter line').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('## Quick Heading');
  await expect(surface.locator('h2', { hasText: 'Quick Heading' })).toBeVisible();

  await page.keyboard.press('Enter');
  await page.keyboard.type('- First task');
  await expect(surface.locator('ul li', { hasText: 'First task' })).toBeVisible();

  const undoButton = surface.getByTestId('editor-toolbar-undo');
  const redoButton = surface.getByTestId('editor-toolbar-redo');
  await expect(undoButton).toBeEnabled();
  await undoButton.click();
  await expect(redoButton).toBeEnabled();
  await redoButton.click();
  await expect(surface.locator('ul li', { hasText: 'First task' })).toBeVisible();

  // Verify Link popover inserts a real hyperlink
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await surface.getByTestId('editor-toolbar-link').click();
  await page.getByTestId('editor-link-url-input').fill('example.com/wiki-guide');
  await page.getByTestId('editor-link-apply').click();
  await expect(
    surface.locator('a[href^="https://example.com/wiki-guide"]')
  ).toBeVisible();

  // Verify read-only historical version hides the editing toolbar
  const versionWorkspace = readSeedState().branchVersionWorkspace;
  if (versionWorkspace.versionId) {
    await page.goto(
      `/workspace/${versionWorkspace.id}?conversationId=${versionWorkspace.conversationId}&versionId=${versionWorkspace.versionId}`
    );
    await expect(
      page.locator('[data-workspace-outline-surface="true"]')
    ).toBeVisible();
    await expect(page.getByTestId('wiki-editor-toolbar')).toHaveCount(0);
  }
});
