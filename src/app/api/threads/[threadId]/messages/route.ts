import { NextRequest, NextResponse } from 'next/server';
import { getSettingsFromHeaders } from '@/lib/ai/providers';
import {
  parseCommentAgentBindings,
  parseCommentAgentMentions,
  refreshCommentAgentBindings,
  stringifyCommentAgentBindings,
  stringifyCommentAgentMentions,
} from '@/lib/comments/agents';
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
  const settings = getSettingsFromHeaders(req.headers);
  const { threadId } = await params;
  const body = await req.json();
  const thread = await prisma.commentThread.findFirst({
    where: {
      deletedAt: null,
      id: threadId,
      organizationId: actor.organizationId,
    },
    select: { id: true, agentBindingsJson: true },
  });

  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  const mentions =
    body.role === 'user' && typeof body.content === 'string'
      ? parseCommentAgentMentions(body.content, settings.commentAgents || [])
      : [];
  const nextBindings =
    body.role === 'user' && mentions.length > 0
      ? refreshCommentAgentBindings({
          bindings: parseCommentAgentBindings(thread.agentBindingsJson),
          mentions,
        })
      : parseCommentAgentBindings(thread.agentBindingsJson);
  const message = await prisma.commentMessage.create({
    data: {
      organizationId: actor.organizationId,
      threadId,
      role: body.role,
      content: body.content,
      model: body.model || null,
      mentionedAgentsJson:
        mentions.length > 0 ? stringifyCommentAgentMentions(mentions) : null,
      agentId: typeof body.agentId === 'string' ? body.agentId : null,
      agentLabel: typeof body.agentLabel === 'string' ? body.agentLabel : null,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
    },
  });

  // Update thread updatedAt
  await prisma.commentThread.update({
    where: { id: threadId },
    data: {
      ...(body.role === 'user'
        ? {
            resolvedAt: null,
            status: 'open',
          }
        : {}),
      ...(body.role === 'user'
        ? {
            agentBindingsJson:
              nextBindings.length > 0
                ? stringifyCommentAgentBindings(nextBindings)
                : null,
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
}
