'use client';

import * as React from 'react';
import { useAppLanguage } from '@/components/providers/language-provider';
import {
  AI_SETTINGS_CHANGED_EVENT,
  getStoredAISettings,
} from '@/lib/client/ai-settings';
import { normalizeCommentAgents } from '@/lib/comments/agents';
import type { CommentAgentConfigData } from '@/types';

export function useCommentAgents() {
  const language = useAppLanguage();
  const [agents, setAgents] = React.useState<CommentAgentConfigData[]>(() =>
    normalizeCommentAgents(getStoredAISettings().commentAgents, language)
  );

  React.useEffect(() => {
    const syncAgents = () => {
      setAgents(normalizeCommentAgents(getStoredAISettings().commentAgents, language));
    };

    syncAgents();
    window.addEventListener(AI_SETTINGS_CHANGED_EVENT, syncAgents);
    return () => {
      window.removeEventListener(AI_SETTINGS_CHANGED_EVENT, syncAgents);
    };
  }, [language]);

  return agents;
}
