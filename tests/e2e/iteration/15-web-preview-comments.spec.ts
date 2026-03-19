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

  await selectPreviewCopy(previewFrame!);

  const selectionCommentButton = page.getByTestId('web-selection-comment-trigger');
  await expect(selectionCommentButton).toBeVisible();
  await selectionCommentButton.click();
  await expect(page.getByTestId('web-selection-comment-composer')).toBeVisible();
  await page.getByPlaceholder('让 AI 调整这里的页面表现……').fill('请把这里改得更醒目。');
  await page.getByRole('button', { name: '提交评论' }).click();

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

  await page.getByRole('tab', { name: /评审|Review/ }).click();
  const thread = page.getByTestId(`comment-thread-${createdThread.id}`);
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
  await page.reload();
  await page.getByRole('tab', { name: /评审|Review/ }).click();
  const refreshedThread = page.getByTestId(`comment-thread-${createdThread.id}`);
  await expect(refreshedThread).toBeVisible();
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

  await selectPreviewCopy(previewFrame!);

  await page.getByTestId('web-selection-comment-trigger').click();
  await expect(page.getByTestId('web-selection-comment-composer')).toBeVisible();
  await page
    .getByPlaceholder('让 AI 调整这里的页面表现……')
    .fill('@assistant 请直接改这里的网页实现并刷新预览。');
  await page.getByRole('button', { name: '提交评论' }).click();

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

  await page.reload();
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

  await selectPreviewCopy(previewFrame!);
  await page.getByTestId('web-selection-comment-trigger').click();
  await page.getByPlaceholder('让 AI 调整这里的页面表现……').fill('请保留这条旧评论作为迁移基线。');
  await page.getByRole('button', { name: '提交评论' }).click();

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

  await page.reload();
  const relocatedPreviewFrame = await waitForPreviewBridgeFrame(page);
  await selectPreviewCopy(relocatedPreviewFrame!, '#hero-summary');
  await page.getByTestId('web-selection-comment-trigger').click();
  await page.getByPlaceholder('让 AI 调整这里的页面表现……').fill('这是新位置上的直接评论。');
  await page.getByRole('button', { name: '提交评论' }).click();

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

  await page.getByRole('tab', { name: /评审|Review/ }).click();
  await expect(page.getByTestId(`comment-thread-${firstThread.id}`)).toHaveCount(0);
  await page.getByRole('button', { name: /更早上下文|Earlier Context/ }).click();
  await expect(page.getByTestId(`comment-thread-${firstThread.id}`)).toBeVisible();
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

  await selectPreviewCopy(previewFrame!);
  await page.getByTestId('web-selection-comment-trigger').click();
  await page.getByPlaceholder('让 AI 调整这里的页面表现……').fill('这条评论应该在目标彻底漂移后失效。');
  await page.getByRole('button', { name: '提交评论' }).click();

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

  await page.reload();
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

  await page.getByRole('tab', { name: /评审|Review/ }).click();
  await expect(page.getByTestId(`comment-thread-${firstThread.id}`)).toHaveCount(0);
  await page.getByRole('button', { name: /更早上下文|Earlier Context/ }).click();
  await expect(page.getByTestId(`comment-thread-${firstThread.id}`)).toBeVisible();
});

async function waitForPreviewBridgeFrame(page: Page) {
  await expect
    .poll(() => page.frames().some((frame) => /preview\/bridge/.test(frame.url())))
    .toBe(true);
  return page.frames().find((frame) => /preview\/bridge/.test(frame.url())) || null;
}

async function startPreviewAndGetFrame(page: Page) {
  await page.getByRole('button', { name: /启动预览|Start Preview/ }).click();
  await page.reload();
  await expect
    .poll(async () => {
      try {
        return await page.locator('iframe').first().getAttribute('src');
      } catch {
        return null;
      }
    })
    .toMatch(/preview\/bridge/);
  return waitForPreviewBridgeFrame(page);
}

async function selectPreviewCopy(
  frame: NonNullable<Awaited<ReturnType<typeof waitForPreviewBridgeFrame>>>,
  selector = '#hero-copy'
) {
  await expect
    .poll(() =>
      frame.evaluate((targetSelector) => Boolean(document.querySelector(targetSelector)), selector)
    )
    .toBe(true);

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
