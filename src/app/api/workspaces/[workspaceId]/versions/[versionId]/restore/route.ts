import { NextRequest, NextResponse } from 'next/server';

import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  restoreWorkspaceSnapshot,
  WorkspaceLockConflictError,
} from '@/lib/workspace/service';

export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ versionId: string; workspaceId: string }>;
  }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { versionId, workspaceId } = await params;

  try {
    const restored = await restoreWorkspaceSnapshot(actor, {
      snapshotId: versionId,
      workspaceId,
    });

    return NextResponse.json(restored);
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
