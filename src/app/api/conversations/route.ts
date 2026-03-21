import { NextRequest, NextResponse } from 'next/server';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { createConversationForWorkspace } from '@/objects/conversation/commands';
import { listConversations } from '@/objects/conversation/queries';
import {
  getConversationWorkspace,
} from '@/lib/workspace/service';

export async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);
  const conversationId = searchParams.get('id');
  const wikiId = searchParams.get('wikiId') || searchParams.get('workspaceId');

  if (conversationId) {
    const workspace = await getConversationWorkspace({
      conversationId,
      organizationId: actor.organizationId,
    });

    if (!workspace) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    return NextResponse.json(workspace);
  }

  const conversations = await listConversations({
    organizationId: actor.organizationId,
    workspaceId: wikiId,
  });

  return NextResponse.json({ items: conversations });
}

export async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json();
  const wikiId = body.wikiId || body.workspaceId;

  if (!wikiId) {
    return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 });
  }

  const conversation = await createConversationForWorkspace(actor, {
    activeFileId: body.activeFileId,
    baseVersionId: body.baseVersionId,
    forkedFromMessageId: body.forkedFromMessageId,
    parentConversationId: body.parentConversationId,
    title: body.title,
    workspaceId: wikiId,
  });

  return NextResponse.json(conversation);
}
