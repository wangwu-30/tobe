import { completeSimple, streamSimple } from '@mariozechner/pi-ai';
import type { Api, Context, Message, Model as PiModel } from '@mariozechner/pi-ai';
import type { Settings } from '@/lib/ai/providers';
import {
  extractAssistantMessageText,
  resolvePiProviderApiKey,
  toPiRunMessages,
} from '@/framework/agent/run';

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

export const extractTextContent = extractAssistantMessageText as (
  message: Message
) => string;

export function toPiContextMessages(
  messages: Array<{ role: 'user' | 'assistant'; content: string; createdAt?: Date | string }>,
  model: AnyPiModel
): Message[] {
  return toPiRunMessages(messages, model);
}

async function buildPiRequestOptions({
  model,
  settings,
}: BuildPiRequestOptionsParams) {
  const providerApiKey = await resolvePiProviderApiKey({
    provider: model.provider,
    settings,
  });

  return {
    apiKey: providerApiKey,
    sessionId: `chengxing:${model.provider}`,
  };
}
