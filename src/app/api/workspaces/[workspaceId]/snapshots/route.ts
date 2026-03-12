import { NextRequest, NextResponse } from 'next/server';

import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  createWorkspaceSnapshot,
  listWorkspaceSnapshots,
  WorkspaceLockConflictError,
} from '@/lib/workspace/service';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const snapshots = await listWorkspaceSnapshots({
    organizationId: actor.organizationId,
    workspaceId,
  });

  return NextResponse.json(snapshots);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    const snapshot = await createWorkspaceSnapshot(actor, {
      snapshotType: body.snapshotType,
      sourceConversationId: body.sourceConversationId,
      sourceMessageId: body.sourceMessageId,
      title: body.title,
      workspaceId,
    });

    return NextResponse.json(snapshot);
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
