import { NextRequest, NextResponse } from 'next/server';

import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { listProjects } from '@/lib/workspace/service';

export async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const projects = await listProjects(actor.organizationId);
  return NextResponse.json({ items: projects });
}
