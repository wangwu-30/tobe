import { prisma } from '@/lib/db/prisma';
import { ensureWorkspaceFiles } from '@/objects/file/commands';
import {
  getParentWorkspacePath,
  getWorkspacePathDepth,
} from '@/objects/file/schema';
import type { WorkspaceVersionFileData } from '@/types';

import type {
  ReplaceWorkspaceDraftDependencies,
  WorkspaceStateActorContext,
} from './shared';

export async function replaceWorkspaceDraftWithVersionFiles(
  actor: WorkspaceStateActorContext,
  input: {
    draftBaseVersionId?: string | null;
    hadActivePreview: boolean;
    preferredActiveFileId?: string | null;
    versionFiles: WorkspaceVersionFileData[];
    workspaceId: string;
  },
  deps: ReplaceWorkspaceDraftDependencies
) {
  const existingFiles = await ensureWorkspaceFiles(
    actor.organizationId,
    input.workspaceId
  );
  const existingById = new Map(existingFiles.map((file) => [file.id, file]));
  const existingByPath = new Map(existingFiles.map((file) => [file.path, file]));
  const preferredActiveFilePath = input.preferredActiveFileId
    ? existingById.get(input.preferredActiveFileId)?.path || null
    : null;
  const deletedFileIds = existingFiles
    .filter((file) => !input.versionFiles.some((versionFile) => versionFile.path === file.path))
    .map((file) => file.id);
  const orderedVersionFiles = [...input.versionFiles].sort((left, right) => {
    const depthDelta =
      getWorkspacePathDepth(left.path) - getWorkspacePathDepth(right.path);
    if (depthDelta !== 0) {
      return depthDelta;
    }

    if (left.nodeType === right.nodeType) {
      return left.path.localeCompare(right.path);
    }

    return left.nodeType === 'folder' ? -1 : 1;
  });
  const fileIdsByPath = new Map<string, string>();
  let resolvedActiveFileId: string | null = null;

  await prisma.$transaction(async (tx) => {
    if (deletedFileIds.length > 0) {
      await tx.workspaceFile.updateMany({
        where: {
          id: { in: deletedFileIds },
        },
        data: {
          deletedAt: new Date(),
          revision: {
            increment: 1,
          },
        },
      });
    }

    for (const versionFile of orderedVersionFiles) {
      const parentPath = getParentWorkspacePath(versionFile.path);
      const parentId = parentPath ? fileIdsByPath.get(parentPath) || null : null;
      const existing = existingByPath.get(versionFile.path);

      if (existing) {
        const updated = await tx.workspaceFile.update({
          where: { id: existing.id },
          data: {
            content: versionFile.content,
            createdByUserId: actor.userId,
            deletedAt: null,
            isPrimary: versionFile.isPrimary,
            kind: versionFile.kind,
            language: versionFile.language,
            name: versionFile.name,
            originDeviceId: actor.deviceId,
            parentId,
            path: versionFile.path,
            role: versionFile.role,
            revision: {
              increment: 1,
            },
            sortOrder: versionFile.sortOrder,
            type: versionFile.nodeType === 'folder' ? 'folder' : 'file',
            updatedAt: new Date(),
          },
        });

        fileIdsByPath.set(versionFile.path, updated.id);
        continue;
      }

      const created = await tx.workspaceFile.create({
        data: {
          content: versionFile.content,
          createdByUserId: actor.userId,
          documentId: input.workspaceId,
          isPrimary: versionFile.isPrimary,
          kind: versionFile.kind,
          language: versionFile.language,
          name: versionFile.name,
          organizationId: actor.organizationId,
          originDeviceId: actor.deviceId,
          parentId,
          path: versionFile.path,
          role: versionFile.role,
          sortOrder: versionFile.sortOrder,
          type: versionFile.nodeType === 'folder' ? 'folder' : 'file',
        },
      });

      fileIdsByPath.set(versionFile.path, created.id);
    }

    const primaryVersionFile =
      orderedVersionFiles.find(
        (file) => file.nodeType === 'file' && file.isPrimary
      ) || orderedVersionFiles.find((file) => file.nodeType === 'file');
    const primaryFileId = primaryVersionFile
      ? fileIdsByPath.get(primaryVersionFile.path) || null
      : null;

    resolvedActiveFileId =
      (preferredActiveFilePath
        ? fileIdsByPath.get(preferredActiveFilePath) || null
        : null) || primaryFileId;

    await tx.document.update({
      where: { id: input.workspaceId },
      data: {
        content: primaryVersionFile?.content || '',
        draftRevision: {
          increment: 1,
        },
        originDeviceId: actor.deviceId,
        revision: {
          increment: 1,
        },
        status: 'draft',
        ...(input.draftBaseVersionId !== undefined
          ? { draftBaseVersionId: input.draftBaseVersionId }
          : {}),
      },
    });

    if (resolvedActiveFileId) {
      await tx.session.updateMany({
        where: {
          deletedAt: null,
          organizationId: actor.organizationId,
          wikiId: input.workspaceId,
          OR: [
            { activeFileId: null },
            { activeFileId: { in: deletedFileIds } },
          ],
        },
        data: {
          activeFileId: resolvedActiveFileId,
          revision: {
            increment: 1,
          },
        },
      });
    }
  });

  await deps.materializeWorkspaceMirror({
    organizationId: actor.organizationId,
    workspaceId: input.workspaceId,
  });

  const restartedPreview = input.hadActivePreview
    ? await deps.startWorkspacePreview(actor, {
        workspaceId: input.workspaceId,
      }).catch(() => null)
    : null;

  return {
    activeFileId: resolvedActiveFileId,
    restartedPreview,
  };
}
