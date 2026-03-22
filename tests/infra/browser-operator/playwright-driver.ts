import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import type {
  BrowserAction,
  BrowserActionOutcome,
  BrowserLocator,
  BrowserObservation,
  BrowserOperatorDriver,
  BrowserOperatorDriverContext,
  BrowserOperatorValue,
} from './types';

const DEFAULT_ACTION_TIMEOUT_MS = 15_000;

export type PlaywrightBrowserOperatorSession = {
  close(): Promise<void>;
  driver: BrowserOperatorDriver;
  page: Page;
};

export async function createPlaywrightBrowserOperatorSession(params?: {
  headless?: boolean;
  locale?: string;
}) : Promise<PlaywrightBrowserOperatorSession> {
  const browser = await chromium.launch({
    headless: params?.headless ?? true,
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: params?.locale || 'en-US',
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  return {
    close: async () => {
      await closePlaywrightSession(browser, context);
    },
    driver: new PlaywrightBrowserOperatorDriver(page),
    page,
  };
}

class PlaywrightBrowserOperatorDriver implements BrowserOperatorDriver {
  constructor(private readonly page: Page) {}

  async captureObservation(
    context: BrowserOperatorDriverContext
  ): Promise<BrowserObservation> {
    const screenshotPath = path.join(
      context.artifactPaths.evidenceDir,
      `step-${String(context.step).padStart(4, '0')}.png`
    );

    await this.page.screenshot({ path: screenshotPath, timeout: 5_000 }).catch(() => null);

    const snapshot = await this.page.evaluate(() => {
      const pickText = (value: string | null | undefined) => {
        const normalized = value?.replace(/\s+/g, ' ').trim() || '';
        return normalized || null;
      };
      const readText = (element: Element | null) => pickText(element?.textContent);
      const buildRole = (element: Element) => {
        const explicit = element.getAttribute('role');
        if (explicit) {
          return explicit;
        }

        const tag = element.tagName.toLowerCase();
        if (tag === 'a') {
          return 'link';
        }
        if (tag === 'button') {
          return 'button';
        }
        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
          return 'textbox';
        }

        return tag;
      };
      const describeElement = (element: Element, index: number) => ({
        id: element.id || `${element.tagName.toLowerCase()}-${index + 1}`,
        name:
          pickText(element.getAttribute('aria-label')) ||
          pickText((element as HTMLInputElement).value) ||
          readText(element),
        role: buildRole(element),
        state: {
          checked:
            element instanceof HTMLInputElement &&
            ['checkbox', 'radio'].includes(element.type)
              ? element.checked
              : undefined,
          disabled:
            element instanceof HTMLButtonElement ||
            element instanceof HTMLInputElement ||
            element instanceof HTMLSelectElement ||
            element instanceof HTMLTextAreaElement
              ? element.disabled
              : undefined,
          expanded: element.getAttribute('aria-expanded') === 'true',
          selected: element.getAttribute('aria-selected') === 'true',
        },
        text: readText(element),
      });
      const visibleText = Array.from(
        document.querySelectorAll('h1, h2, h3, p, li, button, a, label')
      )
        .map((element) => readText(element))
        .filter((value): value is string => Boolean(value))
        .slice(0, 20);
      const primaryActions = Array.from(
        document.querySelectorAll('button, a, [role="button"]')
      )
        .slice(0, 12)
        .map(describeElement);
      const formFields = Array.from(
        document.querySelectorAll('input, textarea, select')
      )
        .slice(0, 12)
        .map(describeElement);
      const dialogs = Array.from(
        document.querySelectorAll('[role="dialog"], [role="alertdialog"], [data-slot="sheet-content"]')
      )
        .slice(0, 5)
        .map((element) => {
          const kind =
            element.getAttribute('role') === 'alertdialog'
              ? ('alertdialog' as const)
              : element.getAttribute('role') === 'dialog'
                ? ('dialog' as const)
                : ('sheet' as const);

          return {
            description:
              pickText(element.getAttribute('aria-description')) ||
              readText(element.querySelector('[data-description]')),
            kind,
            title:
              readText(element.querySelector('h1, h2, h3, [aria-labelledby]')) ||
              readText(element.querySelector('[data-title]')),
          };
        });
      const notices = Array.from(
        document.querySelectorAll('[role="alert"], [data-notice-level]')
      )
        .slice(0, 6)
        .map((element) => ({
          level:
            (element.getAttribute('data-notice-level') as 'error' | 'info' | 'success' | 'warning') ||
            'info',
          text: readText(element) || '',
        }))
        .filter((notice) => notice.text);

      const readyState =
        document.readyState === 'complete'
          ? ('complete' as const)
          : document.readyState === 'interactive'
            ? ('interactive' as const)
            : ('loading' as const);

      return {
        dialogs,
        formFields,
        notices,
        primaryActions,
        readyState,
        summary: visibleText[0] || document.title || null,
        title: document.title || null,
        url: window.location.href,
        visibleText,
      };
    });

    return {
      ...snapshot,
      screenshotPath: fs.existsSync(screenshotPath) ? screenshotPath : null,
    };
  }

  async executeAction(
    action: BrowserAction,
    context: BrowserOperatorDriverContext
  ): Promise<BrowserActionOutcome> {
    const timeout = action.timeoutMs || DEFAULT_ACTION_TIMEOUT_MS;

    switch (action.kind) {
      case 'goto':
        await this.page.goto(action.url, {
          timeout,
          waitUntil: action.waitFor || 'domcontentloaded',
        });
        return {
          status: 'ok',
          summary: `Opened ${action.url}.`,
        };
      case 'click': {
        const locator = resolveLocator(this.page, action.target);
        await locator.click({
          button: action.button || 'left',
          clickCount: action.clickCount || 1,
          timeout,
        });
        return {
          status: 'ok',
          summary: `Clicked ${describeLocator(action.target)}.`,
        };
      }
      case 'fill': {
        const locator = resolveLocator(this.page, action.target);
        if (action.clear !== false) {
          await locator.fill('', { timeout });
        }
        await locator.fill(action.value, { timeout });
        if (action.submit) {
          await locator.press('Enter', { timeout });
        }
        return {
          status: 'ok',
          summary: `Filled ${describeLocator(action.target)}.`,
        };
      }
      case 'select': {
        const locator = resolveLocator(this.page, action.target);
        await locator.selectOption(action.values, { timeout });
        return {
          status: 'ok',
          summary: `Selected ${action.values.join(', ')}.`,
        };
      }
      case 'press': {
        if (action.target) {
          await resolveLocator(this.page, action.target).press(action.key, { timeout });
        } else {
          await this.page.keyboard.press(action.key);
        }
        return {
          status: 'ok',
          summary: `Pressed ${action.key}.`,
        };
      }
      case 'wait_for': {
        if (typeof action.timeMs === 'number' && action.timeMs > 0) {
          await this.page.waitForTimeout(action.timeMs);
        }
        if (action.text) {
          await this.page.getByText(action.text).waitFor({
            state: action.state || 'visible',
            timeout,
          });
        }
        if (action.target) {
          await resolveLocator(this.page, action.target).waitFor({
            state: action.state || 'visible',
            timeout,
          });
        }
        return {
          status: 'ok',
          summary: 'Wait condition satisfied.',
        };
      }
      case 'assert':
        await executeAssertAction(this.page, action, timeout);
        return {
          status: 'ok',
          summary: `Assertion passed: ${action.condition}.`,
        };
      case 'extract': {
        const extracted =
          action.schema === 'search-results-v1'
            ? await extractSearchResults(this.page, context)
            : null;

        if (!extracted) {
          return {
            status: 'failed',
            summary: `Unsupported extraction schema: ${action.schema}.`,
          };
        }

        return {
          extracted: {
            [action.storeAs]: extracted,
            items: extracted.items,
          },
          status: 'ok',
          summary: `Extracted ${extracted.items.length} search result(s).`,
        };
      }
      case 'finish':
        return {
          status: action.status === 'blocked' ? 'failed' : 'ok',
          summary: action.summary,
        };
      default: {
        const neverAction: never = action;
        return {
          status: 'failed',
          summary: `Unsupported browser action: ${JSON.stringify(neverAction)}`,
        };
      }
    }
  }

  async recover(): Promise<null> {
    await this.page.waitForTimeout(500);
    return null;
  }
}

async function closePlaywrightSession(browser: Browser, context: BrowserContext) {
  await context.close().catch(() => null);
  await browser.close().catch(() => null);
}

function resolveLocator(page: Page, locator: BrowserLocator): Locator {
  switch (locator.kind) {
    case 'css':
      return page.locator(locator.value).first();
    case 'label':
      return page.getByLabel(locator.value, {
        exact: locator.exact,
      });
    case 'role':
      return page.getByRole(locator.role as never, {
        exact: locator.exact,
        ...(locator.name ? { name: locator.name } : {}),
      });
    case 'test-id':
      return page.getByTestId(locator.value);
    case 'text':
      return page.getByText(locator.value, {
        exact: locator.exact,
      });
    default: {
      const neverLocator: never = locator;
      throw new Error(`Unsupported locator: ${JSON.stringify(neverLocator)}`);
    }
  }
}

async function executeAssertAction(
  page: Page,
  action: Extract<BrowserAction, { kind: 'assert' }>,
  timeout: number
) {
  switch (action.condition) {
    case 'url-includes':
      if (!action.value || !page.url().includes(action.value)) {
        throw new Error(`Expected URL to include "${action.value || ''}", got ${page.url()}.`);
      }
      return;
    case 'url-is':
      if (!action.value || page.url() !== action.value) {
        throw new Error(`Expected URL to equal "${action.value || ''}", got ${page.url()}.`);
      }
      return;
    case 'contains-text': {
      if (!action.target || !action.value) {
        throw new Error('contains-text assertion needs a target and value.');
      }
      const text = (await resolveLocator(page, action.target).textContent({ timeout })) || '';
      if (!text.includes(action.value)) {
        throw new Error(`Expected text to include "${action.value}".`);
      }
      return;
    }
    case 'visible': {
      if (!action.target) {
        throw new Error('visible assertion needs a target.');
      }
      await resolveLocator(page, action.target).waitFor({ state: 'visible', timeout });
      return;
    }
    case 'hidden': {
      if (!action.target) {
        throw new Error('hidden assertion needs a target.');
      }
      await resolveLocator(page, action.target).waitFor({ state: 'hidden', timeout });
      return;
    }
    case 'disabled': {
      if (!action.target) {
        throw new Error('disabled assertion needs a target.');
      }
      if (!(await resolveLocator(page, action.target).isDisabled({ timeout }))) {
        throw new Error('Expected locator to be disabled.');
      }
      return;
    }
    case 'enabled': {
      if (!action.target) {
        throw new Error('enabled assertion needs a target.');
      }
      if (!(await resolveLocator(page, action.target).isEnabled({ timeout }))) {
        throw new Error('Expected locator to be enabled.');
      }
      return;
    }
    default: {
      const neverCondition: never = action.condition;
      throw new Error(`Unsupported assert condition: ${neverCondition}`);
    }
  }
}

async function extractSearchResults(page: Page, context: BrowserOperatorDriverContext) {
  const metadata = context.request.target.metadata || {};
  const itemSelectors = asStringList(metadata.searchResultItemSelectors);
  const titleSelectors = asStringList(metadata.searchResultTitleSelectors);
  const snippetSelectors = asStringList(metadata.searchResultSnippetSelectors);
  const sourceSelectors = asStringList(metadata.searchResultSourceSelectors);
  const maxResults =
    typeof metadata.searchResultLimit === 'number' && Number.isFinite(metadata.searchResultLimit)
      ? metadata.searchResultLimit
      : 8;

  if (!itemSelectors.length || !titleSelectors.length) {
    throw new Error('Search extraction metadata is incomplete.');
  }

  return page.evaluate(
    ({ itemSelectors, maxResults, snippetSelectors, sourceSelectors, titleSelectors }) => {
      const findFirstElement = (
        root: ParentNode,
        selectors: string[]
      ): Element | null => {
        for (const selector of selectors) {
          const element = root.querySelector(selector);
          if (element) {
            return element;
          }
        }
        return null;
      };
      const normalizeText = (value: string | null | undefined) =>
        value?.replace(/\s+/g, ' ').trim() || null;
      const collectItems = () => {
        for (const selector of itemSelectors) {
          const matches = Array.from(document.querySelectorAll(selector));
          if (matches.length > 0) {
            return matches;
          }
        }
        return [];
      };

      return {
        items: collectItems()
          .slice(0, maxResults)
          .map((item) => {
            const titleNode = findFirstElement(item, titleSelectors);
            const snippetNode = findFirstElement(item, snippetSelectors);
            const sourceNode = findFirstElement(item, sourceSelectors);
            const url =
              titleNode instanceof HTMLAnchorElement
                ? titleNode.href
                : normalizeText(titleNode?.getAttribute('href')) || '';

            return {
              snippet: normalizeText(snippetNode?.textContent),
              source: normalizeText(sourceNode?.textContent),
              title: normalizeText(titleNode?.textContent),
              url,
            };
          })
          .filter((item) => item.url),
      };
    },
    {
      itemSelectors,
      maxResults,
      snippetSelectors,
      sourceSelectors,
      titleSelectors,
    }
  );
}

function describeLocator(locator: BrowserLocator) {
  switch (locator.kind) {
    case 'css':
    case 'label':
    case 'test-id':
    case 'text':
      return locator.description || locator.value;
    case 'role':
      return locator.description || `${locator.role}${locator.name ? `:${locator.name}` : ''}`;
    default: {
      const neverLocator: never = locator;
      return JSON.stringify(neverLocator);
    }
  }
}

function asStringList(value: BrowserOperatorValue | undefined) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
}
