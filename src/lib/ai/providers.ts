import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';

export type CustomProvider = {
  id: string;
  name: string;
  baseURL: string;
  apiKey: string;
  models: { id: string; name: string }[];
};

export type Settings = {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  defaultModel?: string;
  customProviders?: CustomProvider[];
};

export type AIModel = {
  id: string;
  name: string;
  provider: string;
  providerId: string; // "anthropic" | "openai" | custom provider id
};

const BUILTIN_MODELS: AIModel[] = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'Anthropic', providerId: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'Anthropic', providerId: 'anthropic' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', providerId: 'openai' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', providerId: 'openai' },
];

export function getAvailableModels(settings: Settings): AIModel[] {
  const models = [...BUILTIN_MODELS];

  if (settings.customProviders) {
    for (const provider of settings.customProviders) {
      for (const model of provider.models) {
        models.push({
          id: `custom:${provider.id}:${model.id}`,
          name: model.name,
          provider: provider.name,
          providerId: provider.id,
        });
      }
    }
  }

  return models;
}

// Client-side: read from localStorage
export function getAvailableModelsClient(): AIModel[] {
  if (typeof window === 'undefined') return BUILTIN_MODELS;
  const stored = localStorage.getItem('ai-settings');
  if (!stored) return BUILTIN_MODELS;
  try {
    return getAvailableModels(JSON.parse(stored));
  } catch {
    return BUILTIN_MODELS;
  }
}

export function getSettingsFromHeaders(headers: Headers): Settings {
  const settingsHeader = headers.get('x-ai-settings');
  if (settingsHeader) {
    try {
      return JSON.parse(settingsHeader);
    } catch {
      return {};
    }
  }
  return {};
}

export function getModelFromHeaders(headers: Headers, modelOverride?: string) {
  const settings = getSettingsFromHeaders(headers);
  const modelId = modelOverride || settings.defaultModel || 'claude-sonnet-4-20250514';
  return resolveModel(modelId, settings);
}

function resolveModel(modelId: string, settings: Settings) {
  // Custom provider model: "custom:<providerId>:<modelId>"
  if (modelId.startsWith('custom:')) {
    const parts = modelId.split(':');
    const providerId = parts[1];
    const actualModelId = parts.slice(2).join(':');
    const provider = settings.customProviders?.find(p => p.id === providerId);

    if (provider) {
      const custom = createOpenAI({
        baseURL: provider.baseURL,
        apiKey: provider.apiKey || 'sk-placeholder',
      });
      return custom(actualModelId);
    }
  }

  // Anthropic
  if (modelId.startsWith('claude-') || modelId.startsWith('anthropic/')) {
    const id = modelId.replace('anthropic/', '');
    const anthropic = createAnthropic({
      apiKey: settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '',
    });
    return anthropic(id);
  }

  // OpenAI
  if (modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('openai/')) {
    const id = modelId.replace('openai/', '');
    const openai = createOpenAI({
      apiKey: settings.openaiApiKey || process.env.OPENAI_API_KEY || '',
    });
    return openai(id);
  }

  // Fallback: try first custom provider that exists
  if (settings.customProviders?.length) {
    const provider = settings.customProviders[0];
    const custom = createOpenAI({
      baseURL: provider.baseURL,
      apiKey: provider.apiKey || 'sk-placeholder',
    });
    return custom(modelId);
  }

  // Last resort: anthropic
  const anthropic = createAnthropic({
    apiKey: settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '',
  });
  return anthropic('claude-sonnet-4-20250514');
}
