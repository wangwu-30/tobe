export const APP_LANGUAGE_OPTIONS = ['zh-CN', 'en-US'] as const;

export type AppLanguage = (typeof APP_LANGUAGE_OPTIONS)[number];

export const DEFAULT_APP_LANGUAGE: AppLanguage = 'zh-CN';

export function normalizeAppLanguage(value?: string | null): AppLanguage {
  if (!value) {
    return DEFAULT_APP_LANGUAGE;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('zh')) {
    return 'zh-CN';
  }

  return 'en-US';
}

export function getBrowserAppLanguage(): AppLanguage {
  if (typeof navigator === 'undefined') {
    return DEFAULT_APP_LANGUAGE;
  }

  return normalizeAppLanguage(navigator.language);
}
