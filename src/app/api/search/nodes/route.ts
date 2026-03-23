import { NextRequest, NextResponse } from 'next/server';

import { ValidationError, defineRoute } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { searchProjectNodes } from '@/lib/workspace/node';

export const GET = defineRoute(async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const projectId = req.nextUrl.searchParams.get('projectId')?.trim() || '';
  const query = req.nextUrl.searchParams.get('q')?.trim() || '';
  const currentNodeId = req.nextUrl.searchParams.get('currentNodeId')?.trim() || null;
  const limitParam = Number.parseInt(req.nextUrl.searchParams.get('limit') || '', 10);

  if (!projectId) {
    throw new ValidationError('Project id is required.');
  }

  if (!query) {
    return NextResponse.json([]);
  }

  const results = await searchProjectNodes({
    currentNodeId,
    limit: Number.isFinite(limitParam) ? limitParam : undefined,
    organizationId: actor.organizationId,
    projectId,
    query,
  });

  return NextResponse.json(results);
});
