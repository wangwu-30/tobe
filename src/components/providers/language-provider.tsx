'use client';

import * as React from 'react';
import {
  AI_SETTINGS_CHANGED_EVENT,
  getStoredAppLanguage,
} from '@/lib/client/ai-settings';
import type { AppCopyKey } from '@/lib/i18n/copy';
import { translate } from '@/lib/i18n/copy';
import type { AppLanguage } from '@/lib/i18n/language';

type LanguageContextValue = {
  language: AppLanguage;
  t: (
    key: AppCopyKey,
    params?: Record<string, string | number | null | undefined>
  ) => string;
};

const LanguageContext = React.createContext<LanguageContextValue>({
  language: 'zh-CN',
  t: (key) => key,
});

export function LanguageProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [language, setLanguage] = React.useState<AppLanguage>('zh-CN');

  React.useEffect(() => {
    const syncLanguage = () => {
      setLanguage(getStoredAppLanguage());
    };

    syncLanguage();
    window.addEventListener('storage', syncLanguage);
    window.addEventListener(AI_SETTINGS_CHANGED_EVENT, syncLanguage);

    return () => {
      window.removeEventListener('storage', syncLanguage);
      window.removeEventListener(AI_SETTINGS_CHANGED_EVENT, syncLanguage);
    };
  }, []);

  React.useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = React.useMemo<LanguageContextValue>(
    () => ({
      language,
      t: (key, params) => translate(language, key, params),
    }),
    [language]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useAppLanguage() {
  return React.useContext(LanguageContext).language;
}

export function useT() {
  return React.useContext(LanguageContext).t;
}
