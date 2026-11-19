'use client';

import * as React from 'react';
import { BookOpen, Sparkles } from 'lucide-react';

import { ChatPanel } from '@/components/chat/chat-panel';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/framework/resilience';
import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import { useAppLanguage, useT } from '@/components/providers/language-provider';
import type { ChatMessageData } from '@/types';

import {
  deriveOnboardingWikiProposal,
  stripOnboardingProposalBlocks,
} from './onboarding-proposal';
import {
  clearOnboardingConversationId,
  findLastUserGoal,
  loadOnboardingConversationId,
  persistOnboardingConversationId,
} from './onboarding-session';

type HomeOnboardingChatProps = {
  onCreateWiki: (context: {
    conversationId: string | null;
    goal: string;
    title?: string;
  }) => void;
};

const PROPOSAL_CARD_COPY = {
  'en-US': {
    action: 'Review & Create',
    assistantEyebrow: 'Suggested Wiki Space',
    hint: 'Review the name and purpose before creating. Your conversation stays attached.',
    summaryEyebrow: 'Ready to start a Wiki Space?',
  },
  'zh-CN': {
    action: '确认并创建',
    assistantEyebrow: '建议创建的 Wiki 空间',
    hint: '点击后需确认名称与用途才会创建，当前对话会自动延续。',
    summaryEyebrow: '准备沉淀为 Wiki 空间？',
  },
} as const;

export function HomeOnboardingChat({ onCreateWiki }: HomeOnboardingChatProps) {
  const language = useAppLanguage();
  const t = useT();
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessageData[]>([]);
  const [liveMessages, setLiveMessages] = React.useState<ChatMessageData[]>([]);
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
          setLiveMessages([]);
          setLastGoal('');
          return;
        }

        const messagePayload = await messagesResponse.json().catch(() => []);
        const restoredMessages = Array.isArray(messagePayload) ? messagePayload : [];
        setMessages(restoredMessages);
        setLiveMessages(restoredMessages);
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
    setLiveMessages(nextMessages);
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
    setLiveMessages([]);
    setLastGoal('');
    setRestoreError(false);
  }, [conversationId]);

  const proposal = React.useMemo(
    () => deriveOnboardingWikiProposal(liveMessages),
    [liveMessages]
  );
  const proposalCopy = PROPOSAL_CARD_COPY[language];

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
            formatAssistantMessage={stripOnboardingProposalBlocks}
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

      {!isRestoring && !restoreError && !isBusy && proposal ? (
        <div
          className="mt-4 rounded-xl border border-border bg-card/90 p-4 shadow-sm"
          data-testid="home-onboarding-proposal-card"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-brand" />
                <span>
                  {proposal.source === 'assistant-structured'
                    ? proposalCopy.assistantEyebrow
                    : proposalCopy.summaryEyebrow}
                </span>
              </div>
              <div
                className="truncate text-sm font-semibold text-foreground"
                data-testid="home-onboarding-proposal-title"
              >
                {proposal.title}
              </div>
              {proposal.purpose ? (
                <p
                  className="line-clamp-2 text-xs leading-5 text-muted-foreground"
                  data-testid="home-onboarding-proposal-purpose"
                >
                  {proposal.purpose}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">{proposalCopy.hint}</p>
            </div>
            <Button
              className="min-h-11 shrink-0 gap-1.5 sm:min-h-9"
              data-testid="home-onboarding-proposal-action"
              onClick={() =>
                onCreateWiki({
                  conversationId,
                  goal: proposal.purpose || lastGoal,
                  title: proposal.title,
                })
              }
              size="sm"
              type="button"
            >
              <BookOpen aria-hidden="true" className="h-3.5 w-3.5" />
              {proposalCopy.action}
            </Button>
          </div>
        </div>
      ) : null}

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
