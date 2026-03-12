'use client';

import * as React from 'react';
import { ChatMessage } from './chat-message';
import { ChatInput } from './chat-input';
import { useChat } from '@/hooks/use-chat';
import type {
  AssistantRunData,
  ChatMessageData,
  ConversationBranchSummary,
  ModelCatalogData,
  ModelSelectionData,
  WorkflowSummaryData,
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
import { FileText, LoaderCircle, Wand2 } from 'lucide-react';
import {
  AI_SETTINGS_CHANGED_EVENT,
  getStoredAISettingsHeader,
  getStoredDefaultModelKey,
  getStoredDefaultModelSelection,
  resolveStoredModelSelection,
} from '@/lib/client/ai-settings';
import { useT } from '@/components/providers/language-provider';
import { shouldHydrateChatMessages } from '@/lib/chat/message-hydration';
import { useAppRouter } from '@/lib/app-router';

const DEFAULT_CHAT_MODEL_KEY = 'openai-codex::gpt-5.2-codex';
const INTERNAL_FIRST_PASS_PREFIX = 'Take the first author pass for this deliverable.';

export function ChatPanel({
  activeAssistantRun,
  conversationId,
  conversationRuns,
  conversationTitle,
  branches,
  workspaceId,
  activeFileId,
  baseSnapshotId,
  queuedPrompt,
  onBranchConversation,
  onBusyChange,
  onConversationComplete,
  onQueuedPromptHandled,
  onSelectConversation,
  onWorkspaceChange,
  initialMessages,
  workflowSummary,
}: {
  activeAssistantRun?: AssistantRunData | null;
  conversationId?: string | null;
  conversationRuns?: AssistantRunData[];
  conversationTitle?: string | null;
  branches?: ConversationBranchSummary[];
  workspaceId?: string | null;
  activeFileId?: string | null;
  baseSnapshotId?: string | null;
  queuedPrompt?: {
    content: string;
    id: string;
    searchMode?: 'auto' | 'force';
  } | null;
  onBranchConversation?: (messageId: string) => void;
  onBusyChange?: (isBusy: boolean) => void;
  onConversationComplete?: () => void | Promise<void>;
  onQueuedPromptHandled?: (promptId: string) => void;
  onSelectConversation?: (conversationId: string) => void;
  onWorkspaceChange?: (workspace: {
    conversationId: string | null;
    workspaceId: string | null;
  }) => void;
  initialMessages?: ChatMessageData[];
  workflowSummary?: WorkflowSummaryData | null;
}) {
  const t = useT();
  const router = useAppRouter();
  const {
    messages,
    setMessages,
    isLoading,
    error,
    statusMessage,
    sendMessage,
    continueProposal,
    retryLastMessage,
    stopGeneration,
  } = useChat({ conversationId, workspaceId, activeFileId, baseSnapshotId });
  const [modelCatalog, setModelCatalog] = React.useState<ModelCatalogData | null>(null);
  const [selectedModelSelection, setSelectedModelSelection] =
    React.useState<ModelSelectionData | null>(() =>
      resolveStoredModelSelection(null, getStoredDefaultModelSelection(), DEFAULT_CHAT_MODEL_KEY)
    );
  const [proposalActionId, setProposalActionId] = React.useState<string | null>(null);
  const [proposalActionError, setProposalActionError] = React.useState<{
    message: string;
    runId: string;
  } | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const flatBranches = React.useMemo(
    () => flattenBranches(branches || []),
    [branches]
  );
  const lastHydratedConversationRef = React.useRef<string | null>(
    conversationId || null
  );
  const handledQueuedPromptRef = React.useRef<string | null>(null);
  const hasManualModelSelectionRef = React.useRef(false);

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
    () => buildDisplayRuns(conversationRuns || []),
    [conversationRuns]
  );

  const loadModelCatalog = React.useCallback(async () => {
    const response = await fetch('/api/ai/models', {
      headers: getStoredAISettingsHeader(),
    });
    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as ModelCatalogData;
    setModelCatalog(data);
    setSelectedModelSelection((current) =>
      resolveStoredModelSelection(
        data,
        hasManualModelSelectionRef.current ? current : getStoredDefaultModelSelection(),
        data.defaultModelKey
      )
    );
  }, []);

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
    const nextConversationId = conversationId || null;
    const serverMessages = initialMessages || [];
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
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [displayRuns, messages]);

  const handleSend = React.useCallback(
    (
      content: string,
      options?: {
        attachments?: ChatComposerAttachment[];
        searchMode?: 'auto' | 'force';
      }
    ) => {
      const activeModelKey = selectedModelSelection?.key || getActiveModelKey();
      sendMessage(content, {
        attachments: options?.attachments,
        hiddenFromTimeline: isInternalFirstPassPrompt(content),
        model: activeModelKey,
        onComplete: onConversationComplete,
        onWorkspaceChange,
        searchMode: options?.searchMode,
      });
    },
    [onConversationComplete, onWorkspaceChange, selectedModelSelection, sendMessage]
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
      searchMode: queuedPrompt.searchMode,
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

      setProposalActionId(`${run.id}:${action}`);
      setProposalActionError(null);

      try {
        const response = await fetch(
          `/api/workspaces/${workspaceId}/assistant-runs/${run.id}/proposal`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...getStoredAISettingsHeader(),
            },
            body: JSON.stringify({ action }),
          }
        );

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || t('chat.replanActionFailed'));
        }

        if (action === 'dismiss') {
          await onConversationComplete?.();
          return;
        }

        await onConversationComplete?.();
        await continueProposal(run.id, {
          onComplete: onConversationComplete,
          onWorkspaceChange,
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
      isLoading,
      onConversationComplete,
      onWorkspaceChange,
      proposalActionId,
      t,
      workspaceId,
    ]
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-2.5">
        <div className="min-w-0 space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4" />
            {t('assistant.chat')}
          </h2>
          {flatBranches.length > 1 && onSelectConversation ? (
            <Select
              value={conversationId || ''}
              onValueChange={(value) => onSelectConversation(value)}
            >
              <SelectTrigger className="h-7 w-[220px] text-xs">
                <SelectValue placeholder={t('chat.selectConversation')} />
              </SelectTrigger>
              <SelectContent>
                {flatBranches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id} className="text-xs">
                    {branch.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : conversationTitle ? (
            <p className="truncate text-xs text-muted-foreground">
              {t('chat.conversationPrefix', {
                title: formatConversationTitle(conversationTitle),
              })}
            </p>
          ) : null}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="min-w-0 py-4">
          {displayRuns.length > 0 ? (
            <div className="space-y-3 px-4 pb-4">
              {displayRuns.map((run) => (
                <ConversationRunCard
                  key={run.id}
                  run={run}
                  actionError={proposalActionError?.runId === run.id ? proposalActionError.message : null}
                  actionState={proposalActionId}
                  disabled={isLoading}
                  onProposalAction={handleProposalAction}
                />
              ))}
            </div>
          ) : null}

          {visibleMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FileText className="mb-3 h-10 w-10 opacity-30" />
              <p className="text-sm">
                {workflowSummary?.statusTitle ||
                  t(
                    isWaitingForFirstPass
                      ? 'chat.waitingForFirstPassTitle'
                      : 'chat.emptyTitle'
                  )}
              </p>
              <p className="mt-1 text-xs opacity-70">
                {workflowSummary?.blockedReason ||
                  workflowSummary?.statusDescription ||
                  t(
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
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm text-destructive">
                <div>{error.message}</div>
                {error.detail && error.detail !== error.message ? (
                  <div className="mt-2 text-xs leading-5 text-destructive/80">
                    {error.detail}
                  </div>
                ) : null}
                <div className="mt-3 flex items-center gap-2">
                  {error.retryable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={retryLastMessage}
                    >
                      {t('chat.retry')}
                    </Button>
                  ) : null}
                  {error.showSettings ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      onClick={() => router.push('/settings')}
                    >
                      {t('chat.openSettings')}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {isLoading && statusMessage ? (
            <div className="px-4 pb-3">
              <div className="rounded-2xl border border-border/70 bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
                {statusMessage}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ChatInput
        onSend={handleSend}
        onStop={stopGeneration}
        isLoading={isLoading}
        modelCatalog={modelCatalog}
        modelLabel={formatModelLabel(selectedModelSelection?.key || getActiveModelKey(), modelCatalog)}
        modelSelection={selectedModelSelection}
        onModelSelectionChange={handleModelSelectionChange}
      />
    </div>
  );
}

function ConversationRunCard({
  actionError,
  actionState,
  disabled = false,
  onProposalAction,
  run,
}: {
  actionError?: string | null;
  actionState?: string | null;
  disabled?: boolean;
  onProposalAction?: (run: AssistantRunData, action: 'apply' | 'dismiss') => void;
  run: AssistantRunData & { isLocal?: boolean };
}) {
  const t = useT();
  const isBusy =
    run.status === 'queued' || run.status === 'planning' || run.status === 'running';
  const proposal = run.planProposal || null;
  const isProposalPending = proposal?.status === 'pending';
  const isApplying = actionState === `${run.id}:apply`;
  const isDismissing = actionState === `${run.id}:dismiss`;

  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-muted-foreground" />
            <div className="truncate text-sm font-medium text-foreground">{run.title}</div>
            <Badge variant={isBusy ? 'secondary' : 'outline'} className="text-[10px]">
              {formatRunStatus(run.status, t)}
            </Badge>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {run.summary ||
              (isBusy ? t('chat.runInProgress') : t('chat.runCompletedNoSummary'))}
          </p>
        </div>
        {isBusy ? <LoaderCircle className="mt-0.5 h-4 w-4 animate-spin text-primary" /> : null}
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
                  size="sm"
                  className="h-8"
                  disabled={disabled || Boolean(actionState)}
                  onClick={() => onProposalAction(run, 'apply')}
                >
                  {isApplying ? t('chat.replanApplying') : t('chat.replanApplyAndContinue')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={disabled || Boolean(actionState)}
                  onClick={() => onProposalAction(run, 'dismiss')}
                >
                  {isDismissing ? t('chat.replanKeeping') : t('chat.replanKeepCurrent')}
                </Button>
              </div>
            ) : null}
            {actionError ? (
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
                {actionError}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildDisplayRuns(conversationRuns: AssistantRunData[]) {
  return [...conversationRuns].sort(
    (left, right) =>
      new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime()
  );
}

function formatConversationTitle(title: string) {
  return title.replace(/^Branch:\s*/i, '');
}

function getActiveModelKey() {
  return getStoredDefaultModelKey() || DEFAULT_CHAT_MODEL_KEY;
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
