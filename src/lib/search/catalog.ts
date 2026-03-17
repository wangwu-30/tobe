import {
  getSearchSettingsFromHeaders,
  resolveSearchProviderApiKey,
  resolveSearchProviderId,
  type SearchSettings,
} from '@/lib/search/settings';
import {
  BRAVE_SEARCH_PROVIDER_ID,
  DEFAULT_SEARCH_PROVIDER_ID,
  type SearchProviderInfo,
  VOLCENGINE_WEB_SEARCH_PROVIDER_ID,
} from '@/lib/search/types';

type SearchProviderCatalogEntry = {
  description: string;
  id: string;
  label: string;
};

const PROVIDER_CATALOG: SearchProviderCatalogEntry[] = [
  {
    id: BRAVE_SEARCH_PROVIDER_ID,
    label: 'Brave Search',
    description: 'Brave Search API',
  },
  {
    id: VOLCENGINE_WEB_SEARCH_PROVIDER_ID,
    label: 'Volcengine Web Search',
    description: 'ARK Responses API with the web_search tool',
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
      id: provider.id,
      label: provider.label,
      description: provider.description,
      configured: Boolean(resolveSearchProviderApiKey(settings, provider.id)),
      selected: provider.id === selectedProviderId,
    })),
  };
}
