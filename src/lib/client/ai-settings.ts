'use client';

import {
  getBrowserAppLanguage,
  normalizeAppLanguage,
  type AppLanguage,
} from '@/lib/i18n/language';
import { safeJsonParse } from '@/framework/resilience';
import type { ModelCatalogData, ModelSelectionData } from '@/types';

export const AI_SETTINGS_CHANGED_EVENT = 'dao:ai-settings-changed';

type StoredAISettings = Record<string, unknown> & {
  language: AppLanguage;
};

export function getStoredAISettingsHeader(): Record<string, string> {
  if (typeof window === 'undefined') {
    return {} as Record<string, string>;
  }

  const settings = getStoredAISettings();
  return {
    'x-ai-settings': encodeURIComponent(JSON.stringify(settings)),
  };
}

export function setStoredAISettings(value: unknown) {
  if (typeof window === 'undefined') {
    return;
  }

  const nextValue = {
    ...(value && typeof value === 'object' ? (value as Record<string, unknown>) : {}),
    language: normalizeAppLanguage(
      value && typeof value === 'object' && 'language' in (value as Record<string, unknown>)
        ? ((value as Record<string, unknown>).language as string | null | undefined)
        : null
    ),
  };

  window.localStorage.setItem('ai-settings', JSON.stringify(nextValue));
  window.dispatchEvent(new CustomEvent(AI_SETTINGS_CHANGED_EVENT));
}

export function getStoredAISettings(): StoredAISettings {
  if (typeof window === 'undefined') {
    return {
      language: 'zh-CN',
    };
  }

  const raw = window.localStorage.getItem('ai-settings');
  if (!raw) {
    return {
      language: getBrowserAppLanguage(),
    };
  }

  const parsed = safeJsonParse<Record<string, unknown> | null>(raw, null);
  if (!parsed) {
    return {
      language: getBrowserAppLanguage(),
    };
  }

  return {
    ...parsed,
    language: normalizeAppLanguage(parsed.language as string | null | undefined),
  };
}

export function setStoredAppLanguage(language: AppLanguage) {
  if (typeof window === 'undefined') {
    return;
  }

  setStoredAISettings({
    ...getStoredAISettings(),
    language,
  });
}

export function getStoredDefaultModelKey() {
  const settings = getStoredAISettings();
  return typeof settings.defaultModel === 'string' ? settings.defaultModel : null;
}

export function buildStoredModelKey(providerId: string, modelId: string) {
  return `${providerId}::${modelId}`;
}

export function parseStoredModelKey(modelKey?: string | null) {
  if (!modelKey || typeof modelKey !== 'string') {
    return null;
  }

  const separatorIndex = modelKey.indexOf('::');
  if (separatorIndex === -1) {
    return null;
  }

  const providerId = modelKey.slice(0, separatorIndex).trim();
  const modelId = modelKey.slice(separatorIndex + 2).trim();
  if (!providerId || !modelId) {
    return null;
  }

  return {
    key: buildStoredModelKey(providerId, modelId),
    modelId,
    providerId,
  };
}

export function getStoredDefaultModelSelection() {
  return parseStoredModelKey(getStoredDefaultModelKey());
}

export function resolveStoredModelSelection(
  catalog: ModelCatalogData | null,
  selection: ModelSelectionData | null,
  fallbackModelKey?: string | null
) {
  const parsedFallback = parseStoredModelKey(fallbackModelKey);
  const candidate = selection || parsedFallback;
  const providers = catalog?.providers || [];
  if (providers.length === 0) {
    return candidate;
  }

  const fallbackProvider =
    providers.find((provider) => provider.configured && provider.models.length > 0) ||
    providers.find((provider) => provider.models.length > 0) ||
    null;
  const nextProvider =
    providers.find(
      (provider) =>
        provider.id === candidate?.providerId &&
        provider.models.length > 0
    ) || fallbackProvider;

  if (!nextProvider) {
    return candidate;
  }

  const nextModel =
    nextProvider.models.find((model) => model.id === candidate?.modelId) ||
    nextProvider.models[0];

  return {
    key: nextModel.key,
    modelId: nextModel.id,
    providerId: nextProvider.id,
  };
}

export function getStoredAppLanguage() {
  return getStoredAISettings().language;
}
