import { expect, test } from '@playwright/test';
import { BROWSER_OPERATOR_SEARCH_PROVIDER_ID } from '@/lib/search/types';

test('search provider catalog exposes browser operator as a browser-mode provider', async ({
  page,
  baseURL,
}) => {
  const response = await page.request.get(`${baseURL}/api/search/providers`, {
    headers: {
      'x-ai-settings': JSON.stringify({
        searchProviderId: BROWSER_OPERATOR_SEARCH_PROVIDER_ID,
      }),
    },
  });

  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  const provider = payload.providers.find(
    (entry: { id: string }) => entry.id === BROWSER_OPERATOR_SEARCH_PROVIDER_ID
  );

  expect(provider).toMatchObject({
    configured: true,
    id: BROWSER_OPERATOR_SEARCH_PROVIDER_ID,
    mode: 'browser',
    requiresApiKey: false,
    selected: true,
  });
});

test('browser operator search provider can open a search page and extract result cards', async ({
  page,
  baseURL,
}) => {
  const endpoint = `${baseURL}/debug/browser-operator-search`;
  const response = await page.request.post(`${baseURL}/api/search/query`, {
    data: {
      maxResults: 2,
      providerId: BROWSER_OPERATOR_SEARCH_PROVIDER_ID,
      query: 'browser operator runtime search',
    },
    headers: {
      'x-ai-settings': JSON.stringify({
        searchProviderEndpoints: {
          [BROWSER_OPERATOR_SEARCH_PROVIDER_ID]: endpoint,
        },
        searchProviderId: BROWSER_OPERATOR_SEARCH_PROVIDER_ID,
      }),
    },
  });

  expect(response.ok()).toBeTruthy();
  const payload = await response.json();

  expect(payload.providerId).toBe(BROWSER_OPERATOR_SEARCH_PROVIDER_ID);
  expect(payload.results).toHaveLength(2);
  expect(payload.results[0].title).toContain('browser operator runtime search');
  expect(payload.results[0].url).toContain('example.test');
  expect(payload.answer).toContain('Browser Operator extracted 2 results');
  expect(payload.citations).toHaveLength(2);
});
