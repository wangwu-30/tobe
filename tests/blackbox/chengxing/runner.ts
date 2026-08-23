import type { Page } from '@playwright/test';
import {
  createPlaywrightBrowserOperatorSession,
  runBrowserOperator,
} from '../../infra/browser-operator';
import { getAiInspectorScenarioRoot, writeChengxingBlackboxReport } from './report';
import type { ChengxingBlackboxScenario } from './types';

export async function runChengxingBlackboxScenario(
  scenario: ChengxingBlackboxScenario
) {
  const session = await createPlaywrightBrowserOperatorSession({
    headless: true,
    locale: 'zh-CN',
  });

  try {
    await primeBlackboxBrowserState(session.page, scenario.target.metadata);
    const browserRun = await runBrowserOperator({
      artifactRoot: getAiInspectorScenarioRoot(scenario.id),
      driver: session.driver,
      evaluator: scenario.createEvaluator(),
      request: {
        id: `${scenario.id.toLowerCase()}-${Date.now()}`,
        target: scenario.target,
        task: scenario.task,
      },
    });

    const report = writeChengxingBlackboxReport({
      browserRun,
      scenario,
    });

    return {
      browserRun,
      ...report,
    };
  } finally {
    await session.close();
  }
}

async function primeBlackboxBrowserState(
  page: Page,
  metadata?: Record<string, unknown>
) {
  const localStorageEntries = readLocalStorageEntries(metadata);

  await page.addInitScript(() => {
    const nextSettings = { language: 'zh-CN' };

    try {
      const existing = window.localStorage.getItem('ai-settings');
      const parsed =
        existing && existing.trim()
          ? (JSON.parse(existing) as Record<string, unknown>)
          : {};

      window.localStorage.setItem(
        'ai-settings',
        JSON.stringify({
          ...parsed,
          ...nextSettings,
        })
      );
    } catch {
      window.localStorage.setItem('ai-settings', JSON.stringify(nextSettings));
    }
  });

  if (Object.keys(localStorageEntries).length === 0) {
    return;
  }

  await page.addInitScript((payload) => {
    for (const [key, value] of Object.entries(payload.localStorageEntries)) {
      window.localStorage.setItem(key, value);
    }
  }, {
    localStorageEntries,
  });
}

function readLocalStorageEntries(metadata?: Record<string, unknown>) {
  const rawValue = metadata?.localStorage;
  if (!rawValue || Array.isArray(rawValue) || typeof rawValue !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(rawValue).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string';
    })
  );
}
