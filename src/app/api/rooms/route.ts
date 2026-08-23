import { NextRequest, NextResponse } from 'next/server';

import { defineRoute } from '@/framework/resilience';

import {
  getRoomActorFromHeaders,
  readRoomEnsureBody,
  readRoomEnsureQuery,
} from './_shared';
import { ensureDefaultRoom, getDefaultRoom } from './_persistence';

export const GET = defineRoute(async function GET(req: NextRequest) {
  const actor = await getRoomActorFromHeaders(req.headers);
  const query = readRoomEnsureQuery(req.nextUrl.searchParams);
  const room = await getDefaultRoom(actor, { projectId: query.projectId });
  if (!room) {
    const { NotFoundError } = await import('@/framework/resilience');
    throw new NotFoundError('Room not found.');
  }

  return NextResponse.json({ schemaVersion: 1, room });
});

export const POST = defineRoute(async function POST(req: NextRequest) {
  const actor = await getRoomActorFromHeaders(req.headers);
  const room = await ensureDefaultRoom(actor, await readRoomEnsureBody(req));

  return NextResponse.json({ schemaVersion: 1, room });
});
