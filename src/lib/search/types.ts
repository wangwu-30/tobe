export const BRAVE_SEARCH_PROVIDER_ID = 'brave-search';
export const DEFAULT_SEARCH_PROVIDER_ID = BRAVE_SEARCH_PROVIDER_ID;
export const BROWSER_OPERATOR_SEARCH_PROVIDER_ID = 'browser-operator-search';
export const VOLCENGINE_WEB_SEARCH_PROVIDER_ID = 'volcengine-web-search';
export const DEFAULT_BRAVE_SEARCH_ENDPOINT =
  'https://api.search.brave.com/res/v1/web/search';
export const DEFAULT_BROWSER_OPERATOR_SEARCH_ENDPOINT =
  'https://html.duckduckgo.com/html/';
export const DEFAULT_VOLCENGINE_RESPONSES_ENDPOINT =
  'https://ark.cn-beijing.volces.com/api/v3/responses';
export const DEFAULT_VOLCENGINE_WEB_SEARCH_MODEL = 'doubao-seed-1-6-250615';

export type SearchCitation = {
  id: string;
  title: string | null;
  url: string;
  snippet: string | null;
  source: string | null;
  publishedAt: string | null;
  startIndex: number | null;
  endIndex: number | null;
};

export type SearchHit = {
  title: string | null;
  url: string;
  snippet: string | null;
  source: string | null;
  publishedAt: string | null;
};

export type SearchQuery = {
  query: string;
  maxResults?: number;
};

export type SearchResult = {
  providerId: string;
  query: string;
  answer: string;
  results: SearchHit[];
  citations: SearchCitation[];
  raw: unknown;
};

export type SearchProviderInfo = {
  defaultEndpoint?: string | null;
  id: string;
  label: string;
  description: string;
  configured: boolean;
  mode: 'api' | 'browser';
  requiresApiKey: boolean;
  selected: boolean;
};

export type SearchProviderRuntimeConfig = {
  providerId: string;
  apiKey?: string;
  model?: string;
  endpoint?: string;
};

export interface SearchProvider {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  search(input: SearchQuery): Promise<SearchResult>;
}

export class SearchProviderError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status = 500, details?: unknown) {
    super(message);
    this.name = 'SearchProviderError';
    this.status = status;
    this.details = details;
  }
}
