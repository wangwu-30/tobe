'use client';

import { useState, useCallback, useRef } from 'react';
import { describeAIError } from '@/lib/ai/error-utils';
import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import { useAppLanguage } from '@/components/providers/language-provider';

export function useAiReply() {
  const language = useAppLanguage();
  const [isReplying, setIsReplying] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const sendCommentReply = useCallback(
    async (params: {
      threadId: string;
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

        const response = await fetch('/api/ai/comment-reply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getStoredAISettingsHeader(),
          },
          body: JSON.stringify({
            threadId: params.threadId,
            documentContent: params.documentContent,
            anchorText: params.anchorText,
            documentId: params.documentId,
            model: params.model,
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || payload?.details || 'AI reply failed');
        }

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
      } catch (err: unknown) {
        if (!(err instanceof Error) || err.name !== 'AbortError') {
          throw new Error(
            describeAIError({
              language,
              modelKey: params.model,
              rawMessage: err instanceof Error ? err.message : 'AI reply failed',
            }).message
          );
        }
      } finally {
        setIsReplying(false);
        setStreamingContent('');
        abortRef.current = null;
      }
    },
    [language]
  );

  const requestSuggestion = useCallback(
    async (params: {
      documentContent: string;
      anchorText: string;
      threadDiscussion: string;
      model?: string;
    }) => {
      try {
        const response = await fetch('/api/ai/suggest-edit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getStoredAISettingsHeader(),
          },
          body: JSON.stringify(params),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || payload?.details || 'Suggest edit failed');
        }
        const data = await response.json();
        return data.suggestion as string;
      } catch (error) {
        throw new Error(
          describeAIError({
            language,
            modelKey: params.model,
            rawMessage: error instanceof Error ? error.message : 'Suggest edit failed',
          }).message
        );
      }
    },
    [language]
  );

  const extractMemories = useCallback(async (threadId: string) => {
    try {
      const response = await fetch('/api/ai/extract-memory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getStoredAISettingsHeader(),
        },
        body: JSON.stringify({ threadId }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || payload?.details || 'Memory extraction failed');
      }
      const data = await response.json();
      return data.memories;
    } catch (error) {
      throw new Error(
        describeAIError({
          language,
          rawMessage: error instanceof Error ? error.message : 'Memory extraction failed',
        }).message
      );
    }
  }, [language]);

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
