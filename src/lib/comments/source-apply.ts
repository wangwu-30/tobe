import type { Prisma } from '@/generated/prisma/client';

import { ConflictError, NotFoundError, ValidationError } from '@/framework/resilience';
import { prisma } from '@/lib/db/prisma';
import { materializeWorkspaceMirror } from '@/lib/platform/mirror-manager';
import { createStagedChangeSetInTransaction } from '@/lib/workspace/planning';
import { applyStagedChangeSetInTransaction } from '@/lib/workspace/staged-changes';
import { mapCommentThread } from '@/objects/comment/view';
import { normalizeFileKind } from '@/objects/file/schema';

type HumanActorContext = {
  actorType: 'user';
  deviceId: string;
  organizationId: string;
  userId: string;
};

export type ApplyCommentSourceChangeInput = {
  expectedFileRevision: number;
  expectedThreadRevision: number;
  expectedWorkspaceRevision: number;
  fileId: string;
  nextContent: string;
  threadId: string;
  workspaceId: string;
};

export async function applyCommentSourceChange(
  actor: HumanActorContext,
  input: ApplyCommentSourceChangeInput
) {
  validateInput(input);

  const result = await prisma.$transaction(async (tx) => {
    const source = await requireCommentSource(tx, actor, input);
    if (source.file.content === input.nextContent) {
      throw new ValidationError('The comment proposal must change the source file.');
    }

    const changeSet = await createStagedChangeSetInTransaction(tx, actor, {
      baseDraftRevision: source.workspace.draftRevision,
      baseVersionId: source.workspace.draftBaseVersionId,
      changes: [
        {
          fileId: source.file.id,
          kind: normalizeFileKind(source.file.kind),
          name: source.file.name,
          nextContent: input.nextContent,
          operation: 'update',
          preimage: {
            content: source.file.content,
            revision: source.file.revision,
          },
          summary: `Apply comment on ${source.thread.anchorText}`,
        },
      ],
      conversationId: source.workspace.sessionId,
      sourceType: 'comment-source',
      summary: `Apply the reviewed comment to ${source.file.name}.`,
      title: 'Apply comment to source',
      workspaceId: source.workspace.id,
    });

    const appliedChangeSet = await applyStagedChangeSetInTransaction(tx, actor, {
      changeSetId: changeSet.id,
      checkpointTitle: 'Recovery Point before Applying Comment',
      expectedRevision: changeSet.revision,
      expectedWorkspaceRevision: input.expectedWorkspaceRevision,
      workspaceId: source.workspace.id,
    });
    const nextDraftRevision = source.workspace.draftRevision + 1;
    const transitioned = await tx.commentThread.updateMany({
      where: {
        deletedAt: null,
        documentId: source.workspace.id,
        draftRevision: source.workspace.draftRevision,
        fileId: source.file.id,
        id: source.thread.id,
        organizationId: actor.organizationId,
        revision: input.expectedThreadRevision,
        status: 'open',
        versionId: null,
      },
      data: {
        createdByUserId: actor.userId,
        draftRevision: nextDraftRevision,
        originDeviceId: actor.deviceId,
        resolvedAt: null,
        revision: { increment: 1 },
        status: 'applied',
      },
    });
    if (transitioned.count !== 1) {
      throw new ConflictError('The comment thread changed while its source edit was applying.');
    }

    const thread = await tx.commentThread.findUnique({
      where: { id: source.thread.id },
      include: {
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
        version: {
          include: { labels: { where: { deletedAt: null } } },
        },
      },
    });
    if (!thread) throw new NotFoundError('Comment thread not found.');

    return { changeSet: appliedChangeSet, thread: mapCommentThread(thread) };
  });

  await materializeWorkspaceMirror({
    organizationId: actor.organizationId,
    workspaceId: input.workspaceId,
  }).catch((error) => {
    console.error('[comment-source] workspace mirror refresh failed', error);
  });

  return result;
}

async function requireCommentSource(
  tx: Prisma.TransactionClient,
  actor: HumanActorContext,
  input: ApplyCommentSourceChangeInput
) {
  const workspace = await tx.document.findFirst({
    where: {
      deletedAt: null,
      id: input.workspaceId,
      organizationId: actor.organizationId,
    },
  });
  if (!workspace) throw new NotFoundError('Workspace not found.');
  if (workspace.revision !== input.expectedWorkspaceRevision) {
    throw new ConflictError('The workspace changed before the comment could be applied.');
  }

  const file = await tx.workspaceFile.findFirst({
    where: {
      deletedAt: null,
      documentId: workspace.id,
      id: input.fileId,
      organizationId: actor.organizationId,
      type: 'file',
    },
  });
  if (!file) throw new NotFoundError('Source file not found.');
  if (file.revision !== input.expectedFileRevision) {
    throw new ConflictError('The source file changed before the comment could be applied.');
  }

  const thread = await tx.commentThread.findFirst({
    where: {
      deletedAt: null,
      documentId: workspace.id,
      id: input.threadId,
      organizationId: actor.organizationId,
    },
  });
  if (!thread) throw new NotFoundError('Comment thread not found.');
  if (thread.revision !== input.expectedThreadRevision) {
    throw new ConflictError('The comment thread changed before its source edit was applied.');
  }
  if (thread.status !== 'open') {
    throw new ConflictError('Only an open comment thread can be applied to source.');
  }
  if (thread.versionId !== null || thread.draftRevision !== workspace.draftRevision) {
    throw new ConflictError('Only a comment on the current draft can be applied to source.');
  }
  if (thread.fileId !== file.id) {
    throw new ConflictError('The comment thread is not anchored to this source file.');
  }

  return { file, thread, workspace };
}

function validateInput(input: ApplyCommentSourceChangeInput) {
  for (const [field, value] of [
    ['expectedFileRevision', input.expectedFileRevision],
    ['expectedThreadRevision', input.expectedThreadRevision],
    ['expectedWorkspaceRevision', input.expectedWorkspaceRevision],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new ValidationError(`${field} must be a positive integer.`);
    }
  }
  if (!input.workspaceId.trim() || !input.fileId.trim() || !input.threadId.trim()) {
    throw new ValidationError('workspaceId, fileId, and threadId are required.');
  }
  if (typeof input.nextContent !== 'string') {
    throw new ValidationError('nextContent must be a string.');
  }
}
