import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { createConversationMessage } from '@/objects/conversation/commands';
import { mapConversationMessage } from '@/objects/conversation/view';
import { defineRoute } from '@/framework/resilience';


export const GET = defineRoute(async function GET(
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
});

export const POST = defineRoute(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { conversationId } = await params;
  const body = await req.json();
  const focusNodeId = body.focusNodeId || body.workspaceId || body.wikiId || null;

  const message = await createConversationMessage(actor, {
    activeFileId: body.activeFileId,
    content: body.content,
    conversationId,
    focusNodeId,
    model: body.model,
    role: body.role,
    workspaceId: body.workspaceId || body.wikiId || focusNodeId,
  });

  return NextResponse.json(message);
});
