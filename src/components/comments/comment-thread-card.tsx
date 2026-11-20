'use client';

import * as React from 'react';
import { CommentAgentTextarea } from '@/components/comments/comment-agent-textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Bot,
  CheckCircle,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  PenLine,
  Search,
  SendHorizonal,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import {
  buildMissingAgentBindings,
  formatRemainingListeningMs,
  resolveSingleResearchTarget,
} from '@/lib/comments/agents';
import { formatStableDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import {
  formatCommentResearchPhase,
  formatDurationLabel,
  isAppliedThread,
  isResolvedThread,
  type CommentTranslateFn,
  type SourceApplyState,
} from './comment-sidebar-helpers';

import type {
  CommentAgentBindingData,
  CommentAgentConfigData,
  CommentMessageData,
  CommentThreadData,
} from '@/types';

export type CommentThreadCardProps = {
  thread: CommentThreadData;
  activeReplyAgentId: string | null;
  agentRegistry: CommentAgentConfigData[];
  blockedAgentReasons: Record<string, string>;
  isReplying: boolean;
  isSubmitting: boolean;
  isApplying: boolean;
  streamingContent: string;
  allowSourceApply: boolean;
  sourceApplyState: SourceApplyState;
  highlighted?: boolean;
  now: number;
  t: CommentTranslateFn;
  onApplyToSource: (thread: CommentThreadData) => Promise<void>;
  onFocusThread: (threadId: string) => void;
  onOpenFile?: (fileId: string) => void;
  onOpenSettings: () => void;
  onReopen: (threadId: string) => Promise<void>;
  onResearchAction: (
    thread: CommentThreadData,
    action: 'start' | 'dismiss'
  ) => Promise<void>;
  onResolve: (threadId: string) => Promise<void>;
  onStopAgentListening: (threadId: string, agentId: string) => Promise<void>;
  onSubmitDeepResearch: (
    thread: CommentThreadData,
    content: string,
    targetAgentId: string
  ) => Promise<void>;
  onSubmitFollowUp: (thread: CommentThreadData, content: string) => Promise<number>;
  researchActionState: string | null;
};

export const CommentThreadCard = React.forwardRef<HTMLDivElement, CommentThreadCardProps>(
  function CommentThreadCard(
    {
      thread,
      activeReplyAgentId,
      agentRegistry,
      blockedAgentReasons,
      isReplying,
      isSubmitting,
      isApplying,
      streamingContent,
      allowSourceApply,
      sourceApplyState,
      highlighted = false,
      now,
      t,
      onApplyToSource,
      onFocusThread,
      onOpenFile,
      onOpenSettings,
      onReopen,
      onResearchAction,
      onResolve,
      onStopAgentListening,
      onSubmitDeepResearch,
      onSubmitFollowUp,
      researchActionState,
    },
    ref
  ) {
    const [followUp, setFollowUp] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const [notice, setNotice] = React.useState<string | null>(null);
    const followUpFieldId = React.useId();
    const followUpHintId = React.useId();
    const followUpFeedbackId = React.useId();
    const [applyFeedback, setApplyFeedback] = React.useState<{
      text: string;
      tone: 'error' | 'success';
    } | null>(null);
    const [researchMode, setResearchMode] = React.useState<'light' | 'deep'>('light');
    const isResolved = isResolvedThread(thread);
    const isApplied = isAppliedThread(thread);
    const isInherited = thread.isInherited;
    const agentRegistryById = React.useMemo(
      () => new Map(agentRegistry.map((agent) => [agent.id, agent])),
      [agentRegistry]
    );
    const bindingStates = React.useMemo(() => {
      return thread.agentBindings
        .map((binding) => {
          const registryAgent = agentRegistryById.get(binding.agentId) || null;
          const remainingMs = formatRemainingListeningMs(binding.listeningUntil, now);
          const missingBinding = buildMissingAgentBindings({
            agents: agentRegistry,
            bindings: [binding],
          })[0];
          const blockedReason =
            blockedAgentReasons[binding.agentId] ||
            (missingBinding
              ? t('comments.agentMissing')
              : registryAgent && !registryAgent.enabled
                ? t('comments.agentDisabled')
                : null);
          const isResponding = activeReplyAgentId === binding.agentId;
          const isWaiting = !isResponding && !blockedReason && remainingMs > 0;
          const isVisible = isResponding || isWaiting || Boolean(blockedReason);

          if (!isVisible) {
            return null;
          }

          return {
            ...binding,
            blockedReason,
            isResponding,
            isWaiting,
            remainingMs,
          };
        })
        .filter(
          (
            item
          ): item is CommentAgentBindingData & {
            blockedReason: string | null;
            isResponding: boolean;
            isWaiting: boolean;
            remainingMs: number;
          } => Boolean(item)
        );
    }, [
      activeReplyAgentId,
      agentRegistry,
      agentRegistryById,
      blockedAgentReasons,
      now,
      t,
      thread.agentBindings,
    ]);
    const hasAssistantReply = thread.messages.some(
      (message) => message.role === 'assistant' && message.content.trim().length > 0
    );
    const researchState = thread.researchState;
    const researchProposal = researchState?.proposal || null;
    const researchProgress = researchState?.progress || null;
    const researchActionForThread =
      researchActionState?.startsWith(`${thread.id}:`) ? researchActionState : null;
    const isStartingResearch = researchActionForThread === `${thread.id}:start`;
    const isDismissingResearch = researchActionForThread === `${thread.id}:dismiss`;
    const hasResearchReport = Boolean(researchState?.reportFileId);
    const researchBusy =
      researchProgress?.phase === 'searching' ||
      researchProgress?.phase === 'analyzing_gaps' ||
      researchProgress?.phase === 'reporting' ||
      isStartingResearch;
    const researchComposerDisabled =
      researchBusy || (researchProposal !== null && researchProposal.status === 'pending');
    const enabledAgentBindings = thread.agentBindings.filter((binding) => {
      const agent = agentRegistryById.get(binding.agentId);
      return Boolean(agent?.enabled);
    });
    const footerHint = isApplied
      ? t('comments.pendingVerificationHint')
      : bindingStates.length > 0
        ? t('comments.agentWaitingHint')
        : t('comments.continueConversationHint');
    const showApplyAction =
      !isApplied &&
      !isInherited &&
      allowSourceApply &&
      sourceApplyState.canApply &&
      hasAssistantReply;
    const applyStatus = isApplying
      ? {
          text: t('comments.applyLocating'),
          tone: 'info' as const,
        }
      : applyFeedback
        ? {
            text: applyFeedback.text,
            tone: applyFeedback.tone,
          }
        : !showApplyAction &&
            !isApplied &&
            !isResolved &&
            !isInherited &&
            allowSourceApply &&
            hasAssistantReply &&
            sourceApplyState.reason
          ? {
              text: sourceApplyState.reason,
              tone: 'error' as const,
            }
          : null;
    const handleSubmit = React.useCallback(async () => {
      const trimmed = followUp.trim();
      if (!trimmed) {
        return;
      }

      setError(null);
      setNotice(null);
      setApplyFeedback(null);

      try {
        if (researchMode === 'deep') {
          const researchTarget = resolveSingleResearchTarget({
            agents: agentRegistry,
            bindings: enabledAgentBindings,
            content: trimmed,
          });
          if (researchTarget.error === 'multiple') {
            throw new Error(t('comments.researchNeedsSingleAgent'));
          }
          const targetAgent = researchTarget.target;

          if (!targetAgent) {
            throw new Error(t('comments.researchNeedsSingleAgent'));
          }

          await onSubmitDeepResearch(thread, trimmed, targetAgent.agentId);
          setFollowUp('');
          setResearchMode('light');
          setNotice(t('comments.researchPlanQueued'));
          return;
        }

        const triggeredAgentCount = await onSubmitFollowUp(thread, trimmed);
        setFollowUp('');
        setNotice(
          triggeredAgentCount > 0
            ? t('comments.followUpQueued')
            : t('comments.followUpNeedsMention')
        );
      } catch (nextError) {
        setError(
          nextError instanceof Error ? nextError.message : t('comments.followUpFailed')
        );
      }
    }, [
      agentRegistry,
      enabledAgentBindings,
      followUp,
      onSubmitDeepResearch,
      onSubmitFollowUp,
      researchMode,
      t,
      thread,
    ]);

    return (
      <div
        ref={ref}
        data-testid={`comment-thread-${thread.id}`}
        className={cn(
          'w-full min-w-0 overflow-hidden rounded-xl border bg-background p-3 text-xs transition-colors motion-reduce:transition-none',
          isResolved && 'opacity-70',
          highlighted && 'border-primary/60 bg-primary/5 ring-2 ring-primary/15'
        )}
      >
        <button
          type="button"
          className="mb-3 flex min-h-11 w-full min-w-0 items-start justify-between gap-2 rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
          onClick={() => onFocusThread(thread.id)}
        >
          <div className="flex min-w-0 flex-1 items-start gap-1.5 overflow-hidden">
            <div className="mt-0.5 h-full min-h-[16px] w-1 shrink-0 rounded-full bg-yellow-400" />
            <div className="min-w-0 flex-1 overflow-hidden">
              <p className="break-words text-muted-foreground italic [overflow-wrap:anywhere]">
                &quot;{thread.anchorText}&quot;
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  {thread.version ? `v${thread.version.versionNum}` : t('comments.draft')}
                </Badge>
                {isInherited && (
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    {thread.inheritanceState === 'actionable'
                      ? t('comments.inheritedActionable')
                      : t('comments.inherited')}
                  </Badge>
                )}
                {thread.inheritanceState === 'stale' ? (
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                    {t('comments.reviewStateStale')}
                  </Badge>
                ) : null}
                {thread.inheritanceState === 'superseded' ? (
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                    {t('comments.reviewStateSuperseded')}
                  </Badge>
                ) : null}
                {isApplied && (
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    {t('comments.applied')}
                  </Badge>
                )}
                {isResolved && thread.resolvedAt && (
                  <span className="text-[10px] text-muted-foreground">
                    {formatStableDate(thread.resolvedAt)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </button>

        {bindingStates.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {bindingStates.map((binding) => (
              <div
                key={`${thread.id}-${binding.agentId}`}
                data-testid={`comment-agent-chip-${thread.id}-${binding.agentId}`}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-2 py-1 text-[10px]',
                  binding.blockedReason
                    ? 'border-destructive/20 bg-destructive/10 text-destructive'
                    : binding.isResponding
                      ? 'border-primary/20 bg-primary/10 text-primary'
                      : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700'
                )}
              >
                {binding.isResponding ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="h-3 w-3 animate-spin motion-reduce:animate-none"
                  />
                ) : binding.blockedReason ? (
                  <CircleAlert className="h-3 w-3" />
                ) : (
                  <Bot className="h-3 w-3" />
                )}
                <span>
                  {binding.handle}{' '}
                  {binding.isResponding
                    ? t('comments.agentResponding')
                    : binding.blockedReason
                      ? t('comments.agentUnavailable')
                      : `${t('comments.agentWaiting')} · ${formatDurationLabel(binding.remainingMs)}`}
                </span>
                {binding.blockedReason ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="size-11 rounded-full sm:size-5"
                    aria-label={`${t('common.settings')}: ${binding.handle}`}
                    onClick={onOpenSettings}
                  >
                    <Settings2 aria-hidden="true" className="h-3 w-3" />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-11 rounded-full sm:size-5"
                  aria-label={`${t('common.cancel')} ${t('comments.agentWaiting')}: ${binding.handle}`}
                  data-testid={`comment-stop-agent-${thread.id}-${binding.agentId}`}
                  onClick={() => void onStopAgentListening(thread.id, binding.agentId)}
                  disabled={isSubmitting || isApplying}
                >
                  <X aria-hidden="true" className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        {researchState ? (
          <div className="mb-3 space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3">
            {researchProposal ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    <Search className="h-3.5 w-3.5" />
                    {t('comments.researchProposal')}
                  </div>
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                    {researchProposal.status === 'approved'
                      ? t('comments.researchApproved')
                      : t('comments.researchPending')}
                  </Badge>
                </div>
                <div className="break-words text-sm font-medium text-foreground [overflow-wrap:anywhere]">
                  {researchProposal.title}
                </div>
                <p className="break-words text-[11px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                  {researchProposal.summary}
                </p>
                {researchProposal.subquestions.length > 0 ? (
                  <div className="space-y-1">
                    {researchProposal.subquestions.slice(0, 3).map((question, index) => (
                      <div
                        key={`${thread.id}-research-question-${index}`}
                        className="break-words rounded-lg border border-border/60 bg-background/70 px-2 py-1.5 text-[11px] leading-5 text-foreground [overflow-wrap:anywhere]"
                      >
                        {question}
                      </div>
                    ))}
                  </div>
                ) : null}
                {researchProposal.status !== 'dismissed' && !researchBusy ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="h-11 px-2 text-[10px] sm:h-7"
                      disabled={isSubmitting || isReplying || Boolean(researchActionForThread)}
                      aria-busy={isStartingResearch}
                      onClick={() => void onResearchAction(thread, 'start')}
                    >
                      {isStartingResearch
                        ? t('comments.researchStarting')
                        : t('comments.researchStart')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-11 px-2 text-[10px] sm:h-7"
                      disabled={isSubmitting || isReplying || Boolean(researchActionForThread)}
                      aria-busy={isDismissingResearch}
                      onClick={() => void onResearchAction(thread, 'dismiss')}
                    >
                      {isDismissingResearch
                        ? t('comments.researchDismissing')
                        : t('comments.researchDismiss')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {researchProgress ? (
              <div
                className="space-y-2"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5" />
                    {t('comments.researchProgress')}
                  </div>
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                    {formatCommentResearchPhase(researchProgress.phase, t)}
                  </Badge>
                </div>
                {researchProgress.currentStepLabel ? (
                  <p className="break-words text-[11px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                    {researchProgress.currentStepLabel}
                  </p>
                ) : null}
                {researchState.summary ? (
                  <p className="break-words text-[11px] leading-5 text-foreground [overflow-wrap:anywhere]">
                    {researchState.summary}
                  </p>
                ) : null}
                {researchProgress.providerState === 'unavailable' ? (
                  <div className="space-y-2">
                    <ThreadActionStatus
                      text={t('comments.researchProviderUnavailable')}
                      tone="error"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-11 px-2 text-[10px] sm:h-7"
                      onClick={onOpenSettings}
                    >
                      {t('common.settings')}
                    </Button>
                  </div>
                ) : null}
                {hasResearchReport && onOpenFile ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-11 max-w-full px-2 text-[10px] sm:h-7"
                    onClick={() => onOpenFile(researchState.reportFileId!)}
                  >
                    <ExternalLink aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
                    <span className="truncate">{t('comments.openResearchReport')}</span>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mb-3 min-w-0 space-y-2 overflow-hidden">
          {thread.messages.map((msg: CommentMessageData) => (
            <div
              key={msg.id}
              className={cn(
                'min-w-0 overflow-hidden rounded-lg border px-2 py-1.5',
                msg.role === 'assistant'
                  ? 'border-primary/15 bg-primary/5'
                  : 'border-border/60 bg-muted/40'
              )}
            >
              <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {msg.role === 'assistant' ? (
                  <>
                    <Bot className="h-3 w-3 text-primary" />
                    {msg.agentLabel || t('comments.aiReply')}
                  </>
                ) : (
                  t('comments.commentToAi')
                )}
              </div>
              <p className="break-words whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
                {msg.content}
              </p>
            </div>
          ))}

          {isReplying && (
            <div className="min-w-0 overflow-hidden rounded-lg border border-primary/15 bg-primary/5 px-2 py-1.5">
              <div
                className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                <Bot
                  aria-hidden="true"
                  className="h-3 w-3 animate-pulse text-primary motion-reduce:animate-none"
                />
                {t('comments.aiReplying')}
              </div>
              <p className="break-words whitespace-pre-wrap leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                {streamingContent || t('comments.thinkingThroughComment')}
              </p>
            </div>
          )}
        </div>

        {!isResolved && !isInherited && (
          <form
            className="space-y-3"
            aria-busy={isSubmitting}
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-2">
              <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  type="button"
                  size="sm"
                  variant={researchMode === 'deep' ? 'secondary' : 'outline'}
                  className="h-11 rounded-full px-2 text-[10px] sm:h-7"
                  disabled={researchComposerDisabled}
                  aria-pressed={researchMode === 'deep'}
                  onClick={() =>
                    setResearchMode((current) => (current === 'deep' ? 'light' : 'deep'))
                  }
                >
                  <Search className="mr-1 h-3.5 w-3.5" />
                  {researchMode === 'deep'
                    ? t('comments.deepResearchEnabled')
                    : t('comments.deepResearch')}
                </Button>
                {researchMode === 'deep' ? (
                  <span className="text-[10px] leading-5 text-muted-foreground">
                    {t('comments.deepResearchInfo')}
                  </span>
                ) : null}
              </div>
              <CommentAgentTextarea
                agents={agentRegistry}
                id={followUpFieldId}
                name="comment-follow-up"
                suggestionsPlacement="above"
                required
                aria-describedby={[
                  followUpHintId,
                  error || notice ? followUpFeedbackId : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-invalid={error ? true : undefined}
                value={followUp}
                onChange={(value) => {
                  setFollowUp(value);
                  if (error) setError(null);
                  if (notice) setNotice(null);
                  if (applyFeedback) setApplyFeedback(null);
                }}
                className="min-h-[72px] resize-none border-0 bg-background text-xs shadow-none focus-visible:ring-1"
                placeholder={t('comments.followUpPlaceholder')}
              />
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p
                  id={followUpHintId}
                  className="min-w-0 flex-1 break-words text-[10px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]"
                >
                  {researchMode === 'deep'
                    ? t('comments.deepResearchHint')
                    : bindingStates.length > 0
                      ? t('comments.agentListeningHint')
                      : t('comments.agentMentionHint')}
                </p>
                <Button
                  type="submit"
                  size="sm"
                  className="h-11 self-end px-2 text-[10px] sm:h-7"
                  aria-busy={isSubmitting}
                  disabled={isSubmitting || isReplying || !followUp.trim() || researchBusy}
                >
                  {isSubmitting ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="mr-1 h-3 w-3 animate-spin motion-reduce:animate-none"
                    />
                  ) : (
                    <>
                      {researchMode === 'deep' ? (
                        <Search className="mr-1 h-3 w-3" />
                      ) : (
                        <SendHorizonal className="mr-1 h-3 w-3" />
                      )}
                    </>
                  )}
                  {isSubmitting
                    ? researchMode === 'deep'
                      ? t('comments.researchPlanning')
                      : t('comments.sendingFollowUp')
                    : researchMode === 'deep'
                      ? t('comments.createResearchPlan')
                      : t('comments.sendFollowUp')}
                </Button>
              </div>
            </div>

            {error ? (
              <p
                id={followUpFeedbackId}
                className="break-words text-[10px] leading-relaxed text-destructive [overflow-wrap:anywhere]"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            {notice ? (
              <p
                id={followUpFeedbackId}
                className="break-words text-[10px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]"
                role="status"
                aria-live="polite"
              >
                {notice}
              </p>
            ) : null}
            {applyStatus ? (
              <ThreadActionStatus
                text={applyStatus.text}
                tone={applyStatus.tone}
              />
            ) : null}

            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 flex-1 break-words text-[10px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                {footerHint}
              </p>
              <div className="flex max-w-full flex-wrap items-center gap-1 sm:shrink-0">
                {showApplyAction ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-11 px-2 text-[10px] sm:h-6"
                    aria-busy={isApplying}
                    data-testid={`comment-apply-source-${thread.id}`}
                    onClick={() => {
                      void (async () => {
                        try {
                          setApplyFeedback(null);
                          await onApplyToSource(thread);
                          setApplyFeedback({
                            text: t('comments.appliedToSource'),
                            tone: 'success',
                          });
                        } catch (nextError) {
                          setApplyFeedback({
                            text:
                              nextError instanceof Error
                                ? nextError.message
                                : t('comments.applyFailed'),
                            tone: 'error',
                          });
                        }
                      })();
                    }}
                    disabled={isApplying || isSubmitting || isReplying}
                  >
                    {isApplying ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="mr-1 h-3 w-3 animate-spin motion-reduce:animate-none"
                      />
                    ) : (
                      <PenLine className="mr-1 h-3 w-3" />
                    )}
                    {isApplying
                      ? t('comments.applyingToSource')
                      : t('comments.applyToSource')}
                  </Button>
                ) : null}
                {isApplied ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-11 px-2 text-[10px] sm:h-6"
                    onClick={() => void onReopen(thread.id)}
                    disabled={isSubmitting || isApplying || isReplying}
                  >
                    {t('comments.reopen')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-11 px-2 text-[10px] sm:h-6"
                  onClick={() => void onResolve(thread.id)}
                  disabled={isSubmitting || isApplying || isReplying}
                >
                  <CheckCircle className="mr-1 h-3 w-3" />
                  {t('comments.resolve')}
                </Button>
              </div>
            </div>
          </form>
        )}

        {isInherited ? (
          <div className="space-y-1 text-[10px] leading-relaxed text-muted-foreground">
            <p>
              {t('comments.inheritedHint', {
                version: thread.inheritedFromVersionTitle || t('comments.draft'),
              })}
            </p>
            {thread.inheritanceState === 'stale' ? (
              <p>{t('comments.reviewStateStaleHint')}</p>
            ) : null}
            {thread.inheritanceState === 'superseded' ? (
              <p>{t('comments.reviewStateSupersededHint')}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
);

CommentThreadCard.displayName = 'CommentThreadCard';

function ThreadActionStatus({
  text,
  tone,
}: {
  text: string;
  tone: 'error' | 'info' | 'success';
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? undefined : 'polite'}
      aria-atomic="true"
      className={cn(
        'flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium',
        tone === 'error' &&
          'border-destructive/20 bg-destructive/10 text-destructive',
        tone === 'info' && 'border-primary/15 bg-primary/5 text-primary',
        tone === 'success' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700'
      )}
    >
      {tone === 'error' ? (
        <CircleAlert aria-hidden="true" className="h-3 w-3 shrink-0" />
      ) : tone === 'success' ? (
        <CheckCircle aria-hidden="true" className="h-3 w-3 shrink-0" />
      ) : (
        <LoaderCircle
          aria-hidden="true"
          className="h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none"
        />
      )}
      <span className="min-w-0 break-words leading-tight [overflow-wrap:anywhere]">
        {text}
      </span>
    </div>
  );
}
