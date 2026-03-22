import { NextRequest, NextResponse } from 'next/server';

import { bindDraftThreadsToVersion } from '@/lib/comments/version-binding';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { recordSyncEvent } from '@/lib/platform/sync';
import {
  createWorkspaceVersion as createWorkspaceVersionCommand,
} from '@/objects/state/commands';
import {
  listWorkspaceVersions,
  mapWorkspaceVersionWithLabels,
} from '@/objects/state/queries';
import { WorkspaceLockConflictError } from '@/objects/workspace/commands';
import { ensureWorkspaceEditable } from '@/objects/workspace/commands';
import { defineRoute } from '@/framework/resilience';


export const GET = defineRoute(async function GET(
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
    scope === 'all' ? versions : versions.filter((version) => version.visible)
  );
});

export const POST = defineRoute(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    const version = await createWorkspaceVersionCommand(
      actor,
      {
        sourceConversationId: body.sourceConversationId || null,
        sourceMessageId: body.sourceMessageId || null,
        title: body.title,
        workspaceId,
      },
      {
        bindDraftThreadsToVersion,
        ensureWorkspaceEditable,
        recordSyncEvent,
      }
    );

    return NextResponse.json(
      await mapWorkspaceVersionWithLabels({
        organizationId: actor.organizationId,
        version,
      })
    );
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
