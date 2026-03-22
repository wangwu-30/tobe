'use client';

import * as React from 'react';
import { getCommentKey, getDraftCommentKey } from '@platejs/comment';
import { getSelectionBoundingClientRect } from '@platejs/floating';
import { MessageSquarePlus, Search } from 'lucide-react';
import {
  useEditorPlugin,
  useEditorRef,
} from 'platejs/react';

import { commentPlugin } from '@/components/editor/plugins/comment-kit';
import { useEditorSession } from '@/components/editor/editor-session-context';
import { CommentAgentTextarea } from '@/components/comments/comment-agent-textarea';
import { Button } from '@/components/ui/button';
import { useAiReply } from '@/hooks/use-ai-reply';
import { useCommentAgents } from '@/hooks/use-comment-agents';
import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import { resolveSingleResearchTarget } from '@/lib/comments/agents';
import {
  createStructuredDocumentSelectionRange,
  isSingleBlockDocumentSelectionRange,
  type DocumentSelectionRangeData,
} from '@/lib/comments/document-selection';
import {
  OPEN_SELECTION_COMMENT_COMPOSER_EVENT,
  requestCommentThreadFocus,
} from '@/lib/comments/constants';
import { useT } from '@/components/providers/language-provider';
import { cn } from '@/lib/utils';
import type { CommentThreadData } from '@/types';
import { apiFetch } from '@/framework/resilience';


type TriggerPosition = {
  left: number;
  placement: 'above' | 'below';
  top: number;
};

type ComposerState = {
  anchorText: string;
  position: TriggerPosition;
  selectionRange: DocumentSelectionRangeData | null;
};

