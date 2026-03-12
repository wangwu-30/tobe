import { NextRequest, NextResponse } from 'next/server';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getPlatformStatus } from '@/lib/platform/runtime';

export async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const status = await getPlatformStatus(actor);
  return NextResponse.json(status);
}
