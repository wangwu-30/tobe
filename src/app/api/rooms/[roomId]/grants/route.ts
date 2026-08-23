import { NextRequest, NextResponse } from 'next/server';

import { defineRoute } from '@/framework/resilience';

import {
  getRoomActorFromHeaders,
  readIdempotencyKey,
  readRoomGrantBody,
  readRoomId,
} from '../../_shared';
import {
  ROOM_IDEMPOTENCY_HEADER,
  issueRoomDelegationGrant,
} from '../../_persistence';

type RoomGrantsRouteContext = {
  params: Promise<{ roomId: string }>;
};

export const POST = defineRoute(async function POST(
  req: NextRequest,
  { params }: RoomGrantsRouteContext
) {
  const actor = await getRoomActorFromHeaders(req.headers);
  const { roomId: rawRoomId } = await params;
  const grant = await issueRoomDelegationGrant(
    actor,
    readRoomId(rawRoomId),
    await readRoomGrantBody(req),
    {
      idempotencyKey: readIdempotencyKey(
        req.headers,
        ROOM_IDEMPOTENCY_HEADER
      ),
    }
  );

  return NextResponse.json({ schemaVersion: 1, grant }, { status: 201 });
});
