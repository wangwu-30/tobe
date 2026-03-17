import { NextRequest, NextResponse } from 'next/server';
import { isCommentThreadStatus } from '@/lib/comments/status';
import {
  parseCommentAgentBindings,
  stopCommentAgentListening,
  stringifyCommentAgentBindings,
} from '@/lib/comments/agents';
import { prisma } from '@/lib/db/prisma';
import { getBoundVersionIdForWiki } from '@/lib/comments/version-binding';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { mapCommentThread } from '@/lib/wiki/service';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { threadId } = await params;
  const body = await req.json();
  const nextStatus = body.status;

  const existingThread = await prisma.commentThread.findUnique({
    where: { id: threadId },
    select: {
      agentBindingsJson: true,
      id: true,
      documentId: true,
      organizationId: true,
      versionId: true,
      status: true,
    },
  });

  if (!existingThread || existingThread.organizationId !== actor.organizationId) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  if (nextStatus !== undefined && !isCommentThreadStatus(nextStatus)) {
    return NextResponse.json({ error: 'Invalid thread status' }, { status: 400 });
  }
  if (
    body.action !== undefined &&
    body.action !== 'stop_agent_listening'
  ) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  if (body.action === 'stop_agent_listening') {
    if (typeof body.agentId !== 'string' || !body.agentId.trim()) {
      return NextResponse.json({ error: 'Missing agentId' }, { status: 400 });
    }

    const nextBindings = stopCommentAgentListening({
      agentId: body.agentId,
      bindings: parseCommentAgentBindings(existingThread.agentBindingsJson),
    });

    const thread = await prisma.commentThread.update({
      where: { id: threadId },
      data: {
        agentBindingsJson:
          nextBindings.length > 0 ? stringifyCommentAgentBindings(nextBindings) : null,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
        revision: {
          increment: 1,
        },
      },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        version: true,
      },
    });

    return NextResponse.json({
      action: {
        agentId: body.agentId,
        type: 'stop_agent_listening',
      },
      thread: mapCommentThread(thread),
    });
  }

  let versionId = existingThread.versionId;
  if (nextStatus === 'resolved' && !versionId) {
    versionId = await getBoundVersionIdForWiki(existingThread.documentId);
  }

  const thread = await prisma.commentThread.update({
    where: { id: threadId },
    data: {
      ...(nextStatus !== undefined && { status: nextStatus }),
      ...(nextStatus === 'resolved' && { resolvedAt: new Date() }),
      ...((nextStatus === 'open' || nextStatus === 'applied') && {
        resolvedAt: null,
      }),
      ...(versionId !== existingThread.versionId && { versionId }),
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      revision: {
        increment: 1,
      },
    },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      version: true,
    },
  });

  return NextResponse.json({
    action: {
      boundVersionId: thread.versionId,
      boundVersionTitle: thread.version?.title || null,
      previousStatus: existingThread.status,
      status: thread.status,
      versionLinked: Boolean(thread.versionId && thread.versionId !== existingThread.versionId),
    },
    thread: mapCommentThread(thread),
  });
}
