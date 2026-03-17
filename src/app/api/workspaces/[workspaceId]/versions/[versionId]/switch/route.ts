import { NextRequest, NextResponse } from 'next/server';

import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { switchWorkspaceToVersionBranch } from '@/lib/workspace/service';

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
  const body = await req.json().catch(() => ({}));

  const result = await switchWorkspaceToVersionBranch(actor, {
    activeFileId: body.activeFileId || null,
    parentConversationId: body.parentConversationId || null,
    safetyCheckpointTitle: body.safetyCheckpointTitle,
    title: body.title,
    versionId,
    workspaceId,
  });

  return NextResponse.json(result);
}
