import { NextRequest, NextResponse } from 'next/server';

import { defineRoute } from '@/framework/resilience';
import { createRoomEventSseResponse } from '@/lib/room/sse';

import {
  getRoomActorFromHeaders,
  readRoomId,
  readRoomListOptions,
  wantsRoomEventStream,
} from '../../_shared';
import { listRoomEvents } from '../../_persistence';

type RoomEventsRouteContext = {
  params: Promise<{ roomId: string }>;
};

export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: RoomEventsRouteContext
) {
  const actor = await getRoomActorFromHeaders(req.headers);
  const { roomId: rawRoomId } = await params;
  const roomId = readRoomId(rawRoomId);
  const eventStream = wantsRoomEventStream(req, req.nextUrl.searchParams);
  const options = readRoomListOptions(req.nextUrl.searchParams, {
    lastEventId: eventStream ? req.headers.get('last-event-id') : null,
  });
  const events = await listRoomEvents(actor, roomId, options);

  if (!eventStream) {
    return NextResponse.json({ schemaVersion: 1, events });
  }

  return createRoomEventSseResponse({
    after: options.after,
    initialEvents: events,
    loadEvents: (after, _signal) =>
      listRoomEvents(actor, roomId, { after, limit: options.limit }),
    pageSize: options.limit,
    signal: req.signal,
  });
});
