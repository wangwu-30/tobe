import { prisma } from '@/lib/db/prisma';
import { materializeWorkspaceMirror } from '@/lib/platform/mirror-manager';
import { recordSyncEvent } from '@/lib/platform/sync';

import {
  buildWorkspacePath,
  getDefaultFileName,
  getInitialFileContent,
  inferFileKind,
  inferFileLanguage,
  makeUniqueChildName,
  mapWorkspaceFile,
} from './schema';

type WorkspaceFileActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

type FileCommandDependencies = {
  ensureWorkspaceEditable: (
    actor: WorkspaceFileActorContext,
    workspaceId: string
  ) => Promise<void>;
};

const SUPPORT_UPLOADS_ROOT = 'Uploads';

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

export async function createWorkspaceFile(
  actor: WorkspaceFileActorContext,
  input: {
    kind?: 'richtext' | 'markdown' | 'text' | 'code';
    name: string;
    nodeType?: 'file' | 'folder';
    parentId?: string | null;
    role?: 'deliverable' | 'support';
    workspaceId: string;
  },
  deps: FileCommandDependencies
) {
  await deps.ensureWorkspaceEditable(actor, input.workspaceId);
  await ensureWorkspaceFiles(actor.organizationId, input.workspaceId);

  const parent = input.parentId
    ? await prisma.workspaceFile.findFirst({
        where: {
          deletedAt: null,
          id: input.parentId,
          documentId: input.workspaceId,
          organizationId: actor.organizationId,
        },
      })
    : null;

  const siblings = await prisma.workspaceFile.findMany({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      organizationId: actor.organizationId,
      parentId: input.parentId || null,
    },
    orderBy: { sortOrder: 'asc' },
  });

  const safeName = makeUniqueChildName(input.name.trim() || 'Untitled', siblings);
  const path = buildWorkspacePath(parent?.path || null, safeName);
  const nodeType = input.nodeType || 'file';
  const fileKind = input.kind || inferFileKind(safeName);
  const file = await prisma.workspaceFile.create({
    data: {
      organizationId: actor.organizationId,
      documentId: input.workspaceId,
      parentId: input.parentId || null,
      name: safeName,
      path,
      type: nodeType,
      kind: nodeType === 'folder' ? 'text' : fileKind,
      role: input.role || 'deliverable',
      language: nodeType === 'folder' ? null : inferFileLanguage(safeName),
      content: nodeType === 'folder' ? '' : getInitialFileContent(fileKind),
      sortOrder: siblings.length,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      isPrimary: false,
    },
  });

  await recordSyncEvent({
    actorUserId: actor.userId,
    entityId: file.id,
    entityType: 'workspace_file',
    organizationId: actor.organizationId,
    originDeviceId: actor.deviceId,
    payload: {
      op: 'create',
      parentId: input.parentId || null,
      path,
      workspaceId: input.workspaceId,
    },
    revision: file.revision,
  });

  await materializeWorkspaceMirror({
    organizationId: actor.organizationId,
    workspaceId: input.workspaceId,
  });

  return mapWorkspaceFile(file);
}

export async function ensureSupportUploadsFolder(
  actor: WorkspaceFileActorContext,
  workspaceId: string,
  deps: FileCommandDependencies
) {
  const existing = await prisma.workspaceFile.findFirst({
    where: {
      deletedAt: null,
      documentId: workspaceId,
      organizationId: actor.organizationId,
      path: SUPPORT_UPLOADS_ROOT,
      type: 'folder',
    },
  });

  if (existing) {
    return mapWorkspaceFile(existing);
  }

  return createWorkspaceFile(
    actor,
    {
      name: SUPPORT_UPLOADS_ROOT,
      nodeType: 'folder',
      role: 'support',
      workspaceId,
    },
    deps
  );
}

