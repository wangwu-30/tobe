import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getNextProjectTreeSortOrder } from '@/objects/project/queries';
import { defineRoute } from '@/framework/resilience';


async function assertProjectExists(organizationId: string, projectId: string) {
  const project = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      organizationId,
      OR: [{ id: projectId }, { projectId }],
    },
    select: { id: true },
  });

  return Boolean(project);
}

export const POST = defineRoute(async function POST(
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
  const parentId =
    typeof body.parentId === 'string' && body.parentId.trim().length > 0
      ? body.parentId.trim()
      : null;

  if (!title) {
    return NextResponse.json({ error: 'Folder title is required.' }, { status: 400 });
  }

  if (!(await assertProjectExists(actor.organizationId, projectId))) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  if (parentId) {
    const parentFolder = await prisma.projectFolder.findFirst({
      where: {
        deletedAt: null,
        id: parentId,
        organizationId: actor.organizationId,
        projectId,
      },
      select: { id: true },
    });

    if (!parentFolder) {
      return NextResponse.json({ error: 'Parent folder not found.' }, { status: 404 });
    }
  }

  const treeSortOrder = await getNextProjectTreeSortOrder({
    organizationId: actor.organizationId,
    parentFolderId: parentId,
    projectId,
  });

  const folder = await prisma.projectFolder.create({
    data: {
      organizationId: actor.organizationId,
      projectId,
      parentId,
      treeSortOrder,
      title,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
    },
  });

  return NextResponse.json({
    id: folder.id,
    parentFolderId: folder.parentId,
    projectId: folder.projectId,
    sortOrder: folder.treeSortOrder,
    title: folder.title,
    updatedAt: folder.updatedAt,
  });
});
