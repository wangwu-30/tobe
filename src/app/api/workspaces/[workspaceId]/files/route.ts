import { NextRequest, NextResponse } from 'next/server';

import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  createWorkspaceFile,
  listWorkspaceFiles,
  WorkspaceLockConflictError,
} from '@/lib/workspace/service';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const files = await listWorkspaceFiles({
    organizationId: actor.organizationId,
    workspaceId,
  });

  return NextResponse.json(files);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    const file = await createWorkspaceFile(actor, {
      kind: body.kind,
      name: body.name,
      nodeType: body.nodeType,
      parentId: body.parentId,
      role: body.role,
      workspaceId,
    });

    return NextResponse.json(file);
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
