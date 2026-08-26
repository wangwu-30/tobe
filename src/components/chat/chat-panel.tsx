'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChatMessage } from './chat-message';
import { ChatInput } from './chat-input';
import { useChat } from '@/hooks/use-chat';
import type {
  AssistantRunData,
  ChatMessageData,
  ConversationBranchSummary,
  ModelCatalogData,
  ModelSelectionData,
  ResearchMode,
} from '@/types';
import type { ChatComposerAttachment } from '@/components/chat/attachment-types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, FileText, LoaderCircle, Search, Wand2 } from 'lucide-react';
import {
  AI_SETTINGS_CHANGED_EVENT,
  getStoredAISettingsHeader,
  getStoredDefaultModelSelection,
  resolveStoredModelSelection,
} from '@/lib/client/ai-settings';
import { useT } from '@/components/providers/language-provider';
import { apiCall, apiCallOrThrow } from '@/framework/resilience';
import { shouldHydrateChatMessages } from '@/lib/chat/message-hydration';

const DEFAULT_CHAT_MODEL_KEY = 'openai-codex::gpt-5.4';
const INTERNAL_FIRST_PASS_PREFIX = 'Take the first author pass for this deliverable.';

export function ChatPanel({
  allowAttachments = true,
  allowDeepResearch = true,
  activeAssistantRun,
  conversationId,
  conversationRuns,
  conversationTitle,
  baseVersionLabel,
  branches,
  workspaceId,
  activeFileId,
  baseVersionId,
  queuedPrompt,
  onBranchConversation,
  onBusyChange,
  onConversationComplete,
  onQueuedPromptHandled,
  onSelectConversation,
  onOpenFile,
  onWorkspaceChange,
  initialMessages,
  showHeader = true,
  scope = 'workspace',
  emptyState,
  composerHint,
  composerPlaceholder,
  variant = 'workspace',
  onMessagesChange,
  onChatErrorChange,
}: {
  allowAttachments?: boolean;
  allowDeepResearch?: boolean;
  activeAssistantRun?: AssistantRunData | null;
  conversationId?: string | null;
  conversationRuns?: AssistantRunData[];
  conversationTitle?: string | null;
  baseVersionLabel?: string | null;
  branches?: ConversationBranchSummary[];
  workspaceId?: string | null;
  activeFileId?: string | null;
  baseVersionId?: string | null;
  queuedPrompt?: {
    content: string;
    id: string;
    researchMode?: ResearchMode;
  } | null;
  onBranchConversation?: (messageId: string) => void;
  onBusyChange?: (isBusy: boolean) => void;
  onConversationComplete?: () => void | Promise<void>;
  onQueuedPromptHandled?: (promptId: string) => void;
  onSelectConversation?: (conversationId: string) => void;
  onOpenFile?: (fileId: string) => void;
  onWorkspaceChange?: (workspace: {
    conversationId: string | null;
    workspaceId: string | null;
  }) => void;
  onChatErrorChange?: (
    error: { detail: string; message: string; retryable: boolean; kind: string } | null,
    retryFn?: () => void
  ) => void;
  initialMessages?: ChatMessageData[];
  showHeader?: boolean;
  scope?: 'onboarding' | 'workspace';
  emptyState?: { description: string; title: string } | null;
  composerHint?: string | null;
  composerPlaceholder?: string;
  variant?: 'home' | 'workspace';
  onMessagesChange?: (messages: ChatMessageData[]) => void;
}) {
  const t = useT();
  const {
    messages,
    setMessages,
    isLoading,
    error,
    statusMessage,
    sendMessage,
    continueProposal,
    startResearch,
    retryLastMessage,
    stopGeneration,
  } = useChat({
    activeFileId,
    baseVersionId,
    conversationId,
    focusNodeId: workspaceId,
    workspaceId,
    scope,
  });
  const [modelCatalog, setModelCatalog] = React.useState<ModelCatalogData | null>(null);
  const [selectedModelSelection, setSelectedModelSelection] =
    React.useState<ModelSelectionData | null>(() =>
      resolveStoredModelSelection(null, null, DEFAULT_CHAT_MODEL_KEY)
    );
  const [proposalActionId, setProposalActionId] = React.useState<string | null>(null);
  const [proposalActionError, setProposalActionError] = React.useState<{
    message: string;
    runId: string;
  } | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = React.useRef(true);
  const flatBranches = React.useMemo(
    () => flattenBranches(branches || []),
    [branches]
  );
  const showPanelHeader =
    variant !== 'home' ||
    showHeader ||
    (flatBranches.length > 1 && Boolean(onSelectConversation)) ||
    Boolean(conversationTitle) ||
    Boolean(baseVersionLabel);
  const lastHydratedConversationRef = React.useRef<string | null>(
    conversationId || null
  );
  const adoptedConversationIdRef = React.useRef<string | null>(null);
  const handledQueuedPromptRef = React.useRef<string | null>(null);
  const hasManualModelSelectionRef = React.useRef(false);
  const lastModelContextRef = React.useRef<string | null>(null);

  const visibleMessages = React.useMemo(
    () => messages.filter((message) => !shouldHideChatMessage(message, isLoading)),
    [isLoading, messages]
  );
  const isWaitingForFirstPass = React.useMemo(
    () =>
      visibleMessages.length === 0 &&
      messages.some(
        (message) =>
          message.role === 'user' && isInternalFirstPassPrompt(message.content)
      ),
    [messages, visibleMessages.length]
  );
  const displayRuns = React.useMemo(
    () => buildDisplayRuns(conversationRuns || [], activeAssistantRun || null),
    [activeAssistantRun, conversationRuns]
  );
  const isHomeInitialState =
    variant === 'home' &&
    visibleMessages.length === 0 &&
    displayRuns.length === 0 &&
    !isWaitingForFirstPass &&
    !error &&
    !isLoading;

  const loadModelCatalog = React.useCallback(async () => {
    const result = await apiCall<ModelCatalogData>('/api/ai/models', {
      headers: getStoredAISettingsHeader(),
    });
    if (!result.ok || !result.data) {
      return;
    }

    const data = result.data;
    setModelCatalog(data);
    setSelectedModelSelection((current) =>
      resolveStoredModelSelection(
        data,
        hasManualModelSelectionRef.current ? current : getStoredDefaultModelSelection(),
        data.defaultModelKey
      )
    );
  }, []);

  const syncSelectedModelToDefault = React.useCallback(() => {
    setSelectedModelSelection(
      resolveStoredModelSelection(
        modelCatalog,
        getStoredDefaultModelSelection(),
        modelCatalog?.defaultModelKey || DEFAULT_CHAT_MODEL_KEY
      )
    );
  }, [modelCatalog]);

  React.useEffect(() => {
    const syncSelectedModel = () => {
      void loadModelCatalog();
    };

    void loadModelCatalog();
    window.addEventListener('storage', syncSelectedModel);
    window.addEventListener(AI_SETTINGS_CHANGED_EVENT, syncSelectedModel);

    return () => {
      window.removeEventListener('storage', syncSelectedModel);
      window.removeEventListener(AI_SETTINGS_CHANGED_EVENT, syncSelectedModel);
    };
  }, [loadModelCatalog]);

  React.useEffect(() => {
    const contextKey = `${workspaceId || 'workspace:none'}:${conversationId || 'conversation:none'}`;
    if (lastModelContextRef.current === contextKey) {
      return;
    }

    lastModelContextRef.current = contextKey;
    hasManualModelSelectionRef.current = false;
    syncSelectedModelToDefault();
  }, [conversationId, syncSelectedModelToDefault, workspaceId]);

  React.useEffect(() => {
    onChatErrorChange?.(error, retryLastMessage);
  }, [error, onChatErrorChange, retryLastMessage]);

  React.useEffect(() => {
    const nextConversationId = conversationId || null;
    const serverMessages = initialMessages || [];

    if (
      nextConversationId &&
      adoptedConversationIdRef.current === nextConversationId &&
      serverMessages.length === 0
    ) {
      lastHydratedConversationRef.current = nextConversationId;
      return;
    }

    adoptedConversationIdRef.current = null;

    const conversationChanged =
      lastHydratedConversationRef.current !== nextConversationId;

    setMessages((currentMessages) => {
      if (
        !shouldHydrateChatMessages({
          conversationChanged,
          currentMessages,
          isLoading,
          serverMessages,
        })
      ) {
        return currentMessages;
      }

      lastHydratedConversationRef.current = nextConversationId;
      return serverMessages;
    });
  }, [conversationId, initialMessages, isLoading, setMessages]);

  React.useEffect(() => {
    onBusyChange?.(isLoading);
  }, [isLoading, onBusyChange]);

  React.useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  React.useEffect(() => {
    if (scrollRef.current && shouldAutoScrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [displayRuns, messages]);

  React.useEffect(() => {
    shouldAutoScrollRef.current = true;
  }, [conversationId]);

  const handleTimelineScroll = React.useCallback(() => {
    const timeline = scrollRef.current;
    if (!timeline) {
      return;
    }

    const distanceFromBottom =
      timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;
  }, []);

  const handleWorkspaceChange = React.useCallback(
    (workspace: {
      conversationId: string | null;
      workspaceId: string | null;
    }) => {
      if (workspace.conversationId) {
        // A conversation id returned by this panel's own request adopts the
        // in-memory timeline; it is not an external conversation switch.
        lastHydratedConversationRef.current = workspace.conversationId;
        if (workspace.conversationId !== (conversationId || null)) {
          adoptedConversationIdRef.current = workspace.conversationId;
        }
      }
      onWorkspaceChange?.(workspace);
    },
    [conversationId, onWorkspaceChange]
  );

  const handleSend = React.useCallback(
    (
      content: string,
      options?: {
        attachments?: ChatComposerAttachment[];
        researchMode?: ResearchMode;
      }
    ) => {
      shouldAutoScrollRef.current = true;
      const activeModelKey = selectedModelSelection?.key || DEFAULT_CHAT_MODEL_KEY;
      sendMessage(content, {
        attachments: options?.attachments,
        hiddenFromTimeline: isInternalFirstPassPrompt(content),
        model: activeModelKey,
        onComplete: onConversationComplete,
        onWorkspaceChange: handleWorkspaceChange,
        researchMode: options?.researchMode,
      });
    },
    [handleWorkspaceChange, onConversationComplete, selectedModelSelection, sendMessage]
  );

  const handleModelSelectionChange = React.useCallback((selection: ModelSelectionData) => {
    hasManualModelSelectionRef.current = true;
    setSelectedModelSelection(selection);
  }, []);

  React.useEffect(() => {
    if (!queuedPrompt || handledQueuedPromptRef.current === queuedPrompt.id) {
      return;
    }

    handledQueuedPromptRef.current = queuedPrompt.id;
    handleSend(queuedPrompt.content, {
      researchMode: queuedPrompt.researchMode,
    });
    onQueuedPromptHandled?.(queuedPrompt.id);
  }, [handleSend, onQueuedPromptHandled, queuedPrompt]);

  const handleProposalAction = React.useCallback(
    async (
      run: AssistantRunData,
      action: 'apply' | 'dismiss'
    ) => {
      if (!workspaceId || proposalActionId || isLoading) {
        return;
      }
      if (action === 'dismiss' && !window.confirm(t('chat.replanKeepCurrentConfirm'))) {
        return;
      }

      setProposalActionId(`${run.id}:${action}`);
      setProposalActionError(null);

      try {
        await apiCallOrThrow(
          `/api/workspaces/${workspaceId}/assistant-runs/${run.id}/proposal`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...getStoredAISettingsHeader(),
            },
            body: JSON.stringify({ action }),
            fallbackMessage: t('chat.replanActionFailed'),
          }
        );

        if (action === 'dismiss') {
          await onConversationComplete?.();
          return;
        }

        await onConversationComplete?.();
        await continueProposal(run.id, {
          onComplete: onConversationComplete,
          onWorkspaceChange: handleWorkspaceChange,
        });
      } catch (error) {
        setProposalActionError({
          message: error instanceof Error ? error.message : t('chat.replanActionFailed'),
          runId: run.id,
        });
      } finally {
        setProposalActionId(null);
      }
    },
    [
      continueProposal,
      handleWorkspaceChange,
      isLoading,
      onConversationComplete,
      proposalActionId,
      t,
      workspaceId,
    ]
  );

  const handleResearchAction = React.useCallback(
    async (run: AssistantRunData, action: 'start' | 'dismiss') => {
      if (!workspaceId || proposalActionId || isLoading) {
        return;
      }
      if (action === 'dismiss' && !window.confirm(t('chat.researchDismissConfirm'))) {
        return;
      }

      setProposalActionId(`${run.id}:${action}`);
      setProposalActionError(null);

      try {
        await apiCallOrThrow(
          `/api/workspaces/${workspaceId}/assistant-runs/${run.id}/research-plan`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...getStoredAISettingsHeader(),
            },
            body: JSON.stringify({ action: action === 'dismiss' ? 'dismiss' : 'approve' }),
            fallbackMessage: t('chat.researchActionFailed'),
          }
        );

        await onConversationComplete?.();
        if (action === 'dismiss') {
          return;
        }

        await startResearch(run.id, {
          onComplete: onConversationComplete,
          onWorkspaceChange: handleWorkspaceChange,
        });
      } catch (error) {
        setProposalActionError({
          message: error instanceof Error ? error.message : t('chat.researchActionFailed'),
          runId: run.id,
        });
      } finally {
        setProposalActionId(null);
      }
    },
    [
      handleWorkspaceChange,
      isLoading,
      onConversationComplete,
      proposalActionId,
      startResearch,
      t,
      workspaceId,
    ]
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {showPanelHeader ? (
        <div className="border-b border-border px-4 py-2.5">
          <div className="min-w-0 space-y-2">
            {showHeader ? (
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <FileText aria-hidden="true" className="h-4 w-4" />
                {t('assistant.chat')}
              </h2>
            ) : null}
            {flatBranches.length > 1 && onSelectConversation ? (
              <Select
                value={conversationId || ''}
                onValueChange={(value) => onSelectConversation(value)}
              >
                <SelectTrigger
                  aria-label={t('chat.selectConversation')}
                  className="h-11 w-full max-w-[220px] text-xs sm:h-7"
                  data-testid="chat-conversation-select"
                >
                  <SelectValue placeholder={t('chat.selectConversation')} />
                </SelectTrigger>
                <SelectContent className="motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none">
                  {flatBranches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id} className="text-xs">
                      {branch.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : conversationTitle ? (
              <p
                className="truncate text-xs text-muted-foreground"
                title={formatConversationTitle(conversationTitle)}
              >
                {t('chat.conversationPrefix', {
                  title: formatConversationTitle(conversationTitle),
                })}
              </p>
            ) : null}
            {baseVersionLabel ? (
              <Badge
                variant="outline"
                className="w-fit max-w-full truncate text-[10px] font-normal"
                data-testid="chat-base-version-label"
                title={baseVersionLabel}
              >
                {baseVersionLabel}
              </Badge>
            ) : null}
          </div>
        </div>
      ) : null}

      {!isHomeInitialState ? (
        <div
          ref={scrollRef}
          aria-label={t('assistant.chat')}
          aria-busy={isLoading}
          aria-live="polite"
          aria-relevant="additions text"
          className="min-h-0 min-w-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain scroll-pb-32"
          onScroll={handleTimelineScroll}
          role="log"
          tabIndex={0}
        >
          <div className="min-w-0 py-4 pb-28">
            {displayRuns.length > 0 ? (
              <div className="space-y-3 px-4 pb-4">
                {displayRuns.map((run) => (
                  <ConversationRunCard
                    key={run.id}
                    run={run}
                    actionError={
                      proposalActionError?.runId === run.id
                        ? proposalActionError.message
                        : null
                    }
                    actionState={proposalActionId}
                    disabled={isLoading}
                    onOpenFile={onOpenFile}
                    onProposalAction={handleProposalAction}
                    onResearchAction={handleResearchAction}
                  />
                ))}
              </div>
            ) : null}

            {visibleMessages.length === 0 &&
            (variant !== 'home' || isWaitingForFirstPass) ? (
              <div
                className="flex flex-col items-center justify-center px-4 py-16 text-center text-muted-foreground"
                role={isWaitingForFirstPass ? 'status' : undefined}
                aria-live={isWaitingForFirstPass ? 'polite' : undefined}
              >
                <FileText aria-hidden="true" className="mb-3 h-10 w-10 opacity-30" />
                <p className="text-sm">
                  {emptyState && !isWaitingForFirstPass
                    ? emptyState.title
                    : t(
                        isWaitingForFirstPass
                          ? 'chat.waitingForFirstPassTitle'
                          : 'chat.emptyTitle'
                      )}
                </p>
                <p className="mt-1 text-xs">
                  {emptyState && !isWaitingForFirstPass
                    ? emptyState.description
                    : t(
                        isWaitingForFirstPass
                          ? 'chat.waitingForFirstPassDescription'
                          : 'chat.emptyDescription'
                      )}
                </p>
              </div>
            ) : null}

            {visibleMessages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                onBranch={
                  message.content.trim().length > 0 && !isLoading
                    ? onBranchConversation
                    : undefined
                }
              />
            ))}

            {error ? (
              <div className="px-4 pb-3">
                <div
                  className="break-words rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm text-destructive [overflow-wrap:anywhere]"
                  role="alert"
                >
                  <div>{error.message}</div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {error.retryable ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-11 sm:h-8"
                        onClick={retryLastMessage}
                      >
                        {t('chat.retry')}
                      </Button>
                    ) : null}
                    {error.showSettings ? (
                      <Button
                        asChild
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-11 sm:h-8"
                      >
                        <Link href="/settings">{t('chat.openSettings')}</Link>
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {isLoading && statusMessage ? (
              <div className="px-4 pb-3">
                <div
                  className="break-words rounded-2xl border border-border/70 bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {statusMessage}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <ChatInput
        allowAttachments={allowAttachments}
        allowDeepResearch={allowDeepResearch}
        capabilityHint={composerHint}
        onSend={handleSend}
        onStop={stopGeneration}
        isLoading={isLoading}
        modelCatalog={modelCatalog}
        modelLabel={formatModelLabel(
          selectedModelSelection?.key || DEFAULT_CHAT_MODEL_KEY,
          modelCatalog
        )}
        modelSelection={selectedModelSelection}
        onModelSelectionChange={handleModelSelectionChange}
        placeholder={composerPlaceholder}
        variant={variant}
      />
    </div>
  );
}

function ConversationRunCard({
  actionError,
  actionState,
  disabled = false,
  onOpenFile,
  onProposalAction,
  onResearchAction,
  run,
}: {
  actionError?: string | null;
  actionState?: string | null;
  disabled?: boolean;
  onOpenFile?: (fileId: string) => void;
  onProposalAction?: (run: AssistantRunData, action: 'apply' | 'dismiss') => void;
  onResearchAction?: (run: AssistantRunData, action: 'start' | 'dismiss') => void;
  run: AssistantRunData & { isLocal?: boolean };
}) {
  const t = useT();
  const isBusy =
    run.status === 'queued' || run.status === 'planning' || run.status === 'running';
  const proposal = run.planProposal || null;
  const researchPlan = run.researchPlanProposal || null;
  const researchProgress = run.researchProgress || null;
  const isProposalPending = proposal?.status === 'pending';
  const isApplying = actionState === `${run.id}:apply`;
  const isDismissing = actionState === `${run.id}:dismiss`;
  const isStartingResearch = actionState === `${run.id}:start`;
  const hasResearchReport =
    Boolean(researchProgress?.reportFileId) && Boolean(researchProgress?.reportFileName);

  return (
    <div
      className="min-w-0 break-words rounded-2xl border border-border/70 bg-muted/20 px-3 py-3 [overflow-wrap:anywhere] sm:px-4"
      data-testid={`assistant-run-card-${run.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Wand2 aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div
              className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
              title={run.title}
            >
              {run.title}
            </div>
            <Badge
              variant={isBusy ? 'secondary' : 'outline'}
              className="shrink-0 text-[10px]"
              role="status"
              aria-live="polite"
            >
              {formatRunStatus(run.status, t)}
            </Badge>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {run.summary ||
              (isBusy ? t('chat.runInProgress') : t('chat.runCompletedNoSummary'))}
          </p>
        </div>
        {isBusy ? (
          <LoaderCircle
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary motion-reduce:animate-none"
          />
        ) : null}
      </div>

      {proposal ? (
        <div className="mt-3 rounded-2xl border border-border/70 bg-background/80 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {t('chat.replanProposal')}
            </div>
            <Badge variant={proposal.status === 'applied' ? 'secondary' : 'outline'} className="text-[10px]">
              {proposal.status === 'applied'
                ? t('chat.replanApplied')
                : proposal.status === 'dismissed'
                  ? t('chat.replanDismissed')
                  : t('chat.replanPending')}
            </Badge>
          </div>
          <div className="mt-3 space-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('chat.replanGoal')}
              </div>
              <div className="mt-1 text-sm leading-6 text-foreground">{proposal.goal}</div>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{proposal.summary}</p>
            <div className="space-y-2">
              {proposal.stages.map((stage, index) => (
                <div
                  key={`${run.id}-${stage.id}`}
                  className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] text-muted-foreground">
                      {index + 1}
                    </span>
                    <span>{stage.title}</span>
                    {stage.checkpoint ? (
                      <Badge variant="outline" className="text-[10px]">
                        {t('plan.checkpoint')}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {stage.description}
                  </p>
                </div>
              ))}
            </div>
            {isProposalPending && onProposalAction ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-11 sm:h-8"
                  disabled={disabled || Boolean(actionState)}
                  aria-busy={isApplying}
                  onClick={() => onProposalAction(run, 'apply')}
                >
                  {isApplying ? t('chat.replanApplying') : t('chat.replanApplyAndContinue')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-11 sm:h-8"
                  disabled={disabled || Boolean(actionState)}
                  aria-busy={isDismissing}
                  onClick={() => onProposalAction(run, 'dismiss')}
                >
                  {isDismissing ? t('chat.replanKeeping') : t('chat.replanKeepCurrent')}
                </Button>
              </div>
            ) : null}
            {actionError ? (
              <div
                className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive"
                role="alert"
              >
                {actionError}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {researchPlan ? (
        <div className="mt-3 rounded-2xl border border-border/70 bg-background/80 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <Search aria-hidden="true" className="h-3.5 w-3.5" />
              {t('chat.researchProposal')}
            </div>
            <Badge
              variant={researchPlan.status === 'approved' ? 'secondary' : 'outline'}
              className="text-[10px]"
            >
              {researchPlan.status === 'approved'
                ? t('chat.researchApproved')
                : researchPlan.status === 'dismissed'
                  ? t('chat.researchDismissed')
                  : t('chat.researchPending')}
            </Badge>
          </div>
          <div className="mt-3 space-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('chat.researchTitle')}
              </div>
              <div className="mt-1 text-sm leading-6 text-foreground">
                {researchPlan.title}
              </div>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{researchPlan.summary}</p>
            {researchPlan.subquestions.length > 0 ? (
              <div className="space-y-2">
                {researchPlan.subquestions.map((question, index) => (
                  <div
                    key={`${run.id}-research-${index}`}
                    className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] text-muted-foreground">
                        {index + 1}
                      </span>
                      <span>{question}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {researchPlan.status === 'pending' && onResearchAction ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-11 sm:h-8"
                  disabled={disabled || Boolean(actionState)}
                  aria-busy={isStartingResearch}
                  onClick={() => onResearchAction(run, 'start')}
                >
                  {isStartingResearch ? t('chat.researchStarting') : t('chat.researchStart')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-11 sm:h-8"
                  disabled={disabled || Boolean(actionState)}
                  aria-busy={isDismissing}
                  onClick={() => onResearchAction(run, 'dismiss')}
                >
                  {isDismissing ? t('chat.researchDismissing') : t('chat.researchDismiss')}
                </Button>
              </div>
            ) : null}
            {actionError ? (
              <div
                className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive"
                role="alert"
              >
                {actionError}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {researchProgress ? (
        <div
          className="mt-3 rounded-2xl border border-border/70 bg-background/80 px-3 py-3"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <Search aria-hidden="true" className="h-3.5 w-3.5" />
              {t('chat.researchProgress')}
            </div>
            <Badge variant={researchProgress.phase === 'completed' ? 'secondary' : 'outline'} className="text-[10px]">
              {formatResearchPhase(researchProgress.phase, t)}
            </Badge>
          </div>
          <div className="mt-3 space-y-2">
            {researchProgress.currentStepLabel ? (
              <p className="text-xs leading-5 text-muted-foreground">
                {researchProgress.currentStepLabel}
              </p>
            ) : null}
            {researchProgress.stepIndex && researchProgress.totalSteps ? (
              <p className="text-[11px] text-muted-foreground">
                {t('chat.researchStepProgress', {
                  current: researchProgress.stepIndex,
                  total: researchProgress.totalSteps,
                })}
              </p>
            ) : null}
            {researchProgress.providerState === 'unavailable' ? (
              <div
                className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive"
                role="alert"
              >
                <div>{t('chat.researchProviderUnavailable')}</div>
                <div className="mt-2">
                  <Button
                    asChild
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-11 px-2 text-[10px] text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-7"
                  >
                    <Link href="/settings">{t('chat.openSettings')}</Link>
                  </Button>
                </div>
              </div>
            ) : null}
            {hasResearchReport && onOpenFile ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-11 max-w-full sm:h-8"
                onClick={() => onOpenFile(researchProgress.reportFileId!)}
              >
                <ExternalLink aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
                <span className="truncate">{t('chat.openResearchReport')}</span>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildDisplayRuns(
  conversationRuns: AssistantRunData[],
  activeAssistantRun: AssistantRunData | null
) {
  const runs = [...conversationRuns];

  if (activeAssistantRun && !runs.some((run) => run.id === activeAssistantRun.id)) {
    runs.push(activeAssistantRun);
  }

  return runs.sort(
    (left, right) =>
      new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime()
  );
}

function formatConversationTitle(title: string) {
  return title.replace(/^Branch:\s*/i, '');
}

function isInternalFirstPassPrompt(content: string) {
  return content.trim().startsWith(INTERNAL_FIRST_PASS_PREFIX);
}

function formatModelLabel(modelKey: string, catalog?: ModelCatalogData | null) {
  const [providerId, modelId] = modelKey.split('::');
  const provider = catalog?.providers.find((entry) => entry.id === providerId);
  const model = provider?.models.find((entry) => entry.id === modelId);
  return model ? `${provider?.label || providerId} · ${model.name}` : modelId || modelKey;
}

function formatRunStatus(
  status: AssistantRunData['status'],
  t: ReturnType<typeof useT>
) {
  if (status === 'queued') return t('chat.runQueued');
  if (status === 'planning') return t('chat.runPlanning');
  if (status === 'running') return t('chat.runRunning');
  if (status === 'failed') return t('chat.runFailed');
  if (status === 'cancelled') return t('chat.runCancelled');
  return t('chat.runCompleted');
}

function formatResearchPhase(
  phase: NonNullable<AssistantRunData['researchProgress']>['phase'],
  t: ReturnType<typeof useT>
) {
  if (phase === 'proposal') return t('chat.researchPhaseProposal');
  if (phase === 'searching') return t('chat.researchPhaseSearching');
  if (phase === 'analyzing_gaps') return t('chat.researchPhaseAnalyzingGaps');
  if (phase === 'reporting') return t('chat.researchPhaseReporting');
  if (phase === 'blocked') return t('chat.researchPhaseBlocked');
  return t('chat.researchPhaseCompleted');
}

function shouldHideChatMessage(message: ChatMessageData, isLoading: boolean) {
  if (message.role === 'user' && isInternalFirstPassPrompt(message.content)) {
    return true;
  }

  if (message.role === 'assistant' && message.content.trim().length === 0) {
    const isLocalStreamingPlaceholder = message.id.startsWith('temp-');
    return !(isLoading && isLocalStreamingPlaceholder);
  }

  return false;
}

function flattenBranches(
  branches: ConversationBranchSummary[],
  depth = 0
): Array<{ id: string; label: string }> {
  return branches.flatMap((branch) => [
    {
      id: branch.id,
      label: `${'· '.repeat(depth)}${formatConversationTitle(branch.title)}`,
    },
    ...flattenBranches(branch.children, depth + 1),
  ]);
}
