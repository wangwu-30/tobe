import { NextRequest, NextResponse } from 'next/server';

import { defineRoute } from '@/framework/resilience';

import {
  getRoomActorFromHeaders,
  readIdempotencyKey,
  readRoomId,
} from '../../../../_shared';
import {
  ROOM_IDEMPOTENCY_HEADER,
  revokeRoomDelegationGrant,
} from '../../../../_persistence';

type RoomGrantRouteContext = {
  params: Promise<{ roomId: string; grantId: string }>;
};

export const POST = defineRoute(async function POST(
  req: NextRequest,
  { params }: RoomGrantRouteContext
) {
  const actor = await getRoomActorFromHeaders(req.headers);
  const { roomId: rawRoomId, grantId: rawGrantId } = await params;
  const grant = await revokeRoomDelegationGrant(
    actor,
    readRoomId(rawRoomId),
    readRoomId(rawGrantId, 'grantId'),
    {
      idempotencyKey: readIdempotencyKey(
        req.headers,
        ROOM_IDEMPOTENCY_HEADER
      ),
    }
  );

  return NextResponse.json({ schemaVersion: 1, grant });
});
