import { NextRequest, NextResponse } from 'next/server';

import { defineRoute } from '@/framework/resilience';

import {
  getRoomActorFromHeaders,
  readIdempotencyKey,
  readRoomId,
  readRoomListOptions,
  readRoomMessageBody,
} from '../../_shared';
import {
  ROOM_IDEMPOTENCY_HEADER,
  listRoomMessages,
  postRoomMessage,
} from '../../_persistence';

type RoomMessagesRouteContext = {
  params: Promise<{ roomId: string }>;
};

export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: RoomMessagesRouteContext
) {
  const actor = await getRoomActorFromHeaders(req.headers);
  const { roomId: rawRoomId } = await params;
  const roomId = readRoomId(rawRoomId);
  const messages = await listRoomMessages(
    actor,
    roomId,
    readRoomListOptions(req.nextUrl.searchParams)
  );

  return NextResponse.json({ schemaVersion: 1, messages });
});

export const POST = defineRoute(async function POST(
  req: NextRequest,
  { params }: RoomMessagesRouteContext
) {
  const actor = await getRoomActorFromHeaders(req.headers);
  const { roomId: rawRoomId } = await params;
  const receipt = await postRoomMessage(
    actor,
    readRoomId(rawRoomId),
    await readRoomMessageBody(req),
    {
      idempotencyKey: readIdempotencyKey(
        req.headers,
        ROOM_IDEMPOTENCY_HEADER
      ),
    }
  );

  return NextResponse.json(
    { schemaVersion: 1, receipt },
    { status: 202 }
  );
});
