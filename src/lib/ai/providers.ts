import type { Api, Model as PiModel, MutableModels } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { safeJsonParse } from '@/framework/resilience/safe-data';
import { oauthCredentialStore } from '@/lib/ai/auth-store';
import {
  DEFAULT_MODEL_KEY,
  buildModelKey,
  parseModelKey,
} from '@/lib/ai/model-selection';
import { normalizeAppLanguage, type AppLanguage } from '@/lib/i18n/language';
import { translate } from '@/lib/i18n/copy';
import { normalizeCommentAgents } from '@/lib/comments/agents';
import type {
  CommentAgentConfigData,
  ModelCatalogData,
  ModelCatalogProviderData,
  ModelOptionData,
  ModelSelectionData,
} from '@/types';

export type Settings = {
  defaultModel?: string;
  language?: AppLanguage;
  commentAgents?: CommentAgentConfigData[];
  providerApiKeys?: Record<string, string>;
  searchApiKey?: string;
  searchEndpoint?: string;
  search?: {
    apiKey?: string;
    endpoint?: string;
    model?: string;
    providerId?: string;
    providers?: Record<
      string,
      {
        apiKey?: string;
        endpoint?: string;
        model?: string;
      }
    >;
  };
  searchProviderId?: string;
  searchProviderApiKeys?: Record<string, string>;
  searchProviderEndpoints?: Record<string, string>;
  searchProviderModels?: Record<string, string>;
};

export type AIModel = ModelOptionData & {
  provider: string;
};

let piModels: MutableModels | undefined;

export { buildModelKey, parseModelKey };

export function getPiModels(): MutableModels {
  piModels ??= builtinModels({ credentials: oauthCredentialStore });
  return piModels;
}

export function createPiStreamFn(settings: Settings) {
  const models = getPiModels();
  return (
    model: PiModel<Api>,
    context: Parameters<MutableModels['streamSimple']>[1],
    options?: Parameters<MutableModels['streamSimple']>[2]
  ) => {
    // A request-scoped key explicitly configured in the UI wins. When it is
    // absent, Models resolves the persistent credential or provider-specific
    // environment itself, including OAuth refresh under the store lock.
    const apiKey = settings.providerApiKeys?.[model.provider]?.trim();
    return models.streamSimple(model, context, {
      ...options,
      ...(apiKey ? { apiKey } : {}),
    });
  };
}

export async function hasConfiguredPiProviderAuth(
  settings: Settings,
  providerId: string
) {
  if (settings.providerApiKeys?.[providerId]?.trim()) {
    return true;
  }
  return Boolean(await getPiModels().checkAuth(providerId));
}

const AVAILABLE_MODELS = buildAvailableModels();
const DEFAULT_MODEL_SELECTION = parseModelKey(DEFAULT_MODEL_KEY);

export function getAvailableModels(): AIModel[] {
  return AVAILABLE_MODELS;
}

export function getDefaultModelKey() {
  return DEFAULT_MODEL_KEY;
}

export function getModelCatalog(params?: {
  oauthProviderIds?: Iterable<string>;
  settings?: Settings;
}): ModelCatalogData {
  const oauthProviderIds = new Set(params?.oauthProviderIds || []);
  const settings = params?.settings || {
    defaultModel: DEFAULT_MODEL_KEY,
    language: normalizeAppLanguage(),
    providerApiKeys: {},
  };
  const language = normalizeAppLanguage(settings.language);

  const providers = groupModelsByProvider().map((provider) => {
    const hasOauth = oauthProviderIds.has(provider.id);
    const hasApiKey = Boolean(resolveConfiguredApiKey(settings, provider.id));
    const configured = hasOauth || hasApiKey;
    const authState = hasOauth
      ? 'oauth_connected'
      : provider.id === 'openai-codex'
        ? 'oauth_required'
        : hasApiKey
          ? 'api_key_configured'
          : 'api_key_required';

    return {
      ...provider,
      authState,
      configured,
      disabledReason: configured
        ? null
        : provider.id === 'openai-codex'
          ? translate(language, 'models.providerNeedsOauth', {
              provider: provider.label,
            })
          : translate(language, 'models.providerNeedsApiKey', {
              provider: provider.label,
            }),
    } satisfies ModelCatalogProviderData;
  });

  return {
    defaultModelKey: resolveModelSelection(settings.defaultModel, providers).key,
    providers,
  };
}

export function resolveModelSelection(
  modelKey: string | null | undefined,
  providers: ModelCatalogProviderData[]
): ModelSelectionData {
  const parsed = parseModelKey(modelKey || DEFAULT_MODEL_KEY);
  const fallbackProvider =
    providers.find((provider) => provider.configured && provider.models.length > 0) ||
    providers.find((provider) => provider.models.length > 0) ||
    null;

  const selectedProvider =
    providers.find((provider) => provider.id === parsed.providerId && provider.models.length > 0) ||
    fallbackProvider;

  if (!selectedProvider) {
    return {
      ...DEFAULT_MODEL_SELECTION,
    };
  }

  const selectedModel =
    selectedProvider.models.find((model) => model.id === parsed.modelId) ||
    selectedProvider.models[0];

  return {
    key: selectedModel.key,
    modelId: selectedModel.id,
    providerId: selectedProvider.id,
  };
}

export function formatModelLabel(
  modelKey: string,
  catalog?: ModelCatalogData | null
) {
  const selection = resolveModelSelection(modelKey, catalog?.providers || []);
  const provider = catalog?.providers.find((entry) => entry.id === selection.providerId);
  const model = provider?.models.find((entry) => entry.id === selection.modelId);

  return {
    key: selection.key,
    modelId: model?.id || selection.modelId,
    modelLabel: model?.name || selection.modelId,
    providerId: provider?.id || selection.providerId,
    providerLabel: provider?.label || selection.providerId,
  };
}

