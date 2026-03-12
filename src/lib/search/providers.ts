import {
  getSearchSettingsFromHeaders,
  resolveSearchProviderApiKey,
  resolveSearchProviderEndpoint,
  resolveSearchProviderId,
  resolveSearchProviderModel,
  type SearchSettings,
} from '@/lib/search/settings';
import { BraveSearchProvider } from '@/lib/search/providers/brave-search';
import { VolcengineWebSearchProvider } from '@/lib/search/providers/volcengine-web-search';
import {
  BRAVE_SEARCH_PROVIDER_ID,
  DEFAULT_SEARCH_PROVIDER_ID,
  SearchProviderError,
  type SearchProvider,
  type SearchProviderInfo,
  type SearchProviderRuntimeConfig,
  VOLCENGINE_WEB_SEARCH_PROVIDER_ID,
} from '@/lib/search/types';

type ProviderDefinition = {
  id: string;
  label: string;
  description: string;
  create: (config: SearchProviderRuntimeConfig) => SearchProvider;
};

const PROVIDERS: ProviderDefinition[] = [
  {
    id: BRAVE_SEARCH_PROVIDER_ID,
    label: 'Brave Search',
    description: 'Brave Search API with Playwright browser fallback',
    create: config => new BraveSearchProvider(config),
  },
  {
    id: VOLCENGINE_WEB_SEARCH_PROVIDER_ID,
    label: 'Volcengine Web Search',
    description: 'ARK Responses API with the web_search tool',
    create: config => new VolcengineWebSearchProvider(config),
  },
];

export function getSearchProvidersFromHeaders(headers: Headers) {
  const settings = getSearchSettingsFromHeaders(headers);
  return getSearchProviders(settings);
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
    providers: PROVIDERS.map(provider => ({
      id: provider.id,
      label: provider.label,
      description: provider.description,
      configured:
        provider.id === BRAVE_SEARCH_PROVIDER_ID ||
        Boolean(resolveSearchProviderApiKey(settings, provider.id)),
      selected: provider.id === selectedProviderId,
    })),
  };
}

export function getSearchProviderFromHeaders(
  headers: Headers,
  providerIdOverride?: string | null
) {
  const settings = getSearchSettingsFromHeaders(headers);
  return getSearchProvider(settings, providerIdOverride);
}

export function getSearchProvider(
  settings: SearchSettings,
  providerIdOverride?: string | null
) {
  const providerId = resolveSearchProviderId(settings, providerIdOverride);
  const definition = PROVIDERS.find(provider => provider.id === providerId);

  if (!definition) {
    throw new SearchProviderError(`Unsupported search provider: ${providerId}`, 400);
  }

  return definition.create({
    providerId,
    apiKey: resolveSearchProviderApiKey(settings, providerId),
    model: resolveSearchProviderModel(settings, providerId),
    endpoint: resolveSearchProviderEndpoint(settings, providerId),
  });
}
