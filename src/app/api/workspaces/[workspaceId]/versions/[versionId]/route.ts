import { NextRequest, NextResponse } from 'next/server';

import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  setWorkspaceVersionPinned,
  WorkspaceLockConflictError,
  WorkspaceRecoveryPinLimitError,
} from '@/lib/workspace/service';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ versionId: string; workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { versionId, workspaceId } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    const version = await setWorkspaceVersionPinned(actor, {
      pinned: Boolean(body.pinned),
      versionId,
      workspaceId,
    });

    return NextResponse.json(version);
  } catch (error) {
    if (error instanceof WorkspaceRecoveryPinLimitError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

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
