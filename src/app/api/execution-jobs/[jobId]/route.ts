import { NextRequest, NextResponse } from 'next/server';

import { NotFoundError, defineRoute } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getExecutionJobDetail } from '@/objects/execution-job';

type ExecutionJobRouteContext = {
  params: Promise<{ jobId: string }>;
};

export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: ExecutionJobRouteContext
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { jobId } = await params;
  const detail = await getExecutionJobDetail(actor, jobId);
  if (!detail) {
    throw new NotFoundError('Execution job not found.');
  }

  return NextResponse.json(detail);
});
