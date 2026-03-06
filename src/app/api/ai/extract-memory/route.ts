import { generateText } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getModelFromHeaders } from '@/lib/ai/providers';
import {
  buildMemoryExtractionPrompt,
  parseMemoryExtractionResponse,
  saveExtractedMemories,
} from '@/lib/ai/memory-extractor';

export async function POST(req: NextRequest) {
  const { threadId } = await req.json();

  // Fetch thread with messages
  const thread = await prisma.commentThread.findUnique({
    where: { id: threadId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });

  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  const prompt = buildMemoryExtractionPrompt(
    thread.messages.map(m => ({ role: m.role, content: m.content })),
    thread.anchorText
  );

  const model = getModelFromHeaders(req.headers);

  const { text } = await generateText({
    model,
    messages: [{ role: 'user', content: prompt }],
  });

  const memories = parseMemoryExtractionResponse(text);

  if (memories.length > 0) {
    const saved = await saveExtractedMemories(memories, threadId);
    return NextResponse.json({ memories: saved });
  }

  return NextResponse.json({ memories: [] });
}
