import { NextRequest, NextResponse } from 'next/server';

import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { branchConversation } from '@/objects/conversation/commands';
import { defineRoute } from '@/framework/resilience';


export const POST = defineRoute(async function POST(
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
});
