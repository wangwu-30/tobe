import fs from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { normalizeAppLanguage } from '@/lib/i18n/language';
import { getWorkspaceMirrorPath } from '@/lib/platform/mirror-manager';
import { stopWorkspacePreview } from '@/lib/platform/run-service';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { recordSyncEvent } from '@/lib/platform/sync';
import { WorkspaceLockConflictError } from '@/objects/workspace/commands';
import {
  getWorkspaceView,
  updateWorkspace,
} from '@/lib/workspace/service';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const { searchParams } = new URL(req.url);
  const conversationId = searchParams.get('conversationId');
  const fileId = searchParams.get('fileId');
  const versionId = searchParams.get('versionId');
  const language = normalizeAppLanguage(req.headers.get('accept-language'));

  const view = await getWorkspaceView({
    conversationId,
    fileId,
    language,
    organizationId: actor.organizationId,
    versionId,
    workspaceId,
  });

  if (!view.workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  return NextResponse.json(view);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const body = await req.json();

  const existing = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: workspaceId,
      organizationId: actor.organizationId,
    },
    select: { id: true },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  try {
    const workspace = await updateWorkspace(actor, {
      content: body.content,
      projectFolderId:
        body.projectFolderId === null
          ? null
          : typeof body.projectFolderId === 'string'
            ? body.projectFolderId
            : undefined,
      treeSortOrder:
        typeof body.treeSortOrder === 'number' && Number.isFinite(body.treeSortOrder)
          ? body.treeSortOrder
          : undefined,
      status: body.status,
      title: body.title,
      workspaceId,
    });

    return NextResponse.json(workspace);
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;

  const existing = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: workspaceId,
      organizationId: actor.organizationId,
    },
    select: { id: true, projectId: true, projectRootPath: true, revision: true, sessionId: true },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  const deletedAt = new Date();
  const projectId = existing.projectId || existing.id;
  const remainingProjectDocument = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      organizationId: actor.organizationId,
      id: {
        not: workspaceId,
      },
      OR: [{ id: projectId }, { projectId }],
    },
    select: { id: true },
  });
  await stopWorkspacePreview(actor.organizationId, workspaceId);

  await prisma.$transaction(async (tx) => {
    const sessions = await tx.session.findMany({
      where: {
        deletedAt: null,
        organizationId: actor.organizationId,
        OR: [{ id: existing.sessionId }, { wikiId: workspaceId }],
      },
      select: { id: true },
    });
    const threadIds = (
      await tx.commentThread.findMany({
        where: {
          deletedAt: null,
          documentId: workspaceId,
          organizationId: actor.organizationId,
        },
        select: { id: true },
      })
    ).map((thread) => thread.id);
    const sessionIds = sessions.map((session) => session.id);

    await Promise.all([
      tx.document.update({
        where: { id: workspaceId },
        data: {
          deletedAt,
          revision: {
            increment: 1,
          },
        },
      }),
      tx.session.updateMany({
        where: {
          deletedAt: null,
          id: {
            in: sessionIds,
          },
          organizationId: actor.organizationId,
        },
        data: {
          deletedAt,
          revision: {
            increment: 1,
          },
        },
      }),
      tx.chatMessage.updateMany({
        where: {
          deletedAt: null,
          organizationId: actor.organizationId,
          OR: [
            { documentId: workspaceId },
            { sessionId: { in: sessionIds } },
          ],
        },
        data: {
          deletedAt,
          revision: {
            increment: 1,
          },
        },
      }),
      tx.workspaceFile.updateMany({
        where: {
          deletedAt: null,
          organizationId: actor.organizationId,
          documentId: workspaceId,
        },
        data: {
          deletedAt,
          revision: {
            increment: 1,
          },
        },
      }),
      tx.version.updateMany({
        where: {
          deletedAt: null,
          documentId: workspaceId,
          organizationId: actor.organizationId,
        },
        data: {
          deletedAt,
          revision: {
            increment: 1,
          },
        },
      }),
      tx.commentThread.updateMany({
        where: {
          deletedAt: null,
          documentId: workspaceId,
          organizationId: actor.organizationId,
        },
        data: {
          deletedAt,
          revision: {
            increment: 1,
          },
        },
      }),
      tx.commentMessage.updateMany({
        where: {
          deletedAt: null,
          organizationId: actor.organizationId,
          threadId: {
            in: threadIds,
          },
        },
        data: {
          deletedAt,
          revision: {
            increment: 1,
          },
        },
      }),
      tx.assistantRun.updateMany({
        where: {
          deletedAt: null,
          organizationId: actor.organizationId,
          OR: [
            { documentId: workspaceId },
            { sessionId: { in: sessionIds } },
          ],
        },
        data: {
          deletedAt,
          revision: {
            increment: 1,
          },
        },
      }),
      tx.chatAttachment.updateMany({
        where: {
          deletedAt: null,
          organizationId: actor.organizationId,
          OR: [
            { documentId: workspaceId },
            { sessionId: { in: sessionIds } },
          ],
        },
        data: {
          deletedAt,
          revision: {
            increment: 1,
          },
        },
      }),
      tx.workspacePlan.updateMany({
        where: {
          deletedAt: null,
          documentId: workspaceId,
          organizationId: actor.organizationId,
        },
        data: {
          deletedAt,
          revision: {
            increment: 1,
          },
        },
      }),
      tx.stagedChangeSet.updateMany({
        where: {
          deletedAt: null,
          documentId: workspaceId,
          organizationId: actor.organizationId,
        },
        data: {
          deletedAt,
          revision: {
            increment: 1,
          },
        },
      }),
      tx.note.updateMany({
        where: {
          deletedAt: null,
          organizationId: actor.organizationId,
          scope: 'deliverable',
          scopeId: workspaceId,
        },
        data: {
          deletedAt,
          revision: {
            increment: 1,
          },
        },
      }),
      tx.wikiEditLock.deleteMany({
        where: {
          documentId: workspaceId,
          organizationId: actor.organizationId,
        },
      }),
      tx.workspaceRun.deleteMany({
        where: {
          documentId: workspaceId,
          organizationId: actor.organizationId,
        },
      }),
      ...(remainingProjectDocument
        ? []
        : [
            tx.projectFolder.updateMany({
              where: {
                deletedAt: null,
                organizationId: actor.organizationId,
                projectId,
              },
              data: {
                deletedAt,
                revision: {
                  increment: 1,
                },
              },
            }),
          ]),
    ]);
  });

  await Promise.all([
    fs.rm(existing.projectRootPath || getWorkspaceMirrorPath(actor.organizationId, workspaceId), {
      force: true,
      recursive: true,
    }),
    recordSyncEvent({
      actorUserId: actor.userId,
      entityId: workspaceId,
      entityType: 'workspace',
      organizationId: actor.organizationId,
      originDeviceId: actor.deviceId,
      payload: {
        op: 'delete',
      },
      revision: existing.revision + 1,
    }),
  ]);

  return NextResponse.json({ ok: true });
}
