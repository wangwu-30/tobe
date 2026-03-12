import { NextRequest, NextResponse } from 'next/server';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { createWikiWithConversation } from '@/lib/wiki/service';

export async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { sessionId, title, content } = await req.json().catch(() => ({}));

  if (sessionId) {
    const workspace = await createWikiWithConversation(actor, {
      content,
      conversationTitle: title,
      title,
    });

    return NextResponse.json(workspace.wiki);
  }

  const workspace = await createWikiWithConversation(actor, {
    content,
    conversationTitle: title,
    title,
  });

  return NextResponse.json(workspace.wiki);
}
