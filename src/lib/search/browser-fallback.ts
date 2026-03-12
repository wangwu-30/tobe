import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import {
  SearchProviderError,
  type SearchCitation,
  type SearchHit,
  type SearchQuery,
  type SearchResult,
} from '@/lib/search/types';

type BrowserFallbackParams = {
  providerId: string;
  providerLabel: string;
  query: SearchQuery;
};

export async function searchWithPlaywrightFallback({
  providerId,
  providerLabel,
  query,
}: BrowserFallbackParams): Promise<SearchResult> {
  const executablePath = resolveBrowserExecutable();
  if (!executablePath) {
    throw new SearchProviderError(
      `Search provider ${providerId} is not configured, and no compatible local browser was found for Playwright fallback.`,
      400,
      {
        searchedPaths: getBrowserCandidates(),
      }
    );
  }

  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    const searchUrl = buildBraveSearchUrl(query.query);

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

    const rawResults = await page.evaluate((limit) => {
      const roots = [
        document.querySelector('main'),
        document.querySelector('[data-testid="results"]'),
        document.body,
      ].filter(Boolean) as Element[];

      const seen = new Set<string>();
      const items: Array<{ snippet: string | null; title: string | null; url: string }> = [];

      for (const root of roots) {
        const anchors = Array.from(root.querySelectorAll('a[href]'));

        for (const anchor of anchors) {
          const href = anchor.getAttribute('href');
          if (!href) {
            continue;
          }

          let url: URL;
          try {
            url = new URL(href, window.location.href);
          } catch {
            continue;
          }

          if (!['http:', 'https:'].includes(url.protocol)) {
            continue;
          }

          const hostname = url.hostname.toLowerCase();
          if (
            hostname === window.location.hostname ||
            hostname.endsWith('.brave.com') ||
            hostname === 'brave.com'
          ) {
            continue;
          }

          const normalizedUrl = url.toString();
          if (seen.has(normalizedUrl)) {
            continue;
          }

          const title = anchor.textContent?.replace(/\s+/g, ' ').trim() || null;
          if (!title || title.length < 3) {
            continue;
          }

          const container = anchor.closest('article, li, div');
          let snippet = container?.textContent?.replace(/\s+/g, ' ').trim() || null;
          if (snippet && snippet.startsWith(title)) {
            snippet = snippet.slice(title.length).trim() || null;
          }
          if (snippet && snippet.length > 320) {
            snippet = `${snippet.slice(0, 317)}...`;
          }

          items.push({
            snippet,
            title,
            url: normalizedUrl,
          });
          seen.add(normalizedUrl);

          if (items.length >= limit) {
            return items;
          }
        }
      }

      return items;
    }, Math.max(1, Math.min(query.maxResults || 5, 10)));

    const results = rawResults
      .map((item): SearchHit => ({
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        source: deriveSourceFromUrl(item.url),
        publishedAt: null,
      }));

    const citations = results.map((result, index): SearchCitation => ({
      id: `citation-${index + 1}`,
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      source: result.source,
      publishedAt: null,
      startIndex: null,
      endIndex: null,
    }));

    return {
      providerId,
      query: query.query,
      answer: buildFallbackAnswer(providerLabel, query.query, results),
      results,
      citations,
      raw: {
        browserExecutablePath: executablePath,
        mode: 'playwright-browser-fallback',
        searchUrl,
      },
    };
  } catch (error) {
    throw new SearchProviderError(
      `Playwright browser fallback failed for ${providerLabel}.`,
      500,
      error instanceof Error ? { message: error.message } : undefined
    );
  } finally {
    await browser.close().catch(() => {});
  }
}

function buildBraveSearchUrl(query: string) {
  const url = new URL('https://search.brave.com/search');
  url.searchParams.set('q', query);
  url.searchParams.set('source', 'web');
  return url.toString();
}

function buildFallbackAnswer(
  providerLabel: string,
  query: string,
  results: SearchHit[]
) {
  if (results.length === 0) {
    return `${providerLabel} browser fallback did not find any visible results for "${query}".`;
  }

  const topLines = results.slice(0, 3).map((result, index) => {
    const detail = result.snippet ? ` — ${result.snippet}` : '';
    return `${index + 1}. ${result.title || result.url}${detail}`;
  });

  return [
    `${providerLabel} browser fallback collected ${results.length} result${results.length > 1 ? 's' : ''} for "${query}".`,
    ...topLines,
  ].join('\n');
}

function resolveBrowserExecutable() {
  for (const candidate of getBrowserCandidates()) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getBrowserCandidates() {
  const homeDir = os.homedir();
  const candidates = [
    process.env.DAO_SEARCH_BROWSER_PATH,
    process.env.BRAVE_BROWSER_PATH,
    process.env.GOOGLE_CHROME_BIN,
    process.env.CHROME_BIN,
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    path.join(homeDir, 'Applications/Brave Browser.app/Contents/MacOS/Brave Browser'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    path.join(homeDir, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    path.join(homeDir, 'Applications/Chromium.app/Contents/MacOS/Chromium'),
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    path.join(homeDir, 'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];

  return candidates.filter((value): value is string => Boolean(value && value.trim()));
}

function deriveSourceFromUrl(targetUrl: string) {
  try {
    return new URL(targetUrl).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
