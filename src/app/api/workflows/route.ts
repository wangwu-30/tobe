import { NextRequest, NextResponse } from 'next/server';

import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  createWorkflowPlaybook,
  deleteWorkflowPlaybook,
  listWorkflowPlaybooks,
  updateWorkflowPlaybook,
} from '@/lib/workflows/service';

function resolveWorkspaceId(searchParams: URLSearchParams) {
  return (
    searchParams.get('workspaceId') ||
    searchParams.get('wikiId') ||
    searchParams.get('documentId')
  );
}

function readStructuredList(value: unknown) {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }

  return undefined;
}

function readWorkflowStatus(value: unknown) {
  if (value === 'draft' || value === 'active' || value === 'archived') {
    return value;
  }

  return undefined;
}

export async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);

  const items = await listWorkflowPlaybooks({
    includeArchived: searchParams.get('includeArchived') === '1',
    organizationId: actor.organizationId,
    workspaceId: resolveWorkspaceId(searchParams),
  });

  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json().catch(() => ({}));

  if (typeof body.title !== 'string' || !body.title.trim()) {
    return NextResponse.json({ error: 'Missing title' }, { status: 400 });
  }

  try {
    const item = await createWorkflowPlaybook(actor, {
      checklist: readStructuredList(body.checklist),
      content: typeof body.content === 'string' ? body.content : null,
      constraints: readStructuredList(body.constraints),
      forceActivate: body.forceActivate === true,
      sourceThreadId:
        typeof body.sourceThreadId === 'string' ? body.sourceThreadId : null,
      sourceVersionId:
        typeof body.sourceVersionId === 'string' ? body.sourceVersionId : null,
      status: readWorkflowStatus(body.status),
      steps: readStructuredList(body.steps),
      summary: typeof body.summary === 'string' ? body.summary : null,
      title: body.title,
      workspaceId:
        typeof body.workspaceId === 'string'
          ? body.workspaceId
          : typeof body.wikiId === 'string'
            ? body.wikiId
            : typeof body.documentId === 'string'
              ? body.documentId
              : null,
    });

    return NextResponse.json(item);
  } catch (error) {
    const workflowError = error as Error & { warnings?: string[] };
    if (workflowError?.warnings?.length) {
      return NextResponse.json(
        {
          error: workflowError.message,
          warnings: workflowError.warnings,
        },
        { status: 409 }
      );
    }

    throw error;
  }
}

export async function PATCH(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json().catch(() => ({}));

  if (typeof body.id !== 'string' || !body.id.trim()) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  try {
    const item = await updateWorkflowPlaybook(actor, {
      checklist: readStructuredList(body.checklist),
      content:
        body.content === null || typeof body.content === 'string' ? body.content : undefined,
      constraints: readStructuredList(body.constraints),
      forceActivate: body.forceActivate === true,
      id: body.id.trim(),
      status:
        body.status === null ? null : readWorkflowStatus(body.status),
      steps: readStructuredList(body.steps),
      summary:
        body.summary === null || typeof body.summary === 'string' ? body.summary : undefined,
      title: body.title === null || typeof body.title === 'string' ? body.title : undefined,
    });

    return NextResponse.json(item);
  } catch (error) {
    const workflowError = error as Error & { warnings?: string[] };
    if (workflowError?.warnings?.length) {
      return NextResponse.json(
        {
          error: workflowError.message,
          warnings: workflowError.warnings,
        },
        { status: 409 }
      );
    }

    throw error;
  }
}

export async function DELETE(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  await deleteWorkflowPlaybook(actor, id);
  return NextResponse.json({ ok: true });
}
