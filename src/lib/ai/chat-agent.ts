import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { Settings } from '@/lib/ai/providers';
import { AI_STREAM_HEARTBEAT_TOKEN } from '@/lib/ai/stream-protocol';
import {
  getLastAssistantMessageText,
  resolvePiProviderApiKey,
  toPiRunMessages,
  type AgentRunMessage,
  type AnyPiModel,
} from '@/framework/agent/run';

type StreamPiAgentChatParams = {
  sessionId: string;
  model: AnyPiModel;
  settings: Settings;
  systemPrompt: string;
  messages: AgentRunMessage[];
  tools: AgentTool[];
  onError?: (error: unknown) => Promise<void> | void;
  onFirstText?: () => Promise<void> | void;
  onFinish?: (result: { text: string }) => Promise<void> | void;
};

const STREAM_HEARTBEAT_INTERVAL_MS = 5000;

export async function streamPiAgentChat({
  sessionId,
  model,
  settings,
  systemPrompt,
  messages,
  tools,
  onError,
  onFirstText,
  onFinish,
}: StreamPiAgentChatParams) {
  const encoder = new TextEncoder();
  let isStreamSettled = false;
  let cleanupStreamResources: (() => void) | null = null;

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      messages: toPiRunMessages(messages, model),
      tools,
      thinkingLevel: 'low',
    },
    sessionId,
    getApiKey: async (provider) =>
      resolvePiProviderApiKey({
        provider,
        settings,
      }),
  });

  const stream = new ReadableStream({
    async start(controller) {
      let streamedText = '';
      let heartbeatId: ReturnType<typeof setInterval> | null = null;
      let unsubscribe = () => {};
      const cleanup = () => {
        if (heartbeatId) {
          clearInterval(heartbeatId);
          heartbeatId = null;
        }
        unsubscribe();
        unsubscribe = () => {};
      };
      const settleStream = (mode: 'close' | 'error', error?: unknown) => {
        if (isStreamSettled) {
          return;
        }

        isStreamSettled = true;
        cleanup();
        cleanupStreamResources = null;
        try {
          if (mode === 'close') {
            controller.close();
            return;
          }
          controller.error(error);
        } catch {
          // Ignore controller state races triggered by abort/cancel during teardown.
        }
      };
      const enqueueChunk = (chunk: Uint8Array) => {
        if (isStreamSettled) {
          return false;
        }

        try {
          controller.enqueue(chunk);
          return true;
        } catch {
          settleStream('close');
          return false;
        }
      };

      cleanupStreamResources = cleanup;

      heartbeatId = setInterval(() => {
        enqueueChunk(encoder.encode(AI_STREAM_HEARTBEAT_TOKEN));
      }, STREAM_HEARTBEAT_INTERVAL_MS);
      unsubscribe = agent.subscribe((event) => {
        if (
          event.type === 'message_update' &&
          event.assistantMessageEvent.type === 'text_delta'
        ) {
          if (!streamedText.length) {
            void onFirstText?.();
          }
          streamedText += event.assistantMessageEvent.delta;
          enqueueChunk(encoder.encode(event.assistantMessageEvent.delta));
        }
      });

      try {
        await agent.continue();
        const finalText = getLastAssistantMessageText(agent.state.messages) || streamedText;
        await onFinish?.({ text: finalText });
        settleStream('close');
      } catch (error) {
        await onError?.(error);
        settleStream('error', error);
      } finally {
        cleanup();
        cleanupStreamResources = null;
      }
    },
    cancel() {
      isStreamSettled = true;
      cleanupStreamResources?.();
      cleanupStreamResources = null;
      agent.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
