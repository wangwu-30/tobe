import {
  BRAVE_SEARCH_PROVIDER_ID,
  DEFAULT_BRAVE_SEARCH_ENDPOINT,
  DEFAULT_SEARCH_PROVIDER_ID,
  DEFAULT_VOLCENGINE_RESPONSES_ENDPOINT,
  DEFAULT_VOLCENGINE_WEB_SEARCH_MODEL,
  VOLCENGINE_WEB_SEARCH_PROVIDER_ID,
} from '@/lib/search/types';

export type SearchSettings = {
  providerId: string;
  providerApiKeys: Record<string, string>;
  providerModels: Record<string, string>;
  providerEndpoints: Record<string, string>;
};

export function getSearchSettingsFromHeaders(headers: Headers): SearchSettings {
  const settingsHeader = headers.get('x-ai-settings');
  if (!settingsHeader) {
    return normalizeSearchSettings({});
  }

  try {
    return normalizeSearchSettings(JSON.parse(settingsHeader));
  } catch {
    return normalizeSearchSettings({});
  }
}

export function normalizeSearchSettings(input: unknown): SearchSettings {
  const raw = asRecord(input);
  const search = asRecord(raw.search);
  const nestedProviderConfigs = asRecord(search.providers);
  const providerApiKeys: Record<string, string> = {};
  const providerModels: Record<string, string> = {};
  const providerEndpoints: Record<string, string> = {};

  copyStringMap(asRecord(raw.providerApiKeys), providerApiKeys);
  copyStringMap(asRecord(raw.searchProviderApiKeys), providerApiKeys);
  copyStringMap(asRecord(raw.searchProviderModels), providerModels);
  copyStringMap(asRecord(raw.searchProviderEndpoints), providerEndpoints);

  for (const [providerId, value] of Object.entries(nestedProviderConfigs)) {
    const config = asRecord(value);
    const apiKey = asString(config.apiKey);
    const model = asString(config.model);
    const endpoint = asString(config.endpoint);

    if (apiKey) {
      providerApiKeys[providerId] = apiKey;
    }

    if (model) {
      providerModels[providerId] = model;
    }

    if (endpoint) {
      providerEndpoints[providerId] = endpoint;
    }
  }

  const configuredProviderId =
    normalizeProviderId(
      asString(search.providerId) ||
        asString(search.provider) ||
        asString(raw.searchProviderId) ||
        asString(raw.searchProvider)
    ) || DEFAULT_SEARCH_PROVIDER_ID;

  const topLevelSearchApiKey = asString(raw.searchApiKey) || asString(search.apiKey);
  if (topLevelSearchApiKey) {
    providerApiKeys[configuredProviderId] = topLevelSearchApiKey;
  }

  const topLevelSearchModel = asString(raw.searchModel) || asString(search.model);
  if (topLevelSearchModel) {
    providerModels[configuredProviderId] = topLevelSearchModel;
  }

  const topLevelSearchEndpoint = asString(raw.searchEndpoint) || asString(search.endpoint);
  if (topLevelSearchEndpoint) {
    providerEndpoints[configuredProviderId] = topLevelSearchEndpoint;
  }

  return {
    providerId: configuredProviderId,
    providerApiKeys,
    providerModels,
    providerEndpoints,
  };
}

export function resolveSearchProviderId(
  settings: SearchSettings,
  providerIdOverride?: string | null
) {
  return (
    normalizeProviderId(providerIdOverride) ||
    normalizeProviderId(settings.providerId) ||
    normalizeProviderId(process.env.SEARCH_PROVIDER) ||
    DEFAULT_SEARCH_PROVIDER_ID
  );
}

export function resolveSearchProviderApiKey(settings: SearchSettings, providerId: string) {
  const explicitKey = settings.providerApiKeys[providerId];
  if (explicitKey) {
    return explicitKey;
  }

  if (providerId === BRAVE_SEARCH_PROVIDER_ID) {
    return process.env.BRAVE_SEARCH_API_KEY || process.env.SEARCH_API_KEY;
  }

  if (providerId === VOLCENGINE_WEB_SEARCH_PROVIDER_ID) {
    return (
      process.env.VOLCENGINE_WEB_SEARCH_API_KEY ||
      process.env.ARK_API_KEY ||
      process.env.SEARCH_API_KEY
    );
  }

  return process.env.SEARCH_API_KEY;
}

export function resolveSearchProviderModel(settings: SearchSettings, providerId: string) {
  const explicitModel = settings.providerModels[providerId];
  if (explicitModel) {
    return explicitModel;
  }

  if (providerId === VOLCENGINE_WEB_SEARCH_PROVIDER_ID) {
    return (
      process.env.VOLCENGINE_WEB_SEARCH_MODEL ||
      process.env.ARK_WEB_SEARCH_MODEL ||
      process.env.ARK_MODEL ||
      DEFAULT_VOLCENGINE_WEB_SEARCH_MODEL
    );
  }

  return undefined;
}

export function resolveSearchProviderEndpoint(settings: SearchSettings, providerId: string) {
  const explicitEndpoint = settings.providerEndpoints[providerId];
  if (explicitEndpoint) {
    return explicitEndpoint;
  }

  if (providerId === BRAVE_SEARCH_PROVIDER_ID) {
    return process.env.BRAVE_SEARCH_ENDPOINT || DEFAULT_BRAVE_SEARCH_ENDPOINT;
  }

  if (providerId === VOLCENGINE_WEB_SEARCH_PROVIDER_ID) {
    return (
      process.env.VOLCENGINE_WEB_SEARCH_ENDPOINT ||
      process.env.ARK_RESPONSES_ENDPOINT ||
      process.env.ARK_BASE_URL ||
      DEFAULT_VOLCENGINE_RESPONSES_ENDPOINT
    );
  }

  return undefined;
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

function copyStringMap(
  source: Record<string, unknown>,
  target: Record<string, string>
) {
  for (const [key, value] of Object.entries(source)) {
    const normalized = asString(value);
    if (normalized) {
      target[key] = normalized;
    }
  }
}

function normalizeProviderId(providerId?: string | null) {
  return providerId?.trim() || '';
}
