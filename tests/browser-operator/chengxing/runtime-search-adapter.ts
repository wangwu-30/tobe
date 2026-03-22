import type {
  BrowserEvaluator,
  BrowserOperatorTarget,
  BrowserRunReport,
} from '../../infra/browser-operator';
import {
  BROWSER_OPERATOR_SEARCH_PROVIDER_ID,
  type SearchCitation,
  type SearchHit,
  type SearchResult,
} from '@/lib/search/types';

const SEARCH_RESULTS_READY_SELECTOR =
  '[data-browser-operator-result="item"], .results .result, .result';
const SEARCH_RESULT_ITEM_SELECTORS = [
  '[data-browser-operator-result="item"]',
  '.results .result',
  '.result',
];
const SEARCH_RESULT_TITLE_SELECTORS = [
  '[data-browser-operator-role="title-link"]',
  '.result__a',
  'a.result-link',
  'a',
];
const SEARCH_RESULT_SNIPPET_SELECTORS = [
  '[data-browser-operator-role="snippet"]',
  '.result__snippet',
  '.result-snippet',
  'p',
];
const SEARCH_RESULT_SOURCE_SELECTORS = [
  '[data-browser-operator-role="source"]',
  '.result__url',
  '.result-source',
  'cite',
];

export function buildChengxingRuntimeSearchTarget(params: {
  endpoint: string;
  maxResults?: number;
}): BrowserOperatorTarget {
  return {
    id: `${BROWSER_OPERATOR_SEARCH_PROVIDER_ID}-target`,
    label: 'Browser Operator Search',
    baseURL: params.endpoint,
    bootstrap: {
      description: 'Open a search surface and extract visible result cards.',
      seedName: null,
    },
    locators: {
      resultsReady: {
        kind: 'css',
        value: SEARCH_RESULTS_READY_SELECTOR,
        description: 'search results',
      },
    },
    metadata: {
      searchResultItemSelectors: SEARCH_RESULT_ITEM_SELECTORS,
      searchResultLimit: Math.max(1, Math.min(params.maxResults || 8, 10)),
      searchResultSnippetSelectors: SEARCH_RESULT_SNIPPET_SELECTORS,
      searchResultSourceSelectors: SEARCH_RESULT_SOURCE_SELECTORS,
      searchResultTitleSelectors: SEARCH_RESULT_TITLE_SELECTORS,
    },
    readiness: {
      locator: {
        kind: 'css',
        value: SEARCH_RESULTS_READY_SELECTOR,
      },
    },
  };
}

export function createChengxingRuntimeSearchEvaluator(params: {
  endpoint: string;
  maxResults?: number;
  query: string;
}): BrowserEvaluator {
  const searchUrl = buildBrowserOperatorSearchUrl(params.endpoint, params.query);

  return {
    async nextAction(input) {
      if (input.step === 1) {
        return {
          kind: 'goto',
          label: 'Open search results page',
          reason: 'Start the browser search run on the configured search surface.',
          url: searchUrl,
          waitFor: 'domcontentloaded',
        };
      }

      if (input.step === 2) {
        return {
          kind: 'wait_for',
          label: 'Wait for results',
          reason: 'The result list must be visible before extraction.',
          state: 'visible',
          target:
            input.request.target.locators?.resultsReady || {
              kind: 'css',
              value: SEARCH_RESULTS_READY_SELECTOR,
            },
        };
      }

      if (input.step === 3) {
        return {
          kind: 'extract',
          label: 'Extract result cards',
          reason: 'Collect title, source, snippet, and URL from visible result cards.',
          schema: 'search-results-v1',
          storeAs: 'searchResults',
        };
      }

      return {
        kind: 'finish',
        summary: 'Browser search result extraction completed.',
      };
    },
  };
}

export function normalizeBrowserOperatorSearchResult(params: {
  maxResults?: number;
  providerId: string;
  query: string;
  report: BrowserRunReport;
}): SearchResult {
  const extractedItems = readExtractedItems(params.report).slice(
    0,
    Math.max(1, Math.min(params.maxResults || 8, 10))
  );

  const results = extractedItems.map(
    (item): SearchHit => ({
      publishedAt: null,
      snippet: item.snippet,
      source: item.source,
      title: item.title,
      url: item.url,
    })
  );
  const citations = results.map(
    (result, index): SearchCitation => ({
      endIndex: null,
      id: `citation-${index + 1}`,
      publishedAt: result.publishedAt,
      snippet: result.snippet,
      source: result.source,
      startIndex: null,
      title: result.title,
      url: result.url,
    })
  );

  return {
    answer: buildBrowserSearchAnswer(params.query, results),
    citations,
    providerId: params.providerId,
    query: params.query,
    raw: params.report,
    results,
  };
}

export function buildBrowserOperatorSearchUrl(endpoint: string, query: string) {
  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  return url.toString();
}

type ExtractedSearchItem = {
  snippet: string | null;
  source: string | null;
  title: string | null;
  url: string;
};

function readExtractedItems(report: BrowserRunReport): ExtractedSearchItem[] {
  for (const entry of [...report.transcript].reverse()) {
    const items = asSearchItemList(entry.outcome.extracted?.items);
    if (items.length > 0) {
      return items;
    }

    const stored = asRecord(entry.outcome.extracted?.searchResults);
    const nestedItems = asSearchItemList(stored.items);
    if (nestedItems.length > 0) {
      return nestedItems;
    }
  }

  return [];
}

function buildBrowserSearchAnswer(query: string, results: SearchHit[]) {
  if (results.length === 0) {
    return `Browser Operator did not extract any search results for "${query}".`;
  }

  return [
    `Browser Operator extracted ${results.length} result${results.length > 1 ? 's' : ''} for "${query}".`,
    ...results.slice(0, 3).map((result, index) => {
      const detail = result.snippet ? ` — ${result.snippet}` : '';
      return `${index + 1}. ${result.title || result.url}${detail}`;
    }),
  ].join('\n');
}

function asSearchItemList(value: unknown): ExtractedSearchItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const record = asRecord(item);
      const url = asString(record.url);
      if (!url) {
        return null;
      }

      return {
        snippet: asNullableString(record.snippet),
        source: asNullableString(record.source),
        title: asNullableString(record.title),
        url,
      } satisfies ExtractedSearchItem;
    })
    .filter((item): item is ExtractedSearchItem => Boolean(item));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function asNullableString(value: unknown) {
  const normalized = asString(value);
  return normalized || null;
}
