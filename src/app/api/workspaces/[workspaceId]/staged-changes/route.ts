import { NextRequest, NextResponse } from 'next/server';

import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { listStagedChangeSets } from '@/lib/workspace/planning';
import { ForbiddenError } from '@/framework/resilience';
import { defineRoute } from '@/framework/resilience';


export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const items = await listStagedChangeSets({
    organizationId: actor.organizationId,
    workspaceId,
  });

  return NextResponse.json(items);
});

export const POST = defineRoute(async function POST(
  _req: NextRequest,
  _context: { params: Promise<{ workspaceId: string }> }
) {
  throw new ForbiddenError(
    'Document proposals may be created only through the governed Agent proposal tool.'
  );
});
