import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { apiRequest, primeClientState } from './helpers';

test('web preview bridge supports selection comments and review refocus', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const setup = await createWebPreviewWorkspace(baseURL);

  await primeClientState(page);
  await page.goto(
    `/workspace/${setup.workspace.id}?conversationId=${setup.conversation.id}`
  );

  const previewFrame = await startPreviewAndGetFrame(page);
  expect(previewFrame).toBeTruthy();

  await selectPreviewCopy(page);

  const selectionCommentButton = page.getByTestId('web-selection-comment-trigger');
  await expect(selectionCommentButton).toBeVisible();
  await submitPreviewSelectionComment(page, '请把这里改得更醒目。');

  await expect
    .poll(async () => {
      const threads = await apiRequest<
        Array<{
          fileId?: string | null;
          id: string;
          reviewAnchor?: {
            anchorPayload?: { cssSelector?: string | null };
            surfaceType?: string;
          } | null;
        }>
      >(baseURL, `/api/threads?workspaceId=${setup.workspace.id}&draftOnly=1`);
      return threads.length;
    })
    .toBeGreaterThan(0);

  const createdThreads = await apiRequest<
    Array<{
      fileId?: string | null;
      id: string;
      reviewAnchor?: {
        anchorPayload?: { cssSelector?: string | null };
        surfaceType?: string;
      } | null;
    }>
  >(baseURL, `/api/threads?workspaceId=${setup.workspace.id}&draftOnly=1`);
  const createdThread = createdThreads[0];

  expect(createdThread?.id).toBeTruthy();
  expect(createdThread?.fileId).toBe(setup.indexFileId);
  expect(createdThread?.reviewAnchor?.surfaceType).toBe('web-component');
  expect(createdThread?.reviewAnchor?.anchorPayload?.cssSelector).toBe('#hero-copy');

  await openReviewTab(page, createdThread.id);
  const thread = await revealThreadInReview(page, createdThread.id);
  await expect(thread).toBeVisible();
  await thread.getByRole('button').first().click();

  await expect
    .poll(() =>
      previewFrame!.evaluate(
        () =>
          document.querySelector('[data-chengxing-preview-highlight="true"]')?.id || null
      )
    )
    .toBe('hero-copy');

  await apiRequest<{ id: string }>(baseURL, `/api/workspaces/${setup.workspace.id}/versions`, {
    body: {
      title: 'Web Preview Bridge Baseline',
    },
    method: 'POST',
  });

  await apiRequest(baseURL, `/api/workspaces/${setup.workspace.id}/files/${setup.indexFileId}`, {
    body: {
      content: [
        '<!doctype html>',
        '<html lang="zh-CN">',
        '  <head>',
        '    <meta charset="UTF-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        '    <title>Preview Bridge</title>',
        '    <style>',
        '      body { font-family: sans-serif; margin: 0; padding: 32px; }',
        '      main { max-width: 640px; }',
        '      h1 { margin-bottom: 12px; }',
        '    </style>',
        '  </head>',
        '  <body>',
        '    <main>',
        '      <h1 id="hero-title">市场机会</h1>',
        '      <p id="hero-copy">这是更新后的 bridge 预览评论验收。</p>',
        '    </main>',
        '  </body>',
        '</html>',
      ].join('\n'),
      kind: 'code',
      language: 'html',
    },
    method: 'PATCH',
  });

  await apiRequest(baseURL, `/api/workspaces/${setup.workspace.id}/preview/start`, {
    method: 'POST',
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openReviewTab(page, createdThread.id);
  const refreshedThread = await revealThreadInReview(page, createdThread.id);
  const refreshedPreviewFrame = await waitForPreviewBridgeFrame(page);

  await expect
    .poll(async () => {
      const threads = await apiRequest<
        Array<{
          id: string;
          inheritanceState?: string | null;
          scope?: string | null;
        }>
      >(baseURL, `/api/threads?workspaceId=${setup.workspace.id}&draftOnly=1`);
      const threadState = threads.find((item) => item.id === createdThread.id) || null;
      return threadState
        ? {
            inheritanceState: threadState.inheritanceState || null,
            scope: threadState.scope || null,
          }
        : null;
    })
    .toEqual({
      inheritanceState: 'actionable',
      scope: 'inherited',
    });

  await refreshedThread.getByRole('button').first().click();
  await expect
    .poll(() =>
      refreshedPreviewFrame!.evaluate(
        () =>
          document.querySelector('[data-chengxing-preview-highlight="true"]')?.id || null
      )
    )
    .toBe('hero-copy');
});

test('web-component @assistant replies use the revision path and refresh preview output', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const setup = await createWebPreviewWorkspace(baseURL);

  await primeClientState(page);
  await page.goto(
    `/workspace/${setup.workspace.id}?conversationId=${setup.conversation.id}`
  );

  const previewFrame = await startPreviewAndGetFrame(page);
  expect(previewFrame).toBeTruthy();

  await selectPreviewCopy(page);
  await submitPreviewSelectionComment(page, '@assistant 请直接改这里的网页实现并刷新预览。');

  await expect
    .poll(async () => {
      const threads = await apiRequest<
        Array<{
          id: string;
          messages: Array<{ content: string; role: string }>;
        }>
      >(baseURL, `/api/threads?workspaceId=${setup.workspace.id}&draftOnly=1`);

      const thread = threads[0];
      const latestAssistantMessage = [...(thread?.messages || [])]
        .reverse()
        .find((message) => message.role === 'assistant');

      return latestAssistantMessage?.content || null;
    })
    .toContain('已按评论更新');

  await expect
    .poll(async () => {
      const files = await apiRequest<
        Array<{ content: string; id: string; path: string }>
      >(baseURL, `/api/workspaces/${setup.workspace.id}/files`);
      return files.find((file) => file.id === setup.indexFileId)?.content || '';
    })
    .toContain('（已按评论更新）');

  await page.reload({ waitUntil: 'domcontentloaded' });
  const refreshedPreviewFrame = await waitForPreviewBridgeFrame(page);

  await expect
    .poll(() =>
      refreshedPreviewFrame!.evaluate(
        () => document.querySelector('#hero-copy')?.textContent || null
      )
    )
    .toBe('这是 bridge 预览评论验收。（已按评论更新）');
});

