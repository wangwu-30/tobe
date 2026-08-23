import { NextRequest, NextResponse } from 'next/server';

import { NotFoundError, defineRoute } from '@/framework/resilience';

import { getRoomActorFromHeaders, readRoomId } from '../_shared';
import { getRoom } from '../_persistence';

type RoomRouteContext = {
  params: Promise<{ roomId: string }>;
};

export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: RoomRouteContext
) {
  const actor = await getRoomActorFromHeaders(req.headers);
  const { roomId: rawRoomId } = await params;
  const room = await getRoom(actor, readRoomId(rawRoomId));
  if (!room) {
    throw new NotFoundError('Room not found.');
  }

  return NextResponse.json({ schemaVersion: 1, room });
});
