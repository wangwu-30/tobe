import { NextRequest, NextResponse } from 'next/server';

import { ValidationError, defineRoute } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { listExecutionArtifacts } from '@/objects/execution-job';

type RouteContext = { params: Promise<{ jobId: string }> };

export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: RouteContext
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { jobId } = await params;
  const { searchParams } = new URL(req.url);
  const page = await listExecutionArtifacts(actor, jobId, {
    attemptId: searchParams.get('attemptId'),
    cursor: searchParams.get('cursor'),
    limit: readLimit(searchParams),
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
