import { NextRequest, NextResponse } from 'next/server';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { startWorkspacePreview } from '@/lib/platform/run-service';
import { defineRoute } from '@/framework/resilience';


export const POST = defineRoute(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    return NextResponse.json(
      await startWorkspacePreview(actor, {
        versionId: body.versionId || null,
        workspaceId,
      })
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to start workspace preview',
      },
      { status: 400 }
    );
  }
});
