import { NextRequest, NextResponse } from 'next/server';

import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  createStagedChangeSet,
  listStagedChangeSets,
} from '@/lib/workspace/planning';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const items = await listStagedChangeSets({
    organizationId: actor.organizationId,
    workspaceId,
  });

  return NextResponse.json(items);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const body = await req.json().catch(() => ({}));

  const changeSet = await createStagedChangeSet(actor, {
    baseVersionId: body.baseVersionId || null,
    changes: Array.isArray(body.changes) ? body.changes : [],
    conversationId: body.conversationId || null,
    sourceType: body.sourceType,
    summary: body.summary || 'Prepared staged changes',
    title: body.title || 'Staged changes',
    workspaceId,
  });

  return NextResponse.json(changeSet);
}
