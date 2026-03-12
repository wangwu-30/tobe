import { NextRequest, NextResponse } from 'next/server';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getWorkspaceRun } from '@/lib/platform/run-service';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { runId, workspaceId } = await params;

  const run = await getWorkspaceRun({
    organizationId: actor.organizationId,
    runId,
    workspaceId,
  });

  if (!run) {
    return NextResponse.json({ error: 'Workspace run not found' }, { status: 404 });
  }

  return NextResponse.json(run);
}
