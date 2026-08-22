import { NextRequest, NextResponse } from 'next/server';

import { ValidationError, defineRoute, isRecord } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { rejectRoomToolConfirmation } from '@/objects/room-tool-confirmation';

type RouteContext = { params: Promise<{ requestId: string }> };

export const POST = defineRoute(async function POST(req: NextRequest, { params }: RouteContext) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { requestId } = await params;
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body) || body.schemaVersion !== 1 || !Number.isSafeInteger(body.expectedRevision) || Object.keys(body).some((key) => key !== 'schemaVersion' && key !== 'expectedRevision')) {
    throw new ValidationError('Body must contain schemaVersion 1 and a positive expectedRevision only.');
  }
  const result = await rejectRoomToolConfirmation(actor, requestId, {
    expectedRevision: body.expectedRevision as number,
  });
  return NextResponse.json(result);
});
