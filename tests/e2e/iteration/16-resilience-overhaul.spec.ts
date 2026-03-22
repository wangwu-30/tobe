import { createClient } from '@libsql/client';
import { expect, test, type Frame, type Page } from '@playwright/test';

import {
  apiCall,
  createPollController,
  safeJsonParse,
} from '@/framework/resilience';
import { stringifyAssistantRunPayload } from '@/lib/workspace/assistant-run-payload';
import { apiRequest, primeClientState } from './helpers';

test('resilience A1: a crashing zone degrades locally and can recover without hiding its sibling', async ({
  page,
}) => {
  await page.goto('/debug/resilience');

  await expect(page.getByTestId('resilience-healthy-zone')).toBeVisible();
  await expect(page.getByTestId('resilience-fallback-zone')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('resilience-recovered-zone')).toBeVisible();
  await expect(page.getByTestId('resilience-fallback-zone')).toHaveCount(0);
  await expect(page.getByTestId('resilience-healthy-zone')).toBeVisible();
});

test('resilience A2: uncaught route errors always return JSON instead of HTML', async ({
  request,
}) => {
  const response = await request.get('/api/debug/resilience?mode=throw');
  const body = await response.text();
  const payload = JSON.parse(body) as {
    detail?: string | null;
    error?: string;
    kind?: string;
  };

  expect(response.status()).toBe(500);
  expect(response.headers()['content-type']).toContain('application/json');
  expect(body).not.toContain('<!DOCTYPE html>');
  expect(payload.error).toBe('Resilience debug route exploded.');
  expect(typeof payload.detail).toBe('string');
  expect(payload.kind).toBe('unexpected');
});

