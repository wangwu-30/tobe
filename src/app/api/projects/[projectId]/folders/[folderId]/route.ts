import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getNextProjectTreeSortOrder } from '@/objects/project/queries';

async function findProjectFolder(args: {
  folderId: string;
  organizationId: string;
  projectId: string;
}) {
  return prisma.projectFolder.findFirst({
    where: {
      deletedAt: null,
      id: args.folderId,
      organizationId: args.organizationId,
      projectId: args.projectId,
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ folderId: string; projectId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { folderId, projectId } = await params;
  const body = await req.json().catch(() => ({}));
  const hasParentId = Object.prototype.hasOwnProperty.call(body, 'parentId');
  const parentId =
    body.parentId === null
      ? null
      : typeof body.parentId === 'string' && body.parentId.trim().length > 0
        ? body.parentId.trim()
        : undefined;
  const hasTreeSortOrder =
    typeof body.treeSortOrder === 'number' && Number.isFinite(body.treeSortOrder);
  const treeSortOrder = hasTreeSortOrder ? body.treeSortOrder : undefined;
  const title =
    typeof body.title === 'string' && body.title.trim().length > 0
      ? body.title.trim()
      : null;

  if (!title && !hasParentId && treeSortOrder === undefined) {
    return NextResponse.json(
      { error: 'Folder update requires a title, parent folder, or sort order.' },
      { status: 400 }
    );
  }

  const folder = await findProjectFolder({
    folderId,
    organizationId: actor.organizationId,
    projectId,
  });

  if (!folder) {
    return NextResponse.json({ error: 'Folder not found.' }, { status: 404 });
  }

  if (hasParentId && parentId === folder.id) {
    return NextResponse.json(
      { error: 'Folder cannot move into itself.' },
      { status: 400 }
    );
  }

  if (hasParentId && parentId) {
    const nextParent = await findProjectFolder({
      folderId: parentId,
      organizationId: actor.organizationId,
      projectId,
    });

    if (!nextParent) {
      return NextResponse.json({ error: 'Parent folder not found.' }, { status: 404 });
    }

    let cursor = nextParent.parentId;
    while (cursor) {
      if (cursor === folder.id) {
        return NextResponse.json(
          { error: 'Folder cannot move into its own descendant.' },
          { status: 400 }
        );
      }

      const ancestor = await prisma.projectFolder.findFirst({
        where: {
          deletedAt: null,
          id: cursor,
          organizationId: actor.organizationId,
          projectId,
        },
        select: { parentId: true },
      });

      cursor = ancestor?.parentId || null;
    }
  }

  const nextTreeSortOrder =
    treeSortOrder !== undefined
      ? treeSortOrder
      : hasParentId && parentId !== folder.parentId
        ? await getNextProjectTreeSortOrder({
            organizationId: actor.organizationId,
            parentFolderId: parentId || null,
            projectId,
          })
        : undefined;

  const updatedFolder = await prisma.projectFolder.update({
    where: { id: folder.id },
    data: {
      ...(hasParentId ? { parentId: parentId || null } : {}),
      ...(nextTreeSortOrder !== undefined ? { treeSortOrder: nextTreeSortOrder } : {}),
      revision: {
        increment: 1,
      },
      ...(title ? { title } : {}),
    },
  });

  return NextResponse.json({
    id: updatedFolder.id,
    parentFolderId: updatedFolder.parentId,
    projectId: updatedFolder.projectId,
    sortOrder: updatedFolder.treeSortOrder,
    title: updatedFolder.title,
    updatedAt: updatedFolder.updatedAt,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ folderId: string; projectId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { folderId, projectId } = await params;

  const folder = await findProjectFolder({
    folderId,
    organizationId: actor.organizationId,
    projectId,
  });

  if (!folder) {
    return NextResponse.json({ error: 'Folder not found.' }, { status: 404 });
  }

  const [childFolder, childDeliverable] = await Promise.all([
    prisma.projectFolder.findFirst({
      where: {
        deletedAt: null,
        organizationId: actor.organizationId,
        parentId: folderId,
        projectId,
      },
      select: { id: true },
    }),
    prisma.document.findFirst({
      where: {
        deletedAt: null,
        organizationId: actor.organizationId,
        projectId,
        projectFolderId: folderId,
      },
      select: { id: true },
    }),
  ]);

  if (childFolder || childDeliverable) {
    return NextResponse.json(
      { error: 'Folder is not empty yet.' },
      { status: 409 }
    );
  }

  await prisma.projectFolder.update({
    where: { id: folder.id },
    data: {
      deletedAt: new Date(),
      revision: {
        increment: 1,
      },
    },
  });

  return NextResponse.json({ ok: true });
}