test('web inherited threads become superseded after a new direct comment lands on the relocated element', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const setup = await createWebPreviewWorkspace(baseURL);

  await primeClientState(page);
  await page.goto(
    `/workspace/${setup.workspace.id}?conversationId=${setup.conversation.id}`
  );

  const previewFrame = await startPreviewAndGetFrame(page);
  expect(previewFrame).toBeTruthy();

  await selectPreviewCopy(page);
  await submitPreviewSelectionComment(page, '请保留这条旧评论作为迁移基线。');

  await expect
    .poll(async () => {
      const threads = await apiRequest<Array<{ id: string }>>(
        baseURL,
        `/api/threads?workspaceId=${setup.workspace.id}&draftOnly=1`
      );
      return threads.length;
    })
    .toBeGreaterThan(0);

  const [firstThread] = await apiRequest<Array<{ id: string; scope?: string | null }>>(
    baseURL,
    `/api/threads?workspaceId=${setup.workspace.id}&draftOnly=1`
  );

  await apiRequest<{ id: string }>(baseURL, `/api/workspaces/${setup.workspace.id}/versions`, {
    body: {
      title: 'Relocation Baseline',
    },
    method: 'POST',
  });

  await apiRequest(baseURL, `/api/workspaces/${setup.workspace.id}/files/${setup.indexFileId}`, {
    body: {
      content: [
        '<!doctype html>',
        '<html lang="zh-CN">',
        '  <head>',
        '    <meta charset="UTF-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        '    <title>Preview Bridge</title>',
        '    <style>',
        '      body { font-family: sans-serif; margin: 0; padding: 32px; }',
        '      main { max-width: 640px; }',
        '      h1 { margin-bottom: 12px; }',
        '    </style>',
        '  </head>',
        '  <body>',
        '    <main>',
        '      <h1 id="hero-title">市场机会</h1>',
        '      <p id="hero-summary">这是 bridge 预览评论验收。</p>',
        '    </main>',
        '  </body>',
        '</html>',
      ].join('\n'),
      kind: 'code',
      language: 'html',
    },
    method: 'PATCH',
  });

  await apiRequest(baseURL, `/api/workspaces/${setup.workspace.id}/preview/start`, {
    method: 'POST',
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  const relocatedPreviewFrame = await waitForPreviewBridgeFrame(page);
  await selectPreviewCopy(page, '#hero-summary');
  await submitPreviewSelectionComment(page, '这是新位置上的直接评论。');

  await expect
    .poll(async () => {
      const threads = await apiRequest<
        Array<{
          id: string;
          inheritanceState?: string | null;
          scope?: string | null;
        }>
      >(baseURL, `/api/threads?workspaceId=${setup.workspace.id}&draftOnly=1`);
      const oldThread = threads.find((thread) => thread.id === firstThread.id) || null;
      const directThreads = threads.filter((thread) => thread.scope === 'direct');
      return {
        directCount: directThreads.length,
        oldState: oldThread?.inheritanceState || null,
        oldScope: oldThread?.scope || null,
      };
    })
    .toEqual({
      directCount: 1,
      oldScope: 'inherited',
      oldState: 'superseded',
    });

  await openReviewTab(page, firstThread.id);
  await expect(page.locator(`[data-testid="comment-thread-${firstThread.id}"]:visible`)).toHaveCount(
    0
  );
  await page.getByRole('button', { name: /更早上下文|Earlier Context/ }).click();
  await expect(page.locator(`[data-testid="comment-thread-${firstThread.id}"]:visible`)).toBeVisible();
});

test('web inherited threads become stale once selector, excerpt, and dom context all drift', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const setup = await createWebPreviewWorkspace(baseURL);

  await primeClientState(page);
  await page.goto(
    `/workspace/${setup.workspace.id}?conversationId=${setup.conversation.id}`
  );

  const previewFrame = await startPreviewAndGetFrame(page);
  expect(previewFrame).toBeTruthy();

  await selectPreviewCopy(page);
  await submitPreviewSelectionComment(page, '这条评论应该在目标彻底漂移后失效。');

  await expect
    .poll(async () => {
      const threads = await apiRequest<Array<{ id: string }>>(
        baseURL,
        `/api/threads?workspaceId=${setup.workspace.id}&draftOnly=1`
      );
      return threads.length;
    })
    .toBeGreaterThan(0);

  const [firstThread] = await apiRequest<Array<{ id: string }>>(
    baseURL,
    `/api/threads?workspaceId=${setup.workspace.id}&draftOnly=1`
  );

  await apiRequest<{ id: string }>(baseURL, `/api/workspaces/${setup.workspace.id}/versions`, {
    body: {
      title: 'Stale Boundary Baseline',
    },
    method: 'POST',
  });

  await apiRequest(baseURL, `/api/workspaces/${setup.workspace.id}/files/${setup.indexFileId}`, {
    body: {
      content: [
        '<!doctype html>',
        '<html lang="zh-CN">',
        '  <head>',
        '    <meta charset="UTF-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        '    <title>Preview Bridge</title>',
        '    <style>',
        '      body { font-family: sans-serif; margin: 0; padding: 32px; }',
        '      main { max-width: 640px; }',
        '      h1 { margin-bottom: 12px; }',
        '    </style>',
        '  </head>',
        '  <body>',
        '    <main>',
        '      <h1 id="hero-title">全新定位</h1>',
        '      <p id="value-summary">现在展示的是完全不同的内容。</p>',
        '    </main>',
        '  </body>',
        '</html>',
      ].join('\n'),
      kind: 'code',
      language: 'html',
    },
    method: 'PATCH',
  });

  await apiRequest(baseURL, `/api/workspaces/${setup.workspace.id}/preview/start`, {
    method: 'POST',
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForPreviewBridgeFrame(page);

  await expect
    .poll(async () => {
      const threads = await apiRequest<
        Array<{
          id: string;
          inheritanceState?: string | null;
          scope?: string | null;
        }>
      >(baseURL, `/api/threads?workspaceId=${setup.workspace.id}&draftOnly=1`);
      const oldThread = threads.find((thread) => thread.id === firstThread.id) || null;
      return {
        oldScope: oldThread?.scope || null,
        oldState: oldThread?.inheritanceState || null,
      };
    })
    .toEqual({
      oldScope: 'inherited',
      oldState: 'stale',
    });

  await openReviewTab(page, firstThread.id);
  await expect(page.locator(`[data-testid="comment-thread-${firstThread.id}"]:visible`)).toHaveCount(
    0
  );
  await page.getByRole('button', { name: /更早上下文|Earlier Context/ }).click();
  await expect(page.locator(`[data-testid="comment-thread-${firstThread.id}"]:visible`)).toBeVisible();
});

async function waitForPreviewBridgeFrame(page: Page, timeout = 20_000) {
  await expect
    .poll(() => page.frames().some((frame) => /preview\/bridge/.test(frame.url())), { timeout })
    .toBe(true);
  return page.frames().find((frame) => /preview\/bridge/.test(frame.url())) || null;
}

async function dismissVisibleFirstUseGuidance(page: Page) {
  let clearChecks = 0;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const visibleGuide = page.locator('[data-testid^="first-use-guide-"]:visible').first();

    if (!(await visibleGuide.isVisible().catch(() => false))) {
      clearChecks += 1;
      if (clearChecks >= 2) {
        return;
      }
      await page.waitForTimeout(120);
      continue;
    }

    clearChecks = 0;
    const guideTestId = await visibleGuide.getAttribute('data-testid');
    expect(guideTestId).not.toBeNull();

    const guide = page.getByTestId(guideTestId!);
    await guide.getByRole('button', { name: /知道了|Got It/ }).click();
    await expect(guide).toHaveCount(0);
  }
}

async function openReviewTab(page: Page, threadId?: string) {
  await expect(async () => {
    await dismissVisibleFirstUseGuidance(page);

    const reviewTab = page.getByTestId('assistant-tab-review');
    await expect(reviewTab).toBeVisible();
    await expect(reviewTab).toBeEnabled();

    if (threadId) {
      await page.evaluate((focusedThreadId) => {
        window.dispatchEvent(
          new CustomEvent('comment-thread-focus', {
            detail: { threadId: focusedThreadId },
          })
        );
      }, threadId);
    } else {
      await reviewTab.click({ force: true });
    }

    await expect(reviewTab).toHaveAttribute('aria-selected', 'true');
  }).toPass({ timeout: 15_000 });

  await dismissVisibleFirstUseGuidance(page);
}

async function revealThreadInReview(page: Page, threadId: string) {
  await openReviewTab(page, threadId);

  const thread = page.getByTestId(`comment-thread-${threadId}`);
  await expect.poll(() => thread.count()).toBeGreaterThan(0);

  const visibleThread = page.locator(`[data-testid="comment-thread-${threadId}"]:visible`);
  if (await visibleThread.isVisible().catch(() => false)) {
    return visibleThread;
  }

  const earlierContextButton = page.getByRole('button', {
    name: /更早上下文|Earlier Context/,
  });
  if (await earlierContextButton.isVisible().catch(() => false)) {
    await earlierContextButton.click();
  }

  await expect(visibleThread).toBeVisible({ timeout: 10_000 });
  return visibleThread;
}

async function startPreviewAndGetFrame(page: Page) {
  const startPreviewButton = page
    .getByRole('button', { name: /启动预览|Start Preview/ })
    .first();
  if (await startPreviewButton.isVisible().catch(() => false)) {
    await startPreviewButton.click();
    await page.reload({ waitUntil: 'domcontentloaded' });
  }

  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => {
      try {
        return await page.locator('iframe').first().getAttribute('src');
      } catch {
        return null;
      }
    }, { timeout: 20_000 })
    .toMatch(/preview\/bridge/);
  return waitForPreviewBridgeFrame(page, 20_000);
}

