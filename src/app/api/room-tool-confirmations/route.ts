import { NextRequest, NextResponse } from 'next/server';

import { ValidationError, defineRoute } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  isRoomToolConfirmationStatusV1,
  listRoomToolConfirmations,
} from '@/objects/room-tool-confirmation';

export const GET = defineRoute(async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const roomId = req.nextUrl.searchParams.get('roomId')?.trim();
  const status = req.nextUrl.searchParams.get('status');
  if (!roomId) throw new ValidationError('roomId is required.');
  if (status !== null && !isRoomToolConfirmationStatusV1(status)) {
    throw new ValidationError('status is invalid.');
  }
  const items = await listRoomToolConfirmations(actor, {
    roomId,
    ...(status ? { status } : {}),
  });
  return NextResponse.json({ schemaVersion: 1, items });
});