export function SelectionCommentTrigger({
  onThreadsChanged,
  threads,
}: {
  onThreadsChanged: () => Promise<void>;
  threads: CommentThreadData[];
}) {
  const editor = useEditorRef();
  const t = useT();
  const editorSession = useEditorSession();
  const { setOption } = useEditorPlugin(commentPlugin);
  const { isReplying, sendCommentReply } = useAiReply();
  const commentAgents = useCommentAgents();
  const [isMounted, setIsMounted] = React.useState(false);
  const [selectionState, setSelectionState] = React.useState<ComposerState | null>(null);
  const [composerState, setComposerState] = React.useState<ComposerState | null>(null);
  const [commentText, setCommentText] = React.useState('');
  const [researchMode, setResearchMode] = React.useState<'light' | 'deep'>('light');
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const composerRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const readSelectionState = React.useCallback((): ComposerState | null => {
    const domSelection = window.getSelection?.();

    if (
      !isMounted ||
      composerState ||
      !editor.selection ||
      !editor.api.isExpanded() ||
      !domSelection ||
      domSelection.rangeCount === 0 ||
      domSelection.isCollapsed
    ) {
      return null;
    }

    const selectedText = domSelection.toString().trim();
    if (!selectedText) {
      return null;
    }

    try {
      const structuredRange = createStructuredDocumentSelectionRange({
        anchor: {
          offset: editor.selection.anchor.offset,
          path: [...editor.selection.anchor.path],
        },
        focus: {
          offset: editor.selection.focus.offset,
          path: [...editor.selection.focus.path],
        },
      });
      const rect =
        domSelection.getRangeAt(0).getBoundingClientRect() || getSelectionBoundingClientRect(editor);
      if (!rect || rect.width === 0 || rect.height === 0) {
        return null;
      }

      const left = clamp(rect.left + rect.width / 2, 184, window.innerWidth - 184);
      const placement = rect.top < 140 ? 'below' : 'above';
      const top = placement === 'above' ? rect.top - 14 : rect.bottom + 14;

      return {
        anchorText: selectedText,
        position: { left, placement, top },
        selectionRange:
          structuredRange && isSingleBlockDocumentSelectionRange(structuredRange)
            ? structuredRange
            : null,
      };
    } catch {
      return null;
    }
  }, [composerState, editor, isMounted]);

  const clearDraftSelection = React.useCallback(() => {
    editor.tf.unsetNodes(getDraftCommentKey(), {
      at: [],
      match: node => Boolean(node[getDraftCommentKey()]),
      mode: 'lowest',
    });
    setOption('activeId', null);
    setOption('commentingBlock', null);
  }, [editor, setOption]);

  const closeComposer = React.useCallback(
    (clearDraft = true) => {
      if (clearDraft) {
        clearDraftSelection();
      }
      setComposerState(null);
      setCommentText('');
      setResearchMode('light');
      setError(null);
      setSelectionState(null);
    },
    [clearDraftSelection]
  );

  const updateSelectionState = React.useCallback(() => {
    setSelectionState(readSelectionState());
  }, [readSelectionState]);

  const findExistingThreadForSelection = React.useCallback(() => {
    if (!editor.selection) return null;

    const threadIds = new Set(threads.map(thread => thread.id));
    const commentNodes = [
      ...editor.getApi(commentPlugin).comment.nodes({ at: editor.selection }),
    ];

    for (const [node] of commentNodes) {
      const threadId = editor.getApi(commentPlugin).comment.nodeId(node);
      if (threadId && threadIds.has(threadId)) {
        return threadId;
      }
    }

    return null;
  }, [editor, threads]);

  const openComposer = React.useCallback(() => {
    const nextSelectionState = selectionState || readSelectionState();
    if (!nextSelectionState) {
      return;
    }

    const existingThreadId = findExistingThreadForSelection();
    if (existingThreadId) {
      setOption('activeId', existingThreadId);
      editor.tf.collapse();
      requestCommentThreadFocus(existingThreadId);
      return;
    }

    try {
      editor.getTransforms(commentPlugin).comment.setDraft();
      const hasDraft = editor.getApi(commentPlugin).comment.node({ at: [], isDraft: true });

      if (!hasDraft) {
        clearDraftSelection();
        return;
      }

      setComposerState(nextSelectionState);
      setSelectionState(null);
      setCommentText('');
      setError(null);
    } catch {
      clearDraftSelection();
    }
  }, [
    clearDraftSelection,
    editor,
    findExistingThreadForSelection,
    readSelectionState,
    selectionState,
    setOption,
  ]);

  const submitComment = React.useCallback(async () => {
    const content = commentText.trim();
    if (!content || !composerState || !editorSession?.wikiId) {
      return;
    }

    const draftEntries = [
      ...editor.getApi(commentPlugin).comment.nodes({ at: [], isDraft: true }),
    ];
    if (draftEntries.length === 0) {
      setError(t('comments.selectionExpired'));
      closeComposer(true);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const anchorText =
        composerState.anchorText ||
        draftEntries.map(([node]) => node.text).join('').trim();

      const response = await apiFetch('/api/threads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getStoredAISettingsHeader(),
        },
        body: JSON.stringify({
          documentId: editorSession.workspaceId || editorSession.wikiId,
          draftRevision: editorSession.versionId ? null : editorSession.draftRevision,
          fileId: editorSession.fileId,
          wikiId: editorSession.wikiId,
          anchorText,
          firstMessage: content,
          selectionAnchor: JSON.stringify({
            surfaceType: 'document-selection',
            bindingType: 'selection',
            anchorPayload: {
              excerpt: anchorText,
              rangeState: composerState.selectionRange ? 'single-block' : 'cross-block',
              ...(composerState.selectionRange
                ? {
                    start: composerState.selectionRange.start,
                    end: composerState.selectionRange.end,
                  }
                : {}),
            },
            previewVersionId: editorSession.versionId || null,
            sourceMapping: {
              fileId: editorSession.fileId || null,
            },
          }),
          versionId: editorSession.versionId,
        }),
      });

      if (!response.ok) {
        throw new Error(t('comments.createFailed'));
      }

      const thread = (await response.json()) as CommentThreadData;

      draftEntries.forEach(([, path]) => {
        editor.tf.setNodes(
          { [getCommentKey(thread.id)]: true },
          { at: path, split: true }
        );
        editor.tf.unsetNodes([getDraftCommentKey()], { at: path });
      });

      setOption('activeId', thread.id);
      setOption('commentingBlock', null);
      setComposerState(null);
      setCommentText('');
      setResearchMode('light');

      await onThreadsChanged();
      requestCommentThreadFocus(thread.id);

      if (researchMode === 'deep') {
        const researchTarget = resolveSingleResearchTarget({
          agents: commentAgents,
          content,
        });

        if (researchTarget.error === 'multiple') {
          throw new Error(t('comments.researchNeedsSingleAgent'));
        }

        if (!researchTarget.target) {
          throw new Error(t('comments.researchNeedsSingleAgent'));
        }

        const researchResponse = await apiFetch(`/api/threads/${thread.id}/research-plan`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getStoredAISettingsHeader(),
          },
          body: JSON.stringify({
            agentId: researchTarget.target.agentId,
            anchorText,
            content,
            documentContent: editorSession.documentContent,
            persistMessage: false,
          }),
        });

        if (!researchResponse.ok) {
          const payload = await researchResponse.json().catch(() => null);
          throw new Error(payload?.error || t('comments.researchPlanFailed'));
        }

        await onThreadsChanged();
        requestCommentThreadFocus(thread.id);
        return;
      }

      if (thread.agentBindings.length > 0) {
        try {
          for (const binding of thread.agentBindings) {
            await sendCommentReply({
              agentId: binding.agentId,
              anchorText,
              documentContent: editorSession.documentContent,
              documentId: editorSession.wikiId,
              threadId: thread.id,
            });
          }
          await onThreadsChanged();
          requestCommentThreadFocus(thread.id);
        } catch {
          // Comment creation succeeds even if agent replies fail.
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('comments.createFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    closeComposer,
    commentText,
    composerState,
    editor,
    editorSession,
    commentAgents,
    onThreadsChanged,
    researchMode,
    sendCommentReply,
    setOption,
    t,
  ]);

  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  React.useEffect(() => {
    if (!isMounted) {
      return;
    }

    const scheduleUpdate = () => {
      window.requestAnimationFrame(() => {
        updateSelectionState();
      });
    };

    scheduleUpdate();
    document.addEventListener('selectionchange', scheduleUpdate);
    window.addEventListener('pointerup', scheduleUpdate);
    window.addEventListener('keyup', scheduleUpdate);
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      document.removeEventListener('selectionchange', scheduleUpdate);
      window.removeEventListener('pointerup', scheduleUpdate);
      window.removeEventListener('keyup', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [isMounted, updateSelectionState]);

  React.useEffect(() => {
    updateSelectionState();
  }, [threads, updateSelectionState]);

  React.useEffect(() => {
    const handleOpenComposer = () => {
      openComposer();
    };

    window.addEventListener(
      OPEN_SELECTION_COMMENT_COMPOSER_EVENT,
      handleOpenComposer
    );

    return () => {
      window.removeEventListener(
        OPEN_SELECTION_COMMENT_COMPOSER_EVENT,
        handleOpenComposer
      );
    };
  }, [openComposer]);

  React.useEffect(() => {
    if (!composerState) {
      return;
    }

    textareaRef.current?.focus();
  }, [composerState]);

  React.useEffect(() => {
    if (!composerState) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (composerRef.current?.contains(event.target as Node)) {
        return;
      }

      if (!commentText.trim()) {
        closeComposer(true);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !commentText.trim()) {
        event.preventDefault();
        closeComposer(true);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeComposer, commentText, composerState]);

  if (!isMounted || (!selectionState && !composerState)) {
    return null;
  }

  const position = composerState?.position ?? selectionState?.position;
  if (!position) return null;

  return (
    <div
      className="pointer-events-none fixed z-40"
      style={{
        left: position.left,
        top: position.top,
        transform:
          position.placement === 'above'
            ? 'translate(-50%, -100%)'
            : 'translate(-50%, 0)',
      }}
    >
      {composerState ? (
        <div
          ref={composerRef}
          data-testid="selection-comment-composer"
          className="pointer-events-auto w-[340px] rounded-2xl border border-border/70 bg-background/95 p-3 shadow-2xl backdrop-blur supports-[backdrop-filter]:bg-background/90"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold">{t('comments.commentToAi')}</p>
              <p className="text-[11px] text-muted-foreground">
                {t('comments.composerDescription')}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={isSubmitting || isReplying}
              onClick={() => closeComposer(true)}
            >
              {t('common.cancel')}
            </Button>
          </div>

          <div className="mb-3 rounded-xl border border-border/60 bg-muted/60 px-3 py-2">
            <p className="line-clamp-4 text-xs italic text-muted-foreground">
              &ldquo;{composerState.anchorText}&rdquo;
            </p>
          </div>

          <CommentAgentTextarea
            agents={commentAgents}
            ref={textareaRef}
            value={commentText}
            onChange={setCommentText}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submitComment();
              }
            }}
            className="min-h-[92px] resize-none text-sm"
            placeholder={t('comments.commentPlaceholder')}
            rows={4}
          />

          {error && (
            <p className="mt-2 text-[11px] text-destructive">{error}</p>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              {researchMode === 'deep'
                ? t('comments.deepResearchHint')
                : t('comments.agentMentionHint')}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={researchMode === 'deep' ? 'secondary' : 'outline'}
                className="h-8 rounded-full px-2 text-[11px]"
                disabled={isSubmitting || isReplying}
                onClick={() =>
                  setResearchMode((current) => (current === 'deep' ? 'light' : 'deep'))
                }
              >
                <Search className="mr-1 h-3.5 w-3.5" />
                {researchMode === 'deep'
                  ? t('comments.deepResearchEnabled')
                  : t('comments.deepResearch')}
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={!commentText.trim() || isSubmitting || isReplying}
                onClick={() => void submitComment()}
              >
                {researchMode === 'deep' ? (
                  <Search className="h-4 w-4" />
                ) : (
                  <MessageSquarePlus className="h-4 w-4" />
                )}
                {isSubmitting
                  ? researchMode === 'deep'
                    ? t('comments.researchPlanning')
                    : t('comments.creatingComment')
                  : researchMode === 'deep'
                    ? t('comments.createResearchPlan')
                    : t('common.comment')}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Button
          data-testid="selection-comment-trigger"
          size="sm"
          variant="outline"
          className={cn(
            'pointer-events-auto h-10 rounded-full border-border/70 bg-background/95 px-3 shadow-lg backdrop-blur',
            'supports-[backdrop-filter]:bg-background/85'
          )}
          onMouseDown={event => event.preventDefault()}
          onClick={openComposer}
        >
          <MessageSquarePlus className="h-4 w-4" />
          {t('common.comment')}
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Cmd+Shift+M
          </span>
        </Button>
      )}
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
