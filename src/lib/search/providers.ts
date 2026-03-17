import {
  getSearchSettingsFromHeaders,
  resolveSearchProviderApiKey,
  resolveSearchProviderEndpoint,
  resolveSearchProviderId,
  resolveSearchProviderModel,
  type SearchSettings,
} from '@/lib/search/settings';
import {
  SearchProviderError,
  type SearchProvider,
  type SearchProviderRuntimeConfig,
} from '@/lib/search/types';
import {
  BRAVE_SEARCH_PROVIDER_ID,
  VOLCENGINE_WEB_SEARCH_PROVIDER_ID,
} from '@/lib/search/types';

export async function getSearchProviderFromHeaders(
  headers: Headers,
  providerIdOverride?: string | null
) {
  const settings = getSearchSettingsFromHeaders(headers);
  return getSearchProvider(settings, providerIdOverride);
}

export async function getSearchProvider(
  settings: SearchSettings,
  providerIdOverride?: string | null
) : Promise<SearchProvider> {
  const providerId = resolveSearchProviderId(settings, providerIdOverride);
  const provider = await createSearchProvider(providerId, {
    providerId,
    apiKey: resolveSearchProviderApiKey(settings, providerId),
    model: resolveSearchProviderModel(settings, providerId),
    endpoint: resolveSearchProviderEndpoint(settings, providerId),
  });

  return provider;
}

async function createSearchProvider(
  providerId: string,
  config: SearchProviderRuntimeConfig
): Promise<SearchProvider> {
  if (providerId === BRAVE_SEARCH_PROVIDER_ID) {
    const { BraveSearchProvider } = await import('@/lib/search/providers/brave-search');
    return new BraveSearchProvider(config);
  }

  if (providerId === VOLCENGINE_WEB_SEARCH_PROVIDER_ID) {
    const { VolcengineWebSearchProvider } = await import(
      '@/lib/search/providers/volcengine-web-search'
    );
    return new VolcengineWebSearchProvider(config);
  }

  throw new SearchProviderError(`Unsupported search provider: ${providerId}`, 400);
}
