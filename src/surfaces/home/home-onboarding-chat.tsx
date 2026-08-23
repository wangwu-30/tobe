'use client';

import * as React from 'react';
import { BookOpen, Sparkles } from 'lucide-react';

import { ChatPanel } from '@/components/chat/chat-panel';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/framework/resilience';
import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import { useT } from '@/components/providers/language-provider';
import type { ChatMessageData } from '@/types';

import {
  clearOnboardingConversationId,
  findLastUserGoal,
  loadOnboardingConversationId,
  persistOnboardingConversationId,
} from './onboarding-session';

type HomeOnboardingChatProps = {
  onCreateWiki: (context: { conversationId: string | null; goal: string }) => void;
};

export function HomeOnboardingChat({ onCreateWiki }: HomeOnboardingChatProps) {
  const t = useT();
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessageData[]>([]);
  const [lastGoal, setLastGoal] = React.useState('');
  const [isRestoring, setIsRestoring] = React.useState(true);
  const [isBusy, setIsBusy] = React.useState(false);
  const [restoreError, setRestoreError] = React.useState(false);

  React.useEffect(() => {
    const restoredConversationId = loadOnboardingConversationId();
    if (!restoredConversationId) {
      setIsRestoring(false);
      return;
    }

    let cancelled = false;
    setRestoreError(false);
    setConversationId(restoredConversationId);

    void apiFetch(
      `/api/conversations/${encodeURIComponent(restoredConversationId)}/messages?scope=onboarding`,
      { headers: getStoredAISettingsHeader() }
    )
      .then(async (messagesResponse) => {
        if (cancelled) {
          return;
        }
        if (!messagesResponse.ok) {
          if (messagesResponse.status !== 404 && messagesResponse.status !== 409) {
            setRestoreError(true);
            return;
          }

          clearOnboardingConversationId(restoredConversationId);
          setConversationId(null);
          setMessages([]);
          setLastGoal('');
          return;
        }

        const messagePayload = await messagesResponse.json().catch(() => []);
        const restoredMessages = Array.isArray(messagePayload) ? messagePayload : [];
        setMessages(restoredMessages);
        setLastGoal(findLastUserGoal(restoredMessages));
      })
      .catch(() => {
        if (!cancelled) {
          setRestoreError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsRestoring(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleWorkspaceChange = React.useCallback(
    (workspace: { conversationId: string | null; workspaceId: string | null }) => {
      if (workspace.conversationId) {
        setConversationId(workspace.conversationId);
        persistOnboardingConversationId(workspace.conversationId);
      }
    },
    []
  );

  const handleMessagesChange = React.useCallback((nextMessages: ChatMessageData[]) => {
    const nextGoal = findLastUserGoal(nextMessages);
    if (!nextGoal) {
      return;
    }

    setLastGoal((currentGoal) =>
      currentGoal === nextGoal ? currentGoal : nextGoal
    );
  }, []);

  const startNewConversation = React.useCallback(() => {
    clearOnboardingConversationId(conversationId);
    setConversationId(null);
    setMessages([]);
    setLastGoal('');
    setRestoreError(false);
  }, [conversationId]);

  return (
    <section
      aria-labelledby="home-onboarding-title"
      className="overflow-hidden rounded-[28px] border border-border/70 bg-background shadow-sm"
      data-testid="home-onboarding-chat"
    >
      <div className="border-b border-border/70 bg-gradient-to-br from-primary/[0.08] via-background to-background px-5 py-5 sm:px-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
              {t('home.badge')}
            </div>
            <h1 id="home-onboarding-title" className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              {t('home.heroTitle')}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {t('home.heroDescription')}
            </p>
          </div>
          <Button
            aria-busy={isBusy}
            className="shrink-0 gap-2 rounded-xl"
            data-testid="home-onboarding-create-wiki"
            disabled={isBusy}
            onClick={() => onCreateWiki({ conversationId, goal: lastGoal })}
          >
            <BookOpen aria-hidden="true" className="h-4 w-4" />
            {t('home.createWikiSpace')}
          </Button>
        </div>
      </div>

      <div className="h-[min(62vh,620px)] min-h-[420px]">
        {isRestoring ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">
            {t('common.loading')}
          </div>
        ) : restoreError ? (
          <div
            className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
            role="alert"
          >
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              {t('chat.timeoutDetail')}
            </p>
            <Button onClick={startNewConversation} type="button" variant="outline">
              {t('chat.newConversation')}
            </Button>
          </div>
        ) : (
          <ChatPanel
            allowAttachments={false}
            allowDeepResearch={false}
            composerHint={t('home.card3')}
            conversationId={conversationId}
            emptyState={{
              description: t('home.heroDescription'),
              title: t('home.askAssistant'),
            }}
            initialMessages={messages}
            onMessagesChange={handleMessagesChange}
            onBusyChange={setIsBusy}
            onWorkspaceChange={handleWorkspaceChange}
            scope="onboarding"
            showHeader={false}
            workspaceId={null}
          />
        )}
      </div>
    </section>
  );
}
