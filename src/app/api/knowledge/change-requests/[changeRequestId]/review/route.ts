import { NextRequest, NextResponse } from 'next/server';

import { ValidationError, defineRoute, isRecord } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { approveKnowledgeChangeRequest, rejectKnowledgeChangeRequest } from '@/objects/knowledge';

type RouteContext = { params: Promise<{ changeRequestId: string }> };

export const POST = defineRoute(async function POST(req: NextRequest, { params }: RouteContext) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) throw new ValidationError('Request body must be an object.');
  if (body.action !== 'approve' && body.action !== 'reject') {
    throw new ValidationError('action must be approve or reject.');
  }
  if (!Number.isInteger(body.expectedRevision)) {
    throw new ValidationError('expectedRevision must be an integer.');
  }
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
    throw new ValidationError('note must be a string or null.');
  }
  const { changeRequestId } = await params;
  const command = body.action === 'approve'
    ? approveKnowledgeChangeRequest
    : rejectKnowledgeChangeRequest;
  const changeRequest = await command(actor, changeRequestId, {
    expectedRevision: body.expectedRevision as number,
    note: body.note as string | null | undefined,
  });
  return NextResponse.json({ changeRequest });
});
