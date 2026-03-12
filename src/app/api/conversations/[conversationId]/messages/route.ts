import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { createConversationMessage, mapConversationMessage } from '@/lib/wiki/service';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { conversationId } = await params;
  const messages = await prisma.chatMessage.findMany({
    where: {
      deletedAt: null,
      organizationId: actor.organizationId,
      sessionId: conversationId,
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json(messages.map(mapConversationMessage));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { conversationId } = await params;
  const body = await req.json();

  const message = await createConversationMessage(actor, {
    activeFileId: body.activeFileId,
    content: body.content,
    conversationId,
    model: body.model,
    role: body.role,
    wikiId: body.wikiId || body.workspaceId,
  });

  return NextResponse.json(message);
}
