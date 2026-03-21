import fs from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { getWorkspaceMirrorPath } from '@/lib/platform/mirror-manager';
import { stopWorkspacePreview } from '@/lib/platform/run-service';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { recordSyncEvent } from '@/lib/platform/sync';

async function listProjectDocuments(organizationId: string, projectId: string) {
  return prisma.document.findMany({
    where: {
      deletedAt: null,
      organizationId,
      OR: [{ id: projectId }, { projectId }],
    },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { projectId } = await params;
  const body = await req.json().catch(() => ({}));
  const title =
    typeof body.title === 'string' && body.title.trim().length > 0
      ? body.title.trim()
      : null;

  if (!title) {
    return NextResponse.json({ error: 'Project title is required.' }, { status: 400 });
  }

  const documents = await listProjectDocuments(actor.organizationId, projectId);
  if (documents.length === 0) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  await prisma.document.updateMany({
    where: {
      deletedAt: null,
      organizationId: actor.organizationId,
      id: { in: documents.map((document) => document.id) },
    },
    data: {
      projectTitle: title,
      revision: {
        increment: 1,
      },
    },
  });

  await Promise.all(
    documents.map((document) =>
      recordSyncEvent({
        actorUserId: actor.userId,
        entityId: document.id,
        entityType: 'workspace',
        organizationId: actor.organizationId,
        originDeviceId: actor.deviceId,
        payload: {
          op: 'update',
          projectTitle: title,
        },
        revision: document.revision + 1,
      })
    )
  );

  return NextResponse.json({ id: projectId, title });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { projectId } = await params;

  const documents = await listProjectDocuments(actor.organizationId, projectId);
  if (documents.length === 0) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const workspaceIds = documents.map((document) => document.id);
  const primarySessionIds = documents.map((document) => document.sessionId);
  const deletedAt = new Date();

  await Promise.all(
    workspaceIds.map((workspaceId) => stopWorkspacePreview(actor.organizationId, workspaceId))
  );

  await prisma.$transaction(async (tx) => {
    const sessions = await tx.session.findMany({
      where: {
        deletedAt: null,
        organizationId: actor.organizationId,
        OR: [{ id: { in: primarySessionIds } }, { wikiId: { in: workspaceIds } }],
      },
      select: { id: true },
    });
    const sessionIds = sessions.map((session) => session.id);
    const threadIds = (
      await tx.commentThread.findMany({
        where: {
          deletedAt: null,
          documentId: { in: workspaceIds },
          organizationId: actor.organizationId,
        },
        select: { id: true },
      })
    ).map((thread) => thread.id);

    await Promise.all([
      tx.document.updateMany({
        where: {
          deletedAt: null,
          id: { in: workspaceIds },
          organizationId: actor.organizationId,
        },
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
          id: { in: sessionIds },
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
          OR: [{ documentId: { in: workspaceIds } }, { sessionId: { in: sessionIds } }],
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
          documentId: { in: workspaceIds },
          organizationId: actor.organizationId,
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
          documentId: { in: workspaceIds },
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
          documentId: { in: workspaceIds },
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
          threadId: { in: threadIds },
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
          OR: [{ documentId: { in: workspaceIds } }, { sessionId: { in: sessionIds } }],
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
          OR: [{ documentId: { in: workspaceIds } }, { sessionId: { in: sessionIds } }],
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
          documentId: { in: workspaceIds },
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
          documentId: { in: workspaceIds },
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
          OR: [
            { scope: 'deliverable', scopeId: { in: workspaceIds } },
            { scope: 'project', scopeId: projectId },
          ],
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
          documentId: { in: workspaceIds },
          organizationId: actor.organizationId,
        },
      }),
      tx.workspaceRun.deleteMany({
        where: {
          documentId: { in: workspaceIds },
          organizationId: actor.organizationId,
        },
      }),
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
    ]);
  });

  const pathsToDelete = new Set<string>();
  documents.forEach((document) => {
    if (document.projectRootPath) {
      pathsToDelete.add(document.projectRootPath);
    }
    pathsToDelete.add(getWorkspaceMirrorPath(actor.organizationId, document.id));
  });

  await Promise.all([
    ...Array.from(pathsToDelete).map((path) =>
      fs.rm(path, {
        force: true,
        recursive: true,
      })
    ),
    ...documents.map((document) =>
      recordSyncEvent({
        actorUserId: actor.userId,
        entityId: document.id,
        entityType: 'workspace',
        organizationId: actor.organizationId,
        originDeviceId: actor.deviceId,
        payload: {
          op: 'delete',
        },
        revision: document.revision + 1,
      })
    ),
  ]);

  return NextResponse.json({ ok: true });
}
