import { NextRequest, NextResponse } from 'next/server';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { stopWorkspacePreview } from '@/lib/platform/run-service';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;

  return NextResponse.json(
    await stopWorkspacePreview(actor.organizationId, workspaceId)
  );
}
