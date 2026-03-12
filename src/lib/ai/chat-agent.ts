import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { Api, Message as PiMessage, Model as PiModel } from '@mariozechner/pi-ai';
import type { Settings } from '@/lib/ai/providers';
import { getOAuthApiKeyForProvider } from '@/lib/ai/auth-store';
import { resolveConfiguredApiKey } from '@/lib/ai/providers';
import { AI_STREAM_HEARTBEAT_TOKEN } from '@/lib/ai/stream-protocol';

type AgentMessage =
  | {
      role: 'assistant';
      content: string;
      createdAt?: Date | string;
    }
  | {
      role: 'user';
      content:
        | string
        | Array<
            | {
                type: 'image';
                data: string;
                mimeType: string;
              }
            | {
                type: 'text';
                text: string;
              }
          >;
      createdAt?: Date | string;
    };

type AnyPiModel = PiModel<Api>;

type StreamPiAgentChatParams = {
  sessionId: string;
  model: AnyPiModel;
  settings: Settings;
  systemPrompt: string;
  messages: AgentMessage[];
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
      messages: toPiMessages(messages, model),
      tools,
      thinkingLevel: 'low',
    },
    sessionId,
    getApiKey: async (provider) => {
      if (isOAuthProvider(provider)) {
        const oauth = await getOAuthApiKeyForProvider(provider);
        if (oauth?.apiKey) {
          return oauth.apiKey;
        }
      }

      return resolveConfiguredApiKey(settings, provider);
    },
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
        const finalText = getLastAssistantText(agent.state.messages) || streamedText;
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

function toPiMessages(messages: AgentMessage[], model: AnyPiModel): PiMessage[] {
  return messages.map(message => {
    const timestamp = message.createdAt
      ? new Date(message.createdAt).getTime()
      : Date.now();

    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: [{ type: 'text', text: message.content }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        stopReason: 'stop',
        timestamp,
      };
    }

    return {
      role: 'user',
      content:
        typeof message.content === 'string'
          ? message.content
          : message.content.map((block) =>
              block.type === 'text'
                ? { type: 'text', text: block.text }
                : {
                    type: 'image',
                    data: block.data,
                    mimeType: block.mimeType,
                  }
            ),
      timestamp,
    };
  });
}

function getLastAssistantText(messages: PiMessage[]) {
  const assistantMessage = [...messages]
    .reverse()
    .find((message): message is Extract<PiMessage, { role: 'assistant' }> => message.role === 'assistant');

  if (!assistantMessage) {
    return '';
  }

  return assistantMessage.content
    .filter(content => content.type === 'text')
    .map(content => content.text)
    .join('');
}

function isOAuthProvider(provider: string): provider is Parameters<
  typeof getOAuthApiKeyForProvider
>[0] {
  return (
    provider === 'anthropic' ||
    provider === 'openai-codex' ||
    provider === 'github-copilot' ||
    provider === 'google-gemini-cli' ||
    provider === 'google-antigravity'
  );
}
