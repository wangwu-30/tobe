import { NextRequest, NextResponse } from 'next/server';

import { ValidationError, defineRoute, isRecord } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { alignWorkspaceVersion } from '@/objects/state';

export const POST = defineRoute(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object.');
  }
  if (typeof body.versionId !== 'string' || !body.versionId.trim()) {
    throw new ValidationError('versionId must be a non-empty string.');
  }

  const version = await alignWorkspaceVersion(actor, {
    versionId: body.versionId,
    workspaceId,
  });

  return NextResponse.json({ schemaVersion: 1, version });
});
