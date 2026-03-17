import { NextRequest, NextResponse } from 'next/server';

import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { isVisibleVersion } from '@/lib/workspace/planning';
import {
  createWorkspaceVersion,
  listWorkspaceVersions,
  WorkspaceLockConflictError,
} from '@/lib/workspace/service';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const scope = new URL(req.url).searchParams.get('scope');
  const versions = await listWorkspaceVersions({
    organizationId: actor.organizationId,
    workspaceId,
  });

  return NextResponse.json(
    scope === 'all' ? versions : versions.filter(isVisibleVersion)
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    const version = await createWorkspaceVersion(actor, {
      sourceConversationId: body.sourceConversationId || null,
      sourceMessageId: body.sourceMessageId || null,
      title: body.title,
      versionType: 'manual',
      workspaceId,
    });

    return NextResponse.json(version);
  } catch (error) {
    if (error instanceof WorkspaceLockConflictError) {
      return NextResponse.json(
        {
          error: error.message,
          lock: error.detail,
        },
        { status: 423 }
      );
    }

    throw error;
  }
}
