'use client';

import * as React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAiReply } from '@/hooks/use-ai-reply';
import { useCommentAgents } from '@/hooks/use-comment-agents';
import {
  ChevronDown,
  History,
  MessageSquare,
  PanelRightClose,
  PenLine,
} from 'lucide-react';
import type { CommentThreadData, WorkspaceFileData } from '@/types';
import {
  COMMENT_THREAD_FOCUS_EVENT,
  OPEN_MANUAL_COMMENT_COMPOSER_EVENT,
  notifyCommentThreadsChanged,
  requestCommentThreadFocus,
} from '@/lib/comments/constants';
import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import { resolveReplyTargets } from '@/lib/comments/agents';
import { replaceTextInPlateRange } from '@/lib/comments/document-selection';
import { useT } from '@/components/providers/language-provider';
import { cn } from '@/lib/utils';
import { useAppRouter } from '@/lib/app-router';
import { apiCallOrThrow, apiFetch } from '@/framework/resilience';
import {
  BLOCKED_SOURCE_APPLY_STATE,
  buildManualCommentAnchor,
  getSourceApplyState,
  groupResolvedThreads,
  isAppliedThread,
  isOpenThread,
  isResolvedThread,
  replaceSourceRange,
  resolveSourceApplyPlan,
  serializeThreadDiscussion,
  toWorkspaceFileContent,
} from './comment-sidebar-helpers';
import { CommentThreadCard } from './comment-thread-card';
import { ManualCommentComposer } from './manual-comment-composer';


