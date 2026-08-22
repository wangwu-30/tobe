import type { Prisma } from '@/generated/prisma/client';

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  safeJsonParse,
} from '@/framework/resilience';
import { prisma } from '@/lib/db/prisma';
import { materializeWorkspaceMirror } from '@/lib/platform/mirror-manager';
import {
  buildWorkspacePath,
  inferFileLanguage,
  mapWorkspaceFile,
  mapWorkspaceFileToVersion,
  serializeWorkspaceVersion,
} from '@/objects/file/schema';
import { WorkspaceLockConflictError } from '@/objects/workspace/commands';
import {
  STAGED_CHANGE_PATCH_SCHEMA_VERSION,
  canonicalJson,
  mapStagedChangeSet,
  sha256,
} from '@/lib/workspace/planning';
import type { StagedChangePatchData } from '@/types';

type HumanActorContext = {
  actorType: 'user';
  deviceId: string;
  organizationId: string;
  userId: string;
};

type ProposalRecord = Prisma.StagedChangeSetGetPayload<Record<string, never>>;
type WorkspaceFileRecord = Prisma.WorkspaceFileGetPayload<Record<string, never>>;

export async function applyStagedChangeSet(
  actor: HumanActorContext,
  input: {
    changeSetId: string;
    checkpointTitle?: string;
    expectedRevision: number;
    workspaceId: string;
  }
) {
  assertExpectedRevision(input.expectedRevision);
  const result = await prisma.$transaction((tx) =>
    applyStagedChangeSetTransaction(tx, actor, input)
  );

  await materializeWorkspaceMirror({
    organizationId: actor.organizationId,
    workspaceId: input.workspaceId,
  }).catch((error) => {
    console.error('[document-proposal] workspace mirror refresh failed', error);
  });

  return result;
}

