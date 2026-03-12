import { NextRequest, NextResponse } from 'next/server';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { acceptSyncEvents } from '@/lib/platform/sync';

export async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json().catch(() => ({}));
  const events = Array.isArray(body.events) ? body.events : [];
  const backend =
    typeof body.backend === 'string' && body.backend.trim()
      ? body.backend.trim()
      : 'local';
  const accepted = await acceptSyncEvents({
    backend,
    deviceId: actor.deviceId,
    events,
    organizationId: actor.organizationId,
    userId: actor.userId,
  });

  return NextResponse.json({
    accepted,
    backend,
  });
}
