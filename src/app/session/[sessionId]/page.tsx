import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getConversationWorkspace } from '@/lib/wiki/service';

export default async function SessionRedirectPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const requestHeaders = await headers();
  const actor = await getPlatformContextFromHeaders(requestHeaders);
  const workspace = await getConversationWorkspace({
    conversationId: sessionId,
    organizationId: actor.organizationId,
  });

  if (!workspace) {
    notFound();
  }

  if (!workspace.conversation) {
    notFound();
  }

  const workspaceId = workspace.workspace?.id || workspace.wiki?.id || workspace.conversation.wikiId;

  if (!workspaceId) {
    redirect('/');
  }

  redirect(`/workspace/${workspaceId}?conversationId=${workspace.conversation.id}`);
}
