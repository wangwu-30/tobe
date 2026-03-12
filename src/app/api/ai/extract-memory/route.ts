import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { describeAIError } from '@/lib/ai/error-utils';
import {
  buildMemoryExtractionPrompt,
  parseMemoryExtractionResponse,
  saveExtractedMemories,
} from '@/lib/ai/memory-extractor';
import { completeWithPi, extractTextContent } from '@/lib/ai/pi-runtime';
import { getSelectedModelFromHeaders } from '@/lib/ai/providers';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';

export async function POST(req: NextRequest) {
  let modelKey: string | null = null;
  let language: 'zh-CN' | 'en-US' | undefined;

  try {
    const actor = await getPlatformContextFromHeaders(req.headers);
    const { threadId } = await req.json();

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

    const selection = getSelectedModelFromHeaders(req.headers);
    const { model, settings } = selection;
    modelKey = selection.modelKey;
    language = settings.language;

    const message = await completeWithPi({
      model,
      settings,
      context: {
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      },
    });

    const memories = parseMemoryExtractionResponse(extractTextContent(message));

    if (memories.length > 0) {
      const saved = await saveExtractedMemories({
        memories,
        organizationId: actor.organizationId,
        threadId,
        wikiId: thread.documentId,
      });
      return NextResponse.json({ memories: saved });
    }

    return NextResponse.json({ memories: [] });
  } catch (error) {
    const info = describeAIError({
      language,
      modelKey,
      rawMessage: error instanceof Error ? error.message : 'Memory extraction failed',
    });

    return NextResponse.json(
      {
        error: info.message,
        details: info.detail,
      },
      { status: info.statusCode }
    );
  }
}
