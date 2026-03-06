import { streamText } from 'ai';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getModelFromHeaders } from '@/lib/ai/providers';
import { buildCommentContext } from '@/lib/ai/context-builder';

export async function POST(req: NextRequest) {
  const { threadId, message, documentContent, anchorText, documentId, model: modelOverride } = await req.json();

  // Save user message
  await prisma.commentMessage.create({
    data: { threadId, role: 'user', content: message },
  });

  // Fetch thread messages
  const threadMessages = await prisma.commentMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: 'asc' },
  });

  const thread = await prisma.commentThread.findUnique({ where: { id: threadId } });

  const { systemPrompt, messages } = await buildCommentContext({
    documentContent,
    anchorText: anchorText || thread?.anchorText || '',
    threadMessages: threadMessages.map(m => ({ role: m.role, content: m.content })),
    documentId,
  });

  const model = getModelFromHeaders(req.headers, modelOverride);

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    onFinish: async ({ text }) => {
      await prisma.commentMessage.create({
        data: {
          threadId,
          role: 'assistant',
          content: text,
          model: modelOverride || 'claude-sonnet-4-20250514',
        },
      });
    },
  });

  return result.toTextStreamResponse();
}
