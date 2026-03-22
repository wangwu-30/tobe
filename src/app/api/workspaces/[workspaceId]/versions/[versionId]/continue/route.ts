import { NextRequest, NextResponse } from 'next/server';

import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { continueWorkspaceFromVersion } from '@/lib/workspace/service';
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
  const body = await req.json().catch(() => ({}));

  const result = await continueWorkspaceFromVersion(actor, {
    activeFileId: body.activeFileId || null,
    parentConversationId: body.parentConversationId || null,
    safetyCheckpointTitle: body.safetyCheckpointTitle,
    title: body.title,
    versionId,
    workspaceId,
  });

  return NextResponse.json(result);
});
