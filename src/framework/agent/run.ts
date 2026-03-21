import 'server-only';

import type { Api, Message as PiMessage, Model as PiModel } from '@mariozechner/pi-ai';
import type { Settings } from '@/lib/ai/providers';
import { getOAuthApiKeyForProvider } from '@/lib/ai/auth-store';
import { resolveConfiguredApiKey } from '@/lib/ai/providers';

export type AnyPiModel = PiModel<Api>;

export type AgentRunMessage =
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

export async function resolvePiProviderApiKey(params: {
  provider: string;
  settings: Settings;
}) {
  return (
    (isOAuthProvider(params.provider)
      ? (await getOAuthApiKeyForProvider(params.provider))?.apiKey
      : null) || resolveConfiguredApiKey(params.settings, params.provider)
  );
}

export function toPiRunMessages(
  messages: AgentRunMessage[],
  model: AnyPiModel
): PiMessage[] {
  return messages.map((message) => {
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
                ? { type: 'text' as const, text: block.text }
                : {
                    type: 'image' as const,
                    data: block.data,
                    mimeType: block.mimeType,
                  }
            ),
      timestamp,
    };
  });
}

export function extractAssistantMessageText(message: PiMessage) {
  if (message.role !== 'assistant') {
    return '';
  }

  return message.content
    .filter((content) => content.type === 'text')
    .map((content) => content.text)
    .join('');
}

export function getLastAssistantMessageText(messages: PiMessage[]) {
  const assistantMessage = [...messages]
    .reverse()
    .find(
      (message): message is Extract<PiMessage, { role: 'assistant' }> =>
        message.role === 'assistant'
    );

  return assistantMessage ? extractAssistantMessageText(assistantMessage) : '';
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
