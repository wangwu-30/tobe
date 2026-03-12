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
import { VersionBar } from '@/components/versions/version-bar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Lock, Pencil, Eye, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EditorSessionProvider } from '@/components/editor/editor-session-context';
import { useT } from '@/components/providers/language-provider';
import { discussionPlugin } from '@/components/editor/plugins/discussion-kit';
import {
  COMMENT_THREADS_CHANGED_EVENT,
  requestSelectionCommentComposerOpen,
} from '@/lib/comments/constants';
import { threadsToDiscussions } from '@/lib/comments/discussion-sync';
import type { CommentThreadData } from '@/types';

const emptyValue: Value = [{ type: 'p', children: [{ text: '' }] }];

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
  showBottomVersionBar = false,
  showCommentAction = true,
  showVersionControls = true,
  snapshotId = null,
  title,
  status,
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
  showBottomVersionBar?: boolean;
  showCommentAction?: boolean;
  showVersionControls?: boolean;
  snapshotId?: string | null;
  title: string;
  status: string;
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
  const editorPlaceholder = placeholder || t('workspace.documentPlaceholder');
  const resolvedEmptyTitle = emptyTitle || t('workspace.noDocumentYet');
  const resolvedEmptyDescription =
    emptyDescription || t('workspace.askAiGenerateDocument');

  const editor = usePlateEditor(
    {
      plugins: [...BasicNodesKit, ...CommentKit, ...SuggestionKit, ...DiscussionKit],
      value: initialContent || emptyValue,
    },
    [initialContent]
  );

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
    if (snapshotId) {
      searchParams.set('snapshotId', snapshotId);
    }

    const res = await fetch(`/api/threads?${searchParams.toString()}`);
    if (!res.ok) return;

    const nextThreads = (await res.json()) as CommentThreadData[];
    setThreads(nextThreads);
    editor.setOption(discussionPlugin, 'discussions', threadsToDiscussions(nextThreads));
  }, [documentId, editor, fileId, snapshotId, workspaceId]);

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
        snapshotId,
        versionId: snapshotId,
      }}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold truncate max-w-[300px]">
              {title || t('workspace.untitledDocument')}
            </h2>
            <Badge variant={isLocked ? 'secondary' : 'default'} className="text-xs">
              {isLocked ? (
                <>
                  <Lock className="h-3 w-3 mr-1" /> {t('common.locked')}
                </>
              ) : status === 'reviewing' ? (
                <>
                  <Eye className="h-3 w-3 mr-1" /> {t('common.reviewing')}
                </>
              ) : (
                <>
                  <Pencil className="h-3 w-3 mr-1" /> {t('common.draft')}
                </>
              )}
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
                  if (!isReadOnly) {
                    onContentChange(JSON.stringify(value));
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

        {documentId && showBottomVersionBar && <VersionBar documentId={documentId} />}
      </div>
    </EditorSessionProvider>
  );
}
