'use client';

import * as React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAiReply } from '@/hooks/use-ai-reply';
import {
  Bot,
  CheckCircle,
  ChevronDown,
  History,
  MessageSquare,
  PanelRightClose,
} from 'lucide-react';
import type { CommentThreadData, CommentMessageData } from '@/types';
import {
  COMMENT_THREAD_FOCUS_EVENT,
  type CommentReplyMode,
  readCommentReplyMode,
  writeCommentReplyMode,
} from '@/lib/comments/constants';
import { useT } from '@/components/providers/language-provider';
import { formatStableDate } from '@/lib/time';
import { cn } from '@/lib/utils';

export function CommentSidebar({
  className,
  documentId,
  documentContent,
  embedded = false,
  onClose,
  onOpenChange,
  threads,
  refreshThreads,
}: {
  className?: string;
  documentId: string;
  documentContent: string;
  embedded?: boolean;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
  threads: CommentThreadData[];
  refreshThreads: () => Promise<void>;
}) {
  const t = useT();
  const [replyMode, setReplyMode] = React.useState<CommentReplyMode>('auto');
  const [focusedThreadId, setFocusedThreadId] = React.useState<string | null>(null);
  const [openListOpen, setOpenListOpen] = React.useState(true);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [activeReplyThreadId, setActiveReplyThreadId] = React.useState<string | null>(
    null
  );
  const { isReplying, streamingContent, sendCommentReply } = useAiReply();
  const threadRefs = React.useRef(new Map<string, HTMLDivElement>());

  React.useEffect(() => {
    setReplyMode(readCommentReplyMode());
  }, []);

  React.useEffect(() => {
    const handleThreadFocus = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string }>).detail;
      if (!detail?.threadId) return;

      const thread = threads.find(item => item.id === detail.threadId);
      if (!thread) return;

      if (thread.status === 'resolved') {
        setHistoryOpen(true);
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
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [focusedThreadId, historyOpen, openListOpen, threads]);

  const runAiReplyForThread = React.useCallback(
    async (thread: CommentThreadData) => {
      setActiveReplyThreadId(thread.id);
      try {
        await sendCommentReply({
          threadId: thread.id,
          documentContent,
          anchorText: thread.anchorText,
          documentId,
          onComplete: () => refreshThreads(),
        });
      } finally {
        setActiveReplyThreadId(null);
      }
    },
    [documentContent, documentId, refreshThreads, sendCommentReply]
  );

  const handleReplyModeChange = React.useCallback((value: string) => {
    const nextMode = value === 'manual' ? 'manual' : 'auto';
    setReplyMode(nextMode);
    writeCommentReplyMode(nextMode);
  }, []);

  const handleReplyPending = React.useCallback(async () => {
    const pendingThreads = threads.filter(isPendingAiReply);
    for (const thread of pendingThreads) {
      await runAiReplyForThread(thread);
      await refreshThreads();
    }
  }, [refreshThreads, runAiReplyForThread, threads]);

  const handleResolve = React.useCallback(
    async (threadId: string) => {
      const res = await fetch(`/api/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      });

      if (!res.ok) {
        return;
      }

      try {
        await fetch('/api/ai/extract-memory', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(localStorage.getItem('ai-settings')
              ? { 'x-ai-settings': localStorage.getItem('ai-settings')! }
              : {}),
          },
          body: JSON.stringify({ threadId }),
        });
      } catch {
        // Memory extraction is best-effort.
      }

      await refreshThreads();
    },
    [refreshThreads]
  );

  const openThreads = threads.filter(t => t.status === 'open');
  const resolvedThreads = threads.filter(t => t.status === 'resolved');
  const pendingThreads = openThreads.filter(isPendingAiReply);
  const resolvedGroups = groupResolvedThreads(resolvedThreads);

  return (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden bg-muted/30',
        embedded
          ? 'h-full w-full border-0'
          : 'w-[320px] max-w-[320px] shrink-0 border-l border-border',
        className
      )}
    >
      <div className="space-y-2 border-b border-border px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold">
              <MessageSquare className="h-3.5 w-3.5" />
              {t('comments.title')}
              {openThreads.length > 0 && (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  {openThreads.length}
                </Badge>
              )}
            </h3>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              {t('comments.description')}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {replyMode === 'manual' && pendingThreads.length > 0 && (
              <Button
                size="sm"
                className="h-7 gap-1.5 px-2 text-[10px]"
                onClick={handleReplyPending}
                disabled={isReplying}
              >
                <Bot className="h-3 w-3" />
                {t('comments.runAiReplies')}
              </Button>
            )}
            {onClose && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="shrink-0"
                onClick={onClose}
              >
                <PanelRightClose className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select value={replyMode} onValueChange={handleReplyModeChange}>
            <SelectTrigger className="h-8 min-w-0 flex-1 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t('comments.autoReply')}</SelectItem>
              <SelectItem value="manual">{t('comments.batchReply')}</SelectItem>
            </SelectContent>
          </Select>

          {replyMode === 'manual' && (
            <Badge variant="outline" className="text-[10px]">
              {t('comments.queue')}
            </Badge>
          )}
        </div>

        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {replyMode === 'auto'
            ? t('comments.autoReplyDescription')
            : t('comments.writeSeveralCommentsFirst')}
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1 overflow-hidden">
        <div className="space-y-2 p-2">
          <div className="overflow-hidden rounded-lg border bg-background/80">
            <button
              className="flex w-full items-center justify-between px-3 py-2 text-xs text-foreground"
              onClick={() => setOpenListOpen(open => !open)}
              type="button"
            >
              <span className="flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" />
                {t('comments.openThreads', { count: openThreads.length })}
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${
                  openListOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {openListOpen && (
              <div className="space-y-2 border-t border-border p-2">
                {openThreads.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    <MessageSquare className="mx-auto mb-2 h-6 w-6 opacity-30" />
                    <p>{t('comments.noOpenComments')}</p>
                    <p className="mt-1 opacity-70">
                      {t('comments.leaveCommentForAi')}
                    </p>
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
                      resolved={false}
                      isReplying={isReplying && activeReplyThreadId === thread.id}
                      streamingContent={
                        activeReplyThreadId === thread.id ? streamingContent : ''
                      }
                      canRequestAiReply={isPendingAiReply(thread)}
                      t={t}
                      onResolve={handleResolve}
                      onRequestAiReply={runAiReplyForThread}
                    />
                  ))
                )}
              </div>
            )}
          </div>

          {resolvedThreads.length > 0 && (
            <div className="overflow-hidden rounded-lg border bg-background/80">
              <button
                className="flex w-full items-center justify-between px-3 py-2 text-xs text-muted-foreground"
                onClick={() => setHistoryOpen(open => !open)}
                type="button"
              >
                <span className="flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  {t('comments.history', { count: resolvedThreads.length })}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${
                    historyOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {historyOpen && (
                <div className="border-t border-border p-2 space-y-3">
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
                          resolved
                          isReplying={false}
                          streamingContent=""
                          canRequestAiReply={false}
                          t={t}
                          onResolve={handleResolve}
                          onRequestAiReply={runAiReplyForThread}
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
    resolved: boolean;
    isReplying: boolean;
    streamingContent: string;
    canRequestAiReply: boolean;
    highlighted?: boolean;
    t: ReturnType<typeof useT>;
    onResolve: (threadId: string) => Promise<void>;
    onRequestAiReply: (thread: CommentThreadData) => Promise<void>;
  }
>(function CommentThreadCard(
  {
    thread,
    resolved,
    isReplying,
    streamingContent,
    canRequestAiReply,
    highlighted = false,
    t,
    onResolve,
    onRequestAiReply,
  },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        'w-full min-w-0 overflow-hidden rounded-xl border bg-background p-3 text-xs transition-colors',
        resolved && 'opacity-70',
        highlighted && 'border-primary/60 bg-primary/5 ring-2 ring-primary/15'
      )}
    >
      <div className="mb-3 flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-1.5 overflow-hidden">
          <div className="mt-0.5 h-full min-h-[16px] w-1 shrink-0 rounded-full bg-yellow-400" />
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="break-words text-muted-foreground italic">
              &quot;{thread.anchorText}&quot;
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                {thread.snapshot ? `v${thread.snapshot.versionNum}` : t('comments.draft')}
              </Badge>
              {!resolved && canRequestAiReply && (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  {t('comments.awaitingAi')}
                </Badge>
              )}
              {resolved && thread.resolvedAt && (
                <span className="text-[10px] text-muted-foreground">
                  {formatStableDate(thread.resolvedAt)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

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
                  {t('comments.aiReply')}
                </>
              ) : (
                t('comments.commentToAi')
              )}
            </div>
            <p className="break-words whitespace-pre-wrap leading-relaxed">
              {msg.content}
            </p>
          </div>
        ))}

        {isReplying && (
          <div className="min-w-0 overflow-hidden rounded-lg border border-primary/15 bg-primary/5 px-2 py-1.5">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              <Bot className="h-3 w-3 animate-pulse text-primary" />
              {t('comments.aiReplying')}
            </div>
            <p className="break-words whitespace-pre-wrap leading-relaxed text-muted-foreground">
              {streamingContent || t('comments.thinkingThroughComment')}
            </p>
          </div>
        )}
      </div>

      {!resolved && (
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-muted-foreground">
            {canRequestAiReply
              ? t('comments.waitingAiReply')
              : t('comments.resolvedMoveToHistory')}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {canRequestAiReply && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={() => void onRequestAiReply(thread)}
                disabled={isReplying}
              >
                <Bot className="mr-1 h-3 w-3" />
                {t('comments.replyWithAi')}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => void onResolve(thread.id)}
            >
              <CheckCircle className="mr-1 h-3 w-3" />
              {t('comments.resolve')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});

CommentThreadCard.displayName = 'CommentThreadCard';

function isPendingAiReply(thread: CommentThreadData) {
  const lastMessage = [...thread.messages]
    .reverse()
    .find(message => message.role === 'user' || message.role === 'assistant');

  return lastMessage?.role === 'user';
}

function groupResolvedThreads(threads: CommentThreadData[]) {
  const groups = new Map<number | null, CommentThreadData[]>();

  threads.forEach(thread => {
    const versionNum = thread.snapshot?.versionNum ?? null;
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
