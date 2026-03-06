'use client';

import { useState, useCallback, useRef } from 'react';

export function useAiReply() {
  const [isReplying, setIsReplying] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const sendCommentReply = useCallback(
    async (params: {
      threadId: string;
      message: string;
      documentContent: string;
      anchorText: string;
      documentId?: string;
      model?: string;
      onComplete?: (fullText: string) => void;
    }) => {
      setIsReplying(true);
      setStreamingContent('');

      try {
        abortRef.current = new AbortController();
        const settings = localStorage.getItem('ai-settings');

        const response = await fetch('/api/ai/comment-reply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(settings ? { 'x-ai-settings': settings } : {}),
          },
          body: JSON.stringify({
            threadId: params.threadId,
            message: params.message,
            documentContent: params.documentContent,
            anchorText: params.anchorText,
            documentId: params.documentId,
            model: params.model,
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) throw new Error('AI reply failed');

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let fullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          fullText += chunk;
          setStreamingContent(fullText);
        }

        params.onComplete?.(fullText);
        return fullText;
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          throw err;
        }
      } finally {
        setIsReplying(false);
        setStreamingContent('');
        abortRef.current = null;
      }
    },
    []
  );

  const requestSuggestion = useCallback(
    async (params: {
      documentContent: string;
      anchorText: string;
      threadDiscussion: string;
      model?: string;
    }) => {
      const settings = localStorage.getItem('ai-settings');
      const response = await fetch('/api/ai/suggest-edit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(settings ? { 'x-ai-settings': settings } : {}),
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) throw new Error('Suggest edit failed');
      const data = await response.json();
      return data.suggestion as string;
    },
    []
  );

  const extractMemories = useCallback(async (threadId: string) => {
    const settings = localStorage.getItem('ai-settings');
    const response = await fetch('/api/ai/extract-memory', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings ? { 'x-ai-settings': settings } : {}),
      },
      body: JSON.stringify({ threadId }),
    });

    if (!response.ok) throw new Error('Memory extraction failed');
    const data = await response.json();
    return data.memories;
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    isReplying,
    streamingContent,
    sendCommentReply,
    requestSuggestion,
    extractMemories,
    stop,
  };
}
