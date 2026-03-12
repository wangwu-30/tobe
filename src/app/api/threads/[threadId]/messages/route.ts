import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { mapCommentMessage } from '@/lib/wiki/service';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(_req.headers);
  const { threadId } = await params;
  const messages = await prisma.commentMessage.findMany({
    where: {
      deletedAt: null,
      threadId,
      organizationId: actor.organizationId,
    },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json(messages.map(mapCommentMessage));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { threadId } = await params;
  const body = await req.json();
  const thread = await prisma.commentThread.findFirst({
    where: {
      deletedAt: null,
      id: threadId,
      organizationId: actor.organizationId,
    },
    select: { id: true },
  });

  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  const message = await prisma.commentMessage.create({
    data: {
      organizationId: actor.organizationId,
      threadId,
      role: body.role,
      content: body.content,
      model: body.model || null,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
    },
  });

  // Update thread updatedAt
  await prisma.commentThread.update({
    where: { id: threadId },
    data: {
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      revision: {
        increment: 1,
      },
      updatedAt: new Date(),
    },
  });

  return NextResponse.json(mapCommentMessage(message));
}
