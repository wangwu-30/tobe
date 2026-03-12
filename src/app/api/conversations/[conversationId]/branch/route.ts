import { NextRequest, NextResponse } from 'next/server';

import { branchConversation } from '@/lib/wiki/service';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { conversationId } = await params;
  const body = await req.json().catch(() => ({}));

  if (!body.messageId) {
    return NextResponse.json({ error: 'Missing messageId' }, { status: 400 });
  }

  const result = await branchConversation(actor, {
    conversationId,
    messageId: body.messageId,
    title: body.title,
  });

  return NextResponse.json(result);
}
