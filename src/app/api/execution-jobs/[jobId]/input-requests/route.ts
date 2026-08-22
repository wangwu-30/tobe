import { NextRequest, NextResponse } from 'next/server';

import { ValidationError, defineRoute } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  EXECUTION_INPUT_REQUEST_STATUSES_V1,
  listExecutionInputRequests,
} from '@/objects/execution-job';

type RouteContext = { params: Promise<{ jobId: string }> };

export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: RouteContext
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { jobId } = await params;
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || undefined;
  if (
    status !== undefined &&
    !EXECUTION_INPUT_REQUEST_STATUSES_V1.includes(status as never)
  ) {
    throw new ValidationError('Invalid execution input request status.');
  }
  const page = await listExecutionInputRequests(actor, jobId, {
    cursor: searchParams.get('cursor'),
    limit: readLimit(searchParams),
    status: status as 'pending' | 'answered' | 'cancelled' | undefined,
  });
  return NextResponse.json({ schemaVersion: 1, ...page });
});

function readLimit(params: URLSearchParams) {
  const value = params.get('limit');
  if (value === null || value === '') return undefined;
  if (!/^\d+$/.test(value)) {
    throw new ValidationError('limit must be an integer.');
  }
  return Number(value);
}
