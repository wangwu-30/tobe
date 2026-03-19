'use client';

import * as React from 'react';
import { MessageSquarePlus, Search } from 'lucide-react';
import { CommentAgentTextarea } from '@/components/comments/comment-agent-textarea';
import { Button } from '@/components/ui/button';
import { useAiReply } from '@/hooks/use-ai-reply';
import { useCommentAgents } from '@/hooks/use-comment-agents';
import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import { resolveSingleResearchTarget } from '@/lib/comments/agents';
import { useT } from '@/components/providers/language-provider';
import type { CommentThreadData } from '@/types';
import {
  OPEN_SELECTION_COMMENT_COMPOSER_EVENT,
  requestCommentThreadFocus,
} from '@/lib/comments/constants';
import {
  WEB_PREVIEW_BRIDGE_CHANNEL,
  type WebPreviewAnchorPayloadData,
  type WebPreviewBridgeMessage,
} from '@/lib/workspace/preview-bridge';

type ComposerState = {
  anchorPayload: WebPreviewAnchorPayloadData;
  x: number;
  y: number;
};

export function WebSelectionCommentTrigger({
  draftRevision,
  documentContent,
  fileId,
  iframeRef,
  onThreadsChanged,
  versionId,
  workspaceId,
}: {
  draftRevision?: number | null;
  documentContent: string;
  fileId?: string | null;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onThreadsChanged: () => Promise<void>;
  versionId?: string | null;
  workspaceId: string;
}) {
  const t = useT();
  const { sendCommentReply } = useAiReply();
  const commentAgents = useCommentAgents();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const composerRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const readinessTimeoutRef = React.useRef<number | null>(null);
  const [selectionState, setSelectionState] = React.useState<ComposerState | null>(null);
  const [composerState, setComposerState] = React.useState<ComposerState | null>(null);
  const [commentText, setCommentText] = React.useState('');
  const [researchMode, setResearchMode] = React.useState<'light' | 'deep'>('light');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectionAvailable, setSelectionAvailable] = React.useState<boolean | null>(null);

  const clearReadinessTimeout = React.useCallback(() => {
    if (readinessTimeoutRef.current) {
      window.clearTimeout(readinessTimeoutRef.current);
      readinessTimeoutRef.current = null;
    }
  }, []);

  const buildComposerState = React.useCallback(
    (payload: WebPreviewAnchorPayloadData) => {
      const iframe = iframeRef.current;
      const container = containerRef.current;
      if (!iframe || !container || !payload.excerpt?.trim()) {
        return null;
      }

      const iframeRect = iframe.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const rect = payload.boundingRect;

      return {
        anchorPayload: payload,
        x:
          iframeRect.left -
          containerRect.left +
          (rect ? rect.x + rect.width / 2 : iframeRect.width / 2),
        y: iframeRect.top - containerRect.top + (rect ? rect.y : 24),
      } satisfies ComposerState;
    },
    [iframeRef]
  );

  const closeComposer = React.useCallback(() => {
    setComposerState(null);
    setCommentText('');
    setResearchMode('light');
    setError(null);
    setSelectionState(null);
  }, []);

  const openComposer = React.useCallback(() => {
    if (!selectionState) {
      return;
    }

    setComposerState(selectionState);
    setSelectionState(null);
    setCommentText('');
    setError(null);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [selectionState]);

  const submitComment = React.useCallback(async () => {
    if (!composerState || !commentText.trim()) {
      return;
    }

    const anchorPayload = composerState.anchorPayload;
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/threads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getStoredAISettingsHeader(),
        },
        body: JSON.stringify({
          documentId: workspaceId,
          draftRevision: versionId ? null : draftRevision,
          fileId: fileId || null,
          firstMessage: commentText.trim(),
          anchorText: anchorPayload.excerpt,
          selectionAnchor: JSON.stringify({
            surfaceType: 'web-component',
            bindingType: 'selection',
            anchorPayload: {
              excerpt: anchorPayload.excerpt,
              cssSelector: anchorPayload.cssSelector,
              domContext: anchorPayload.domContext,
              boundingRect: anchorPayload.boundingRect,
              selector: anchorPayload.cssSelector,
            },
            previewVersionId: versionId || null,
            sourceMapping: {
              fileId: fileId || null,
              selector: anchorPayload.cssSelector,
            },
          }),
          versionId: versionId || null,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create thread.');
      }

      const thread = (await response.json()) as CommentThreadData;
      await onThreadsChanged();
      requestCommentThreadFocus(thread.id);

      if (researchMode === 'deep') {
        const researchTarget = resolveSingleResearchTarget({
          agents: commentAgents,
          content: commentText.trim(),
        });

        if (researchTarget.error === 'multiple' || !researchTarget.target) {
          throw new Error(t('comments.researchNeedsSingleAgent'));
        }

        const researchResponse = await fetch(`/api/threads/${thread.id}/research-plan`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getStoredAISettingsHeader(),
          },
          body: JSON.stringify({
            agentId: researchTarget.target.agentId,
            anchorText: anchorPayload.excerpt,
            content: commentText.trim(),
            documentContent,
            persistMessage: false,
          }),
        });

        if (!researchResponse.ok) {
          const payload = await researchResponse.json().catch(() => null);
          throw new Error(payload?.error || t('comments.researchPlanFailed'));
        }

        await onThreadsChanged();
        requestCommentThreadFocus(thread.id);
        closeComposer();
        return;
      }

      if (thread.agentBindings.length > 0) {
        try {
          for (const binding of thread.agentBindings) {
            await sendCommentReply({
              agentId: binding.agentId,
              anchorText: anchorPayload.excerpt,
              documentContent,
              documentId: workspaceId,
              threadId: thread.id,
            });
          }
          await onThreadsChanged();
          requestCommentThreadFocus(thread.id);
        } catch {
          // Comment creation succeeds even if agent replies fail.
        }
      }

      closeComposer();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to create thread.');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    closeComposer,
    commentAgents,
    commentText,
    composerState,
    documentContent,
    draftRevision,
    fileId,
    onThreadsChanged,
    researchMode,
    sendCommentReply,
    t,
    versionId,
    workspaceId,
  ]);

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent<WebPreviewBridgeMessage>) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }

      const message = event.data;
      if (!message || message.channel !== WEB_PREVIEW_BRIDGE_CHANNEL) {
        return;
      }

      if (message.type === 'ready') {
        clearReadinessTimeout();
        setSelectionAvailable(true);
        return;
      }

      if (message.type !== 'selection' && message.type !== 'element') {
        return;
      }

      clearReadinessTimeout();
      setSelectionAvailable(true);

      if (composerState) {
        return;
      }

      setSelectionState(message.payload ? buildComposerState(message.payload) : null);
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [buildComposerState, clearReadinessTimeout, composerState, iframeRef]);

  React.useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) {
      return;
    }

    const handleLoad = () => {
      setSelectionState(null);
      setSelectionAvailable(null);
      clearReadinessTimeout();
      readinessTimeoutRef.current = window.setTimeout(() => {
        setSelectionAvailable(false);
        readinessTimeoutRef.current = null;
      }, 1200);
    };

    iframe.addEventListener('load', handleLoad);
    handleLoad();

    return () => {
      iframe.removeEventListener('load', handleLoad);
      clearReadinessTimeout();
    };
  }, [clearReadinessTimeout, iframeRef]);

  React.useEffect(() => {
    const handleOpen = () => {
      openComposer();
    };

    window.addEventListener(OPEN_SELECTION_COMMENT_COMPOSER_EVENT, handleOpen);
    return () => {
      window.removeEventListener(OPEN_SELECTION_COMMENT_COMPOSER_EVENT, handleOpen);
    };
  }, [openComposer]);

  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!composerRef.current) {
        return;
      }

      if (composerRef.current.contains(event.target as Node)) {
        return;
      }

      closeComposer();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [closeComposer]);

  if (!selectionState && !composerState) {
    return (
      <div ref={containerRef} className="pointer-events-none absolute inset-0 z-10">
        {selectionAvailable === false ? (
          <div className="absolute right-3 top-3 rounded-full border border-border bg-background/95 px-3 py-1 text-[11px] text-muted-foreground shadow-sm">
            {t('comments.webSelectionUnavailable')}
          </div>
        ) : null}
      </div>
    );
  }

  const anchor = composerState || selectionState;

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-10">
      {selectionState && !composerState ? (
        <div
          className="absolute"
          style={{
            left: clamp(selectionState.x, 72, (containerRef.current?.clientWidth || 320) - 72),
            top: Math.max(16, selectionState.y - 12),
            transform: 'translate(-50%, -100%)',
          }}
        >
          <Button
            type="button"
            size="sm"
            className="pointer-events-auto h-8 gap-1.5 rounded-full shadow-lg"
            data-testid="web-selection-comment-trigger"
            onClick={openComposer}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            评论
          </Button>
        </div>
      ) : null}

      {composerState && anchor ? (
        <div
          ref={composerRef}
          data-testid="web-selection-comment-composer"
          className="pointer-events-auto absolute w-[320px] rounded-2xl border border-border/70 bg-background/95 p-3 shadow-2xl"
          style={{
            left: clamp(anchor.x, 180, (containerRef.current?.clientWidth || 400) - 180),
            top: Math.max(16, anchor.y + 20),
            transform: 'translateX(-50%)',
          }}
        >
          <div className="mb-2 text-xs font-medium text-foreground">
            {composerState.anchorPayload.excerpt}
          </div>
          <CommentAgentTextarea
            agents={commentAgents}
            ref={textareaRef}
            value={commentText}
            onChange={setCommentText}
            placeholder="让 AI 调整这里的页面表现……"
            className="min-h-[96px]"
          />
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            {researchMode === 'deep'
              ? t('comments.deepResearchHint')
              : t('comments.agentMentionHint')}
          </p>
          {error ? <div className="mt-2 text-xs text-destructive">{error}</div> : null}
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant={researchMode === 'deep' ? 'secondary' : 'outline'}
              className="rounded-full"
              onClick={() =>
                setResearchMode((current) => (current === 'deep' ? 'light' : 'deep'))
              }
              disabled={isSubmitting}
            >
              <Search className="mr-1 h-3.5 w-3.5" />
              {researchMode === 'deep'
                ? t('comments.deepResearchEnabled')
                : t('comments.deepResearch')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={closeComposer}>
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void submitComment()}
              disabled={isSubmitting || !commentText.trim()}
            >
              {isSubmitting
                ? researchMode === 'deep'
                  ? t('comments.researchPlanning')
                  : '提交中…'
                : researchMode === 'deep'
                  ? t('comments.createResearchPlan')
                  : '提交评论'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
