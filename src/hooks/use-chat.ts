'use client';

import { useState, useCallback, useRef } from 'react';
import {
  consumeAssistantTextResponse,
  createLocalAssistantMessageDraft,
  createLocalAttachmentDrafts,
  createLocalUserMessageDraft,
  ensureAgentResponseOk,
  requestAgentRun,
  requestProposalContinue,
  requestResearchStart,
} from '@/agent';
import { StreamController } from '@/framework/agent';
import type { ChatMessageData, ResearchMode } from '@/types';
import { describeAIError, type AIErrorInfo } from '@/lib/ai/error-utils';
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
  baseVersionId,
}: {
  conversationId?: string | null;
  workspaceId?: string | null;
  activeFileId?: string | null;
  baseVersionId?: string | null;
}) {
  const language = useAppLanguage();
  const t = useT();
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<AIErrorInfo | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const streamControllerRef = useRef<StreamController | null>(null);
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
      researchMode?: ResearchMode;
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

  const createStreamController = useCallback(
    () =>
      new StreamController({
        idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
        onSlowResponse: () => {
          setStatusMessage(t('chat.stillWaiting'));
        },
        slowResponseMs: SLOW_RESPONSE_MS,
        totalTimeoutMs: STREAM_TOTAL_TIMEOUT_MS,
      }),
    [t]
  );

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
        researchMode?: ResearchMode;
        suppressUserEcho?: boolean;
      }
    ) => {
      setIsLoading(true);
      setError(null);
      setStatusMessage(t('chat.connecting'));
      lastAttemptRef.current = {
        content,
        options: {
          ...options,
        },
      };

      const localAttachments = createLocalAttachmentDrafts({
        attachments: options?.attachments,
        conversationId,
        nextTempId,
        workspaceId,
      });

      const userMessage: ChatMessageData = createLocalUserMessageDraft({
        attachments: localAttachments,
        content,
        conversationId,
        nextTempId,
        workspaceId,
      });
      if (!options?.hiddenFromTimeline && !options?.suppressUserEcho) {
        setMessages((prev) => [...prev, userMessage]);
      }

      const assistantMessage: ChatMessageData = createLocalAssistantMessageDraft({
        conversationId,
        model: options?.model || null,
        nextTempId,
        workspaceId,
      });
      const assistantId = assistantMessage.id;
      setMessages((prev) => [...prev, assistantMessage]);

      const streamController = createStreamController();
      streamControllerRef.current = streamController;

      try {
        streamController.start();
        const { isDeepResearch, response } = await requestAgentRun({
          activeFileId,
          attachments: options?.attachments,
          baseVersionId,
          conversationId,
          message: content,
          model: options?.model || '',
          researchMode: options?.researchMode || 'light',
          signal: streamController.signal,
          workspaceId,
        });

        setStatusMessage(
          isDeepResearch ? t('chat.researchPlanning') : t('chat.planning')
        );

        if (isDeepResearch) {
          await ensureAgentResponseOk(response);
          streamController.dismissSlowResponse();
          const payload = (await response.json()) as {
            conversationId?: string | null;
            workspaceId?: string | null;
          };
          options?.onWorkspaceChange?.({
            conversationId: payload.conversationId || conversationId || null,
            workspaceId: payload.workspaceId || workspaceId || null,
          });
          setMessages((prev) => prev.filter((message) => message.id !== assistantId));
          setStatusMessage(null);
          await options?.onComplete?.();
          return;
        }

        const { fullText, workspaceChange } = await consumeAssistantTextResponse({
          onFirstChunk: () => {
            setStatusMessage(null);
          },
          onText: (nextText) => {
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId ? { ...message, content: nextText } : message
              )
            );
          },
          response,
          streamController,
          workspaceChangeFallback: {
            conversationId,
            workspaceId,
          },
        });
        options?.onWorkspaceChange?.(workspaceChange);

        if (!fullText.trim()) {
          throw new Error(t('chat.timeoutDetail'));
        }

        setStatusMessage(null);
        await options?.onComplete?.();
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          if (streamController.reason === 'timeout') {
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
        streamController.finish();
        setIsLoading(false);
        if (streamControllerRef.current === streamController) {
          streamControllerRef.current = null;
        }
      }
    },
    [
      activeFileId,
      baseVersionId,
      conversationId,
      createStreamController,
      language,
      nextTempId,
      t,
      workspaceId,
    ]
  );

  const startResearch = useCallback(
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
      setStatusMessage(t('chat.researchStarting'));
      const streamController = createStreamController();
      streamControllerRef.current = streamController;

      try {
        streamController.start();
        const response = await requestResearchStart({
          runId,
          signal: streamController.signal,
          workspaceId,
        });

        await ensureAgentResponseOk(response);
        const payload = await response.json().catch(() => null);
        streamController.dismissSlowResponse();
        setStatusMessage(null);
        options?.onWorkspaceChange?.({
          conversationId: payload?.conversationId || conversationId || null,
          workspaceId: payload?.workspaceId || workspaceId || null,
        });
        await options?.onComplete?.();
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          if (streamController.reason === 'timeout') {
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
        } else {
          setStatusMessage(null);
          setError(
            describeAIError({
              language,
              rawMessage: err instanceof Error ? err.message : '',
            })
          );
        }
      } finally {
        streamController.finish();
        setIsLoading(false);
        if (streamControllerRef.current === streamController) {
          streamControllerRef.current = null;
        }
      }
    },
    [conversationId, createStreamController, language, t, workspaceId]
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

      const assistantMessage: ChatMessageData = createLocalAssistantMessageDraft({
        conversationId,
        model: null,
        nextTempId,
        workspaceId,
      });
      const assistantId = assistantMessage.id;
      setMessages((prev) => [...prev, assistantMessage]);

      const streamController = createStreamController();
      streamControllerRef.current = streamController;

      try {
        streamController.start();
        const response = await requestProposalContinue({
          runId,
          signal: streamController.signal,
          workspaceId,
        });

        setStatusMessage(t('chat.planning'));

        const { fullText, workspaceChange } = await consumeAssistantTextResponse({
          onFirstChunk: () => {
            setStatusMessage(null);
          },
          onText: (nextText) => {
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId ? { ...message, content: nextText } : message
              )
            );
          },
          response,
          streamController,
          workspaceChangeFallback: {
            conversationId,
            workspaceId,
          },
        });
        options?.onWorkspaceChange?.(workspaceChange);

        if (!fullText.trim()) {
          throw new Error(t('chat.timeoutDetail'));
        }

        setStatusMessage(null);
        await options?.onComplete?.();
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          if (streamController.reason === 'timeout') {
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
        streamController.finish();
        setIsLoading(false);
        if (streamControllerRef.current === streamController) {
          streamControllerRef.current = null;
        }
      }
    },
    [
      conversationId,
      createStreamController,
      language,
      nextTempId,
      t,
      workspaceId,
    ]
  );

  const stopGeneration = useCallback(() => {
    streamControllerRef.current?.abort('user');
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

  return {
    messages,
    setMessages,
    isLoading,
    error,
    statusMessage,
    sendMessage,
    continueProposal,
    startResearch,
    retryLastMessage,
    stopGeneration,
    loadMessages,
  };
}
