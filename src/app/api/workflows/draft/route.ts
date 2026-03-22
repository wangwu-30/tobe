import { NextRequest, NextResponse } from 'next/server';

import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { buildWorkflowPlaybookDraft } from '@/lib/workflows/service';
import { defineRoute } from '@/framework/resilience';


export const POST = defineRoute(async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json().catch(() => ({}));
  const workspaceId =
    typeof body.workspaceId === 'string'
      ? body.workspaceId
      : typeof body.wikiId === 'string'
        ? body.wikiId
        : null;

  if (!workspaceId) {
    return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 });
  }

  try {
    const draft = await buildWorkflowPlaybookDraft({
      organizationId: actor.organizationId,
      workspaceId,
    });
    return NextResponse.json(draft);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not build workflow draft.' },
      { status: 400 }
    );
  }
});
