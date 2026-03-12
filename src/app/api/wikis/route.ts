import { NextRequest, NextResponse } from 'next/server';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { createWikiWithConversation, listWikis } from '@/lib/wiki/service';

export async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const wikis = await listWikis(actor.organizationId);
  return NextResponse.json({ items: wikis });
}

export async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json().catch(() => ({}));
  const workspace = await createWikiWithConversation(actor, {
    content: body.content,
    conversationTitle: body.conversationTitle,
    title: body.title,
  });

  return NextResponse.json(workspace);
}
