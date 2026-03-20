import { prisma } from '@/lib/db/prisma';

import {
  getDefaultFileName,
  inferFileLanguage,
} from './schema';

export async function ensureWorkspaceFiles(
  organizationId: string,
  workspaceId: string
) {
  let files = await prisma.workspaceFile.findMany({
    where: {
      deletedAt: null,
      documentId: workspaceId,
      organizationId,
    },
    orderBy: [{ path: 'asc' }, { sortOrder: 'asc' }],
  });

  if (files.length > 0) {
    return files;
  }

  const workspace = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: workspaceId,
      organizationId,
    },
  });

  if (!workspace) {
    return [];
  }

  const primaryFileName = getDefaultFileName('richtext');
  const file = await prisma.workspaceFile.create({
    data: {
      organizationId,
      documentId: workspace.id,
      name: primaryFileName,
      path: primaryFileName,
      type: 'file',
      kind: 'richtext',
      role: 'deliverable',
      language: inferFileLanguage(primaryFileName),
      content: workspace.content,
      isPrimary: true,
      sortOrder: 0,
      createdByUserId: workspace.createdByUserId,
      originDeviceId: workspace.originDeviceId,
    },
  });

  await prisma.session.updateMany({
    where: {
      deletedAt: null,
      organizationId,
      wikiId: workspace.id,
      activeFileId: null,
    },
    data: {
      activeFileId: file.id,
      revision: {
        increment: 1,
      },
    },
  });

  files = [file];
  return files;
}

export async function rebuildDescendantPaths(params: {
  fileId: string;
  oldPath: string;
  organizationId: string;
  workspaceId: string;
}) {
  const root = await prisma.workspaceFile.findUnique({
    where: { id: params.fileId },
  });

  if (!root) {
    return;
  }

  const descendants = await prisma.workspaceFile.findMany({
    where: {
      deletedAt: null,
      documentId: params.workspaceId,
      organizationId: params.organizationId,
      path: {
        startsWith: `${params.oldPath}/`,
      },
    },
    orderBy: { path: 'asc' },
  });

  for (const descendant of descendants) {
    const nextPath = descendant.path.replace(params.oldPath, root.path);
    await prisma.workspaceFile.update({
      where: { id: descendant.id },
      data: {
        path: nextPath,
        revision: {
          increment: 1,
        },
      },
    });
  }
}
