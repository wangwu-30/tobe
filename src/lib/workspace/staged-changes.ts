import { prisma } from '@/lib/db/prisma';
import { markStagedChangeSetStatus, mapStagedChangeSet } from '@/lib/workspace/planning';
import {
  createWorkspaceFile,
  createWorkspaceSnapshot,
  updateWorkspaceFile,
} from '@/lib/workspace/service';

type ActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

export async function applyStagedChangeSet(
  actor: ActorContext,
  input: {
    changeSetId: string;
    checkpointTitle?: string;
    workspaceId: string;
  }
) {
  const changeSet = await getStagedChangeSet(actor.organizationId, {
    changeSetId: input.changeSetId,
    workspaceId: input.workspaceId,
  });

  if (!changeSet) {
    throw new Error('Staged change set not found.');
  }

  const patches = parseChangeSetPatches(changeSet.changesJson);
  const checkpoint = await createWorkspaceSnapshot(actor, {
    snapshotType: 'checkpoint',
    sourceConversationId: changeSet.sessionId,
    title: input.checkpointTitle || 'Recovery Checkpoint',
    workspaceId: input.workspaceId,
  });

  for (const patch of patches) {
    const targetFile =
      (patch.fileId
        ? await prisma.workspaceFile.findFirst({
            where: {
              deletedAt: null,
              documentId: input.workspaceId,
              id: patch.fileId,
              organizationId: actor.organizationId,
            },
          })
        : null) ||
      (await prisma.workspaceFile.findFirst({
        where: {
          deletedAt: null,
          documentId: input.workspaceId,
          isPrimary: true,
          organizationId: actor.organizationId,
        },
        orderBy: { updatedAt: 'desc' },
      }));

    if (!targetFile && patch.name) {
      const created = await createWorkspaceFile(actor, {
        kind: patch.kind,
        name: patch.name,
        nodeType: 'file',
        workspaceId: input.workspaceId,
      });

      await updateWorkspaceFile(actor, {
        content: patch.nextContent,
        fileId: created.id,
        workspaceId: input.workspaceId,
      });
      continue;
    }

    if (!targetFile) {
      continue;
    }

    await updateWorkspaceFile(actor, {
      content: patch.nextContent,
      fileId: targetFile.id,
      workspaceId: input.workspaceId,
    });
  }

  return markStagedChangeSetStatus(actor, {
    changeSetId: input.changeSetId,
    checkpointVersionId: checkpoint.id,
    status: 'applied',
  });
}

export async function discardStagedChangeSet(
  actor: ActorContext,
  input: {
    changeSetId: string;
    workspaceId: string;
  }
) {
  const changeSet = await getStagedChangeSet(actor.organizationId, input);
  if (!changeSet) {
    throw new Error('Staged change set not found.');
  }

  return markStagedChangeSetStatus(actor, {
    changeSetId: input.changeSetId,
    status: 'discarded',
  });
}

export async function getPendingStagedChangeSets(params: {
  organizationId: string;
  workspaceId: string;
}) {
  const items = await prisma.stagedChangeSet.findMany({
    where: {
      deletedAt: null,
      documentId: params.workspaceId,
      organizationId: params.organizationId,
      status: 'pending',
    },
    orderBy: { createdAt: 'desc' },
  });

  return items.map(mapStagedChangeSet);
}

async function getStagedChangeSet(
  organizationId: string,
  input: {
    changeSetId: string;
    workspaceId: string;
  }
) {
  return prisma.stagedChangeSet.findFirst({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      id: input.changeSetId,
      organizationId,
    },
  });
}

function parseChangeSetPatches(changesJson: string) {
  try {
    const parsed = JSON.parse(changesJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
