import { NextRequest, NextResponse } from 'next/server';

import { NotFoundError, defineRoute } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getExecutionArtifact } from '@/objects/execution-job';

type RouteContext = {
  params: Promise<{ artifactId: string; jobId: string }>;
};

export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: RouteContext
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { artifactId, jobId } = await params;
  const result = await getExecutionArtifact(actor, jobId, artifactId);
  if (!result) throw new NotFoundError('Execution artifact not found.');
  return NextResponse.json(result);
});
