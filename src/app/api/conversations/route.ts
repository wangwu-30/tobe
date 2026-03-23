import { NextRequest, NextResponse } from 'next/server';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { createConversationForWorkspace } from '@/objects/conversation/commands';
import {
  listConversations,
  resolveConversationProjectScope,
} from '@/objects/conversation/queries';
import {
  getConversationWorkspace,
} from '@/lib/workspace/service';
import { defineRoute } from '@/framework/resilience';


export const GET = defineRoute(async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);
  const conversationId = searchParams.get('id');
  const scopeId =
    searchParams.get('projectId') ||
    searchParams.get('wikiId') ||
    searchParams.get('workspaceId');

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

  const projectScope = await resolveConversationProjectScope({
    organizationId: actor.organizationId,
    scopeId,
  });
  const conversations = await listConversations({
    organizationId: actor.organizationId,
    projectId: projectScope.projectId,
    projectNodeIds: projectScope.nodeIds,
    workspaceId: scopeId,
  });

  return NextResponse.json({ items: conversations });
});

export const POST = defineRoute(async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json();
  const focusNodeId = body.focusNodeId || body.workspaceId || body.wikiId;

  if (!focusNodeId) {
    return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 });
  }

  const conversation = await createConversationForWorkspace(actor, {
    activeFileId: body.activeFileId,
    baseVersionId: body.baseVersionId,
    forkedFromMessageId: body.forkedFromMessageId,
    parentConversationId: body.parentConversationId,
    title: body.title,
    workspaceId: focusNodeId,
  });

  return NextResponse.json(conversation);
});
