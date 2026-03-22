import {
  getSearchSettingsFromHeaders,
  resolveSearchProviderApiKey,
  resolveSearchProviderId,
  type SearchSettings,
} from '@/lib/search/settings';
import {
  BROWSER_OPERATOR_SEARCH_PROVIDER_ID,
  BRAVE_SEARCH_PROVIDER_ID,
  DEFAULT_BROWSER_OPERATOR_SEARCH_ENDPOINT,
  DEFAULT_SEARCH_PROVIDER_ID,
  type SearchProviderInfo,
  VOLCENGINE_WEB_SEARCH_PROVIDER_ID,
} from '@/lib/search/types';
import { resolveSearchProviderEndpoint } from '@/lib/search/settings';

type SearchProviderCatalogEntry = {
  defaultEndpoint?: string | null;
  description: string;
  id: string;
  label: string;
  mode: 'api' | 'browser';
  requiresApiKey: boolean;
};

const PROVIDER_CATALOG: SearchProviderCatalogEntry[] = [
  {
    id: BROWSER_OPERATOR_SEARCH_PROVIDER_ID,
    label: 'Browser Operator Search',
    description: 'Launch a browser, open a search surface, and extract visible result cards',
    mode: 'browser',
    requiresApiKey: false,
    defaultEndpoint: DEFAULT_BROWSER_OPERATOR_SEARCH_ENDPOINT,
  },
  {
    id: BRAVE_SEARCH_PROVIDER_ID,
    label: 'Brave Search',
    description: 'Brave Search API',
    mode: 'api',
    requiresApiKey: true,
  },
  {
    id: VOLCENGINE_WEB_SEARCH_PROVIDER_ID,
    label: 'Volcengine Web Search',
    description: 'ARK Responses API with the web_search tool',
    mode: 'api',
    requiresApiKey: true,
  },
];

export function getSearchProviderCatalog() {
  return PROVIDER_CATALOG;
}

export function getSearchProvidersFromHeaders(headers: Headers) {
  return getSearchProviders(getSearchSettingsFromHeaders(headers));
}

export function getSearchProviders(settings: SearchSettings): {
  defaultProviderId: string;
  selectedProviderId: string;
  providers: SearchProviderInfo[];
} {
  const selectedProviderId = resolveSearchProviderId(settings);

  return {
    defaultProviderId: DEFAULT_SEARCH_PROVIDER_ID,
    selectedProviderId,
    providers: PROVIDER_CATALOG.map((provider) => ({
      defaultEndpoint: provider.defaultEndpoint || null,
      id: provider.id,
      label: provider.label,
      description: provider.description,
      configured: provider.requiresApiKey
        ? Boolean(resolveSearchProviderApiKey(settings, provider.id))
        : Boolean(resolveSearchProviderEndpoint(settings, provider.id)),
      mode: provider.mode,
      requiresApiKey: provider.requiresApiKey,
      selected: provider.id === selectedProviderId,
    })),
  };
}
