import { NextRequest, NextResponse } from 'next/server';

import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  deleteWorkspaceFile,
  updateWorkspaceFile,
} from '@/objects/file/commands';
import { WorkspaceLockConflictError } from '@/objects/workspace/commands';
import { defineRoute } from '@/framework/resilience';


export const PATCH = defineRoute(async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string; workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { fileId, workspaceId } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    const file = await updateWorkspaceFile(actor, {
      content: body.content,
      fileId,
      kind: body.kind,
      language: body.language,
      name: body.name,
      parentId: body.parentId,
      setPrimary: body.setPrimary,
      sortOrder:
        typeof body.sortOrder === 'number' && Number.isFinite(body.sortOrder)
          ? body.sortOrder
          : undefined,
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
});

export const DELETE = defineRoute(async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string; workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { fileId, workspaceId } = await params;

  try {
    return NextResponse.json(
      await deleteWorkspaceFile(actor, {
        fileId,
        workspaceId,
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
