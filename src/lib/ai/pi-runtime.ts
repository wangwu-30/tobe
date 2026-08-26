import type { Api, Context, Message, Model as PiModel } from '@earendil-works/pi-ai';
import { createPiStreamFn, type Settings } from '@/lib/ai/providers';
import {
  extractAssistantMessageText,
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
  const stream = await createPiStreamFn(settings)(
    model,
    context,
    { sessionId: `chengxing:${model.provider}` }
  );
  const message = await stream.result();

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
  const stream = await createPiStreamFn(settings)(model, context, {
    sessionId: `chengxing:${model.provider}`,
  });

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
