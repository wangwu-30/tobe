import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ensureWorkspaceFiles } from '@/objects/file/commands';
import {
  mapWorkspaceFile,
  mapWorkspaceFileToVersion,
  parseVersionFiles,
  resolvePrimaryFile,
  serializeWorkspaceVersion,
} from '@/objects/file/schema';
import {
  hasPinnedStateLabel,
  hasRecoveryStateLabel,
} from './schema';
import { alignWorkspaceVersionWithDb } from './alignment';
import { replaceWorkspaceDraftWithVersionFiles } from './draft-commands';
import { resolveDraftBaseVersionIdForVersion } from './queries';
import type {
  CreateWorkspaceVersionDependencies,
  RestoreWorkspaceVersionDependencies,
  SetWorkspaceVersionPinnedDependencies,
  WorkspaceStateActorContext,
} from './shared';

const MAX_PINNED_RECOVERY_POINTS = 3;
const MAX_TEMPORARY_RECOVERY_POINTS = 1;

export class WorkspaceRecoveryPinLimitError extends Error {
  constructor() {
    super('Pinned recovery points are limited to 3.');
  }
}

/**
 * Records an explicit human decision that an immutable, visible version is a
 * valid source of truth for durable execution. The command is intentionally
 * workspace-scoped and idempotent; generic label creation is not a safe
 * substitute for this authorization boundary.
 */
export async function alignWorkspaceVersion(
  actor: WorkspaceStateActorContext,
  input: {
    versionId: string;
    workspaceId: string;
  }
) {
  return alignWorkspaceVersionWithDb(prisma, actor, input);
}

