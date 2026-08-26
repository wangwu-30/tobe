'use client';

import * as React from 'react';
import { BookOpen } from 'lucide-react';

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
      className="mx-auto w-full max-w-3xl"
      data-testid="home-onboarding-chat"
    >
      <div className="px-4 pb-6 pt-8 text-center sm:pt-12">
        <h1
          className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl"
          id="home-onboarding-title"
        >
          {t('home.heroTitle')}
        </h1>
      </div>

      <div>
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
            composerPlaceholder={t('home.chatPlaceholder')}
            conversationId={conversationId}
            emptyState={null}
            initialMessages={messages}
            onMessagesChange={handleMessagesChange}
            onBusyChange={setIsBusy}
            onWorkspaceChange={handleWorkspaceChange}
            scope="onboarding"
            showHeader={false}
            variant="home"
            workspaceId={null}
          />
        )}
      </div>

      {!isRestoring && !restoreError ? (
        <div className="flex justify-center pt-2">
          <Button
            aria-busy={isBusy}
            className="h-11 min-h-11 gap-1.5 px-2 text-muted-foreground md:h-11 md:min-h-11"
            data-testid="home-onboarding-create-wiki"
            disabled={isBusy}
            onClick={() => onCreateWiki({ conversationId, goal: lastGoal })}
            size="sm"
            variant="ghost"
          >
            <BookOpen aria-hidden="true" className="h-3.5 w-3.5" />
            {t('home.createWikiSpace')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
