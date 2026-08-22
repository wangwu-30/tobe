import { NextRequest, NextResponse } from 'next/server';

import { ValidationError, defineRoute } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { listExecutionEvents } from '@/objects/execution-job';

type RouteContext = { params: Promise<{ jobId: string }> };

export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: RouteContext
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { jobId } = await params;
  const { searchParams } = new URL(req.url);
  const page = await listExecutionEvents(actor, jobId, {
    afterSequence: readInteger(searchParams, 'afterSequence'),
    attemptId: searchParams.get('attemptId'),
    limit: readInteger(searchParams, 'limit'),
  });
  return NextResponse.json({ schemaVersion: 1, ...page });
});

function readInteger(params: URLSearchParams, field: string) {
  const value = params.get(field);
  if (value === null || value === '') return undefined;
  if (!/^\d+$/.test(value)) {
    throw new ValidationError(`${field} must be an integer.`);
  }
  return Number(value);
}
