import { completeSimple, streamSimple } from '@mariozechner/pi-ai';
import type { Api, Context, Message, Model as PiModel } from '@mariozechner/pi-ai';
import type { Settings } from '@/lib/ai/providers';
import { getOAuthApiKeyForProvider } from '@/lib/ai/auth-store';
import { resolveConfiguredApiKey } from '@/lib/ai/providers';

type AnyPiModel = PiModel<Api>;

type BuildPiRequestOptionsParams = {
  model: AnyPiModel;
  settings: Settings;
};

export async function completeWithPi({
  model,
  settings,
  context,
}: BuildPiRequestOptionsParams & {
  context: Context;
}) {
  const message = await completeSimple(
    model,
    context,
    await buildPiRequestOptions({ model, settings })
  );

  if (message.role === 'assistant' && message.stopReason === 'error') {
    throw new Error(message.errorMessage || 'AI request failed');
  }

  return message;
}

export async function streamWithPi({
  model,
  settings,
  context,
  onFinish,
}: BuildPiRequestOptionsParams & {
  context: Context;
  onFinish?: (result: { text: string; message: Message }) => Promise<void> | void;
}) {
  const encoder = new TextEncoder();
  const options = await buildPiRequestOptions({ model, settings });
  const stream = streamSimple(model, context, options);

  const responseStream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'text_delta') {
            controller.enqueue(encoder.encode(event.delta));
          }

          if (event.type === 'error') {
            throw new Error(event.error.errorMessage || 'AI request failed');
          }
        }

        const message = await stream.result();
        await onFinish?.({ text: extractTextContent(message), message });
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(responseStream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export function extractTextContent(message: Message) {
  if (message.role !== 'assistant') {
    return '';
  }

  return message.content
    .filter(content => content.type === 'text')
    .map(content => content.text)
    .join('');
}

export function toPiContextMessages(
  messages: Array<{ role: 'user' | 'assistant'; content: string; createdAt?: Date | string }>,
  model: AnyPiModel
): Message[] {
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
      content: message.content,
      timestamp,
    };
  });
}

async function buildPiRequestOptions({
  model,
  settings,
}: BuildPiRequestOptionsParams) {
  const providerApiKey =
    (isOAuthProvider(model.provider)
      ? (await getOAuthApiKeyForProvider(model.provider))?.apiKey
      : null) || resolveConfiguredApiKey(settings, model.provider);

  return {
    apiKey: providerApiKey,
    sessionId: `chengxing:${model.provider}`,
  };
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
