import { NextRequest, NextResponse } from 'next/server';

import { ValidationError, defineRoute, isRecord } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { cancelExecutionJob } from '@/objects/execution-job';

type ExecutionJobCancelRouteContext = {
  params: Promise<{ jobId: string }>;
};

export const POST = defineRoute(async function POST(
  req: NextRequest,
  { params }: ExecutionJobCancelRouteContext
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { jobId } = await params;
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object.');
  }
  if (typeof body.expectedRevision !== 'number') {
    throw new ValidationError('expectedRevision must be a number.');
  }

  const job = await cancelExecutionJob(actor, jobId, {
    expectedRevision: body.expectedRevision,
  });

  return NextResponse.json({ schemaVersion: 1, job });
});
