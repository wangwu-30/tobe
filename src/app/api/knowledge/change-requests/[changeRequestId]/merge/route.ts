import { NextRequest, NextResponse } from 'next/server';

import { ValidationError, defineRoute, isRecord } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { queueKnowledgeMerge } from '@/objects/knowledge';

type RouteContext = { params: Promise<{ changeRequestId: string }> };

export const POST = defineRoute(async function POST(req: NextRequest, { params }: RouteContext) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body) || !Number.isInteger(body.expectedRevision)) {
    throw new ValidationError('expectedRevision must be an integer.');
  }
  if (body.indexVersion !== undefined && typeof body.indexVersion !== 'string') {
    throw new ValidationError('indexVersion must be a string.');
  }
  const { changeRequestId } = await params;
  const operation = await queueKnowledgeMerge(actor, changeRequestId, {
    expectedRevision: body.expectedRevision as number,
    indexVersion: body.indexVersion as string | undefined,
  });
  return NextResponse.json({ operation }, { status: 202 });
});
