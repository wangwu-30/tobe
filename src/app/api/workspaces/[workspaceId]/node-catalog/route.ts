import { NextRequest, NextResponse } from 'next/server';
import { defineRoute } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getProjectNodeCatalog } from '@/lib/workspace/node';

export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const url = new URL(req.url);
  const currentNodeId = url.searchParams.get('currentNodeId');

  const catalog = await getProjectNodeCatalog({
    currentNodeId,
    organizationId: actor.organizationId,
    projectId: workspaceId,
  });

  if (!catalog) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  return NextResponse.json(catalog);
});
