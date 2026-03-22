import { getModel as getPiModel, getModels, getProviders } from '@mariozechner/pi-ai';
import type { Api, Model as PiModel, Provider as PiProvider } from '@mariozechner/pi-ai';
import { safeJsonParse } from '@/framework/resilience';
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

const DEFAULT_MODEL_KEY = buildModelKey('openai-codex', 'gpt-5.2-codex');

const PROVIDER_LABELS: Partial<Record<PiProvider, string>> = {
  anthropic: 'Anthropic',
  'azure-openai-responses': 'Azure OpenAI',
  cerebras: 'Cerebras',
  'github-copilot': 'GitHub Copilot',
  google: 'Google',
  'google-antigravity': 'Google Antigravity',
  'google-gemini-cli': 'Google Gemini CLI',
  'google-vertex': 'Vertex AI',
  groq: 'Groq',
  huggingface: 'Hugging Face',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax CN',
  mistral: 'Mistral',
  opencode: 'OpenCode',
  'opencode-go': 'OpenCode Go',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex',
  openrouter: 'OpenRouter',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  xai: 'xAI',
  zai: 'z.ai',
  'kimi-coding': 'Kimi Coding',
};

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

  const defaultModel = normalizeModelKey(asString(raw.defaultModel)) || DEFAULT_MODEL_KEY;
  const language = normalizeAppLanguage(asString(raw.language));
  const commentAgents = normalizeCommentAgents(raw.commentAgents, language);

  return {
    defaultModel,
    language,
    commentAgents,
    providerApiKeys,
  };
}

export function buildModelKey(providerId: string, modelId: string) {
  return `${providerId}::${modelId}`;
}

export function parseModelKey(modelKey: string) {
  const normalized = normalizeModelKey(modelKey) || DEFAULT_MODEL_KEY;
  const separatorIndex = normalized.indexOf('::');

  if (separatorIndex === -1) {
    return {
      providerId: 'openai-codex',
      modelId: 'gpt-5.2-codex',
      key: DEFAULT_MODEL_KEY,
    };
  }

  return {
    providerId: normalized.slice(0, separatorIndex),
    modelId: normalized.slice(separatorIndex + 2),
    key: normalized,
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

  return {
    settings,
    modelKey: key,
    providerId,
    modelId,
    model: getPiModel(providerId as never, modelId as never) as PiModel<Api>,
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
    google: process.env.GOOGLE_API_KEY,
    'google-vertex': process.env.GOOGLE_VERTEX_API_KEY,
    minimax: process.env.MINIMAX_API_KEY,
    'minimax-cn': process.env.MINIMAX_API_KEY,
    huggingface: process.env.HUGGINGFACE_API_KEY,
    zai: process.env.ZAI_API_KEY,
    opencode: process.env.OPENCODE_API_KEY,
    'opencode-go': process.env.OPENCODE_GO_API_KEY,
    'kimi-coding': process.env.KIMI_CODING_API_KEY,
  };

  return envKeyMap[providerId];
}

function buildAvailableModels() {
  const models = new Map<string, AIModel>();

  for (const providerId of getProviders()) {
    for (const model of getModels(providerId)) {
      const key = buildModelKey(providerId, model.id);
      const nextModel = {
        key,
        id: model.id,
        name: model.name || model.id,
        provider: PROVIDER_LABELS[providerId] || providerId,
        providerId,
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

function normalizeModelKey(modelKey?: string | null) {
  if (!modelKey) {
    return null;
  }

  if (modelKey.includes('::')) {
    return modelKey;
  }

  if (modelKey.startsWith('anthropic/')) {
    return buildModelKey('anthropic', modelKey.slice('anthropic/'.length));
  }

  if (modelKey.startsWith('openai/')) {
    return buildModelKey('openai', modelKey.slice('openai/'.length));
  }

  if (modelKey.startsWith('claude-')) {
    return buildModelKey('anthropic', modelKey);
  }

  if (modelKey.startsWith('gpt-') || modelKey.startsWith('o1') || modelKey.startsWith('codex-')) {
    return buildModelKey('openai', modelKey);
  }

  return null;
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}
