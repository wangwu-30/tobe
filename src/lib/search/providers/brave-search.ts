import { searchWithPlaywrightFallback } from '@/lib/search/browser-fallback';
import {
  BRAVE_SEARCH_PROVIDER_ID,
  DEFAULT_BRAVE_SEARCH_ENDPOINT,
  SearchProviderError,
  type SearchCitation,
  type SearchHit,
  type SearchProvider,
  type SearchProviderRuntimeConfig,
  type SearchQuery,
  type SearchResult,
} from '@/lib/search/types';

type BraveWebSearchApiResponse = {
  mixed?: {
    main?: Array<{ index: number; type: string }>;
  };
  query?: {
    original: string;
  };
  web?: {
    results?: Array<{
      age?: string;
      description?: string;
      meta_url?: {
        hostname?: string;
      };
      page_age?: string;
      profile?: {
        name?: string;
      };
      title?: string;
      url?: string;
    }>;
  };
};

export class BraveSearchProvider implements SearchProvider {
  readonly id = BRAVE_SEARCH_PROVIDER_ID;
  readonly label = 'Brave Search';
  readonly description = 'Brave Search API with Playwright browser fallback';

  private readonly apiKey: string | null;
  private readonly endpoint: string;

  constructor(config: SearchProviderRuntimeConfig) {
    this.apiKey = config.apiKey?.trim() || null;
    this.endpoint = normalizeEndpoint(config.endpoint || DEFAULT_BRAVE_SEARCH_ENDPOINT);
  }

  async search(input: SearchQuery): Promise<SearchResult> {
    if (!this.apiKey) {
      return searchWithPlaywrightFallback({
        providerId: this.id,
        providerLabel: this.label,
        query: input,
      });
    }

    try {
      return await this.searchWithApi(input);
    } catch (error) {
      if (error instanceof SearchProviderError) {
        return searchWithPlaywrightFallback({
          providerId: this.id,
          providerLabel: this.label,
          query: input,
        });
      }

      throw error;
    }
  }

  private async searchWithApi(input: SearchQuery): Promise<SearchResult> {
    const url = new URL(this.endpoint);
    url.searchParams.set('q', input.query);
    url.searchParams.set('text_decorations', 'false');
    url.searchParams.set('result_filter', 'web');
    url.searchParams.set('count', String(Math.max(1, Math.min(input.maxResults || 8, 20))));

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.apiKey!,
      },
    });

    const payload = (await parseResponseBody(response)) as BraveWebSearchApiResponse;
    if (!response.ok) {
      throw new SearchProviderError(
        getErrorMessage(payload, response.status),
        response.status,
        payload
      );
    }

    return normalizeSearchResult(payload, input, this.id);
  }
}

function normalizeSearchResult(
  payload: BraveWebSearchApiResponse,
  input: SearchQuery,
  providerId: string
): SearchResult {
  const results = (payload.web?.results || [])
    .map((item): SearchHit | null => {
      const url = item.url?.trim();
      if (!url) {
        return null;
      }

      return {
        title: item.title?.trim() || null,
        url,
        snippet: item.description?.trim() || null,
        source: item.profile?.name?.trim() || item.meta_url?.hostname?.trim() || null,
        publishedAt: item.age?.trim() || item.page_age?.trim() || null,
      };
    })
    .filter((item): item is SearchHit => Boolean(item));

  const citations = results.map((result, index): SearchCitation => ({
    id: `citation-${index + 1}`,
    title: result.title,
    url: result.url,
    snippet: result.snippet,
    source: result.source,
    publishedAt: result.publishedAt,
    startIndex: null,
    endIndex: null,
  }));

  return {
    providerId,
    query: payload.query?.original?.trim() || input.query,
    answer: buildApiAnswer(input.query, results),
    results,
    citations,
    raw: payload,
  };
}

function buildApiAnswer(query: string, results: SearchHit[]) {
  if (results.length === 0) {
    return `Brave Search did not return any web results for "${query}".`;
  }

  return [
    `Brave Search returned ${results.length} result${results.length > 1 ? 's' : ''} for "${query}".`,
    ...results.slice(0, 3).map((result, index) => {
      const detail = result.snippet ? ` — ${result.snippet}` : '';
      return `${index + 1}. ${result.title || result.url}${detail}`;
    }),
  ].join('\n');
}

async function parseResponseBody(response: Response) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getErrorMessage(payload: unknown, status: number) {
  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim();
  }

  if (payload && typeof payload === 'object') {
    const error = (payload as Record<string, unknown>).error;
    if (typeof error === 'string' && error.trim()) {
      return error.trim();
    }

    if (error && typeof error === 'object') {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim()) {
        return message.trim();
      }
    }

    const message = (payload as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
  }

  return `Brave Search request failed with status ${status}`;
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.replace(/\/+$/, '');
}
