import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { mapCommentMessage } from '@/objects/comment/view';
import { defineRoute } from '@/framework/resilience';


export const PATCH = defineRoute(async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string; messageId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { threadId, messageId } = await params;
  const body = await req.json();

  const existingMessage = await prisma.commentMessage.findFirst({
    where: {
      deletedAt: null,
      id: messageId,
      threadId,
      organizationId: actor.organizationId,
    },
  });

  if (!existingMessage) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }

  const message = await prisma.commentMessage.update({
    where: { id: messageId },
    data: {
      content: body.content,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      revision: {
        increment: 1,
      },
    },
  });

  await prisma.commentThread.update({
    where: { id: threadId },
    data: {
      ...(existingMessage.role === 'user'
        ? {
            resolvedAt: null,
            status: 'open',
          }
        : {}),
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      revision: {
        increment: 1,
      },
      updatedAt: new Date(),
    },
  });

  return NextResponse.json(mapCommentMessage(message));
});

export const DELETE = defineRoute(async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ threadId: string; messageId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(_req.headers);
  const { threadId, messageId } = await params;

  const existingMessage = await prisma.commentMessage.findFirst({
    where: {
      deletedAt: null,
      id: messageId,
      threadId,
      organizationId: actor.organizationId,
    },
  });

  if (!existingMessage) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }

  await prisma.commentMessage.update({
    where: { id: messageId },
    data: {
      deletedAt: new Date(),
      revision: {
        increment: 1,
      },
    },
  });

  const remainingMessages = await prisma.commentMessage.count({
    where: {
      deletedAt: null,
      organizationId: actor.organizationId,
      threadId,
    },
  });

  if (remainingMessages === 0) {
    await prisma.commentThread.update({
      where: { id: threadId },
      data: {
        deletedAt: new Date(),
        revision: {
          increment: 1,
        },
      },
    });

    return NextResponse.json({ deletedThread: true });
  }

  await prisma.commentThread.update({
    where: { id: threadId },
    data: {
      ...(existingMessage.role === 'user'
        ? {
            resolvedAt: null,
            status: 'open',
          }
        : {}),
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      revision: {
        increment: 1,
      },
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({ deletedThread: false });
});