export async function discardStagedChangeSet(
  actor: HumanActorContext,
  input: {
    changeSetId: string;
    expectedRevision: number;
    workspaceId: string;
  }
) {
  assertExpectedRevision(input.expectedRevision);
  return prisma.$transaction(async (tx) => {
    await requireOwner(tx, actor);
    const proposal = await getProposal(tx, actor.organizationId, input);
    assertPendingProposal(proposal, input.expectedRevision);

    const reviewedAt = new Date();
    const decision = await tx.stagedChangeSet.updateMany({
      where: {
        deletedAt: null,
        documentId: input.workspaceId,
        id: input.changeSetId,
        organizationId: actor.organizationId,
        revision: input.expectedRevision,
        status: 'pending',
      },
      data: {
        discardedAt: reviewedAt,
        originDeviceId: actor.deviceId,
        reviewedAt,
        reviewedByUserId: actor.userId,
        revision: { increment: 1 },
        status: 'discarded',
      },
    });
    if (decision.count !== 1) proposalConflict('The proposal changed before it was discarded.');
    return mapStagedChangeSet(
      (await tx.stagedChangeSet.findUnique({ where: { id: proposal.id } }))!
    );
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

async function applyStagedChangeSetTransaction(
  tx: Prisma.TransactionClient,
  actor: HumanActorContext,
  input: {
    changeSetId: string;
    checkpointTitle?: string;
    expectedRevision: number;
    workspaceId: string;
  }
) {
  await requireOwner(tx, actor);
  const proposal = await getProposal(tx, actor.organizationId, input);
  assertPendingProposal(proposal, input.expectedRevision);
  const patches = assertCanonicalProposal(proposal);
  const workspace = await tx.document.findFirst({
    where: {
      deletedAt: null,
      id: input.workspaceId,
      organizationId: actor.organizationId,
    },
  });
  if (!workspace) throw new NotFoundError('Workspace not found.');

  if (workspace.draftRevision !== proposal.baseDraftRevision) {
    proposalConflict('The document draft revision no longer matches this proposal.');
  }
  if (workspace.draftBaseVersionId !== proposal.baseVersionId) {
    proposalConflict('The document base version no longer matches this proposal.');
  }
  await assertBaseVersion(tx, proposal, actor.organizationId);
  await ensureReviewLock(tx, actor, workspace.id);

  const files = await tx.workspaceFile.findMany({
    where: {
      deletedAt: null,
      documentId: workspace.id,
      organizationId: actor.organizationId,
    },
    orderBy: [{ path: 'asc' }, { sortOrder: 'asc' }],
  });
  validateFileCas(files, patches);

  const checkpoint = await createRecoveryCheckpoint(tx, actor, {
    files,
    sessionId: proposal.sessionId,
    title: input.checkpointTitle?.trim() || 'Recovery Point before Apply',
    workspace,
  });
  const finalPrimary = await applyFilePatches(tx, actor, workspace.id, files, patches);

  const documentCas = await tx.document.updateMany({
    where: {
      deletedAt: null,
      draftBaseVersionId: proposal.baseVersionId,
      draftRevision: proposal.baseDraftRevision!,
      id: workspace.id,
      organizationId: actor.organizationId,
    },
    data: {
      content: finalPrimary?.content || '',
      currentVersion: checkpoint.versionNum,
      draftRevision: { increment: 1 },
      originDeviceId: actor.deviceId,
      revision: { increment: 1 },
    },
  });
  if (documentCas.count !== 1) {
    proposalConflict('The document draft changed while this proposal was applying.');
  }

  const reviewedAt = new Date();
  const decision = await tx.stagedChangeSet.updateMany({
    where: {
      deletedAt: null,
      documentId: workspace.id,
      id: proposal.id,
      organizationId: actor.organizationId,
      revision: input.expectedRevision,
      status: 'pending',
    },
    data: {
      appliedAt: reviewedAt,
      appliedCheckpointVersionId: checkpoint.id,
      originDeviceId: actor.deviceId,
      reviewedAt,
      reviewedByUserId: actor.userId,
      revision: { increment: 1 },
      status: 'applied',
    },
  });
  if (decision.count !== 1) proposalConflict('The proposal changed while it was applying.');

  const updated = await tx.stagedChangeSet.findUnique({ where: { id: proposal.id } });
  if (!updated) throw new NotFoundError('Staged change set not found.');
  return mapStagedChangeSet(updated);
}

async function requireOwner(tx: Prisma.TransactionClient, actor: HumanActorContext) {
  if (actor.actorType !== 'user') {
    throw new ForbiddenError('Only a human organization owner can review document proposals.');
  }
  const membership = await tx.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: actor.organizationId,
        userId: actor.userId,
      },
    },
    select: { role: true },
  });
  if (membership?.role !== 'owner') {
    throw new ForbiddenError('Only an organization owner can apply or discard document proposals.');
  }
}

async function getProposal(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: { changeSetId: string; workspaceId: string }
) {
  const proposal = await tx.stagedChangeSet.findFirst({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      id: input.changeSetId,
      organizationId,
    },
  });
  if (!proposal) throw new NotFoundError('Staged change set not found.');
  return proposal;
}

function assertPendingProposal(proposal: ProposalRecord, expectedRevision: number) {
  if (proposal.status !== 'pending') proposalConflict('The proposal has already been reviewed.');
  if (proposal.revision !== expectedRevision) {
    proposalConflict('The proposal revision changed before this review decision.');
  }
}

function assertCanonicalProposal(proposal: ProposalRecord): StagedChangePatchData[] {
  if (
    proposal.patchSchemaVersion !== STAGED_CHANGE_PATCH_SCHEMA_VERSION ||
    proposal.baseDraftRevision === null ||
    !proposal.patchSha256
  ) {
    proposalConflict('This legacy proposal has no trustworthy CAS preimage.');
  }
  const parsed = safeJsonParse<unknown>(proposal.changesJson, null);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    proposalConflict('The proposal patch is invalid.');
  }
  const canonical = canonicalJson(parsed);
  if (canonical !== proposal.changesJson || sha256(canonical) !== proposal.patchSha256) {
    proposalConflict('The proposal patch hash does not match its canonical content.');
  }
  return parsed as StagedChangePatchData[];
}

