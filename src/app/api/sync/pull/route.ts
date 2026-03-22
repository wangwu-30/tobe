import { NextRequest, NextResponse } from 'next/server';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { pullSyncEvents } from '@/lib/platform/sync';
import { defineRoute } from '@/framework/resilience';


export const GET = defineRoute(async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get('cursor');
  const lastOccurredAt = searchParams.get('lastOccurredAt');
  const backend = searchParams.get('backend')?.trim() || 'local';
  const limit = searchParams.get('limit');
  const result = await pullSyncEvents({
    backend,
    cursor,
    deviceId: actor.deviceId,
    lastOccurredAt,
    limit: limit ? Number(limit) : undefined,
    organizationId: actor.organizationId,
  });

  return NextResponse.json({
    items: result.items,
    nextCursor: result.nextCursor,
    nextOccurredAt: result.nextOccurredAt,
    backend,
  });
});
