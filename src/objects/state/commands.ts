import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ensureWorkspaceFiles } from '@/objects/file/commands';
import {
  getParentWorkspacePath,
  getWorkspacePathDepth,
  mapWorkspaceFile,
  mapWorkspaceFileToVersion,
  resolvePrimaryFile,
  serializeWorkspaceVersion,
} from '@/objects/file/schema';
import { isRecoveryVersionType } from '@/lib/workspace/planning';
import { normalizeWorkspaceVersionType } from './schema';
import type {
  WorkspaceRunData,
  WorkspaceVersionFileData,
  WorkspaceVersionType,
} from '@/types';

type WorkspaceStateActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

type CreateWorkspaceVersionDependencies = {
  bindDraftThreadsToVersion: (
    workspaceId: string,
    versionId: string,
    draftRevision: number
  ) => Promise<void>;
  ensureWorkspaceEditable: (
    actor: WorkspaceStateActorContext,
    workspaceId: string
  ) => Promise<void>;
  recordSyncEvent: (params: {
    actorUserId: string;
    entityId: string;
    entityType: string;
    organizationId: string;
    originDeviceId?: string | null;
    payload: unknown;
    revision: number;
  }) => Promise<void>;
};

type ReplaceWorkspaceDraftDependencies = {
  materializeWorkspaceMirror: (params: {
    organizationId: string;
    workspaceId: string;
  }) => Promise<unknown>;
  startWorkspacePreview: (
    actor: WorkspaceStateActorContext,
    input: {
      workspaceId: string;
    }
  ) => Promise<WorkspaceRunData>;
};

const MAX_TEMPORARY_RECOVERY_POINTS = 1;

export async function createWorkspaceVersion(
  actor: WorkspaceStateActorContext,
  input: {
    bindDraftThreads?: boolean;
    versionType?: WorkspaceVersionType;
    sourceConversationId?: string | null;
    sourceMessageId?: string | null;
    title?: string;
    workspaceId: string;
  },
  deps: CreateWorkspaceVersionDependencies
) {
  await deps.ensureWorkspaceEditable(actor, input.workspaceId);
  const versionType = normalizeWorkspaceVersionType(input.versionType);
  const shouldBindDraftThreads =
    input.bindDraftThreads !== undefined
      ? input.bindDraftThreads
      : versionType !== 'checkpoint';

  const workspace = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: input.workspaceId,
      organizationId: actor.organizationId,
    },
  });

  if (!workspace) {
    throw new Error('Workspace not found.');
  }

  const files = await ensureWorkspaceFiles(actor.organizationId, workspace.id);
  const mappedFiles = files.map(mapWorkspaceFile);
  const primaryFile = resolvePrimaryFile(files);
  const [latestVersion, latestVisibleVersion] = await Promise.all([
    prisma.version.findFirst({
      where: {
        deletedAt: null,
        documentId: workspace.id,
        organizationId: actor.organizationId,
      },
      orderBy: { versionNum: 'desc' },
    }),
    versionType === 'checkpoint'
      ? Promise.resolve(null)
      : prisma.version.findFirst({
          where: {
            deletedAt: null,
            documentId: workspace.id,
            organizationId: actor.organizationId,
            versionType: {
              not: 'checkpoint',
            },
          },
          orderBy: { versionNum: 'desc' },
        }),
  ]);

  const nextVersion = workspace.currentVersion + 1;
  const versionContent = serializeWorkspaceVersion({
    files: mappedFiles.map(mapWorkspaceFileToVersion),
    workspaceTitle: input.title?.trim() || workspace.title,
  });

  const version = await prisma.$transaction(async (tx) => {
    const created = await tx.version.create({
      data: {
        organizationId: actor.organizationId,
        documentId: workspace.id,
        versionNum: nextVersion,
        content: versionContent,
        title: input.title?.trim() || workspace.title,
        parentVersionId:
          versionType === 'checkpoint'
            ? latestVersion?.id || null
            : latestVisibleVersion?.id || null,
        sourceSessionId: input.sourceConversationId || null,
        sourceMessageId: input.sourceMessageId || null,
        versionType,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
    });

    await tx.document.update({
      where: { id: workspace.id },
      data: {
        currentVersion: nextVersion,
        draftRevision: {
          increment: 1,
        },
        originDeviceId: actor.deviceId,
        revision: {
          increment: 1,
        },
        ...(primaryFile ? { content: primaryFile.content } : {}),
        ...(isRecoveryVersionType(versionType)
          ? {}
          : { draftBaseVersionId: created.id }),
      },
    });

    return created;
  });

  if (shouldBindDraftThreads) {
    await deps.bindDraftThreadsToVersion(
      workspace.id,
      version.id,
      workspace.draftRevision
    );
  }

  await deps.recordSyncEvent({
    actorUserId: actor.userId,
    entityId: version.id,
    entityType: 'workspace_version',
    organizationId: actor.organizationId,
    originDeviceId: actor.deviceId,
    payload: {
      op: 'create',
      versionNum: version.versionNum,
      workspaceId: workspace.id,
      sourceConversationId: input.sourceConversationId || null,
      sourceMessageId: input.sourceMessageId || null,
    },
    revision: version.revision,
  });

  if (versionType === 'checkpoint') {
    await pruneWorkspaceRecoveryCheckpoints({
      organizationId: actor.organizationId,
      workspaceId: workspace.id,
    });
  }

  return version;
}

export async function pruneWorkspaceRecoveryCheckpoints(
  params: {
    organizationId: string;
    workspaceId: string;
  },
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  const checkpoints = await db.version.findMany({
    where: {
      deletedAt: null,
      documentId: params.workspaceId,
      organizationId: params.organizationId,
      versionType: 'checkpoint',
    },
    orderBy: { versionNum: 'desc' },
    select: {
      id: true,
    },
  });

  const staleCheckpointIds = checkpoints
    .slice(MAX_TEMPORARY_RECOVERY_POINTS)
    .map((checkpoint) => checkpoint.id);

  if (staleCheckpointIds.length === 0) {
    return;
  }

  await db.version.updateMany({
    where: {
      id: {
        in: staleCheckpointIds,
      },
    },
    data: {
      deletedAt: new Date(),
      revision: {
        increment: 1,
      },
    },
  });
}

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