async function assertBaseVersion(
  tx: Prisma.TransactionClient,
  proposal: ProposalRecord,
  organizationId: string
) {
  if (!proposal.baseVersionId) {
    if (proposal.baseVersionSha256 !== null) proposalConflict('The proposal base hash is invalid.');
    return;
  }
  const version = await tx.version.findFirst({
    where: {
      deletedAt: null,
      documentId: proposal.documentId,
      id: proposal.baseVersionId,
      organizationId,
    },
    select: { content: true },
  });
  if (!version || sha256(version.content) !== proposal.baseVersionSha256) {
    proposalConflict('The proposal base version hash no longer matches.');
  }
}

function validateFileCas(files: WorkspaceFileRecord[], patches: StagedChangePatchData[]) {
  const byId = new Map(files.map((file) => [file.id, file]));
  const createNames = new Set<string>();
  for (const patch of patches) {
    assertLeafName(patch.name);
    if (patch.operation === 'create') {
      if (patch.fileId !== null || patch.preimage !== null || patch.nextContent === null) {
        proposalConflict('A create operation has an invalid preimage.');
      }
      if (createNames.has(patch.name) || files.some((file) => file.parentId === null && file.name === patch.name)) {
        proposalConflict(`The proposed file ${patch.name} already exists.`);
      }
      createNames.add(patch.name);
      continue;
    }

    const file = patch.fileId ? byId.get(patch.fileId) : null;
    if (!file || file.type !== 'file') {
      proposalConflict(`The proposed file ${patch.name} is no longer available.`);
    }
    if (file.name !== patch.name) {
      proposalConflict(`The proposed file ${patch.name} was renamed.`);
    }
    if (
      !patch.preimage ||
      patch.preimage.revision !== file.revision ||
      patch.preimage.content !== file.content ||
      patch.preimage.contentSha256 !== sha256(file.content)
    ) {
      proposalConflict(`The proposed file ${patch.name} changed after its preimage was read.`);
    }
    if (patch.operation === 'update' && patch.nextContent === null) {
      proposalConflict(`The update for ${patch.name} has no content.`);
    }
    if (patch.operation === 'delete' && patch.nextContent !== null) {
      proposalConflict(`The delete for ${patch.name} unexpectedly contains content.`);
    }
  }
}

async function createRecoveryCheckpoint(
  tx: Prisma.TransactionClient,
  actor: HumanActorContext,
  input: {
    files: WorkspaceFileRecord[];
    sessionId: string | null;
    title: string;
    workspace: Prisma.DocumentGetPayload<Record<string, never>>;
  }
) {
  const latestVersion = await tx.version.findFirst({
    where: {
      deletedAt: null,
      documentId: input.workspace.id,
      organizationId: actor.organizationId,
    },
    orderBy: { versionNum: 'desc' },
    select: { id: true },
  });
  const mappedFiles = input.files.map((file) => mapWorkspaceFileToVersion(mapWorkspaceFile(file)));
  const version = await tx.version.create({
    data: {
      content: serializeWorkspaceVersion({ files: mappedFiles, workspaceTitle: input.title }),
      createdByUserId: actor.userId,
      documentId: input.workspace.id,
      organizationId: actor.organizationId,
      originDeviceId: actor.deviceId,
      parentVersionId: latestVersion?.id || null,
      sourceSessionId: input.sessionId,
      title: input.title,
      versionNum: input.workspace.currentVersion + 1,
    },
  });
  await tx.label.create({
    data: {
      createdByUserId: actor.userId,
      kind: 'recovery',
      name: input.title,
      organizationId: actor.organizationId,
      originDeviceId: actor.deviceId,
      versionId: version.id,
    },
  });
  return version;
}