export async function createWorkspaceVersion(
  actor: WorkspaceStateActorContext,
  input: {
    bindDraftThreads?: boolean;
    recovery?: boolean;
    sourceConversationId?: string | null;
    sourceMessageId?: string | null;
    title?: string;
    workspaceId: string;
  },
  deps: CreateWorkspaceVersionDependencies
) {
  await deps.ensureWorkspaceEditable(actor, input.workspaceId);
  const isRecovery = input.recovery === true;
  const shouldBindDraftThreads =
    input.bindDraftThreads !== undefined
      ? input.bindDraftThreads
      : !isRecovery;

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
    isRecovery
      ? Promise.resolve(null)
      : prisma.version.findFirst({
          where: {
            deletedAt: null,
            documentId: workspace.id,
            organizationId: actor.organizationId,
            labels: {
              some: {
                deletedAt: null,
                kind: 'milestone',
              },
            },
          },
          orderBy: { versionNum: 'desc' },
        }),
  ]);
  const versionTitle = input.title?.trim() || workspace.title;

  const nextVersion = workspace.currentVersion + 1;
  const versionContent = serializeWorkspaceVersion({
    files: mappedFiles.map(mapWorkspaceFileToVersion),
    workspaceTitle: versionTitle,
  });

  const version = await prisma.$transaction(async (tx) => {
    const created = await tx.version.create({
      data: {
        organizationId: actor.organizationId,
        documentId: workspace.id,
        versionNum: nextVersion,
        content: versionContent,
        title: versionTitle,
        parentVersionId:
          isRecovery
            ? latestVersion?.id || null
            : latestVisibleVersion?.id || null,
        sourceSessionId: input.sourceConversationId || null,
        sourceMessageId: input.sourceMessageId || null,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
    });

    if (!isRecovery) {
      if (latestVisibleVersion?.id) {
        await tx.label.updateMany({
          where: {
            deletedAt: null,
            kind: 'head',
            organizationId: actor.organizationId,
            versionId: latestVisibleVersion.id,
          },
          data: {
            deletedAt: new Date(),
            originDeviceId: actor.deviceId,
            revision: {
              increment: 1,
            },
          },
        });
      }

      await tx.label.createMany({
        data: [
          {
            organizationId: actor.organizationId,
            versionId: created.id,
            kind: 'milestone',
            name: created.title,
            createdByUserId: actor.userId,
            originDeviceId: actor.deviceId,
          },
          {
            organizationId: actor.organizationId,
            versionId: created.id,
            kind: 'head',
            name: created.title,
            createdByUserId: actor.userId,
            originDeviceId: actor.deviceId,
          },
        ],
      });
    }

    if (isRecovery) {
      await tx.label.create({
        data: {
          organizationId: actor.organizationId,
          versionId: created.id,
          kind: 'recovery',
          name: created.title,
          createdByUserId: actor.userId,
          originDeviceId: actor.deviceId,
        },
      });
    }

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
        ...(isRecovery ? {} : { draftBaseVersionId: created.id }),
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

  if (isRecovery) {
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
      labels: {
        some: {
          deletedAt: null,
          kind: 'recovery',
        },
      },
      NOT: {
        labels: {
          some: {
            deletedAt: null,
            kind: 'pinned',
          },
        },
      },
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

export async function setWorkspaceVersionPinned(
  actor: WorkspaceStateActorContext,
  input: {
    pinned: boolean;
    versionId: string;
    workspaceId: string;
  },
  deps: SetWorkspaceVersionPinnedDependencies
) {
  await deps.ensureWorkspaceEditable(actor, input.workspaceId);

  const version = await prisma.version.findFirst({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      id: input.versionId,
      organizationId: actor.organizationId,
    },
    include: {
      labels: {
        where: {
          deletedAt: null,
        },
        select: {
          id: true,
          kind: true,
        },
      },
    },
  });

  if (!version) {
    throw new Error('Version not found.');
  }

  if (!hasRecoveryStateLabel(version.labels)) {
    throw new Error('Only recovery points can be pinned.');
  }

  if (input.pinned && !hasPinnedStateLabel(version.labels)) {
    const pinnedCount = await prisma.version.count({
      where: {
        deletedAt: null,
        documentId: input.workspaceId,
        organizationId: actor.organizationId,
        labels: {
          some: {
            deletedAt: null,
            kind: 'pinned',
          },
        },
      },
    });

    if (pinnedCount >= MAX_PINNED_RECOVERY_POINTS) {
      throw new WorkspaceRecoveryPinLimitError();
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (input.pinned && !hasPinnedStateLabel(version.labels)) {
      await tx.label.create({
        data: {
          organizationId: actor.organizationId,
          versionId: version.id,
          kind: 'pinned',
          name: version.title,
          createdByUserId: actor.userId,
          originDeviceId: actor.deviceId,
        },
      });
    }

    if (!input.pinned && hasPinnedStateLabel(version.labels)) {
      await tx.label.updateMany({
        where: {
          deletedAt: null,
          kind: 'pinned',
          organizationId: actor.organizationId,
          versionId: version.id,
        },
        data: {
          deletedAt: new Date(),
          originDeviceId: actor.deviceId,
          revision: {
            increment: 1,
          },
        },
      });
    }

    return tx.version.update({
      where: {
        id: version.id,
      },
      data: {
        revision: {
          increment: 1,
        },
      },
    });
  });

  await pruneWorkspaceRecoveryCheckpoints({
    organizationId: actor.organizationId,
    workspaceId: input.workspaceId,
  });

  return updated;
}

export async function restoreWorkspaceVersion(
  actor: WorkspaceStateActorContext,
  input: {
    versionId: string;
    workspaceId: string;
  },
  deps: RestoreWorkspaceVersionDependencies
) {
  await deps.ensureWorkspaceEditable(actor, input.workspaceId);

  const version = await prisma.version.findFirst({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      id: input.versionId,
      organizationId: actor.organizationId,
    },
  });

  if (!version) {
    throw new Error('Version not found.');
  }

  const hadActivePreview = (
    await deps.listWorkspaceRuns({
      organizationId: actor.organizationId,
      workspaceId: input.workspaceId,
    })
  ).some(
    (run) =>
      run.kind === 'preview' &&
      (run.status === 'pending' || run.status === 'running')
  );
  const draftBaseVersionId = await resolveDraftBaseVersionIdForVersion({
    organizationId: actor.organizationId,
    versionId: version.id,
  });
  const safetyCheckpoint = await createWorkspaceVersion(
    actor,
    {
      bindDraftThreads: true,
      recovery: true,
      title: 'Safety Checkpoint before Restore',
      workspaceId: input.workspaceId,
    },
    deps
  );
  const { restartedPreview } = await replaceWorkspaceDraftWithVersionFiles(
    actor,
    {
      draftBaseVersionId,
      hadActivePreview,
      versionFiles: parseVersionFiles(version.content),
      workspaceId: input.workspaceId,
    },
    deps
  );

  return {
    restoredVersion: version,
    restartedPreview,
    safetyCheckpoint,
  };
}

export { replaceWorkspaceDraftWithVersionFiles } from './draft-commands';
