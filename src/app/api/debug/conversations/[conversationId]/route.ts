import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { defineRoute } from '@/framework/resilience';

export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  if (process.env.DAO_E2E !== '1') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const actor = await getPlatformContextFromHeaders(req.headers);
  const { conversationId } = await params;
  const conversation = await prisma.session.findFirst({
    where: {
      deletedAt: null,
      id: conversationId,
      organizationId: actor.organizationId,
    },
    select: {
      activeFile: {
        select: {
          documentId: true,
        },
      },
      activeFileId: true,
      id: true,
      projectId: true,
      wikiId: true,
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  }

  const messages = await prisma.chatMessage.findMany({
    where: {
      deletedAt: null,
      organizationId: actor.organizationId,
      sessionId: conversationId,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      documentId: true,
      focusNodeId: true,
      id: true,
      role: true,
    },
  });

  return NextResponse.json({
    conversation: {
      activeFileId: conversation.activeFileId,
      activeFileWorkspaceId: conversation.activeFile?.documentId || null,
      id: conversation.id,
      projectId: conversation.projectId,
      wikiId: conversation.wikiId,
    },
    messages,
  });
});
