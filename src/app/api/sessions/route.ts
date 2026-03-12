import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  createWikiWithConversation,
  getConversationWorkspace,
  listConversations,
} from '@/lib/wiki/service';

export async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (id) {
    const workspace = await getConversationWorkspace({
      conversationId: id,
      organizationId: actor.organizationId,
    });

    if (!workspace) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (!workspace.conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    return NextResponse.json({
      ...workspace.conversation,
      messages: workspace.conversation.messages,
      documents: workspace.wiki ? [workspace.wiki] : [],
      wikiId: workspace.wiki?.id || workspace.conversation.wikiId,
    });
  }

  const conversations = await listConversations({
    organizationId: actor.organizationId,
  });

  return NextResponse.json(
    conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages || [],
      documents: [],
      wikiId: conversation.wikiId,
    }))
  );
}

export async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json().catch(() => ({}));
  const workspace = await createWikiWithConversation(actor, {
    content: body.content,
    conversationTitle: body.title,
    title: body.wikiTitle || body.title,
  });

  return NextResponse.json({
    ...workspace.conversation,
    documents: [workspace.wiki],
    messages: [],
    wikiId: workspace.wiki.id,
  });
}

export async function DELETE(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const conversation = await prisma.session.findFirst({
    where: {
      deletedAt: null,
      id,
      organizationId: actor.organizationId,
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await prisma.session.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      revision: {
        increment: 1,
      },
    },
  });

  return NextResponse.json({ ok: true });
}
