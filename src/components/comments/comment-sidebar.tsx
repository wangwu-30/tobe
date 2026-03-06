'use client';

import * as React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useAiReply } from '@/hooks/use-ai-reply';
import {
  MessageSquare,
  Send,
  Bot,
  CheckCircle,
  Loader2,
  Wand2,
} from 'lucide-react';
import type { CommentThreadData, CommentMessageData } from '@/types';

export function CommentSidebar({
  documentId,
  sessionId,
}: {
  documentId: string;
  sessionId: string;
}) {
  const [threads, setThreads] = React.useState<CommentThreadData[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);

  const loadThreads = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/threads?documentId=${documentId}`);
      if (res.ok) {
        setThreads(await res.json());
      }
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  React.useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  const handleResolve = async (threadId: string) => {
    // Update thread status
    const res = await fetch(`/api/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'system', content: 'Thread resolved' }),
    });

    // Extract memories from resolved thread
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
      // Memory extraction is best-effort
    }

    setThreads(prev =>
      prev.map(t => (t.id === threadId ? { ...t, status: 'resolved' } : t))
    );
  };

  const openThreads = threads.filter(t => t.status === 'open');
  const resolvedThreads = threads.filter(t => t.status === 'resolved');

  return (
    <div className="w-[280px] border-l border-border flex flex-col bg-muted/30">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <h3 className="text-xs font-semibold flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" />
          Comments
          {openThreads.length > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {openThreads.length}
            </Badge>
          )}
        </h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isLoading && threads.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-xs">
              <MessageSquare className="h-6 w-6 mx-auto mb-2 opacity-30" />
              <p>No comments yet</p>
              <p className="mt-1 opacity-70">Select text and press Cmd+Shift+M</p>
            </div>
          )}

          {openThreads.map(thread => (
            <CommentThreadCard
              key={thread.id}
              thread={thread}
              documentId={documentId}
              onResolve={() => handleResolve(thread.id)}
              onUpdate={loadThreads}
            />
          ))}

          {resolvedThreads.length > 0 && (
            <>
              <div className="text-xs text-muted-foreground px-1 pt-2">
                Resolved ({resolvedThreads.length})
              </div>
              {resolvedThreads.map(thread => (
                <CommentThreadCard
                  key={thread.id}
                  thread={thread}
                  documentId={documentId}
                  resolved
                  onUpdate={loadThreads}
                />
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function CommentThreadCard({
  thread,
  documentId,
  resolved,
  onResolve,
  onUpdate,
}: {
  thread: CommentThreadData;
  documentId: string;
  resolved?: boolean;
  onResolve?: () => void;
  onUpdate: () => void;
}) {
  const [replyText, setReplyText] = React.useState('');
  const { isReplying, streamingContent, sendCommentReply } = useAiReply();

  const handleSendReply = async () => {
    if (!replyText.trim()) return;
    const message = replyText.trim();
    setReplyText('');

    // Save user message
    await fetch(`/api/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: message }),
    });

    // Get AI reply
    await sendCommentReply({
      threadId: thread.id,
      message,
      documentContent: '', // TODO: get from editor
      anchorText: thread.anchorText,
      documentId,
      onComplete: () => onUpdate(),
    });

    onUpdate();
  };

  const handleRequestSuggestion = async () => {
    // TODO: implement suggestion generation
  };

  return (
    <div className={`rounded-lg border bg-background p-2.5 text-xs ${resolved ? 'opacity-60' : ''}`}>
      {/* Anchor text */}
      <div className="mb-2 flex items-start gap-1.5">
        <div className="mt-0.5 w-1 h-full min-h-[16px] bg-yellow-400 rounded-full shrink-0" />
        <p className="text-muted-foreground line-clamp-2 italic">
          &quot;{thread.anchorText}&quot;
        </p>
      </div>

      {/* Messages */}
      <div className="space-y-1.5 mb-2">
        {thread.messages.map((msg: CommentMessageData) => (
          <div
            key={msg.id}
            className={`flex gap-1.5 ${msg.role === 'assistant' ? 'bg-muted/50 rounded px-1.5 py-1' : ''}`}
          >
            {msg.role === 'assistant' && (
              <Bot className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
            )}
            <p className="leading-relaxed">{msg.content}</p>
          </div>
        ))}

        {/* Streaming AI reply */}
        {isReplying && streamingContent && (
          <div className="flex gap-1.5 bg-muted/50 rounded px-1.5 py-1">
            <Bot className="h-3 w-3 mt-0.5 shrink-0 text-primary animate-pulse" />
            <p className="leading-relaxed">{streamingContent}</p>
          </div>
        )}
      </div>

      {/* Reply input */}
      {!resolved && (
        <div className="space-y-1.5">
          <Textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Reply or ask AI..."
            className="min-h-[28px] text-xs resize-none rounded-md"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendReply();
              }
            }}
          />
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px] px-2"
                onClick={handleRequestSuggestion}
                disabled={isReplying}
              >
                <Wand2 className="h-3 w-3 mr-1" />
                Suggest Edit
              </Button>
            </div>
            <div className="flex gap-1">
              {onResolve && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] px-2"
                  onClick={onResolve}
                >
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Resolve
                </Button>
              )}
              <Button
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={handleSendReply}
                disabled={!replyText.trim() || isReplying}
              >
                <Send className="h-3 w-3 mr-1" />
                Send
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