export async function updateWorkspaceFile(
  actor: WorkspaceFileActorContext,
  input: {
    content?: string;
    fileId: string;
    kind?: 'richtext' | 'markdown' | 'text' | 'code';
    language?: string | null;
    name?: string;
    parentId?: string | null;
    role?: 'deliverable' | 'support';
    setPrimary?: boolean;
    sortOrder?: number;
    workspaceId: string;
  },
  deps: FileCommandDependencies
) {
  await deps.ensureWorkspaceEditable(actor, input.workspaceId);

  const existing = await prisma.workspaceFile.findFirst({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      id: input.fileId,
      organizationId: actor.organizationId,
    },
  });

  if (!existing) {
    throw new Error('Workspace file not found.');
  }

  const nextParent = input.parentId
    ? await prisma.workspaceFile.findFirst({
        where: {
          deletedAt: null,
          documentId: input.workspaceId,
          id: input.parentId,
          organizationId: actor.organizationId,
        },
      })
    : null;

  if (
    nextParent &&
    (nextParent.id === existing.id || nextParent.path.startsWith(`${existing.path}/`))
  ) {
    throw new Error('Cannot move a folder into itself or one of its descendants.');
  }

  const nextParentId = input.parentId === undefined ? existing.parentId : input.parentId;

  const siblings = await prisma.workspaceFile.findMany({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      organizationId: actor.organizationId,
      parentId: nextParentId,
      id: { not: existing.id },
    },
  });
  const previousSiblings =
    input.parentId !== undefined && existing.parentId !== nextParentId
      ? await prisma.workspaceFile.findMany({
          where: {
            deletedAt: null,
            documentId: input.workspaceId,
            organizationId: actor.organizationId,
            parentId: existing.parentId,
            id: { not: existing.id },
          },
        })
      : [];

  const nextName =
    input.name !== undefined
      ? makeUniqueChildName(input.name.trim() || existing.name, siblings)
      : existing.name;
  const nextPath =
    input.name !== undefined || input.parentId !== undefined
      ? buildWorkspacePath(nextParent?.path || null, nextName)
      : existing.path;
  const normalizedSiblings = [...siblings].sort(
    (left, right) => left.sortOrder - right.sortOrder
  );
  const targetSortOrder =
    input.sortOrder === undefined
      ? existing.sortOrder
      : Math.max(0, Math.min(Math.trunc(input.sortOrder), normalizedSiblings.length));
  const requiresSortNormalization =
    input.parentId !== undefined ||
    input.sortOrder !== undefined;

  const file = requiresSortNormalization
    ? await prisma.$transaction(async (tx) => {
        const updated = await tx.workspaceFile.update({
          where: { id: existing.id },
          data: {
            ...(input.content !== undefined && { content: input.content }),
            ...(input.kind !== undefined && { kind: input.kind }),
            ...(input.role !== undefined && { role: input.role }),
            ...(input.language !== undefined && { language: input.language }),
            ...(input.name !== undefined && { name: nextName }),
            ...(input.parentId !== undefined && { parentId: nextParentId }),
            ...(nextPath !== existing.path && { path: nextPath }),
            sortOrder: targetSortOrder,
            originDeviceId: actor.deviceId,
            createdByUserId: actor.userId,
            revision: {
              increment: 1,
            },
            updatedAt: new Date(),
          },
        });

        const reorderedTargetIds = [
          ...normalizedSiblings.slice(0, targetSortOrder).map((item) => item.id),
          updated.id,
          ...normalizedSiblings.slice(targetSortOrder).map((item) => item.id),
        ];

        for (const [index, id] of reorderedTargetIds.entries()) {
          await tx.workspaceFile.update({
            where: { id },
            data: { sortOrder: index },
          });
        }

        if (previousSiblings.length > 0) {
          const reorderedPreviousIds = [...previousSiblings]
            .sort((left, right) => left.sortOrder - right.sortOrder)
            .map((item) => item.id);
          for (const [index, id] of reorderedPreviousIds.entries()) {
            await tx.workspaceFile.update({
              where: { id },
              data: { sortOrder: index },
            });
          }
        }

        return updated;
      })
    : await prisma.workspaceFile.update({
        where: { id: existing.id },
        data: {
          ...(input.content !== undefined && { content: input.content }),
          ...(input.kind !== undefined && { kind: input.kind }),
          ...(input.role !== undefined && { role: input.role }),
          ...(input.language !== undefined && { language: input.language }),
          ...(input.name !== undefined && { name: nextName }),
          ...(input.parentId !== undefined && { parentId: nextParentId }),
          ...(nextPath !== existing.path && { path: nextPath }),
          originDeviceId: actor.deviceId,
          createdByUserId: actor.userId,
          revision: {
            increment: 1,
          },
          updatedAt: new Date(),
        },
      });

  if (nextPath !== existing.path) {
    await rebuildDescendantPaths({
      fileId: file.id,
      oldPath: existing.path,
      organizationId: actor.organizationId,
      workspaceId: input.workspaceId,
    });
  }

  if (input.setPrimary) {
    await prisma.$transaction([
      prisma.workspaceFile.updateMany({
        where: {
          deletedAt: null,
          documentId: input.workspaceId,
          organizationId: actor.organizationId,
          isPrimary: true,
          id: { not: existing.id },
        },
        data: {
          isPrimary: false,
          revision: {
            increment: 1,
          },
        },
      }),
      prisma.workspaceFile.update({
        where: { id: existing.id },
        data: {
          isPrimary: true,
          revision: {
            increment: 1,
          },
        },
      }),
      prisma.document.update({
        where: { id: input.workspaceId },
        data: {
          content: input.content !== undefined ? input.content : existing.content,
          originDeviceId: actor.deviceId,
          revision: {
            increment: 1,
          },
        },
      }),
    ]);
  } else if (file.isPrimary && input.content !== undefined) {
    await prisma.document.update({
      where: { id: input.workspaceId },
      data: {
        content: input.content,
        originDeviceId: actor.deviceId,
        revision: {
          increment: 1,
        },
      },
    });
  }

  await materializeWorkspaceMirror({
    organizationId: actor.organizationId,
    workspaceId: input.workspaceId,
  });

  return mapWorkspaceFile(
    (await prisma.workspaceFile.findUnique({ where: { id: file.id } })) || file
  );
}

