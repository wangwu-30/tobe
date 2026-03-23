'use client';

import * as React from 'react';
import { Plate, usePlateEditor } from 'platejs/react';
import type { Value } from 'platejs';
import { Editor, EditorContainer } from '@/components/ui/editor';
import { BasicNodesKit } from '@/components/editor/plugins/basic-nodes-kit';
import { CommentKit } from '@/components/editor/plugins/comment-kit';
import { SuggestionKit } from '@/components/editor/plugins/suggestion-kit';
import { DiscussionKit } from '@/components/editor/plugins/discussion-kit';
import { CommentSidebar } from '@/components/comments/comment-sidebar';
import { SelectionCommentTrigger } from '@/components/comments/selection-comment-trigger';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertCircle, Lock, Pencil, Eye, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EditorSessionProvider } from '@/components/editor/editor-session-context';
import { useT } from '@/components/providers/language-provider';
import { commentPlugin } from '@/components/editor/plugins/comment-kit';
import { discussionPlugin } from '@/components/editor/plugins/discussion-kit';
import {
  COMMENT_THREAD_FOCUS_EVENT,
  COMMENT_THREADS_CHANGED_EVENT,
  requestSelectionCommentComposerOpen,
  type CommentThreadFocusDetail,
} from '@/lib/comments/constants';
import { threadsToDiscussions } from '@/lib/comments/discussion-sync';
import type { CommentThreadData } from '@/types';
import { apiFetch } from '@/framework/resilience';


const emptyValue: Value = [{ type: 'p', children: [{ text: '' }] }];

function serializeEditorValue(value: Value | null | undefined) {
  return JSON.stringify(value || emptyValue);
}