test('resilience A3: apiCall reports non-JSON error bodies as parse failures', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('<html><body>Bad Gateway</body></html>', {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
      status: 502,
      statusText: 'Bad Gateway',
    })) as typeof fetch;

  try {
    const result = await apiCall<{ ok: true }>('https://example.test/api');
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected apiCall to return an error result.');
    }
    expect(result.error.kind).toBe('parse');
    expect(result.error.message).toBe('The response could not be parsed.');
    expect(result.error.status).toBe(502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resilience A4: apiCall reports network failures without throwing', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;

  try {
    const result = await apiCall<{ ok: true }>('https://example.test/api');
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected apiCall to return an error result.');
    }
    expect(result.error.kind).toBe('network');
    expect(result.error.retryable).toBe(true);
    expect(result.error.status).toBe(503);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resilience A5: poll controller backs off after repeated failures', async () => {
  const scheduled = new Map<number, () => void>();
  let nextTimeoutId = 1;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let attempts = 0;

  globalThis.setTimeout = (((callback: TimerHandler) => {
    const timeoutId = nextTimeoutId;
    nextTimeoutId += 1;
    scheduled.set(timeoutId, callback as () => void);
    return timeoutId as unknown as ReturnType<typeof globalThis.setTimeout>;
  }) as unknown as typeof globalThis.setTimeout);
  globalThis.clearTimeout = (((timeoutId: ReturnType<typeof globalThis.setTimeout>) => {
    scheduled.delete(Number(timeoutId));
  }) as unknown as typeof globalThis.clearTimeout);

  try {
    const controller = createPollController({
      baseInterval: 3_000,
      fn: () => {
        attempts += 1;
        throw new Error(`failure-${attempts}`);
      },
      maxInterval: 60_000,
    });

    controller.start();

    const expectedIntervals = [6_000, 12_000, 24_000, 48_000, 48_000];
    for (const expectedInterval of expectedIntervals) {
      await Promise.resolve();
      expect(controller.getCurrentInterval()).toBe(expectedInterval);
      const [nextTask] = scheduled.entries();
      expect(nextTask).toBeTruthy();
      if (nextTask) {
        scheduled.delete(nextTask[0]);
        nextTask[1]();
      }
    }
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('resilience A6: safeJsonParse falls back on invalid JSON', () => {
  expect(safeJsonParse('{"broken"', { ok: false })).toEqual({ ok: false });
});

test('resilience A7: web deliverables with live content auto-start preview', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const setup = await createWebPreviewWorkspace(baseURL, 'Auto Start Preview');

  await primeClientState(page);
  await page.goto(
    `/workspace/${setup.workspace.id}?conversationId=${setup.conversation.id}`
  );

  await expect
    .poll(async () => {
      try {
        return await page.locator('iframe').first().getAttribute('src');
      } catch {
        return null;
      }
    }, {
      timeout: 20_000,
    })
    .toMatch(/preview\/bridge/);
  await expect(page.getByTestId('web-deliverable-canvas')).toBeVisible();
});

test('resilience A8: implementing workspaces still expose manual comment fallback', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const setup = await createWebPreviewWorkspace(baseURL, 'Implementing Manual Fallback');
  await insertRunningAssistantRun(setup.workspace.id, setup.conversation.id);

  await primeClientState(page);
  await page.goto(
    `/workspace/${setup.workspace.id}?conversationId=${setup.conversation.id}`
  );

  const manualCommentButton = page
    .getByTestId('web-deliverable-canvas')
    .getByRole('button', { name: '新建评论' })
    .first();
  await expect(manualCommentButton).toBeVisible();
  await manualCommentButton.click();

  await expect(page.getByTestId('assistant-tab-review')).toHaveAttribute('data-state', 'active');
  const manualComposer = page.getByTestId('manual-comment-composer');
  await expect(manualComposer).toBeVisible();
  await expect(manualComposer.getByText('通用评论')).toBeVisible();
  await manualComposer.getByLabel('范围').fill('实现中的页面草稿');
  await manualComposer
    .getByPlaceholder('告诉 AI 这次需要重点看什么……')
    .fill('即使 AI 正在实现，也要允许我先记一条通用评论。');
  await manualComposer.getByRole('button', { name: '创建评论' }).click();

  await expect
    .poll(async () => {
      const threads = await apiRequest<Array<{ anchorText: string; id: string }>>(
        baseURL,
        `/api/threads?workspaceId=${setup.workspace.id}&draftOnly=1`
      );
      return threads.some((thread) => thread.anchorText === '实现中的页面草稿');
    })
    .toBe(true);
});

test('resilience A9: comment UI switches fully to English after changing the app language', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const setup = await createWebPreviewWorkspace(baseURL, 'English Comment UI');

  await primeClientState(page);
  await page.goto('/settings');
  const languageCard = page.getByTestId('settings-language-card');
  await languageCard.getByRole('combobox').click();
  await page.getByRole('option', { name: 'English' }).click();

  await page.goto(
    `/workspace/${setup.workspace.id}?conversationId=${setup.conversation.id}`
  );
  const previewFrame = await startPreviewAndGetFrame(page);
  expect(previewFrame).toBeTruthy();

  await selectPreviewCopy(page, '#hero-copy');
  const selectionTrigger = page.getByTestId('web-selection-comment-trigger');
  await expect(selectionTrigger).toBeVisible();
  await selectionTrigger.click();
  const selectionComposer = page.getByTestId('web-selection-comment-composer');
  await expect(selectionComposer).toBeVisible();
  await expect(
    selectionComposer.getByPlaceholder('Tell AI what you want reviewed here...')
  ).toBeVisible();
  await expect(selectionComposer.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(
    selectionComposer.getByRole('button', { name: 'Deep Research' })
  ).toBeVisible();
  await expect(
    selectionComposer.getByText(
      'Use @assistant or another role handle if you want AI to join this thread.'
    )
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '取消' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '深度研究' })).toHaveCount(0);
});