export function getSettingsFromHeaders(headers: Headers): Settings {
  const settingsHeader = headers.get('x-ai-settings');
  if (!settingsHeader) {
    return {
      defaultModel: DEFAULT_MODEL_KEY,
      language: normalizeAppLanguage(),
      commentAgents: normalizeCommentAgents([], normalizeAppLanguage()),
      providerApiKeys: {},
    };
  }

  const parsed =
    safeJsonParse<unknown>(settingsHeader, null) ??
    safeJsonParse<unknown>(decodeURIComponent(settingsHeader), null);
  if (parsed !== null) {
    return normalizeSettings(parsed);
  }

  return {
    defaultModel: DEFAULT_MODEL_KEY,
    language: normalizeAppLanguage(),
    commentAgents: normalizeCommentAgents([], normalizeAppLanguage()),
    providerApiKeys: {},
  };
}

export function normalizeSettings(input: unknown): Settings {
  const raw = (input || {}) as Record<string, unknown>;
  const providerApiKeys: Record<string, string> = {};

  const legacyAnthropicKey = asString(raw.anthropicApiKey);
  if (legacyAnthropicKey) {
    providerApiKeys.anthropic = legacyAnthropicKey;
  }

  const legacyOpenAiKey = asString(raw.openaiApiKey);
  if (legacyOpenAiKey) {
    providerApiKeys.openai = legacyOpenAiKey;
  }

  const explicitProviderApiKeys = raw.providerApiKeys;
  if (explicitProviderApiKeys && typeof explicitProviderApiKeys === 'object') {
    for (const [providerId, apiKey] of Object.entries(
      explicitProviderApiKeys as Record<string, unknown>
    )) {
      const normalizedKey = asString(apiKey);
      if (normalizedKey) {
        providerApiKeys[providerId] = normalizedKey;
      }
    }
  }

  const defaultModel = parseModelKey(asString(raw.defaultModel)).key;
  const language = normalizeAppLanguage(asString(raw.language));
  const commentAgents = normalizeCommentAgents(raw.commentAgents, language);

  return {
    defaultModel,
    language,
    commentAgents,
    providerApiKeys,
  };
}

export function getSelectedModelFromHeaders(headers: Headers, modelOverride?: string) {
  const settings = getSettingsFromHeaders(headers);
  return getSelectedModel(settings, modelOverride);
}

export function getSelectedModel(settings: Settings, modelOverride?: string) {
  const { providerId, modelId, key } = parseModelKey(
    modelOverride || settings.defaultModel || DEFAULT_MODEL_KEY
  );
  const models = getPiModels();
  const model = models.getModel(providerId, modelId);

  if (!model) {
    throw new Error(
      `The configured Pi model is not available: ${providerId}::${modelId}`
    );
  }

  return {
    settings,
    modelKey: key,
    providerId: model.provider,
    modelId: model.id,
    model: model as PiModel<Api>,
  };
}

export function resolveConfiguredApiKey(settings: Settings, providerId: string) {
  const explicitKey = settings.providerApiKeys?.[providerId];
  if (explicitKey) {
    return explicitKey;
  }

  const envKeyMap: Record<string, string | undefined> = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    'azure-openai-responses': process.env.AZURE_OPENAI_API_KEY,
    groq: process.env.GROQ_API_KEY,
    xai: process.env.XAI_API_KEY,
    mistral: process.env.MISTRAL_API_KEY,
    cerebras: process.env.CEREBRAS_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    'vercel-ai-gateway': process.env.AI_GATEWAY_API_KEY,
    google: process.env.GEMINI_API_KEY,
    'google-vertex': process.env.GOOGLE_CLOUD_API_KEY,
    minimax: process.env.MINIMAX_API_KEY,
    'minimax-cn': process.env.MINIMAX_CN_API_KEY,
    huggingface: process.env.HF_TOKEN,
    zai: process.env.ZAI_API_KEY,
    opencode: process.env.OPENCODE_API_KEY,
    'opencode-go': process.env.OPENCODE_API_KEY,
    'kimi-coding': process.env.KIMI_API_KEY,
  };

  return envKeyMap[providerId];
}

function buildAvailableModels() {
  const models = new Map<string, AIModel>();

  for (const provider of getPiModels().getProviders()) {
    for (const model of provider.getModels()) {
      const key = buildModelKey(provider.id, model.id);
      const nextModel = {
        key,
        id: model.id,
        name: model.name || model.id,
        provider: provider.name,
        providerId: provider.id,
      };

      const existing = models.get(key);
      if (!existing || existing.name === existing.id) {
        models.set(key, nextModel);
      }
    }
  }

  return [...models.values()].sort((a, b) => {
    if (a.provider === b.provider) {
      return a.name.localeCompare(b.name);
    }
    return a.provider.localeCompare(b.provider);
  });
}

function groupModelsByProvider() {
  const grouped = new Map<string, ModelCatalogProviderData>();

  for (const model of AVAILABLE_MODELS) {
    const existing = grouped.get(model.providerId);
    if (existing) {
      existing.models.push({
        id: model.id,
        key: model.key,
        name: model.name,
        providerId: model.providerId,
      });
      continue;
    }

    grouped.set(model.providerId, {
      id: model.providerId,
      label: model.provider,
      configured: false,
      authState: model.providerId === 'openai-codex' ? 'oauth_required' : 'api_key_required',
      disabledReason: null,
      models: [
        {
          id: model.id,
          key: model.key,
          name: model.name,
          providerId: model.providerId,
        },
      ],
    });
  }

  return [...grouped.values()]
    .map((provider) => ({
      ...provider,
      models: [...provider.models].sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}
