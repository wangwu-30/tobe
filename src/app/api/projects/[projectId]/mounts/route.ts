import { NextRequest, NextResponse } from 'next/server';

import {
  ValidationError,
  defineRoute,
} from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  createProjectMount,
  listProjectMounts,
} from '@/objects/project-mount';

export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { projectId } = await params;

  const mounts = await listProjectMounts({
    organizationId: actor.organizationId,
    sourceProjectId: projectId,
  });

  return NextResponse.json(mounts);
});

export const POST = defineRoute(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { projectId } = await params;
  const body = await req.json().catch(() => ({}));
  const targetProjectId =
    typeof body.targetProjectId === 'string' && body.targetProjectId.trim().length > 0
      ? body.targetProjectId.trim()
      : null;

  if (!targetProjectId) {
    throw new ValidationError('Target project id is required.');
  }

  const mount = await createProjectMount({
    organizationId: actor.organizationId,
    sourceProjectId: projectId,
    targetProjectId,
  });

  return NextResponse.json(mount, { status: 201 });
});
