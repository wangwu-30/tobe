'use client';

import { useState, useCallback, useRef } from 'react';
import type { ChatMessageData } from '@/types';
import { describeAIError, type AIErrorInfo } from '@/lib/ai/error-utils';
import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import { stripAIStreamControlTokens } from '@/lib/ai/stream-protocol';
import {
  useAppLanguage,
  useT,
} from '@/components/providers/language-provider';
import type { ChatComposerAttachment } from '@/components/chat/attachment-types';

const SLOW_RESPONSE_MS = 8000;
const STREAM_IDLE_TIMEOUT_MS = 45000;
const STREAM_TOTAL_TIMEOUT_MS = 180000;

export function useChat({
  conversationId,
  workspaceId,
  activeFileId,
  baseSnapshotId,
}: {
  conversationId?: string | null;
  workspaceId?: string | null;
  activeFileId?: string | null;
  baseSnapshotId?: string | null;
}) {
  const language = useAppLanguage();
  const t = useT();
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<AIErrorInfo | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const abortReasonRef = useRef<'user' | 'timeout' | null>(null);
  const hardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const totalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slowResponseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tempIdRef = useRef(0);
  const lastAttemptRef = useRef<{
    content: string;
    options?: {
      attachments?: ChatComposerAttachment[];
      hiddenFromTimeline?: boolean;
      model?: string;
      onComplete?: () => void | Promise<void>;
      onWorkspaceChange?: (workspace: {
        conversationId: string | null;
        workspaceId: string | null;
      }) => void;
      searchMode?: 'auto' | 'force';
      suppressUserEcho?: boolean;
    };
  } | null>(null);

  const loadMessages = useCallback(async () => {
    // Messages are loaded as part of session data
  }, []);

  const nextTempId = useCallback(() => {
    tempIdRef.current += 1;
    return `temp-${tempIdRef.current}`;
  }, []);

  const sendMessage = useCallback(
    async (
      content: string,
      options?: {
        attachments?: ChatComposerAttachment[];
        hiddenFromTimeline?: boolean;
        model?: string;
        onComplete?: () => void | Promise<void>;
        onWorkspaceChange?: (workspace: {
          conversationId: string | null;
          workspaceId: string | null;
        }) => void;
        searchMode?: 'auto' | 'force';
        suppressUserEcho?: boolean;
      }
    ) => {
      setIsLoading(true);
      setError(null);
      setStatusMessage(t('chat.connecting'));
      abortReasonRef.current = null;
      lastAttemptRef.current = {
        content,
        options: {
          ...options,
        },
      };

      const localAttachments = (options?.attachments || []).map((attachment, index) => ({
        id: `${nextTempId()}-attachment-${index}`,
        organizationId: 'local-org',
        conversationId: conversationId || 'pending-conversation',
        messageId: '',
        workspaceId: workspaceId || '',
        workspaceFileId: '',
        filePath: attachment.file.name,
        kind: attachment.kind,
        source: attachment.source,
        storageFormat:
          attachment.kind === 'image'
            ? ('base64-envelope' as const)
            : ('text' as const),
        mimeType: attachment.file.type || null,
        originalName: attachment.file.name,
        sizeBytes: attachment.file.size,
        previewUrl:
          attachment.kind === 'image' ? URL.createObjectURL(attachment.file) : null,
        createdByUserId: null,
        originDeviceId: null,
        revision: 1,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const userMessage: ChatMessageData = {
        id: nextTempId(),
        conversationId: conversationId || 'pending-conversation',
        organizationId: 'local-org',
        role: 'user',
        content,
        attachments: localAttachments,
        workspaceId: workspaceId || null,
        wikiId: workspaceId || null,
        model: null,
        createdByUserId: null,
        originDeviceId: null,
        revision: 1,
        deletedAt: null,
        createdAt: new Date(),
      };
      if (!options?.hiddenFromTimeline && !options?.suppressUserEcho) {
        setMessages((prev) => [...prev, userMessage]);
      }

      const assistantId = `${nextTempId()}-assistant`;
      const assistantMessage: ChatMessageData = {
        id: assistantId,
        conversationId: conversationId || 'pending-conversation',
        organizationId: 'local-org',
        role: 'assistant',
        content: '',
        attachments: [],
        workspaceId: workspaceId || null,
        wikiId: workspaceId || null,
        model: options?.model || null,
        createdByUserId: null,
        originDeviceId: null,
        revision: 1,
        deletedAt: null,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      try {
        abortRef.current = new AbortController();
        clearTimers();
        slowResponseRef.current = setTimeout(() => {
          setStatusMessage(t('chat.stillWaiting'));
        }, SLOW_RESPONSE_MS);
        scheduleIdleTimeout();
        totalTimeoutRef.current = setTimeout(() => {
          abortReasonRef.current = 'timeout';
          abortRef.current?.abort();
        }, STREAM_TOTAL_TIMEOUT_MS);

        const formData = new FormData();
        formData.set('activeFileId', activeFileId || '');
        formData.set('baseSnapshotId', baseSnapshotId || '');
        formData.set('conversationId', conversationId || '');
        formData.set('sessionId', conversationId || '');
        formData.set('searchMode', options?.searchMode || 'auto');
        formData.set('workspaceId', workspaceId || '');
        formData.set('wikiId', workspaceId || '');
        formData.set('message', content);
        formData.set('model', options?.model || '');
        formData.set(
          'attachmentsMeta',
          JSON.stringify(
            (options?.attachments || []).map((attachment) => ({
              id: attachment.id,
              kind: attachment.kind,
              name: attachment.file.name,
              mimeType: attachment.file.type || null,
              sizeBytes: attachment.file.size,
              source: attachment.source,
            }))
          )
        );

        (options?.attachments || []).forEach((attachment) => {
          formData.append('attachments', attachment.file, attachment.file.name);
        });

        const response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: {
            ...getStoredAISettingsHeader(),
          },
          body: formData,
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const message =
            payload?.error ||
            payload?.details ||
            `AI request failed: ${response.status} ${response.statusText}`;
          throw new Error(message);
        }

        if (slowResponseRef.current) {
          clearTimeout(slowResponseRef.current);
          slowResponseRef.current = null;
        }
        setStatusMessage(t('chat.planning'));

        const nextConversationId =
          response.headers.get('x-dao-conversation-id') || conversationId || null;
        const nextWorkspaceId =
          response.headers.get('x-dao-workspace-id') ||
          response.headers.get('x-dao-wiki-id') ||
          workspaceId ||
          null;

        options?.onWorkspaceChange?.({
          conversationId: nextConversationId,
          workspaceId: nextWorkspaceId,
        });

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let fullText = '';
        let receivedFirstChunk = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          scheduleIdleTimeout();

          const chunk = stripAIStreamControlTokens(decoder.decode(value, { stream: true }));
          if (!chunk) {
            continue;
          }

          if (!receivedFirstChunk) {
            receivedFirstChunk = true;
            setStatusMessage(null);
          }
          fullText += chunk;
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId ? { ...message, content: fullText } : message
            )
          );
        }

        if (!fullText.trim()) {
          throw new Error(t('chat.timeoutDetail'));
        }

        setStatusMessage(null);
        await options?.onComplete?.();
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          if (abortReasonRef.current === 'timeout') {
            setStatusMessage(null);
            setError({
              detail: t('chat.timeoutDetail'),
              kind: 'network',
              message: t('chat.timeoutMessage'),
              retryable: true,
              showSettings: true,
              statusCode: 504,
            });
          } else {
            setStatusMessage(t('chat.generationStopped'));
          }
          setMessages((prev) => prev.filter((message) => message.id !== assistantId));
        } else {
          setStatusMessage(null);
          setError(
            describeAIError({
              language,
              modelKey: options?.model,
              rawMessage: err instanceof Error ? err.message : '',
            })
          );
          setMessages((prev) => prev.filter((message) => message.id !== assistantId));
        }
      } finally {
        clearTimers();
        setIsLoading(false);
        abortRef.current = null;
        abortReasonRef.current = null;
      }
    },
    [activeFileId, baseSnapshotId, conversationId, language, nextTempId, t, workspaceId]
  );

  const continueProposal = useCallback(
    async (
      runId: string,
      options?: {
        onComplete?: () => void | Promise<void>;
        onWorkspaceChange?: (workspace: {
          conversationId: string | null;
          workspaceId: string | null;
        }) => void;
      }
    ) => {
      if (!workspaceId || !runId) {
        return;
      }

      setIsLoading(true);
      setError(null);
      setStatusMessage(t('chat.connecting'));
      abortReasonRef.current = null;

      const assistantId = `${nextTempId()}-assistant`;
      const assistantMessage: ChatMessageData = {
        id: assistantId,
        conversationId: conversationId || 'pending-conversation',
        organizationId: 'local-org',
        role: 'assistant',
        content: '',
        attachments: [],
        workspaceId: workspaceId || null,
        wikiId: workspaceId || null,
        model: null,
        createdByUserId: null,
        originDeviceId: null,
        revision: 1,
        deletedAt: null,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      try {
        abortRef.current = new AbortController();
        clearTimers();
        slowResponseRef.current = setTimeout(() => {
          setStatusMessage(t('chat.stillWaiting'));
        }, SLOW_RESPONSE_MS);
        scheduleIdleTimeout();
        totalTimeoutRef.current = setTimeout(() => {
          abortReasonRef.current = 'timeout';
          abortRef.current?.abort();
        }, STREAM_TOTAL_TIMEOUT_MS);

        const response = await fetch(
          `/api/workspaces/${workspaceId}/assistant-runs/${runId}/proposal/continue`,
          {
            method: 'POST',
            headers: {
              ...getStoredAISettingsHeader(),
            },
            signal: abortRef.current.signal,
          }
        );

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const message =
            payload?.error ||
            payload?.details ||
            `AI request failed: ${response.status} ${response.statusText}`;
          throw new Error(message);
        }

        if (slowResponseRef.current) {
          clearTimeout(slowResponseRef.current);
          slowResponseRef.current = null;
        }
        setStatusMessage(t('chat.planning'));

        options?.onWorkspaceChange?.({
          conversationId:
            response.headers.get('x-dao-conversation-id') || conversationId || null,
          workspaceId:
            response.headers.get('x-dao-workspace-id') ||
            response.headers.get('x-dao-wiki-id') ||
            workspaceId ||
            null,
        });

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let fullText = '';
        let receivedFirstChunk = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          scheduleIdleTimeout();

          const chunk = stripAIStreamControlTokens(decoder.decode(value, { stream: true }));
          if (!chunk) {
            continue;
          }

          if (!receivedFirstChunk) {
            receivedFirstChunk = true;
            setStatusMessage(null);
          }
          fullText += chunk;
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId ? { ...message, content: fullText } : message
            )
          );
        }

        if (!fullText.trim()) {
          throw new Error(t('chat.timeoutDetail'));
        }

        setStatusMessage(null);
        await options?.onComplete?.();
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          if (abortReasonRef.current === 'timeout') {
            setStatusMessage(null);
            setError({
              detail: t('chat.timeoutDetail'),
              kind: 'network',
              message: t('chat.timeoutMessage'),
              retryable: true,
              showSettings: true,
              statusCode: 504,
            });
          } else {
            setStatusMessage(t('chat.generationStopped'));
          }
          setMessages((prev) => prev.filter((message) => message.id !== assistantId));
        } else {
          setStatusMessage(null);
          setError(
            describeAIError({
              language,
              rawMessage: err instanceof Error ? err.message : '',
            })
          );
          setMessages((prev) => prev.filter((message) => message.id !== assistantId));
        }
      } finally {
        clearTimers();
        setIsLoading(false);
        abortRef.current = null;
        abortReasonRef.current = null;
      }
    },
    [conversationId, language, nextTempId, t, workspaceId]
  );

  const stopGeneration = useCallback(() => {
    abortReasonRef.current = 'user';
    abortRef.current?.abort();
  }, []);

  const retryLastMessage = useCallback(() => {
    if (isLoading || !lastAttemptRef.current) {
      return;
    }

    const nextAttempt = lastAttemptRef.current;
    void sendMessage(nextAttempt.content, {
      ...nextAttempt.options,
      suppressUserEcho: true,
    });
  }, [isLoading, sendMessage]);

  const clearTimers = () => {
    if (hardTimeoutRef.current) {
      clearTimeout(hardTimeoutRef.current);
      hardTimeoutRef.current = null;
    }
    if (totalTimeoutRef.current) {
      clearTimeout(totalTimeoutRef.current);
      totalTimeoutRef.current = null;
    }
    if (slowResponseRef.current) {
      clearTimeout(slowResponseRef.current);
      slowResponseRef.current = null;
    }
  };

  const scheduleIdleTimeout = () => {
    if (hardTimeoutRef.current) {
      clearTimeout(hardTimeoutRef.current);
    }

    hardTimeoutRef.current = setTimeout(() => {
      abortReasonRef.current = 'timeout';
      abortRef.current?.abort();
    }, STREAM_IDLE_TIMEOUT_MS);
  };

  return {
    messages,
    setMessages,
    isLoading,
    error,
    statusMessage,
    sendMessage,
    continueProposal,
    retryLastMessage,
    stopGeneration,
    loadMessages,
  };
}