async function createWebPreviewWorkspace(baseURL: string, label: string) {
  const suffix = `${label}-${Date.now()}`;
  const created = await apiRequest<{
    conversation: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      deliverableType: 'web',
      goal: `Resilience test workspace: ${label}.`,
      title: suffix,
    },
    method: 'POST',
  });

  const files = await apiRequest<Array<{ id: string; path: string }>>(
    baseURL,
    `/api/workspaces/${created.workspace.id}/files`
  );
  const indexFile = files.find((file) => file.path === 'index.html');
  expect(indexFile?.id).toBeTruthy();

  await apiRequest(
    baseURL,
    `/api/workspaces/${created.workspace.id}/files/${indexFile!.id}`,
    {
      body: {
        content: [
          '<!doctype html>',
          '<html lang="zh-CN">',
          '  <head>',
          '    <meta charset="UTF-8" />',
          '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
          '    <title>Resilience Preview</title>',
          '    <style>',
          '      body { font-family: sans-serif; margin: 0; padding: 32px; }',
          '      main { max-width: 640px; }',
          '    </style>',
          '  </head>',
          '  <body>',
          '    <main>',
          '      <h1 id="hero-title">Resilience Preview</h1>',
          '      <p id="hero-copy">This preview should become reviewable without manual recovery.</p>',
          '    </main>',
          '  </body>',
          '</html>',
        ].join('\n'),
        kind: 'code',
        language: 'html',
      },
      method: 'PATCH',
    }
  );

  return {
    conversation: created.conversation,
    indexFileId: indexFile!.id,
    workspace: created.workspace,
  };
}

function createSeedDbClient() {
  return createClient({
    url: resolveIterationDatabaseUrl(),
  });
}

function resolveIterationDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  return 'file:.tmp/iteration-regression/app-data/dev.db';
}

async function insertRunningAssistantRun(workspaceId: string, conversationId: string) {
  const seedDb = createSeedDbClient();
  const nowIso = new Date().toISOString();

  try {
    await seedDb.execute({
      sql: `INSERT INTO "AssistantRun" (
        "id", "organizationId", "sessionId", "documentId", "mode", "title", "status",
        "summary", "payloadJson", "createdByUserId", "originDeviceId", "startedAt", "createdAt", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        `seed-running-${workspaceId}`,
        'local-org',
        conversationId,
        workspaceId,
        'run',
        'Resilience Running Draft',
        'running',
        'Testing the implementing-state manual comment fallback.',
        stringifyAssistantRunPayload({}),
        'local-user',
        'local-device',
        nowIso,
        nowIso,
        nowIso,
      ],
    });
  } finally {
    await seedDb.close();
  }
}

async function waitForPreviewBridgeFrame(page: Page) {
  await expect
    .poll(async () => {
      try {
        return await page.locator('iframe').first().getAttribute('src');
      } catch {
        return null;
      }
    }, {
      timeout: 20_000,
    })
    .toMatch(/preview\/bridge/);
  await expect
    .poll(() => page.frames().some((frame: Frame) => /preview\/bridge/.test(frame.url())), {
      timeout: 20_000,
    })
    .toBe(true);
  return page.frames().find((frame: Frame) => /preview\/bridge/.test(frame.url())) || null;
}

async function startPreviewAndGetFrame(page: Page) {
  const startPreviewButton = page
    .getByRole('button', { name: /启动预览|Start Preview/ })
    .first();
  if (await startPreviewButton.isVisible().catch(() => false)) {
    await startPreviewButton.click();
    await page.reload();
  }

  return waitForPreviewBridgeFrame(page);
}

async function selectPreviewCopy(page: Page, selector: string) {
  await expect
    .poll(async () => {
      const frame = await waitForPreviewBridgeFrame(page);
      if (!frame) {
        return false;
      }

      try {
        return await frame.evaluate(
          (targetSelector: string) => Boolean(document.querySelector(targetSelector)),
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

  await frame.evaluate((targetSelector: string) => {
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
