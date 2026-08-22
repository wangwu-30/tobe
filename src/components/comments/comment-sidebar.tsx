'use client';

import * as React from 'react';
import { CommentAgentTextarea } from '@/components/comments/comment-agent-textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { markdownToPlate, plateToMarkdown } from '@/lib/ai/serializer';
import { useAiReply } from '@/hooks/use-ai-reply';
import { useCommentAgents } from '@/hooks/use-comment-agents';
import {
  Bot,
  CheckCircle,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  History,
  LoaderCircle,
  MessageSquare,
  PanelRightClose,
  PenLine,
  Search,
  SendHorizonal,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  CommentAgentBindingData,
  CommentAgentConfigData,
  CommentMessageData,
  CommentThreadData,
  WorkspaceFileData,
} from '@/types';
import {
  COMMENT_THREAD_FOCUS_EVENT,
  OPEN_MANUAL_COMMENT_COMPOSER_EVENT,
  notifyCommentThreadsChanged,
  requestCommentThreadFocus,
} from '@/lib/comments/constants';
import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import {
  buildMissingAgentBindings,
  formatRemainingListeningMs,
  resolveReplyTargets,
  resolveSingleResearchTarget,
} from '@/lib/comments/agents';
import {
  extractTextFromPlateRange,
  getStructuredDocumentSelectionRange,
  isSingleBlockDocumentSelectionRange,
  replaceTextInPlateRange,
  type DocumentSelectionRangeData,
} from '@/lib/comments/document-selection';
import { useT } from '@/components/providers/language-provider';
import { formatStableDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useAppRouter } from '@/lib/app-router';
import {
  getWorkspaceFileDisplayName,
  isPlateBackedWorkspaceFile,
} from '@/lib/workspace/file-presentation';
import { apiCallOrThrow, apiFetch, safeJsonParse } from '@/framework/resilience';


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
  const manualAnchorFieldId = React.useId();
  const manualCommentFieldId = React.useId();
  const manualComposerTitleId = React.useId();
  const manualComposerErrorId = React.useId();
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
        const createResponse = await apiFetch(`/api/workspaces/${documentId}/staged-changes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceType: 'comment',
            summary: t('comments.applySummary', { anchorText: thread.anchorText }),
            title: t('comments.applyTitle'),
            changes: [
              {
                fileId: plan.targetFile.id,
                kind: plan.targetFile.kind,
                name: plan.targetFile.name,
                nextContent,
                summary: t('comments.applySummary', { anchorText: thread.anchorText }),
              },
            ],
          }),
        });

        if (!createResponse.ok) {
          const payload = await createResponse.json().catch(() => null);
          throw new Error(payload?.error || 'Failed to create staged changes');
        }

        const changeSet = (await createResponse.json()) as { id: string };
        const applyResponse = await apiFetch(
          `/api/workspaces/${documentId}/staged-changes/${changeSet.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'apply',
              checkpointTitle: t('comments.applyCheckpointTitle'),
            }),
          }
        );

        if (!applyResponse.ok) {
          const payload = await applyResponse.json().catch(() => null);
          throw new Error(payload?.error || 'Failed to apply staged changes');
        }

        const threadResponse = await apiFetch(`/api/threads/${thread.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'applied' }),
        });

        if (!threadResponse.ok) {
          const payload = await threadResponse.json().catch(() => null);
          throw new Error(payload?.error || t('comments.applyStatusUpdateFailed'));
        }

        await Promise.all([
          refreshThreads(),
          Promise.resolve(onSourceContentApplied?.()),
        ]);
        requestCommentThreadFocus(thread.id);
      } finally {
        setApplyingThreadId(null);
      }
    },
    [documentId, files, onSourceContentApplied, refreshThreads, requestSuggestion, t]
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
          <form
            aria-busy={manualSubmitting}
            aria-labelledby={manualComposerTitleId}
            className="rounded-xl border border-border/70 bg-background/80 p-3"
            data-testid="manual-comment-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void submitManualComment();
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p id={manualComposerTitleId} className="text-xs font-semibold">
                  {t('comments.manualComposerTitle')}
                </p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  {t('comments.manualComposerDescription')}
                </p>
              </div>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="size-11 sm:size-6"
                aria-label={t('execution.close')}
                onClick={closeManualComposer}
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="mt-3 space-y-2">
              <label
                className="text-[11px] font-medium text-foreground"
                htmlFor={manualAnchorFieldId}
              >
                {t('comments.manualAnchorLabel')}
              </label>
              <Input
                id={manualAnchorFieldId}
                name="comment-scope"
                autoComplete="off"
                data-testid="manual-comment-anchor-input"
                value={manualAnchorText}
                onChange={(event) => {
                  setManualAnchorText(event.target.value);
                  if (manualComposerError) setManualComposerError(null);
                }}
                placeholder={t('comments.manualAnchorPlaceholder')}
              />
            </div>

            <div className="mt-3 space-y-2">
              <label
                className="text-[11px] font-medium text-foreground"
                htmlFor={manualCommentFieldId}
              >
                {t('comments.manualCommentLabel')}
              </label>
              <CommentAgentTextarea
                agents={commentAgents}
                id={manualCommentFieldId}
                name="comment"
                required
                aria-describedby={manualComposerError ? manualComposerErrorId : undefined}
                aria-invalid={manualComposerError ? true : undefined}
                data-testid="manual-comment-textarea"
                value={manualCommentText}
                onChange={(value) => {
                  setManualCommentText(value);
                  if (manualComposerError) setManualComposerError(null);
                }}
                placeholder={t('comments.manualCommentPlaceholder')}
                className="min-h-[104px]"
              />
            </div>

            {manualComposerError ? (
              <p
                id={manualComposerErrorId}
                className="mt-2 break-words text-[11px] text-destructive [overflow-wrap:anywhere]"
                role="alert"
              >
                {manualComposerError}
              </p>
            ) : null}

            <div className="mt-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-muted-foreground">
                {t('comments.agentMentionHint')}
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-11 sm:h-8"
                  onClick={closeManualComposer}
                  disabled={manualSubmitting}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  className="h-11 sm:h-8"
                  aria-busy={manualSubmitting}
                  disabled={manualSubmitting || !manualCommentText.trim()}
                >
                  {manualSubmitting
                    ? t('comments.manualCreating')
                    : t('comments.manualCreate')}
                </Button>
              </div>
            </div>
          </form>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1 overflow-hidden">
        <div className="space-y-2 p-2">
          <div className="overflow-hidden rounded-lg border bg-background/80">
            <button
              aria-controls={openThreadsRegionId}
              aria-expanded={openListOpen}
              className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
              onClick={() => setOpenListOpen(open => !open)}
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
                  openThreads.map(thread => (
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
                          isReplying={isReplying && activeReplyTarget?.threadId === thread.id}
                      isSubmitting={submittingThreadId === thread.id}
                      isApplying={applyingThreadId === thread.id}
                      streamingContent={
                        activeReplyTarget?.threadId === thread.id ? streamingContent : ''
                      }
                      allowSourceApply={allowSourceApply}
                      activeReplyAgentId={
                        activeReplyTarget?.threadId === thread.id
                          ? activeReplyTarget.agentId
                          : null
                      }
                      agentRegistry={commentAgents}
                      blockedAgentReasons={replyProblems[thread.id] || {}}
                      t={t}
                      now={now}
                      sourceApplyState={sourceApplyStates.get(thread.id) || BLOCKED_SOURCE_APPLY_STATE}
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
                  ))
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
                onClick={() => setAppliedListOpen(open => !open)}
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
                  {appliedThreads.map(thread => (
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
                          isReplying={isReplying && activeReplyTarget?.threadId === thread.id}
                      isSubmitting={submittingThreadId === thread.id}
                      isApplying={applyingThreadId === thread.id}
                      streamingContent={
                        activeReplyTarget?.threadId === thread.id ? streamingContent : ''
                      }
                      allowSourceApply={allowSourceApply}
                      activeReplyAgentId={
                        activeReplyTarget?.threadId === thread.id
                          ? activeReplyTarget.agentId
                          : null
                      }
                      agentRegistry={commentAgents}
                      blockedAgentReasons={replyProblems[thread.id] || {}}
                      t={t}
                      now={now}
                      sourceApplyState={sourceApplyStates.get(thread.id) || BLOCKED_SOURCE_APPLY_STATE}
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
                  ))}
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
                {actionableInheritedThreads.map(thread => (
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
                    isReplying={false}
                    isSubmitting={false}
                    isApplying={false}
                    streamingContent=""
                    allowSourceApply={false}
                    activeReplyAgentId={null}
                    agentRegistry={commentAgents}
                    blockedAgentReasons={replyProblems[thread.id] || {}}
                    t={t}
                    now={now}
                    sourceApplyState={BLOCKED_SOURCE_APPLY_STATE}
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
                ))}
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
                  {earlierContextThreads.map((thread) => (
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
                      isReplying={false}
                      isSubmitting={false}
                      isApplying={false}
                      streamingContent=""
                      allowSourceApply={false}
                      activeReplyAgentId={null}
                      agentRegistry={commentAgents}
                      blockedAgentReasons={replyProblems[thread.id] || {}}
                      t={t}
                      now={now}
                      sourceApplyState={BLOCKED_SOURCE_APPLY_STATE}
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
                  ))}
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
                onClick={() => setHistoryOpen(open => !open)}
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
                  {resolvedGroups.map(group => (
                    <div
                      key={group.versionNum === null ? 'draft' : `v${group.versionNum}`}
                      className="space-y-2"
                    >
                      <div className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {group.versionNum === null
                          ? t('comments.draft')
                          : `v${group.versionNum}`}
                      </div>
                      {group.threads.map(thread => (
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
                          isReplying={false}
                          isSubmitting={false}
                          isApplying={false}
                          streamingContent=""
                          allowSourceApply={false}
                          activeReplyAgentId={null}
                          agentRegistry={commentAgents}
                          blockedAgentReasons={replyProblems[thread.id] || {}}
                          t={t}
                          now={now}
                          sourceApplyState={BLOCKED_SOURCE_APPLY_STATE}
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
                      ))}
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

const CommentThreadCard = React.forwardRef<
  HTMLDivElement,
  {
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
    t: ReturnType<typeof useT>;
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
  }
>(function CommentThreadCard(
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
  }, [activeReplyAgentId, agentRegistry, agentRegistryById, blockedAgentReasons, now, t, thread.agentBindings]);
  const hasAssistantReply = thread.messages.some(
    message => message.role === 'assistant' && message.content.trim().length > 0
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
  const applyStatus =
    isApplying
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
});

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

function formatCommentResearchPhase(
  phase: NonNullable<CommentThreadData['researchState']>['progress'] extends infer T
    ? T extends { phase: infer P }
      ? P
      : never
    : never,
  t: ReturnType<typeof useT>
) {
  if (phase === 'proposal') return t('comments.researchPhaseProposal');
  if (phase === 'searching') return t('comments.researchPhaseSearching');
  if (phase === 'analyzing_gaps') return t('comments.researchPhaseAnalyzingGaps');
  if (phase === 'reporting') return t('comments.researchPhaseReporting');
  if (phase === 'blocked') return t('comments.researchPhaseBlocked');
  return t('comments.researchPhaseCompleted');
}

function formatDurationLabel(valueMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(valueMs / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function isOpenThread(thread: CommentThreadData) {
  return thread.status === 'open';
}

function isAppliedThread(thread: CommentThreadData) {
  return thread.status === 'applied';
}

function isResolvedThread(thread: CommentThreadData) {
  return thread.status === 'resolved';
}

function groupResolvedThreads(threads: CommentThreadData[]) {
  const groups = new Map<number | null, CommentThreadData[]>();

  threads.forEach(thread => {
    const versionNum = thread.version?.versionNum ?? null;
    const existing = groups.get(versionNum) ?? [];
    existing.push(thread);
    groups.set(versionNum, existing);
  });

  return [...groups.entries()]
    .sort(([left], [right]) => compareHistoryLabels(left, right))
    .map(([versionNum, groupedThreads]) => ({
      versionNum,
      threads: groupedThreads.sort((a, b) => {
        const leftTime = new Date(b.updatedAt).getTime();
        const rightTime = new Date(a.updatedAt).getTime();
        return leftTime - rightTime;
      }),
    }));
}

function compareHistoryLabels(left: number | null, right: number | null) {
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

type SourceApplyState = {
  canApply: boolean;
  reason: string | null;
};

type SourceApplyPlan =
  | {
      editableText: string;
      kind: 'structured';
      range: DocumentSelectionRangeData;
      targetFile: WorkspaceFileData;
    }
  | {
      editableText: string;
      kind: 'text';
      match: { end: number; start: number };
      targetFile: WorkspaceFileData;
    };

const BLOCKED_SOURCE_APPLY_STATE: SourceApplyState = {
  canApply: false,
  reason: null,
};

function getSourceApplyState(params: {
  allowSourceApply: boolean;
  files: WorkspaceFileData[];
  t: ReturnType<typeof useT>;
  thread: CommentThreadData;
}): SourceApplyState {
  if (
    !params.allowSourceApply ||
    params.thread.isInherited ||
    isResolvedThread(params.thread) ||
    isAppliedThread(params.thread)
  ) {
    return BLOCKED_SOURCE_APPLY_STATE;
  }

  const plan = resolveSourceApplyPlan(params);
  if (!plan || plan.kind === 'blocked') {
    return {
      canApply: false,
      reason: plan?.reason || null,
    };
  }

  return {
    canApply: true,
    reason: null,
  };
}

function resolveSourceApplyPlan(params: {
  files: WorkspaceFileData[];
  t: ReturnType<typeof useT>;
  thread: CommentThreadData;
}):
  | SourceApplyPlan
  | {
      kind: 'blocked';
      reason: string | null;
    } {
  const targetFile = resolveTargetFile(params.thread, params.files);
  if (!targetFile) {
    return {
      kind: 'blocked',
      reason: params.t('comments.applyTargetMissing'),
    };
  }

  const reviewAnchor = params.thread.reviewAnchor;
  if (reviewAnchor?.surfaceType === 'web-component') {
    return {
      kind: 'blocked',
      reason: null,
    };
  }

  const rangeState =
    typeof reviewAnchor?.anchorPayload?.rangeState === 'string'
      ? reviewAnchor.anchorPayload.rangeState
      : null;
  if (
    reviewAnchor?.surfaceType === 'document-selection' &&
    rangeState === 'cross-block'
  ) {
    return {
      kind: 'blocked',
      reason: params.t('comments.applyCrossBlockUnsupported'),
    };
  }

  const editableText = getEditableText(targetFile);
  const anchorCandidates = collectAnchorCandidates(params.thread);
  const structuredRange = getStructuredDocumentSelectionRange(reviewAnchor);
  if (
    structuredRange &&
    isSingleBlockDocumentSelectionRange(structuredRange) &&
    isPlateBackedWorkspaceFile(targetFile)
  ) {
    const structuredExcerpt = extractTextFromPlateRange(targetFile.content, structuredRange);
    if (
      structuredExcerpt &&
      matchesStructuredAnchorExcerpt(structuredExcerpt, anchorCandidates)
    ) {
      return {
        editableText,
        kind: 'structured',
        range: structuredRange,
        targetFile,
      };
    }
  }

  const textMatch = resolveUniqueAnchorMatch({
    anchorCandidates,
    sourceText: editableText,
  });
  if (!textMatch) {
    return {
      kind: 'blocked',
      reason: params.t('comments.applyAnchorMissing'),
    };
  }

  if (textMatch === 'ambiguous') {
    return {
      kind: 'blocked',
      reason: params.t('comments.applyAnchorAmbiguous'),
    };
  }

  return {
    editableText,
    kind: 'text',
    match: textMatch,
    targetFile,
  };
}

function resolveTargetFile(
  thread: CommentThreadData,
  files: WorkspaceFileData[]
): WorkspaceFileData | null {
  const mappedFileId =
    thread.fileId || thread.reviewAnchor?.sourceMapping?.fileId || null;

  if (mappedFileId) {
    return files.find(file => file.id === mappedFileId) || null;
  }

  return files.find(file => file.isPrimary) || files[0] || null;
}

function serializeThreadDiscussion(thread: CommentThreadData) {
  return thread.messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message =>
      `${message.role === 'assistant' ? 'AI' : 'User'}: ${message.content.trim()}`
    )
    .join('\n\n');
}

function collectAnchorCandidates(thread: CommentThreadData) {
  const candidates = new Set<string>();
  const excerpt =
    typeof thread.reviewAnchor?.anchorPayload?.excerpt === 'string'
      ? thread.reviewAnchor.anchorPayload.excerpt
      : null;

  [thread.anchorText, excerpt].forEach((value) => {
    const trimmed = value?.trim();
    if (trimmed) {
      candidates.add(trimmed);
    }
  });

  return [...candidates];
}

function getEditableText(file: WorkspaceFileData) {
  if (!isPlateBackedWorkspaceFile(file)) {
    return file.content;
  }

  const parsed = safeJsonParse<unknown>(file.content, null);
  return Array.isArray(parsed) ? plateToMarkdown(parsed) : file.content;
}

function toWorkspaceFileContent(file: WorkspaceFileData, content: string) {
  if (!isPlateBackedWorkspaceFile(file)) {
    return content;
  }

  return JSON.stringify(markdownToPlate(content));
}

function matchesStructuredAnchorExcerpt(
  excerpt: string,
  anchorCandidates: string[]
) {
  if (anchorCandidates.length === 0) {
    return true;
  }

  const normalizedExcerpt = normalizeAnchorText(excerpt);
  return anchorCandidates.some(
    (candidate) => normalizeAnchorText(candidate) === normalizedExcerpt
  );
}

function resolveUniqueAnchorMatch(params: {
  anchorCandidates: string[];
  sourceText: string;
}) {
  const candidates = params.anchorCandidates
    .map((candidate) => candidate.trim())
    .filter(Boolean);

  if (candidates.length === 0) {
    return null;
  }

  for (const candidate of candidates) {
    const exactMatch = findUniqueExactMatch(params.sourceText, candidate);
    if (exactMatch === 'ambiguous') {
      continue;
    }
    if (exactMatch) {
      return exactMatch;
    }
  }

  const normalizedMatches = new Map<string, { end: number; start: number }>();
  let sawAmbiguousCandidate = false;

  for (const candidate of candidates) {
    const normalizedMatch = findUniqueNormalizedMatch(params.sourceText, candidate);
    if (normalizedMatch === 'ambiguous') {
      sawAmbiguousCandidate = true;
      continue;
    }
    if (normalizedMatch) {
      normalizedMatches.set(
        `${normalizedMatch.start}:${normalizedMatch.end}`,
        normalizedMatch
      );
    }
  }

  if (normalizedMatches.size === 1) {
    return [...normalizedMatches.values()][0];
  }

  if (normalizedMatches.size > 1 || sawAmbiguousCandidate) {
    return 'ambiguous' as const;
  }

  return null;
}

function findUniqueExactMatch(sourceText: string, candidate: string) {
  const firstIndex = sourceText.indexOf(candidate);
  if (firstIndex < 0) {
    return null;
  }

  const secondIndex = sourceText.indexOf(candidate, firstIndex + candidate.length);
  if (secondIndex >= 0) {
    return 'ambiguous' as const;
  }

  return {
    end: firstIndex + candidate.length,
    start: firstIndex,
  };
}

function findUniqueNormalizedMatch(sourceText: string, candidate: string) {
  const normalizedCandidate = normalizeAnchorText(candidate);
  if (!normalizedCandidate) {
    return null;
  }

  const indexedSource = buildNormalizedSearchIndex(sourceText);
  if (!indexedSource.text) {
    return null;
  }

  const matchIndex = indexedSource.text.indexOf(normalizedCandidate);
  if (matchIndex < 0) {
    return null;
  }

  const nextMatchIndex = indexedSource.text.indexOf(
    normalizedCandidate,
    matchIndex + normalizedCandidate.length
  );
  if (nextMatchIndex >= 0) {
    return 'ambiguous' as const;
  }

  return {
    end: indexedSource.indexMap[matchIndex + normalizedCandidate.length - 1] + 1,
    start: indexedSource.indexMap[matchIndex],
  };
}

function buildNormalizedSearchIndex(value: string) {
  let text = '';
  const indexMap: number[] = [];
  let lastWasWhitespace = true;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (/\s/.test(character)) {
      if (lastWasWhitespace || text.length === 0) {
        continue;
      }
      text += ' ';
      indexMap.push(index);
      lastWasWhitespace = true;
      continue;
    }

    text += character.toLowerCase();
    indexMap.push(index);
    lastWasWhitespace = false;
  }

  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    indexMap.pop();
  }

  return { indexMap, text };
}

function buildManualCommentAnchor(params: {
  currentFileId?: string | null;
  files: WorkspaceFileData[];
  t: ReturnType<typeof useT>;
}) {
  const currentFile =
    params.currentFileId
      ? params.files.find((file) => file.id === params.currentFileId) || null
      : null;

  if (!currentFile) {
    return params.t('comments.manualDefaultAnchor');
  }

  return getWorkspaceFileDisplayName(currentFile) || params.t('comments.manualDefaultAnchor');
}

function normalizeAnchorText(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function replaceSourceRange(
  sourceText: string,
  range: { end: number; start: number },
  replacement: string
) {
  return sourceText.slice(0, range.start) + replacement + sourceText.slice(range.end);
}
