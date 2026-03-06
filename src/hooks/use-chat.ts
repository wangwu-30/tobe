'use client';

import { useState, useCallback, useRef } from 'react';
import type { ChatMessageData } from '@/types';

export function useChat(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadMessages = useCallback(async () => {
    // Messages are loaded as part of session data
  }, []);

  const sendMessage = useCallback(
    async (
      content: string,
      options?: { model?: string; onDocumentDetected?: (markdown: string) => void }
    ) => {
      setIsLoading(true);
      setError(null);

      const userMessage: ChatMessageData = {
        id: `temp-${Date.now()}`,
        sessionId,
        role: 'user',
        content,
        documentId: null,
        model: null,
        createdAt: new Date(),
      };
      setMessages(prev => [...prev, userMessage]);

      // Placeholder for assistant response
      const assistantId = `temp-${Date.now()}-assistant`;
      const assistantMessage: ChatMessageData = {
        id: assistantId,
        sessionId,
        role: 'assistant',
        content: '',
        documentId: null,
        model: options?.model || null,
        createdAt: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);

      try {
        abortRef.current = new AbortController();
        const settings = localStorage.getItem('ai-settings');

        const response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(settings ? { 'x-ai-settings': settings } : {}),
          },
          body: JSON.stringify({
            sessionId,
            message: content,
            model: options?.model,
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`AI request failed: ${response.statusText}`);
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
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId ? { ...m, content: fullText } : m
            )
          );
        }

        // Check if response contains a document
        const docMatch = fullText.match(/```document\n([\s\S]*?)\n```/);
        if (docMatch && options?.onDocumentDetected) {
          options.onDocumentDetected(docMatch[1]);
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setError(err.message);
          // Remove the empty assistant message on error
          setMessages(prev => prev.filter(m => m.id !== assistantId));
        }
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [sessionId]
  );

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    messages,
    setMessages,
    isLoading,
    error,
    sendMessage,
    stopGeneration,
    loadMessages,
  };
}
