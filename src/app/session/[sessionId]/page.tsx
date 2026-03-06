'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { SplitView } from '@/components/layout/split-view';
import { ChatPanel } from '@/components/chat/chat-panel';
import { EditorWrapper } from '@/components/editor/editor-wrapper';
import { KnowledgePanel } from '@/components/knowledge/knowledge-panel';
import { Button } from '@/components/ui/button';
import { BookOpen } from 'lucide-react';
import { markdownToPlate } from '@/lib/ai/serializer';
import { useDocument } from '@/hooks/use-document';
import type { Value } from 'platejs';
import type { ChatMessageData } from '@/types';

export default function SessionPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;
  const [knowledgePanelOpen, setKnowledgePanelOpen] = React.useState(false);
  const [editorContent, setEditorContent] = React.useState<Value | null>(null);
  const [initialMessages, setInitialMessages] = React.useState<ChatMessageData[]>([]);

  const {
    document: currentDoc,
    setDocument,
    isSaving,
    saveContent,
    lockVersion,
    unlockForEditing,
  } = useDocument();

  // Load session data on mount
  React.useEffect(() => {
    const loadSession = async () => {
      try {
        const res = await fetch(`/api/sessions?id=${sessionId}`);
        // We don't have a single-session endpoint yet, load from list
      } catch {
        // Session will be created on first message
      }
    };
    loadSession();
  }, [sessionId]);

  const handleDocumentGenerated = React.useCallback(
    async (markdown: string) => {
      // Parse markdown to Plate format
      const plateValue = markdownToPlate(markdown);
      setEditorContent(plateValue);

      // Extract title from first heading
      const firstHeading = markdown.match(/^#\s+(.+)$/m);
      const title = firstHeading ? firstHeading[1] : 'Generated Document';

      // Create document in DB
      try {
        const res = await fetch('/api/documents/new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            title,
            content: JSON.stringify(plateValue),
          }),
        });
        if (res.ok) {
          const doc = await res.json();
          setDocument(doc);
        }
      } catch (err) {
        console.error('Failed to create document:', err);
      }
    },
    [sessionId, setDocument]
  );

  const handleContentChange = React.useCallback(
    (content: string) => {
      if (currentDoc) {
        saveContent(currentDoc.id, content);
      }
    },
    [currentDoc, saveContent]
  );

  const handleLockVersion = React.useCallback(async () => {
    if (currentDoc) {
      await lockVersion(currentDoc.id);
    }
  }, [currentDoc, lockVersion]);

  const handleUnlock = React.useCallback(async () => {
    if (currentDoc) {
      await unlockForEditing(currentDoc.id);
    }
  }, [currentDoc, unlockForEditing]);

  return (
    <div className="h-screen w-full relative">
      <SplitView
        left={
          <ChatPanel
            sessionId={sessionId}
            onDocumentGenerated={handleDocumentGenerated}
            initialMessages={initialMessages}
          />
        }
        right={
          <EditorWrapper
            documentId={currentDoc?.id || null}
            initialContent={editorContent}
            title={currentDoc?.title || ''}
            status={currentDoc?.status || 'draft'}
            onContentChange={handleContentChange}
            onLockVersion={handleLockVersion}
            onUnlock={handleUnlock}
            sessionId={sessionId}
          />
        }
      />

      {/* Knowledge panel toggle */}
      <Button
        size="icon"
        variant="outline"
        className="fixed bottom-4 right-4 z-40 rounded-full h-10 w-10 shadow-md"
        onClick={() => setKnowledgePanelOpen(!knowledgePanelOpen)}
      >
        <BookOpen className="h-4 w-4" />
      </Button>

      <KnowledgePanel
        isOpen={knowledgePanelOpen}
        onClose={() => setKnowledgePanelOpen(false)}
      />
    </div>
  );
}
