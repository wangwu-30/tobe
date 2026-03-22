import 'server-only';

import {
  BROWSER_OPERATOR_SEARCH_PROVIDER_ID,
  DEFAULT_BROWSER_OPERATOR_SEARCH_ENDPOINT,
  SearchProviderError,
  type SearchProvider,
  type SearchProviderRuntimeConfig,
  type SearchQuery,
  type SearchResult,
} from '@/lib/search/types';

export class BrowserOperatorSearchProvider implements SearchProvider {
  readonly id = BROWSER_OPERATOR_SEARCH_PROVIDER_ID;
  readonly label = 'Browser Operator Search';
  readonly description = 'Headless browser search over a configurable HTML search surface';

  private readonly endpoint: string;

  constructor(config: SearchProviderRuntimeConfig) {
    this.endpoint = normalizeEndpoint(
      config.endpoint || DEFAULT_BROWSER_OPERATOR_SEARCH_ENDPOINT
    );
  }

  async search(input: SearchQuery): Promise<SearchResult> {
    const [
      browserOperator,
      playwrightDriver,
      runtimeSearchAdapter,
    ] = await Promise.all([
      import('../../../../tests/infra/browser-operator'),
      import('../../../../tests/infra/browser-operator/playwright-driver'),
      import('../../../../tests/browser-operator/chengxing/runtime-search-adapter'),
    ]);

    const session = await playwrightDriver
      .createPlaywrightBrowserOperatorSession()
      .catch((error) => {
        throw new SearchProviderError(
          'Browser Operator could not launch a local browser.',
          503,
          {
            cause: error instanceof Error ? error.message : 'unknown',
          }
        );
      });

    try {
      const report = await browserOperator.runBrowserOperator({
        driver: session.driver,
        evaluator: runtimeSearchAdapter.createChengxingRuntimeSearchEvaluator({
          endpoint: this.endpoint,
          maxResults: input.maxResults,
          query: input.query,
        }),
        request: {
          id: buildRunId(input.query),
          target: runtimeSearchAdapter.buildChengxingRuntimeSearchTarget({
            endpoint: this.endpoint,
            maxResults: input.maxResults,
          }),
          task: `Search for "${input.query}" and extract visible result cards.`,
        },
      });

      if (report.status !== 'passed') {
        throw new SearchProviderError(
          'Browser Operator search did not reach a successful end state.',
          503,
          report
        );
      }

      const result = runtimeSearchAdapter.normalizeBrowserOperatorSearchResult({
        maxResults: input.maxResults,
        providerId: this.id,
        query: input.query,
        report,
      });

      if (result.results.length === 0) {
        throw new SearchProviderError(
          'Browser Operator opened the search surface but did not extract any result cards.',
          503,
          report
        );
      }

      return result;
    } catch (error) {
      if (error instanceof SearchProviderError) {
        throw error;
      }

      throw new SearchProviderError(
        error instanceof Error ? error.message : 'Browser Operator search failed.',
        503
      );
    } finally {
      await session.close();
    }
  }
}

function buildRunId(query: string) {
  const normalized = query.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `browser-search-${normalized || 'query'}-${Date.now()}`;
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, '');
}
