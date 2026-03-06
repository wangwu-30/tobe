import { streamText } from 'ai';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getModelFromHeaders } from '@/lib/ai/providers';
import { buildChatSystemPrompt } from '@/lib/ai/context-builder';

export async function POST(req: NextRequest) {
  const { sessionId, message, model: modelOverride } = await req.json();

  // Ensure session exists
  let session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    session = await prisma.session.create({
      data: { id: sessionId, title: 'New Session' },
    });
  }

  // Save user message
  await prisma.chatMessage.create({
    data: { sessionId, role: 'user', content: message },
  });

  // Fetch chat history
  const history = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
  });

  const systemPrompt = await buildChatSystemPrompt(sessionId);
  const model = getModelFromHeaders(req.headers, modelOverride);

  const result = streamText({
    model,
    system: systemPrompt,
    messages: history.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    onFinish: async ({ text }) => {
      await prisma.chatMessage.create({
        data: {
          sessionId,
          role: 'assistant',
          content: text,
          model: modelOverride || 'claude-sonnet-4-20250514',
        },
      });

      // Update session title if it's the first exchange
      if (history.length <= 1) {
        const title = message.slice(0, 50) + (message.length > 50 ? '...' : '');
        await prisma.session.update({
          where: { id: sessionId },
          data: { title },
        });
      }
    },
  });

  return result.toTextStreamResponse();
}
