'use client';

import { useState, useCallback, useRef } from 'react';
import { describeAIError } from '@/lib/ai/error-utils';
import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import { useAppLanguage } from '@/components/providers/language-provider';
import { stripAIStreamControlTokens } from '@/lib/ai/stream-protocol';

export function useAiReply() {
  const language = useAppLanguage();
  const [isReplying, setIsReplying] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const sendCommentReply = useCallback(
    async (params: {
      agentId?: string;
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

        const response = await fetch('/api/agent/run', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getStoredAISettingsHeader(),
          },
          body: JSON.stringify({
            mode: 'comment-reply',
            input: {
              anchorText: params.anchorText,
              documentContent: params.documentContent,
            },
            model: params.model,
            target: {
              agentId: params.agentId,
              threadId: params.threadId,
              workspaceId: params.documentId,
            },
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
          fullText += stripAIStreamControlTokens(chunk);
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
        const response = await fetch('/api/agent/run', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getStoredAISettingsHeader(),
          },
          body: JSON.stringify({
            mode: 'suggest-edit',
            input: {
              anchorText: params.anchorText,
              documentContent: params.documentContent,
              threadDiscussion: params.threadDiscussion,
            },
            model: params.model,
            target: {},
          }),
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
      const response = await fetch('/api/agent/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getStoredAISettingsHeader(),
        },
        body: JSON.stringify({
          mode: 'extract-memory',
          target: { threadId },
        }),
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