async function selectPreviewCopy(page: Page, selector = '#hero-copy') {
  await expect
    .poll(async () => {
      const frame = await waitForPreviewBridgeFrame(page);
      if (!frame) {
        return false;
      }

      try {
        return await frame.evaluate(
          (targetSelector) => Boolean(document.querySelector(targetSelector)),
          selector
        );
      } catch {
        return false;
      }
    }, { timeout: 20_000 })
    .toBe(true);

  const frame = await waitForPreviewBridgeFrame(page);
  if (!frame) {
    throw new Error('Preview bridge frame is unavailable.');
  }

  await frame.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    if (!target) {
      throw new Error('Missing preview copy node.');
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, selector);
}

async function submitPreviewSelectionComment(page: Page, content: string) {
  const selectionCommentButton = page.getByTestId('web-selection-comment-trigger');
  const composer = page.getByTestId('web-selection-comment-composer');

  await expect(selectionCommentButton).toBeVisible();
  await selectionCommentButton.click();
  await expect(composer).toBeVisible();
  await composer.locator('textarea').fill(content);
  await composer.getByRole('button', { name: /评论|Comment/ }).click();
}

async function createWebPreviewWorkspace(baseURL: string) {
  const suffix = Date.now();
  const created = await apiRequest<{
    conversation: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      deliverableType: 'web',
      goal: '验证同源 bridge 预览里可以直接创建评论并从评审聚焦回页面。',
      title: `Web Preview Bridge ${suffix}`,
    },
    method: 'POST',
  });

  const files = await apiRequest<
    Array<{ id: string; path: string }>
  >(baseURL, `/api/workspaces/${created.workspace.id}/files`);
  const indexFile = files.find((file) => file.path === 'index.html');
  expect(indexFile?.id).toBeTruthy();

  await apiRequest(baseURL, `/api/workspaces/${created.workspace.id}/files/${indexFile!.id}`, {
    body: {
      content: [
        '<!doctype html>',
        '<html lang="zh-CN">',
        '  <head>',
        '    <meta charset="UTF-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        '    <title>Preview Bridge</title>',
        '    <style>',
        '      body { font-family: sans-serif; margin: 0; padding: 32px; }',
        '      main { max-width: 640px; }',
        '      h1 { margin-bottom: 12px; }',
        '    </style>',
        '  </head>',
        '  <body>',
        '    <main>',
        '      <h1 id="hero-title">市场机会</h1>',
        '      <p id="hero-copy">这是 bridge 预览评论验收。</p>',
        '    </main>',
        '  </body>',
        '</html>',
      ].join('\n'),
      kind: 'code',
      language: 'html',
    },
    method: 'PATCH',
  });

  return {
    conversation: created.conversation,
    indexFileId: indexFile!.id,
    workspace: created.workspace,
  };
}
