import { NextRequest, NextResponse } from 'next/server';

import { defineRoute, ValidationError } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { proposeKnowledgeToWikiChangeSet } from '@/lib/workspace/knowledge-to-wiki-bridge';

export const POST = defineRoute(async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    throw new ValidationError('JSON request body is required.');
  }

  const result = await proposeKnowledgeToWikiChangeSet(actor, {
    documentPath: typeof body.documentPath === 'string' ? body.documentPath : '',
    fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
    spaceId: typeof body.spaceId === 'string' ? body.spaceId : '',
    summary: typeof body.summary === 'string' ? body.summary : undefined,
    targetFileId: typeof body.targetFileId === 'string' ? body.targetFileId : null,
    title: typeof body.title === 'string' ? body.title : undefined,
    workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : '',
  });

  return NextResponse.json(result, { status: 201 });
});
