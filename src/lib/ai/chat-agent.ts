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
      let isClosed = false;
      const heartbeatId = setInterval(() => {
        if (isClosed) {
          return;
        }

        controller.enqueue(encoder.encode(AI_STREAM_HEARTBEAT_TOKEN));
      }, STREAM_HEARTBEAT_INTERVAL_MS);
      const unsubscribe = agent.subscribe((event) => {
        if (
          event.type === 'message_update' &&
          event.assistantMessageEvent.type === 'text_delta'
        ) {
          if (!streamedText.length) {
            void onFirstText?.();
          }
          streamedText += event.assistantMessageEvent.delta;
          controller.enqueue(encoder.encode(event.assistantMessageEvent.delta));
        }
      });

      try {
        await agent.continue();
        const finalText = getLastAssistantMessageText(agent.state.messages) || streamedText;
        await onFinish?.({ text: finalText });
        isClosed = true;
        clearInterval(heartbeatId);
        controller.close();
      } catch (error) {
        await onError?.(error);
        isClosed = true;
        clearInterval(heartbeatId);
        controller.error(error);
      } finally {
        isClosed = true;
        clearInterval(heartbeatId);
        unsubscribe();
      }
    },
    cancel() {
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
