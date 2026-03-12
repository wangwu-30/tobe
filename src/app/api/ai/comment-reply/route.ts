import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { buildCommentContext } from '@/lib/ai/context-builder';
import { getSelectedModelFromHeaders } from '@/lib/ai/providers';
import { streamWithPi, toPiContextMessages } from '@/lib/ai/pi-runtime';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';

export async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const {
    threadId,
    wikiContent,
    documentContent,
    anchorText,
    wikiId,
    documentId,
    model: modelOverride,
  } = await req.json();

  const threadMessages = await prisma.commentMessage.findMany({
    where: {
      deletedAt: null,
      threadId,
    },
    orderBy: { createdAt: 'asc' },
  });

  const thread = await prisma.commentThread.findUnique({
    where: { id: threadId },
  });

  const resolvedWikiId = wikiId || documentId || thread?.documentId || undefined;

  const { model, modelKey, settings } = getSelectedModelFromHeaders(
    req.headers,
    modelOverride
  );

  const { systemPrompt, messages } = await buildCommentContext({
    anchorText: anchorText || thread?.anchorText || '',
    language: settings.language,
    organizationId: thread?.organizationId || actor.organizationId,
    threadMessages: threadMessages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({ role: message.role, content: message.content })),
    wikiContent: wikiContent || documentContent || '',
    wikiId: resolvedWikiId,
  });

  return streamWithPi({
    model,
    settings,
    context: {
      systemPrompt,
      messages: toPiContextMessages(
        messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        model
      ),
    },
    onFinish: async ({ text }) => {
      const persistedText = text.trim();
      if (!persistedText) {
        return;
      }

      await prisma.commentMessage.create({
        data: {
          organizationId: thread?.organizationId || actor.organizationId,
          threadId,
          role: 'assistant',
          content: persistedText,
          model: modelKey,
          createdByUserId: actor.userId,
          originDeviceId: actor.deviceId,
        },
      });
    },
  });
}