async function applyFilePatches(
  tx: Prisma.TransactionClient,
  actor: HumanActorContext,
  workspaceId: string,
  originalFiles: WorkspaceFileRecord[],
  patches: StagedChangePatchData[]
) {
  const byId = new Map(originalFiles.map((file) => [file.id, file]));
  const deletedIds = new Set<string>();

  for (const patch of patches) {
    if (patch.operation === 'create') {
      const sortOrder = originalFiles.filter((file) => file.parentId === null).length;
      const created = await tx.workspaceFile.create({
        data: {
          content: patch.nextContent!,
          createdByUserId: actor.userId,
          documentId: workspaceId,
          isPrimary: false,
          kind: patch.kind,
          language: inferFileLanguage(patch.name),
          name: patch.name,
          organizationId: actor.organizationId,
          originDeviceId: actor.deviceId,
          path: patch.name,
          role: 'deliverable',
          sortOrder,
          type: 'file',
        },
      });
      byId.set(created.id, created);
      continue;
    }

    const existing = byId.get(patch.fileId!)!;
    if (patch.operation === 'update') {
      const updated = await tx.workspaceFile.update({
        where: { id: existing.id },
        data: {
          content: patch.nextContent!,
          createdByUserId: actor.userId,
          kind: patch.kind,
          originDeviceId: actor.deviceId,
          revision: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      byId.set(updated.id, updated);
      continue;
    }

    const deletedAt = new Date();
    await tx.workspaceFile.update({
      where: { id: existing.id },
      data: { deletedAt, originDeviceId: actor.deviceId, revision: { increment: 1 } },
    });
    await tx.commentThread.updateMany({
      where: { deletedAt: null, fileId: existing.id, organizationId: actor.organizationId },
      data: { deletedAt, originDeviceId: actor.deviceId, revision: { increment: 1 } },
    });
    deletedIds.add(existing.id);
  }

  const activeFiles = [...byId.values()].filter((file) => !deletedIds.has(file.id));
  let primary = activeFiles.find((file) => file.isPrimary && file.type === 'file') || null;
  if (!primary) {
    primary = activeFiles
      .filter((file) => file.type === 'file')
      .sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt.getTime() - right.createdAt.getTime())[0] || null;
    if (primary) {
      primary = await tx.workspaceFile.update({
        where: { id: primary.id },
        data: { isPrimary: true, revision: { increment: 1 } },
      });
      byId.set(primary.id, primary);
    }
  }
  if (deletedIds.size > 0) {
    await tx.session.updateMany({
      where: { activeFileId: { in: [...deletedIds] }, organizationId: actor.organizationId },
      data: { activeFileId: primary?.id || null, revision: { increment: 1 } },
    });
  }
  return primary ? byId.get(primary.id) || primary : null;
}

async function ensureReviewLock(
  tx: Prisma.TransactionClient,
  actor: HumanActorContext,
  workspaceId: string
) {
  const lock = await tx.wikiEditLock.findUnique({ where: { documentId: workspaceId } });
  const now = new Date();
  if (lock && lock.expiresAt > now && lock.userId !== actor.userId) {
    throw new WorkspaceLockConflictError({
      expiresAt: lock.expiresAt,
      userId: lock.userId,
      workspaceId,
    });
  }
  const expiresAt = new Date(now.getTime() + 15 * 60_000);
  if (lock) {
    await tx.wikiEditLock.update({
      where: { documentId: workspaceId },
      data: { expiresAt, originDeviceId: actor.deviceId, userId: actor.userId },
    });
  } else {
    await tx.wikiEditLock.create({
      data: {
        documentId: workspaceId,
        expiresAt,
        organizationId: actor.organizationId,
        originDeviceId: actor.deviceId,
        userId: actor.userId,
      },
    });
  }
}

function assertLeafName(name: string) {
  if (!name.trim() || name !== name.trim() || name.includes('/') || name.includes('\\')) {
    throw new ValidationError('Proposal file names must be non-empty leaf names.');
  }
  buildWorkspacePath(null, name);
}

function assertExpectedRevision(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ValidationError('expectedRevision must be a positive integer.');
  }
}

function proposalConflict(message: string): never {
  throw new ConflictError(message);
}
