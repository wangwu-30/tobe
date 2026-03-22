import { NextRequest, NextResponse } from 'next/server';

import { bindDraftThreadsToVersion } from '@/lib/comments/version-binding';
import { materializeWorkspaceMirror } from '@/lib/platform/mirror-manager';
import { listWorkspaceRuns, startWorkspacePreview } from '@/lib/platform/run-service';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { recordSyncEvent } from '@/lib/platform/sync';
import { restoreWorkspaceVersion } from '@/objects/state/commands';
import { mapWorkspaceVersionsWithLabels } from '@/objects/state/queries';
import { WorkspaceLockConflictError } from '@/objects/workspace/commands';
import { ensureWorkspaceEditable } from '@/objects/workspace/commands';
import { defineRoute } from '@/framework/resilience';


export const POST = defineRoute(async function POST(
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
    const restored = await restoreWorkspaceVersion(
      actor,
      {
        versionId,
        workspaceId,
      },
      {
        bindDraftThreadsToVersion,
        ensureWorkspaceEditable,
        listWorkspaceRuns,
        materializeWorkspaceMirror,
        recordSyncEvent,
        startWorkspacePreview,
      }
    );
    const [restoredVersion, safetyCheckpoint] = await mapWorkspaceVersionsWithLabels({
      organizationId: actor.organizationId,
      versions: [restored.restoredVersion, restored.safetyCheckpoint],
    });

    return NextResponse.json({
      restoredVersion,
      restartedPreview: restored.restartedPreview,
      safetyCheckpoint,
    });
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
});