export function CommentSidebar({
  className,
  currentFileId,
  documentId,
  documentContent,
  draftRevision,
  embedded = false,
  files = [],
  onClose,
  onOpenChange,
  onOpenFile,
  onSourceContentApplied,
  allowSourceApply = false,
  showHeader = !embedded,
  threads,
  refreshThreads,
  versionId,
  workspaceRevision,
}: {
  className?: string;
  documentId: string;
  documentContent: string;
  draftRevision?: number | null;
  embedded?: boolean;
  files?: WorkspaceFileData[];
  currentFileId?: string | null;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
  onOpenFile?: (fileId: string) => void;
  onSourceContentApplied?: () => Promise<void> | void;
  allowSourceApply?: boolean;
  showHeader?: boolean;
  threads: CommentThreadData[];
  refreshThreads: () => Promise<void>;
  versionId?: string | null;
  workspaceRevision?: number | null;
}) {
  const t = useT();
  const router = useAppRouter();
  const commentAgents = useCommentAgents();
  const [focusedThreadId, setFocusedThreadId] = React.useState<string | null>(null);
  const [openListOpen, setOpenListOpen] = React.useState(true);
  const [appliedListOpen, setAppliedListOpen] = React.useState(true);
  const [earlierContextOpen, setEarlierContextOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [activeReplyTarget, setActiveReplyTarget] = React.useState<{
    agentId: string;
    threadId: string;
  } | null>(null);
  const [submittingThreadId, setSubmittingThreadId] = React.useState<string | null>(null);
  const [applyingThreadId, setApplyingThreadId] = React.useState<string | null>(null);
  const [researchActionId, setResearchActionId] = React.useState<string | null>(null);
  const [replyProblems, setReplyProblems] = React.useState<
    Record<string, Record<string, string>>
  >({});
  const [threadStatusNotice, setThreadStatusNotice] = React.useState<{
    tone: 'error' | 'info';
    text: string;
  } | null>(null);
  const openThreadsRegionId = React.useId();
  const appliedThreadsRegionId = React.useId();
  const earlierContextRegionId = React.useId();
  const historyRegionId = React.useId();
  const [manualComposerOpen, setManualComposerOpen] = React.useState(false);
  const [manualAnchorText, setManualAnchorText] = React.useState('');
  const [manualCommentText, setManualCommentText] = React.useState('');
  const [manualComposerError, setManualComposerError] = React.useState<string | null>(null);
  const [manualSubmitting, setManualSubmitting] = React.useState(false);
  const {
    isReplying,
    streamingContent,
    sendCommentReply,
    requestSuggestion,
  } = useAiReply();
  const threadRefs = React.useRef(new Map<string, HTMLDivElement>());
  const [now, setNow] = React.useState(() => Date.now());
  const defaultManualAnchor = React.useMemo(
    () =>
      buildManualCommentAnchor({
        currentFileId,
        files,
        t,
      }),
    [currentFileId, files, t]
  );
  const openManualComposer = React.useCallback(() => {
    setManualComposerOpen(true);
    setManualAnchorText((current) => current || defaultManualAnchor);
    setManualComposerError(null);
    setThreadStatusNotice(null);
    onOpenChange?.(true);
  }, [defaultManualAnchor, onOpenChange]);
  const closeManualComposer = React.useCallback(() => {
    setManualComposerOpen(false);
    setManualAnchorText(defaultManualAnchor);
    setManualCommentText('');
    setManualComposerError(null);
  }, [defaultManualAnchor]);

  React.useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  React.useEffect(() => {
    const handleThreadFocus = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string }>).detail;
      if (!detail?.threadId) return;

      const thread = threads.find(item => item.id === detail.threadId);
      if (!thread) return;

      if (isResolvedThread(thread)) {
        setHistoryOpen(true);
      } else if (isAppliedThread(thread)) {
        setAppliedListOpen(true);
      } else {
        setOpenListOpen(true);
      }

      onOpenChange?.(true);
      setFocusedThreadId(thread.id);
    };

    window.addEventListener(COMMENT_THREAD_FOCUS_EVENT, handleThreadFocus);
    return () => {
      window.removeEventListener(COMMENT_THREAD_FOCUS_EVENT, handleThreadFocus);
    };
  }, [onOpenChange, threads]);

  React.useEffect(() => {
    window.addEventListener(OPEN_MANUAL_COMMENT_COMPOSER_EVENT, openManualComposer);
    return () => {
      window.removeEventListener(OPEN_MANUAL_COMMENT_COMPOSER_EVENT, openManualComposer);
    };
  }, [openManualComposer]);

  React.useEffect(() => {
    if (!focusedThreadId) return;

    const timeoutId = window.setTimeout(() => {
      setFocusedThreadId(current => (current === focusedThreadId ? null : current));
    }, 2200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [focusedThreadId]);

  React.useEffect(() => {
    if (!focusedThreadId) return;

    const target = threadRefs.current.get(focusedThreadId);
    if (!target) return;

    requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'nearest',
      });
    });
  }, [appliedListOpen, focusedThreadId, historyOpen, openListOpen, threads]);

  const runAgentReplies = React.useCallback(
    async (
      thread: CommentThreadData,
      targets: Array<{ agentId: string; agentLabel: string; handle: string }>
    ) => {
      for (const target of targets) {
        setActiveReplyTarget({ agentId: target.agentId, threadId: thread.id });
        setReplyProblems((current) => {
          if (!current[thread.id]?.[target.agentId]) {
            return current;
          }
          const next = { ...current };
          next[thread.id] = { ...next[thread.id] };
          delete next[thread.id][target.agentId];
          if (Object.keys(next[thread.id]).length === 0) {
            delete next[thread.id];
          }
          return next;
        });

        try {
          await sendCommentReply({
            agentId: target.agentId,
            threadId: thread.id,
            documentContent,
            anchorText: thread.anchorText,
            documentId,
          });
        } catch (error) {
          setReplyProblems((current) => ({
            ...current,
            [thread.id]: {
              ...(current[thread.id] || {}),
              [target.agentId]:
                error instanceof Error ? error.message : t('comments.agentBlocked'),
            },
          }));
        } finally {
          setActiveReplyTarget((current) =>
            current?.threadId === thread.id && current.agentId === target.agentId
              ? null
              : current
          );
        }
      }

      notifyCommentThreadsChanged();
      await refreshThreads();
      requestCommentThreadFocus(thread.id);
    },
    [documentContent, documentId, refreshThreads, sendCommentReply, t]
  );

  const submitManualComment = React.useCallback(async () => {
    const trimmed = manualCommentText.trim();
    const anchorText =
      manualAnchorText.trim() ||
      trimmed.split('\n')[0]?.trim().slice(0, 80) ||
      defaultManualAnchor;

    if (!trimmed || !anchorText) {
      return;
    }

    setManualSubmitting(true);
    setManualComposerError(null);

    try {
      const thread = await apiCallOrThrow<CommentThreadData>('/api/threads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getStoredAISettingsHeader(),
        },
        body: JSON.stringify({
          anchorText,
          documentId,
          draftRevision: versionId ? null : draftRevision ?? null,
          fileId: currentFileId || null,
          firstMessage: trimmed,
          selectionAnchor: JSON.stringify({
            anchorPayload: {
              excerpt: anchorText,
            },
            bindingType: 'manual',
            previewVersionId: versionId || null,
            sourceMapping: {
              fileId: currentFileId || null,
            },
            surfaceType: 'manual',
          }),
          versionId: versionId || null,
        }),
        fallbackMessage: t('comments.manualCreateFailed'),
      });
      closeManualComposer();
      notifyCommentThreadsChanged();
      await refreshThreads();
      requestCommentThreadFocus(thread.id);

      if (thread.agentBindings.length > 0) {
        await runAgentReplies(
          thread,
          thread.agentBindings.map((binding) => ({
            agentId: binding.agentId,
            agentLabel: binding.agentLabel,
            handle: binding.handle,
          }))
        );
      }
    } catch (error) {
      setManualComposerError(
        error instanceof Error ? error.message : t('comments.manualCreateFailed')
      );
    } finally {
      setManualSubmitting(false);
    }
  }, [
    closeManualComposer,
    currentFileId,
    defaultManualAnchor,
    documentId,
    draftRevision,
    manualAnchorText,
    manualCommentText,
    refreshThreads,
    runAgentReplies,
    t,
    versionId,
  ]);

  const submitFollowUpForThread = React.useCallback(
    async (thread: CommentThreadData, content: string) => {
      const trimmed = content.trim();
      if (!trimmed) {
        return 0;
      }

      setThreadStatusNotice(null);
      setSubmittingThreadId(thread.id);
      try {
        const response = await apiFetch(`/api/threads/${thread.id}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getStoredAISettingsHeader(),
          },
          body: JSON.stringify({ role: 'user', content: trimmed }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || 'Failed to add comment');
        }

        notifyCommentThreadsChanged();
        const targets = resolveReplyTargets({
          agents: commentAgents,
          bindings: thread.agentBindings,
          content: trimmed,
        });
        if (targets.length > 0) {
          await runAgentReplies(thread, targets);
        } else {
          await refreshThreads();
          requestCommentThreadFocus(thread.id);
        }
        return targets.length;
      } finally {
        setSubmittingThreadId(null);
      }
    },
    [commentAgents, refreshThreads, runAgentReplies]
  );

  const submitDeepResearchForThread = React.useCallback(
    async (
      thread: CommentThreadData,
      content: string,
      targetAgentId: string
    ) => {
      const trimmed = content.trim();
      if (!trimmed) {
        return;
      }

      setThreadStatusNotice(null);
      setSubmittingThreadId(thread.id);

      try {
        const response = await apiFetch(`/api/threads/${thread.id}/research-plan`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getStoredAISettingsHeader(),
          },
          body: JSON.stringify({
            agentId: targetAgentId,
            anchorText: thread.anchorText,
            content: trimmed,
            documentContent,
          }),
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(payload?.error || t('comments.researchPlanFailed'));
        }

        notifyCommentThreadsChanged();
        await refreshThreads();
        requestCommentThreadFocus(thread.id);
        setThreadStatusNotice({
          tone: 'info',
          text: t('comments.researchPlanQueued'),
        });
      } finally {
        setSubmittingThreadId(null);
      }
    },
    [documentContent, refreshThreads, t]
  );

  const applyThreadToSource = React.useCallback(
    async (thread: CommentThreadData) => {
      const plan = resolveSourceApplyPlan({ files, t, thread });
      if (plan.kind === 'blocked') {
        throw new Error(plan.reason || t('comments.applyFailed'));
      }

      setApplyingThreadId(thread.id);
      setThreadStatusNotice(null);

      try {
        const replacement = (
          await requestSuggestion({
            anchorText: thread.anchorText,
            documentContent: plan.editableText,
            threadDiscussion: serializeThreadDiscussion(thread),
          })
        ).trim();

        const nextContent =
          plan.kind === 'structured'
            ? replaceTextInPlateRange(plan.targetFile.content, plan.range, replacement)
            : toWorkspaceFileContent(
                plan.targetFile,
                replaceSourceRange(plan.editableText, plan.match, replacement)
              );
        if (!nextContent) {
          throw new Error(t('comments.applyAnchorMissing'));
        }
        if (nextContent === plan.targetFile.content) {
          throw new Error(t('comments.applyNoMaterialChange'));
        }
        if (!Number.isSafeInteger(workspaceRevision) || (workspaceRevision || 0) < 1) {
          throw new Error(t('comments.applyFailed'));
        }
        await apiCallOrThrow(`/api/threads/${thread.id}/apply-source`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedFileRevision: plan.targetFile.revision,
            expectedThreadRevision: thread.revision,
            expectedWorkspaceRevision: workspaceRevision,
            fileId: plan.targetFile.id,
            nextContent,
            workspaceId: documentId,
          }),
          fallbackMessage: t('comments.applyFailed'),
        });

        try {
          await Promise.all([
            refreshThreads(),
            Promise.resolve(onSourceContentApplied?.()),
          ]);
          requestCommentThreadFocus(thread.id);
        } catch (refreshError) {
          console.error('[comment-source] committed edit refresh failed', refreshError);
          setThreadStatusNotice({
            tone: 'info',
            text: t('comments.applyRefreshFailed'),
          });
        }
      } finally {
        setApplyingThreadId(null);
      }
    },
    [
      documentId,
      files,
      onSourceContentApplied,
      refreshThreads,
      requestSuggestion,
      t,
      workspaceRevision,
    ]
  );

  const handleStopAgentListening = React.useCallback(
    async (threadId: string, agentId: string) => {
      const response = await apiFetch(`/api/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'stop_agent_listening',
          agentId,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setThreadStatusNotice({
          tone: 'error',
          text: payload?.error || t('comments.stopListeningFailed'),
        });
        return;
      }

      setReplyProblems((current) => {
        if (!current[threadId]?.[agentId]) {
          return current;
        }
        const next = { ...current };
        next[threadId] = { ...next[threadId] };
        delete next[threadId][agentId];
        if (Object.keys(next[threadId]).length === 0) {
          delete next[threadId];
        }
        return next;
      });
      await refreshThreads();
    },
    [refreshThreads, t]
  );

  const handleResolve = React.useCallback(
    async (threadId: string) => {
      const res = await apiFetch(`/api/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setThreadStatusNotice({
          tone: 'error',
          text: payload?.error || t('comments.resolveFailed'),
        });
        return;
      }

      const payload = (await res.json().catch(() => null)) as
        | {
            action?: {
              boundVersionTitle?: string | null;
              versionLinked?: boolean;
            };
          }
        | null;

      try {
        await apiFetch('/api/agent/run', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(localStorage.getItem('ai-settings')
              ? { 'x-ai-settings': localStorage.getItem('ai-settings')! }
              : {}),
          },
          body: JSON.stringify({
            mode: 'extract-memory',
            target: { threadId },
          }),
        });
      } catch {
        // Memory extraction is best-effort.
      }

      setThreadStatusNotice({
        tone: 'info',
        text:
          payload?.action?.versionLinked && payload.action.boundVersionTitle
            ? t('comments.resolvedBoundVersion', {
                version: payload.action.boundVersionTitle,
              })
            : t('comments.resolvedNotice'),
      });
      await refreshThreads();
    },
    [refreshThreads, t]
  );

  const handleReopen = React.useCallback(
    async (threadId: string) => {
      const res = await apiFetch(`/api/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'open' }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setThreadStatusNotice({
          tone: 'error',
          text: payload?.error || t('comments.reopenFailed'),
        });
        return;
      }

      setThreadStatusNotice({
        tone: 'info',
        text: t('comments.reopenedNotice'),
      });
      await refreshThreads();
      requestCommentThreadFocus(threadId);
    },
    [refreshThreads, t]
  );

  const handleResearchAction = React.useCallback(
    async (thread: CommentThreadData, action: 'start' | 'dismiss') => {
      if (researchActionId) {
        return;
      }

      setResearchActionId(`${thread.id}:${action}`);
      setThreadStatusNotice(null);

      try {
        if (action === 'dismiss') {
          const dismissResponse = await apiFetch(`/api/threads/${thread.id}/research-plan`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              ...getStoredAISettingsHeader(),
            },
            body: JSON.stringify({ action: 'dismiss' }),
          });
          const dismissPayload = await dismissResponse.json().catch(() => null);
          if (!dismissResponse.ok) {
            throw new Error(dismissPayload?.error || t('comments.researchActionFailed'));
          }

          await refreshThreads();
          return;
        }

        const proposalStatus = thread.researchState?.proposal?.status || 'pending';
        if (proposalStatus !== 'approved') {
          const approveResponse = await apiFetch(`/api/threads/${thread.id}/research-plan`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              ...getStoredAISettingsHeader(),
            },
            body: JSON.stringify({ action: 'approve' }),
          });
          const approvePayload = await approveResponse.json().catch(() => null);
          if (!approveResponse.ok) {
            throw new Error(approvePayload?.error || t('comments.researchActionFailed'));
          }
          await refreshThreads();
        }

        const intervalId = window.setInterval(() => {
          void refreshThreads();
        }, 1500);

        try {
          const startResponse = await apiFetch(`/api/threads/${thread.id}/research/start`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...getStoredAISettingsHeader(),
            },
            body: JSON.stringify({
              anchorText: thread.anchorText,
              documentContent,
            }),
          });
          const startPayload = await startResponse.json().catch(() => null);
          if (!startResponse.ok) {
            throw new Error(startPayload?.error || t('comments.researchActionFailed'));
          }
        } finally {
          window.clearInterval(intervalId);
        }

        notifyCommentThreadsChanged();
        await refreshThreads();
        requestCommentThreadFocus(thread.id);
      } catch (error) {
        setThreadStatusNotice({
          tone: 'error',
          text:
            error instanceof Error
              ? error.message
              : t('comments.researchActionFailed'),
        });
      } finally {
        setResearchActionId(null);
      }
    },
    [documentContent, refreshThreads, researchActionId, t]
  );

  const directThreads = threads.filter((thread) => thread.scope === 'direct');
  const openThreads = directThreads.filter(isOpenThread);
  const appliedThreads = directThreads.filter(isAppliedThread);
  const actionableInheritedThreads = threads.filter(
    (thread) => thread.scope === 'inherited' && thread.inheritanceState === 'actionable'
  );
  const earlierContextThreads = threads.filter(
    (thread) =>
      thread.scope === 'inherited' &&
      (thread.inheritanceState === 'stale' || thread.inheritanceState === 'superseded')
  );
  const resolvedThreads = directThreads.filter(isResolvedThread);
  const resolvedGroups = groupResolvedThreads(resolvedThreads);
  const activeThreadCount =
    openThreads.length + appliedThreads.length + actionableInheritedThreads.length;
  const sourceApplyStates = React.useMemo(
    () =>
      new Map(
        threads.map((thread) => [
          thread.id,
          getSourceApplyState({
            allowSourceApply,
            files,
            t,
            thread,
          }),
        ])
      ),
    [allowSourceApply, files, t, threads]
  );

  const renderThreadCard = (thread: CommentThreadData, interactive: boolean) => (
    <CommentThreadCard
      key={thread.id}
      highlighted={focusedThreadId === thread.id}
      ref={(node) => {
        if (node) {
          threadRefs.current.set(thread.id, node);
        } else {
          threadRefs.current.delete(thread.id);
        }
      }}
      thread={thread}
      isReplying={interactive && isReplying && activeReplyTarget?.threadId === thread.id}
      isSubmitting={interactive && submittingThreadId === thread.id}
      isApplying={interactive && applyingThreadId === thread.id}
      streamingContent={
        interactive && activeReplyTarget?.threadId === thread.id ? streamingContent : ''
      }
      allowSourceApply={interactive ? allowSourceApply : false}
      activeReplyAgentId={
        interactive && activeReplyTarget?.threadId === thread.id
          ? activeReplyTarget.agentId
          : null
      }
      agentRegistry={commentAgents}
      blockedAgentReasons={replyProblems[thread.id] || {}}
      t={t}
      now={now}
      sourceApplyState={
        interactive
          ? sourceApplyStates.get(thread.id) || BLOCKED_SOURCE_APPLY_STATE
          : BLOCKED_SOURCE_APPLY_STATE
      }
      onApplyToSource={applyThreadToSource}
      onFocusThread={requestCommentThreadFocus}
      onOpenSettings={() => router.push('/settings')}
      onOpenFile={onOpenFile}
      onReopen={handleReopen}
      onResearchAction={handleResearchAction}
      onResolve={handleResolve}
      onStopAgentListening={handleStopAgentListening}
      onSubmitDeepResearch={submitDeepResearchForThread}
      onSubmitFollowUp={submitFollowUpForThread}
      researchActionState={researchActionId}
    />
  );

  return (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden bg-muted/30',
        embedded
          ? 'h-full w-full border-0'
          : 'w-full max-w-full shrink-0 border-l border-border sm:w-[320px] sm:max-w-[320px]',
        className
      )}
    >
      <div className="space-y-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          {showHeader ? (
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold">
                <MessageSquare className="h-3.5 w-3.5" />
                {t('assistant.review')}
                {activeThreadCount > 0 && (
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    {activeThreadCount}
                  </Badge>
                )}
              </h3>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                {t('comments.description')}
              </p>
            </div>
          ) : null}
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 px-2 text-xs sm:h-7"
              onClick={openManualComposer}
            >
              <PenLine className="mr-1 h-3.5 w-3.5" />
              {t('comments.manualOpenComposer')}
            </Button>
            {onClose && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-11 shrink-0 sm:size-6"
                aria-label={`${t('execution.close')} ${t('assistant.review')}`}
                onClick={onClose}
              >
                <PanelRightClose aria-hidden="true" className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {!showHeader ? (
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            {t('comments.description')}
          </p>
        ) : null}
        {threadStatusNotice ? (
          <div
            aria-live={threadStatusNotice.tone === 'error' ? undefined : 'polite'}
            role={threadStatusNotice.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'break-words rounded-md px-2 py-1.5 text-[10px] leading-relaxed [overflow-wrap:anywhere]',
              threadStatusNotice.tone === 'error'
                ? 'bg-destructive/10 text-destructive'
                : 'bg-muted/60 text-muted-foreground'
            )}
          >
            {threadStatusNotice.text}
          </div>
        ) : null}
        {manualComposerOpen ? (
          <ManualCommentComposer
            agents={commentAgents}
            anchorText={manualAnchorText}
            commentText={manualCommentText}
            error={manualComposerError}
            onAnchorTextChange={(value) => {
              setManualAnchorText(value);
              if (manualComposerError) setManualComposerError(null);
            }}
            onClose={closeManualComposer}
            onCommentTextChange={(value) => {
              setManualCommentText(value);
              if (manualComposerError) setManualComposerError(null);
            }}
            onSubmit={() => void submitManualComment()}
            submitting={manualSubmitting}
            t={t}
          />
        ) : null}
      </div>

      <ScrollArea
        className="min-h-0 flex-1 overflow-hidden"
        viewportProps={{
          'aria-label': t('assistant.review'),
          tabIndex: 0,
        }}
      >
        <div className="space-y-2 p-2">
          <div className="overflow-hidden rounded-lg border bg-background/80">
            <button
              aria-controls={openThreadsRegionId}
              aria-expanded={openListOpen}
              className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
              onClick={() => setOpenListOpen((open) => !open)}
              type="button"
            >
              <span className="flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" />
                {t('comments.openThreads', { count: openThreads.length })}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${
                  openListOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {openListOpen && (
              <div
                id={openThreadsRegionId}
                className="space-y-2 border-t border-border p-2"
              >
                {openThreads.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    <MessageSquare className="mx-auto mb-2 h-6 w-6 opacity-30" />
                    <p>{t('comments.noOpenComments')}</p>
                    <p className="mt-1 opacity-70">
                      {t('comments.leaveCommentForAi')}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-3 h-11 sm:h-8"
                      onClick={openManualComposer}
                    >
                      <PenLine className="mr-1.5 h-3.5 w-3.5" />
                      {t('comments.manualOpenComposer')}
                    </Button>
                  </div>
                ) : (
                  openThreads.map((thread) => renderThreadCard(thread, true))
                )}
              </div>
            )}
          </div>

          {appliedThreads.length > 0 && (
            <div className="overflow-hidden rounded-lg border bg-background/80">
              <button
                aria-controls={appliedThreadsRegionId}
                aria-expanded={appliedListOpen}
                className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
                onClick={() => setAppliedListOpen((open) => !open)}
                type="button"
              >
                <span className="flex items-center gap-1.5">
                  <PenLine className="h-3.5 w-3.5" />
                  {t('comments.pendingVerificationThreads', {
                    count: appliedThreads.length,
                  })}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${
                    appliedListOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {appliedListOpen && (
                <div
                  id={appliedThreadsRegionId}
                  className="space-y-2 border-t border-border p-2"
                >
                  <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
                    {t('comments.pendingVerificationDescription')}
                  </p>
                  {appliedThreads.map((thread) => renderThreadCard(thread, true))}
                </div>
              )}
            </div>
          )}

          {actionableInheritedThreads.length > 0 && (
            <div className="overflow-hidden rounded-lg border bg-background/80">
              <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
                <History className="h-3.5 w-3.5" />
                {t('comments.inheritedThreads', { count: actionableInheritedThreads.length })}
              </div>
              <div className="space-y-2 border-t border-border p-2">
                <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
                  {t('comments.inheritedDescription')}
                </p>
                {actionableInheritedThreads.map((thread) => renderThreadCard(thread, false))}
              </div>
            </div>
          )}

          {earlierContextThreads.length > 0 && (
            <div className="overflow-hidden rounded-lg border bg-background/80">
              <button
                aria-controls={earlierContextRegionId}
                aria-expanded={earlierContextOpen}
                className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
                onClick={() => setEarlierContextOpen((open) => !open)}
                type="button"
              >
                <span className="flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  {t('comments.earlierContext', { count: earlierContextThreads.length })}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${
                    earlierContextOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {earlierContextOpen && (
                <div
                  id={earlierContextRegionId}
                  className="space-y-2 border-t border-border p-2"
                >
                  <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
                    {t('comments.earlierContextDescription')}
                  </p>
                  {earlierContextThreads.map((thread) => renderThreadCard(thread, false))}
                </div>
              )}
            </div>
          )}

          {resolvedThreads.length > 0 && (
            <div className="overflow-hidden rounded-lg border bg-background/80">
              <button
                aria-controls={historyRegionId}
                aria-expanded={historyOpen}
                className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
                onClick={() => setHistoryOpen((open) => !open)}
                type="button"
              >
                <span className="flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  {t('comments.history', { count: resolvedThreads.length })}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${
                    historyOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {historyOpen && (
                <div
                  id={historyRegionId}
                  className="space-y-3 border-t border-border p-2"
                >
                  {resolvedGroups.map((group) => (
                    <div
                      key={group.versionNum === null ? 'draft' : `v${group.versionNum}`}
                      className="space-y-2"
                    >
                      <div className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {group.versionNum === null
                          ? t('comments.draft')
                          : `v${group.versionNum}`}
                      </div>
                      {group.threads.map((thread) => renderThreadCard(thread, false))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