export async function deleteWorkspaceFile(
  actor: WorkspaceFileActorContext,
  input: {
    fileId: string;
    workspaceId: string;
  },
  deps: FileCommandDependencies
) {
  await deps.ensureWorkspaceEditable(actor, input.workspaceId);

  const existing = await prisma.workspaceFile.findFirst({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      id: input.fileId,
      organizationId: actor.organizationId,
    },
  });

  if (!existing) {
    throw new Error('Workspace file not found.');
  }

  const descendants = await prisma.workspaceFile.findMany({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      organizationId: actor.organizationId,
      OR: [{ id: existing.id }, { path: { startsWith: `${existing.path}/` } }],
    },
  });

  const deletedAt = new Date();
  await prisma.$transaction([
    prisma.workspaceFile.updateMany({
      where: {
        id: {
          in: descendants.map((file) => file.id),
        },
      },
      data: {
        deletedAt,
        revision: {
          increment: 1,
        },
      },
    }),
    prisma.commentThread.updateMany({
      where: {
        deletedAt: null,
        organizationId: actor.organizationId,
        fileId: {
          in: descendants.map((file) => file.id),
        },
      },
      data: {
        deletedAt,
        revision: {
          increment: 1,
        },
      },
    }),
  ]);

  if (existing.isPrimary) {
    const replacement = await prisma.workspaceFile.findFirst({
      where: {
        deletedAt: null,
        documentId: input.workspaceId,
        organizationId: actor.organizationId,
        id: { notIn: descendants.map((file) => file.id) },
        type: 'file',
      },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    if (replacement) {
      await prisma.$transaction([
        prisma.workspaceFile.update({
          where: { id: replacement.id },
          data: {
            isPrimary: true,
            revision: {
              increment: 1,
            },
          },
        }),
        prisma.document.update({
          where: { id: input.workspaceId },
          data: {
            content: replacement.content,
            originDeviceId: actor.deviceId,
            revision: {
              increment: 1,
            },
          },
        }),
      ]);
    }
  }

  await prisma.session.updateMany({
    where: {
      activeFileId: {
        in: descendants.map((file) => file.id),
      },
      deletedAt: null,
      organizationId: actor.organizationId,
      wikiId: input.workspaceId,
    },
    data: {
      activeFileId: null,
      revision: {
        increment: 1,
      },
    },
  });

  await materializeWorkspaceMirror({
    organizationId: actor.organizationId,
    workspaceId: input.workspaceId,
  });

  return { deleted: true };
}
