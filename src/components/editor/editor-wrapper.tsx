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
import { VersionBar } from '@/components/versions/version-bar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Lock, Pencil, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const emptyValue: Value = [{ type: 'p', children: [{ text: '' }] }] as any;

export function EditorWrapper({
  documentId,
  initialContent,
  title,
  status,
  onContentChange,
  onLockVersion,
  onUnlock,
  sessionId,
}: {
  documentId: string | null;
  initialContent: Value | null;
  title: string;
  status: string;
  onContentChange: (content: string) => void;
  onLockVersion: () => void;
  onUnlock: () => void;
  sessionId: string;
}) {
  const isLocked = status === 'locked';
  const isReadOnly = isLocked;

  const editor = usePlateEditor(
    {
      plugins: [...BasicNodesKit, ...CommentKit, ...SuggestionKit, ...DiscussionKit],
      value: initialContent || emptyValue,
    },
    [initialContent]
  );

  return (
    <div className="flex h-full flex-col">
      {/* Document header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold truncate max-w-[300px]">
            {title || 'Untitled Document'}
          </h2>
          <Badge variant={isLocked ? 'secondary' : 'default'} className="text-xs">
            {isLocked ? (
              <><Lock className="h-3 w-3 mr-1" /> Locked</>
            ) : status === 'reviewing' ? (
              <><Eye className="h-3 w-3 mr-1" /> Reviewing</>
            ) : (
              <><Pencil className="h-3 w-3 mr-1" /> Draft</>
            )}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {isLocked ? (
            <Button size="sm" variant="outline" onClick={onUnlock} className="text-xs h-7">
              Unlock for editing
            </Button>
          ) : (
            <Button size="sm" onClick={onLockVersion} className="text-xs h-7" disabled={!documentId}>
              Lock Version
            </Button>
          )}
        </div>
      </div>

      {/* Editor area with sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main editor */}
        <ScrollArea className="flex-1">
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
                  placeholder="Document content will appear here..."
                />
              </EditorContainer>
            </Plate>
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-32 text-muted-foreground">
              <Pencil className="h-10 w-10 mb-3 opacity-20" />
              <p className="text-sm">No document yet</p>
              <p className="text-xs mt-1 opacity-70">
                Ask the AI to generate a document in the chat panel
              </p>
            </div>
          )}
        </ScrollArea>

        {/* Comment sidebar */}
        {documentId && (
          <CommentSidebar
            documentId={documentId}
            sessionId={sessionId}
          />
        )}
      </div>

      {/* Version bar */}
      {documentId && (
        <VersionBar documentId={documentId} />
      )}
    </div>
  );
}
