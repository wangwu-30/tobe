import { NextRequest, NextResponse } from 'next/server';

import { defineRoute } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { listExecutionRuntimesV1 } from '@/objects/execution-runtime';

export const GET = defineRoute(async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const runtimes = await listExecutionRuntimesV1(actor);

  return NextResponse.json({ schemaVersion: 1, runtimes });
});
