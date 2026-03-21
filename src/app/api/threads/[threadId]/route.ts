import { NextRequest, NextResponse } from 'next/server';
import { isCommentThreadStatus } from '@/lib/comments/status';
import {
  parseCommentAgentBindings,
} from '@/lib/comments/agents';
import { buildStopCommentAgentControlMessage } from '@/derive/agent-watching';
import { prisma } from '@/lib/db/prisma';
import { getBoundVersionIdForWiki } from '@/lib/comments/version-binding';
import { stopCommentAgentListeningState } from '@/objects/comment/agent-bindings';
import { mapCommentThread } from '@/objects/comment/view';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';

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

    const existingBindings = parseCommentAgentBindings(existingThread.agentBindingsJson);
    const stoppedBinding =
      existingBindings.find((binding) => binding.agentId === body.agentId) || null;
    const nextBindings = stopCommentAgentListeningState({
      agentId: body.agentId,
      bindingsJson: existingThread.agentBindingsJson,
    });

    const thread = await prisma.$transaction(async (tx) => {
      if (stoppedBinding) {
        await tx.commentMessage.create({
          data: {
            organizationId: actor.organizationId,
            threadId,
            ...buildStopCommentAgentControlMessage({
              agentId: stoppedBinding.agentId,
              agentLabel: stoppedBinding.agentLabel,
              handle: stoppedBinding.handle,
            }),
            createdByUserId: actor.userId,
            originDeviceId: actor.deviceId,
          },
        });
      }

      return tx.commentThread.update({
        where: { id: threadId },
        data: {
          agentBindingsJson: nextBindings.bindingsJson,
          createdByUserId: actor.userId,
          originDeviceId: actor.deviceId,
          revision: {
            increment: 1,
          },
        },
        include: {
          messages: { orderBy: { createdAt: 'asc' } },
          version: {
            include: {
              labels: {
                where: { deletedAt: null },
              },
            },
          },
        },
      });
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
      version: {
        include: {
          labels: {
            where: { deletedAt: null },
          },
        },
      },
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
