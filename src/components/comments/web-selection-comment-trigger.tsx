'use client';

import * as React from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAiReply } from '@/hooks/use-ai-reply';
import type { CommentThreadData } from '@/types';
import {
  OPEN_SELECTION_COMMENT_COMPOSER_EVENT,
  readCommentReplyMode,
  requestCommentThreadFocus,
} from '@/lib/comments/constants';

type ComposerState = {
  anchorText: string;
  selector: string | null;
  x: number;
  y: number;
};

export function WebSelectionCommentTrigger({
  documentContent,
  fileId,
  iframeRef,
  onThreadsChanged,
  snapshotId,
  workspaceId,
}: {
  documentContent: string;
  fileId?: string | null;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onThreadsChanged: () => Promise<void>;
  snapshotId?: string | null;
  workspaceId: string;
}) {
  const { sendCommentReply } = useAiReply();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const composerRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [selectionState, setSelectionState] = React.useState<ComposerState | null>(null);
  const [composerState, setComposerState] = React.useState<ComposerState | null>(null);
  const [commentText, setCommentText] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const readSelectionState = React.useCallback(() => {
    const iframe = iframeRef.current;
    const container = containerRef.current;
    if (!iframe || !container) {
      return null;
    }

    try {
      const iframeWindow = iframe.contentWindow;
      const iframeDocument = iframe.contentDocument;
      const selection = iframeWindow?.getSelection();
      const selectedText = selection?.toString().trim();
      if (!selection || !selectedText || selection.rangeCount === 0) {
        return null;
      }

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) {
        return null;
      }

      const iframeRect = iframe.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const x = iframeRect.left - containerRect.left + rect.left + rect.width / 2;
      const y = iframeRect.top - containerRect.top + rect.top;
      const anchorNode = range.commonAncestorContainer;
      const element =
        anchorNode.nodeType === Node.ELEMENT_NODE
          ? (anchorNode as Element)
          : anchorNode.parentElement;

      return {
        anchorText: selectedText,
        selector: element && iframeDocument ? buildSelector(element, iframeDocument) : null,
        x,
        y,
      };
    } catch {
      return null;
    }
  }, [iframeRef]);

  const updateSelectionState = React.useCallback(() => {
    if (composerState) {
      return;
    }

    setSelectionState(readSelectionState());
  }, [composerState, readSelectionState]);

  const closeComposer = React.useCallback(() => {
    setComposerState(null);
    setCommentText('');
    setError(null);
    setSelectionState(null);
  }, []);

  const openComposer = React.useCallback(() => {
    const nextState = selectionState || readSelectionState();
    if (!nextState) {
      return;
    }

    setComposerState(nextState);
    setSelectionState(null);
    setCommentText('');
    setError(null);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [readSelectionState, selectionState]);

  const submitComment = React.useCallback(async () => {
    if (!composerState || !commentText.trim()) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: workspaceId,
          fileId: fileId || null,
          firstMessage: commentText.trim(),
          anchorText: composerState.anchorText,
          selectionAnchor: JSON.stringify({
            surfaceType: 'web-component',
            bindingType: 'selection',
            anchorPayload: {
              excerpt: composerState.anchorText,
              selector: composerState.selector,
            },
            previewSnapshotId: snapshotId || null,
            sourceMapping: {
              fileId: fileId || null,
              selector: composerState.selector,
            },
          }),
          snapshotId: snapshotId || null,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create thread.');
      }

      const thread = (await response.json()) as CommentThreadData;
      await onThreadsChanged();
      requestCommentThreadFocus(thread.id);

      if (readCommentReplyMode() === 'auto') {
        try {
          await sendCommentReply({
            anchorText: composerState.anchorText,
            documentContent,
            documentId: workspaceId,
            threadId: thread.id,
          });
          await onThreadsChanged();
          requestCommentThreadFocus(thread.id);
        } catch {
          // Comment creation succeeds even if auto reply fails.
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
    commentText,
    composerState,
    documentContent,
    fileId,
    onThreadsChanged,
    sendCommentReply,
    snapshotId,
    workspaceId,
  ]);

  React.useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) {
      return;
    }

    const bindSelection = () => {
      try {
        const iframeDocument = iframe.contentDocument;
        iframeDocument?.addEventListener('selectionchange', updateSelectionState);
      } catch {
        // Cross-origin or unavailable preview. No inline selection comments.
      }
    };

    const unbindSelection = () => {
      try {
        const iframeDocument = iframe.contentDocument;
        iframeDocument?.removeEventListener('selectionchange', updateSelectionState);
      } catch {
        // Ignore cleanup errors.
      }
    };

    iframe.addEventListener('load', bindSelection);
    bindSelection();

    return () => {
      iframe.removeEventListener('load', bindSelection);
      unbindSelection();
    };
  }, [iframeRef, updateSelectionState]);

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
    return <div ref={containerRef} className="pointer-events-none absolute inset-0" />;
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
          className="pointer-events-auto absolute w-[320px] rounded-2xl border border-border/70 bg-background/95 p-3 shadow-2xl"
          style={{
            left: clamp(anchor.x, 180, (containerRef.current?.clientWidth || 400) - 180),
            top: Math.max(16, anchor.y + 20),
            transform: 'translateX(-50%)',
          }}
        >
          <div className="mb-2 text-xs font-medium text-foreground">
            {composerState.anchorText}
          </div>
          <Textarea
            ref={textareaRef}
            value={commentText}
            onChange={(event) => setCommentText(event.target.value)}
            placeholder="让 AI 调整这里的页面表现……"
            className="min-h-[96px]"
          />
          {error ? <div className="mt-2 text-xs text-destructive">{error}</div> : null}
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={closeComposer}>
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void submitComment()}
              disabled={isSubmitting || !commentText.trim()}
            >
              {isSubmitting ? '提交中…' : '提交评论'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildSelector(element: Element, rootDocument: Document) {
  if (element.id) {
    return `#${element.id}`;
  }

  const segments: string[] = [];
  let current: Element | null = element;
  while (current && current !== rootDocument.body && segments.length < 4) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) {
      segments.unshift(tag);
      break;
    }

    const siblings = Array.from(parent.children).filter(
      (sibling) => sibling.tagName === current!.tagName
    );
    const index = siblings.indexOf(current) + 1;
    segments.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
    current = parent;
  }

  return segments.join(' > ') || null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