export function EditorWrapper({
  commentSidebarOpen = true,
  documentId,
  documentContent,
  fileId = null,
  headerActions,
  initialContent,
  onCommentSidebarOpenChange,
  onCloseCommentSidebar,
  readOnly: readOnlyOverride,
  sessionId,
  showCommentAction = true,
  showVersionControls = true,
  versionId = null,
  title,
  status,
  statusLabel,
  statusTone,
  draftRevision = null,
  onContentChange,
  onLockVersion,
  onUnlock,
  workspaceId,
  emptyDescription,
  emptyTitle,
  placeholder,
  primaryActionLabel,
}: {
  commentSidebarOpen?: boolean;
  documentId: string | null;
  documentContent: string;
  fileId?: string | null;
  headerActions?: React.ReactNode;
  initialContent: Value | null;
  onCommentSidebarOpenChange?: (open: boolean) => void;
  onCloseCommentSidebar?: () => void;
  readOnly?: boolean;
  sessionId: string;
  showCommentAction?: boolean;
  showVersionControls?: boolean;
  versionId?: string | null;
  draftRevision?: number | null;
  title: string;
  status: string;
  statusLabel?: string;
  statusTone?: 'blocked' | 'draft' | 'locked' | 'reviewing';
  onContentChange: (content: string) => void;
  onLockVersion: () => void;
  onUnlock: () => void;
  workspaceId?: string | null;
  emptyDescription?: string;
  emptyTitle?: string;
  placeholder?: string;
  primaryActionLabel?: string;
}) {
  const t = useT();
  const isLocked = status === 'locked';
  const isReadOnly = readOnlyOverride ?? isLocked;
  const [threads, setThreads] = React.useState<CommentThreadData[]>([]);
  const editorSurfaceRef = React.useRef<HTMLDivElement | null>(null);
  const lastLoadedContentRef = React.useRef(serializeEditorValue(initialContent));
  const editorPlaceholder = placeholder || t('workspace.documentPlaceholder');
  const resolvedEmptyTitle = emptyTitle || t('workspace.noDocumentYet');
  const resolvedEmptyDescription =
    emptyDescription || t('workspace.askAiGenerateDocument');
  const resolvedStatusTone =
    statusTone || (isLocked ? 'locked' : status === 'reviewing' ? 'reviewing' : 'draft');
  const resolvedStatusLabel =
    statusLabel ||
    (resolvedStatusTone === 'locked'
      ? t('common.locked')
      : resolvedStatusTone === 'reviewing'
        ? t('common.reviewing')
        : resolvedStatusTone === 'blocked'
          ? t('plan.blockedTitle')
          : t('common.draft'));
  const statusIcon =
    resolvedStatusTone === 'locked' ? (
      <Lock className="mr-1 h-3 w-3" />
    ) : resolvedStatusTone === 'reviewing' ? (
      <Eye className="mr-1 h-3 w-3" />
    ) : resolvedStatusTone === 'blocked' ? (
      <AlertCircle className="mr-1 h-3 w-3" />
    ) : (
      <Pencil className="mr-1 h-3 w-3" />
    );

  const editor = usePlateEditor(
    {
      plugins: [...BasicNodesKit, ...CommentKit, ...SuggestionKit, ...DiscussionKit],
      value: initialContent || emptyValue,
    },
    [initialContent]
  );

  React.useEffect(() => {
    lastLoadedContentRef.current = serializeEditorValue(initialContent);
  }, [initialContent]);

  const loadThreads = React.useCallback(async () => {
    if (!documentId) {
      setThreads([]);
      editor.setOption(discussionPlugin, 'discussions', []);
      return;
    }

    const searchParams = new URLSearchParams({ documentId });
    if (workspaceId) {
      searchParams.set('workspaceId', workspaceId);
    }
    if (fileId) {
      searchParams.set('fileId', fileId);
    }
    if (versionId) {
      searchParams.set('versionId', versionId);
    } else {
      searchParams.set('draftOnly', '1');
    }

    const res = await apiFetch(`/api/threads?${searchParams.toString()}`);
    if (!res.ok) return;

    const nextThreads = (await res.json()) as CommentThreadData[];
    setThreads(nextThreads);
    editor.setOption(discussionPlugin, 'discussions', threadsToDiscussions(nextThreads));
  }, [documentId, editor, fileId, versionId, workspaceId]);

  React.useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  React.useEffect(() => {
    const handleThreadsChanged = () => {
      void loadThreads();
    };

    window.addEventListener(COMMENT_THREADS_CHANGED_EVENT, handleThreadsChanged);
    return () => {
      window.removeEventListener(COMMENT_THREADS_CHANGED_EVENT, handleThreadsChanged);
    };
  }, [loadThreads]);

  React.useEffect(() => {
    const activeThreadId = editor.getOption(commentPlugin, 'activeId');
    if (!activeThreadId) {
      return;
    }

    const activeThread = threads.find((thread) => thread.id === activeThreadId) || null;
    if (activeThread?.status !== 'resolved') {
      return;
    }

    editor.setOption(commentPlugin, 'activeId', null);
    editor.setOption(commentPlugin, 'hoverId', null);
  }, [editor, threads]);

  React.useEffect(() => {
    let clearHighlightTimeoutId: number | null = null;

    const handleThreadFocus = (event: Event) => {
      const detail = (event as CustomEvent<CommentThreadFocusDetail>).detail;
      if (!detail?.threadId) {
        return;
      }

      editor.setOption(commentPlugin, 'activeId', detail.threadId);
      editor.setOption(commentPlugin, 'hoverId', null);

      const target = editorSurfaceRef.current?.querySelector<HTMLElement>(
        `[data-comment-thread-id="${detail.threadId}"]`
      );
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      if (clearHighlightTimeoutId) {
        window.clearTimeout(clearHighlightTimeoutId);
      }

      clearHighlightTimeoutId = window.setTimeout(() => {
        if (editor.getOption(commentPlugin, 'activeId') === detail.threadId) {
          editor.setOption(commentPlugin, 'activeId', null);
        }
      }, 2200);
    };

    window.addEventListener(COMMENT_THREAD_FOCUS_EVENT, handleThreadFocus);
    return () => {
      if (clearHighlightTimeoutId) {
        window.clearTimeout(clearHighlightTimeoutId);
      }
      window.removeEventListener(COMMENT_THREAD_FOCUS_EVENT, handleThreadFocus);
    };
  }, [editor]);

  return (
    <EditorSessionProvider
      value={{
        documentContent,
        documentId,
        workspaceId: workspaceId || documentId,
        fileId,
        wikiId: documentId,
        conversationId: sessionId,
        sessionId,
        versionId,
        draftRevision,
      }}
    >
      <div
        ref={editorSurfaceRef}
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
        data-workspace-outline-surface="true"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold truncate max-w-[300px]">
              {title || t('workspace.untitledDocument')}
            </h2>
            <Badge
              variant={resolvedStatusTone === 'locked' ? 'secondary' : 'default'}
              className="text-xs"
            >
              {statusIcon}
              {resolvedStatusLabel}
            </Badge>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {headerActions ? (
              headerActions
            ) : (
              <>
                {showCommentAction ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => requestSelectionCommentComposerOpen()}
                    className="text-xs h-7"
                    disabled={!documentId}
                  >
                    <MessageSquarePlus className="mr-1 h-3.5 w-3.5" />
                    {t('common.comment')}
                  </Button>
                ) : null}
                {showVersionControls
                  ? isLocked
                    ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={onUnlock}
                        className="text-xs h-7"
                      >
                        {t('version.unlockForEditing')}
                      </Button>
                    )
                    : (
                      <Button
                        size="sm"
                        onClick={onLockVersion}
                        className="text-xs h-7"
                        disabled={!documentId}
                      >
                        {primaryActionLabel || t('version.lockVersion')}
                      </Button>
                    )
                  : null}
              </>
            )}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <ScrollArea className="min-h-0 min-w-0 flex-1">
            {documentId ? (
              <Plate
                editor={editor}
                onChange={({ value }) => {
                  if (isReadOnly) {
                    return;
                  }

                  const serialized = serializeEditorValue(value);
                  if (serialized !== lastLoadedContentRef.current) {
                    onContentChange(serialized);
                  }
                }}
              >
                <EditorContainer>
                <Editor
                  readOnly={isReadOnly}
                  placeholder={editorPlaceholder}
                />
                </EditorContainer>
                <SelectionCommentTrigger
                  onThreadsChanged={loadThreads}
                  threads={threads}
                />
              </Plate>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-32 text-muted-foreground">
                <Pencil className="h-10 w-10 mb-3 opacity-20" />
                <p className="text-sm">{resolvedEmptyTitle}</p>
                <p className="text-xs mt-1 opacity-70">
                  {resolvedEmptyDescription}
                </p>
              </div>
            )}
          </ScrollArea>

          {documentId && commentSidebarOpen && (
            <CommentSidebar
              documentId={documentId}
              documentContent={documentContent}
              onClose={onCloseCommentSidebar}
              onOpenChange={onCommentSidebarOpenChange}
              threads={threads}
              refreshThreads={loadThreads}
            />
          )}
        </div>
      </div>
    </EditorSessionProvider>
  );
}
