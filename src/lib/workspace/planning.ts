import { createHash } from 'node:crypto';

import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ConflictError, NotFoundError, ValidationError, safeJsonParse } from '@/framework/resilience';
import { mapWorkspaceFile } from '@/objects/file/schema';
import {
  normalizeStoredDeliverableType,
  parseStoredDeliverableType,
} from '@/lib/workspace/deliverable-types';
import { deriveRenderAs } from '@/lib/workspace/render-as';
import { resolveWorkflowExtensionHints } from '@/lib/workflows/extension-hints';
import { buildDefaultPlanStages } from '@/lib/workspace/plan-blueprints';
import type {
  AssistantRunData,
  DeliverableData,
  DeliverableType,
  RenderAs,
  StagedChangePatchData,
  StagedChangeOperation,
  StagedChangeSetData,
  WorkflowPlaybookData,
  WorkspaceWorkflowStatusData,
  WorkspaceFileData,
  WorkspacePlanData,
  WorkspacePlanStageData,
  WorkspaceVersionData,
} from '@/types';

type ActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

export type CreateStagedChangeSetInput = {
  baseDraftRevision: number;
  baseVersionId: string | null;
  changes: StagedChangePatchInput[];
  conversationId?: string | null;
  sourceType?: string;
  summary: string;
  title: string;
  workspaceId: string;
};

type WorkspaceRecord = {
  id: string;
  title: string;
  content: string;
  status: string;
  currentVersion: number;
};

type WorkspacePlanRecord = {
  id: string;
  organizationId: string;
  documentId: string;
  activeWorkflowPlaybookId?: string | null;
  goal: string;
  deliverableType: string;
  constraints: string | null;
  styleGuide: string | null;
  status: string;
  version: number;
  stagesJson: string;
  activeStageId: string | null;
  lastProgressNote: string | null;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  activeWorkflowPlaybook?: {
    id: string;
    organizationId: string;
    documentId: string | null;
    sourceVersionId: string | null;
    sourceThreadId: string | null;
    status: string;
    title: string;
    summary: string;
    steps?: string | null;
    constraints?: string | null;
    checklist?: string | null;
    extensionHints?: string | null;
    content: string;
    archivedAt?: Date | null;
    createdByUserId: string | null;
    originDeviceId: string | null;
    revision: number;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
};

type StagedChangeSetRecord = {
  id: string;
  organizationId: string;
  documentId: string;
  sessionId: string | null;
  baseVersionId: string | null;
  baseVersionSha256: string | null;
  baseDraftRevision: number | null;
  patchSchemaVersion: number | null;
  patchSha256: string | null;
  appliedCheckpointVersionId: string | null;
  title: string;
  summary: string;
  status: string;
  sourceType: string;
  changesJson: string;
  createdByUserId: string | null;
  originDeviceId: string | null;
  appliedAt: Date | null;
  discardedAt: Date | null;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  revision: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export const STAGED_CHANGE_PATCH_SCHEMA_VERSION = 1 as const;

export type StagedChangePatchInput = {
  operation: StagedChangeOperation;
  fileId: string | null;
  kind: StagedChangePatchData['kind'];
  name: string;
  nextContent: string | null;
  preimage: {
    content: string;
    revision: number;
  } | null;
  summary: string;
};

export function inferDeliverableType(input: {
  explicitType?: string | null;
  fileKind?: string | null;
  goal?: string | null;
  title?: string | null;
  files?: Array<{ path: string; kind?: string | null }> | null;
}): DeliverableType {
  const normalizedExplicitType = normalizeStoredDeliverableType(input.explicitType);
  if (normalizedExplicitType === 'web') {
    return normalizedExplicitType;
  }

  if (normalizedExplicitType === 'document') {
    return 'document';
  }

  const corpus = [
    input.goal || '',
    input.title || '',
    ...(input.files?.map((file) => `${file.path} ${file.kind || ''}`) || []),
  ]
    .join(' ')
    .toLowerCase();

  if (
    /slides|deck|presentation|ppt|pptx|幻灯片|演示文稿|课件/.test(corpus)
  ) {
    return 'document';
  }

  if (
    /landing|frontend|front-end|website|web app|page|页面|网页|组件|next\.js|react|vite|html|css/.test(
      corpus
    )
  ) {
    return 'web';
  }

  return 'document';
}

export async function getWorkspacePlan(params: {
  organizationId: string;
  workspaceId: string;
}) {
  const findWorkspacePlanUnique = prisma.workspacePlan.findUnique as unknown as (
    args: object
  ) => Promise<unknown>;
  const plan = await prisma.workspacePlan.findFirst({
    where: {
      deletedAt: null,
      documentId: params.workspaceId,
      organizationId: params.organizationId,
    },
  } as object);

  const hydratedPlan = plan
    ? await findWorkspacePlanUnique({
        where: { documentId: params.workspaceId },
        include: { activeWorkflowPlaybook: true },
      })
    : null;

  return hydratedPlan ? mapWorkspacePlan(hydratedPlan as WorkspacePlanRecord) : null;
}

export async function getWorkspacePlanResultShape(params: {
  organizationId: string;
  plan: WorkspacePlanData | null;
  workspaceId: string;
}): Promise<RenderAs | null> {
  const workspace = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: params.workspaceId,
      organizationId: params.organizationId,
    },
    include: {
      files: {
        where: { deletedAt: null },
      },
    },
  });

  if (!workspace) {
    return null;
  }

  return buildDeliverable({
    currentVersion: workspace.currentVersion,
    files: workspace.files.map(mapWorkspaceFile),
    plan: params.plan,
    storedDeliverableType: params.plan?.deliverableType || null,
    workspace,
  }).renderAs;
}

export async function upsertWorkspacePlan(
  actor: ActorContext,
  input: {
    activeStageId?: string | null;
    activeWorkflowPlaybookId?: string | null;
    constraints?: string | null;
    deliverableType?: DeliverableType;
    goal: string;
    incrementVersion?: boolean;
    lastProgressNote?: string | null;
    stages?: WorkspacePlanStageData[];
    status?: string;
    styleGuide?: string | null;
    workspaceId: string;
  }
) {
  const upsertWorkspacePlanRecord = prisma.workspacePlan.upsert as unknown as (
    args: object
  ) => Promise<unknown>;
  const workspace = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: input.workspaceId,
      organizationId: actor.organizationId,
    },
    include: {
      files: {
        where: { deletedAt: null },
      },
    },
  });

  if (!workspace) {
    throw new Error('Workspace not found.');
  }

  const deliverableType =
    input.deliverableType ||
    inferDeliverableType({
      goal: input.goal,
      title: workspace.title,
      files: workspace.files.map((file) => ({ path: file.path, kind: file.kind })),
    });
  const goal = input.goal.trim() || 'Create a new deliverable';
  const constraints = input.constraints?.trim() || null;
  const styleGuide = input.styleGuide?.trim() || null;
  const existing = await prisma.workspacePlan.findUnique({
    where: { documentId: input.workspaceId },
  });
  const nextActiveWorkflowPlaybook =
    input.activeWorkflowPlaybookId !== undefined && input.activeWorkflowPlaybookId !== null
      ? await prisma.workflowPlaybook.findFirst({
          where: {
            deletedAt: null,
            id: input.activeWorkflowPlaybookId,
            organizationId: actor.organizationId,
            status: 'active',
          },
          select: { id: true },
        })
      : undefined;

  if (input.activeWorkflowPlaybookId && !nextActiveWorkflowPlaybook) {
    throw new Error('Only active workflow playbooks can be applied to a task.');
  }

  const stages = resolvePlanStages({
    deliverableType,
    existing: existing ? mapWorkspacePlan(existing as WorkspacePlanRecord) : null,
    nextStages: input.stages,
  });
  const activeStageId =
    input.activeStageId ||
    stages.find((stage) => stage.status === 'in_progress')?.id ||
    stages[0]?.id ||
    null;

  const plan = await upsertWorkspacePlanRecord({
    where: { documentId: input.workspaceId },
    create: {
      organizationId: actor.organizationId,
      documentId: input.workspaceId,
      goal,
      deliverableType,
      constraints,
      styleGuide,
      status: input.status || 'drafting',
      version: 1,
      stagesJson: JSON.stringify(stages),
      activeStageId,
      lastProgressNote: input.lastProgressNote || null,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      ...(input.activeWorkflowPlaybookId
        ? {
            activeWorkflowPlaybookId: nextActiveWorkflowPlaybook!.id,
          }
        : {}),
    },
    update: {
      goal,
      deliverableType,
      constraints,
      styleGuide,
      status: input.status || 'drafting',
      ...(input.incrementVersion ? { version: { increment: 1 } } : {}),
      ...(input.activeWorkflowPlaybookId !== undefined
        ? {
            activeWorkflowPlaybook: input.activeWorkflowPlaybookId
              ? {
                  connect: {
                    id: nextActiveWorkflowPlaybook!.id,
                  },
                }
              : {
                  disconnect: true,
                },
          }
        : {}),
      stagesJson: JSON.stringify(stages),
      activeStageId,
      lastProgressNote:
        input.lastProgressNote === undefined
          ? existing?.lastProgressNote || null
          : input.lastProgressNote,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      revision: {
        increment: 1,
      },
    },
    include: {
      activeWorkflowPlaybook: true,
    },
  });

  return mapWorkspacePlan(plan as WorkspacePlanRecord);
}

export async function updateWorkspacePlan(
  actor: ActorContext,
  input: {
    activeStageId?: string | null;
    activeWorkflowPlaybookId?: string | null;
    constraints?: string | null;
    deliverableType?: DeliverableType;
    goal?: string;
    incrementVersion?: boolean;
    lastProgressNote?: string | null;
    stages?: WorkspacePlanStageData[];
    status?: string;
    styleGuide?: string | null;
    workspaceId: string;
  }
) {
  const existing = await prisma.workspacePlan.findUnique({
    where: { documentId: input.workspaceId },
  });

  if (!existing) {
    throw new Error('Workspace plan not found.');
  }

  const updateWorkspacePlanRecord = prisma.workspacePlan.update as unknown as (
    args: object
  ) => Promise<unknown>;
  const nextActiveWorkflowPlaybook =
    input.activeWorkflowPlaybookId !== undefined && input.activeWorkflowPlaybookId !== null
      ? await prisma.workflowPlaybook.findFirst({
          where: {
            deletedAt: null,
            id: input.activeWorkflowPlaybookId,
            organizationId: actor.organizationId,
            status: 'active',
          },
          select: { id: true },
        })
      : undefined;

  if (input.activeWorkflowPlaybookId && !nextActiveWorkflowPlaybook) {
    throw new Error('Only active workflow playbooks can be applied to a task.');
  }

  const deliverableType =
    input.deliverableType || normalizeDeliverableType(existing.deliverableType);
  const nextStages = resolvePlanStages({
    deliverableType,
    existing: mapWorkspacePlan(existing as WorkspacePlanRecord),
    nextStages: input.stages,
  });
  const activeStageId =
    input.activeStageId ||
    nextStages.find((stage) => stage.status === 'in_progress')?.id ||
    existing.activeStageId ||
    nextStages[0]?.id ||
    null;

  const plan = await updateWorkspacePlanRecord({
    where: { documentId: input.workspaceId },
    data: {
      ...(input.goal !== undefined ? { goal: input.goal.trim() } : {}),
      ...(input.deliverableType !== undefined
        ? { deliverableType: input.deliverableType }
        : {}),
      ...(input.constraints !== undefined
        ? { constraints: input.constraints?.trim() || null }
        : {}),
      ...(input.styleGuide !== undefined
        ? { styleGuide: input.styleGuide?.trim() || null }
        : {}),
      ...(input.activeWorkflowPlaybookId !== undefined
        ? {
            activeWorkflowPlaybook: input.activeWorkflowPlaybookId
              ? {
                  connect: {
                    id: nextActiveWorkflowPlaybook!.id,
                  },
                }
              : {
                  disconnect: true,
                },
          }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.incrementVersion ? { version: { increment: 1 } } : {}),
      stagesJson: JSON.stringify(nextStages),
      activeStageId,
      ...(input.lastProgressNote !== undefined
        ? { lastProgressNote: input.lastProgressNote }
        : {}),
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      revision: {
        increment: 1,
      },
    },
    include: {
      activeWorkflowPlaybook: true,
    },
  });

  return mapWorkspacePlan(plan as WorkspacePlanRecord);
}

export async function listStagedChangeSets(params: {
  organizationId: string;
  workspaceId: string;
}) {
  const items = await prisma.stagedChangeSet.findMany({
    where: {
      deletedAt: null,
      documentId: params.workspaceId,
      organizationId: params.organizationId,
    },
    orderBy: { createdAt: 'desc' },
  });

  return items.map(mapStagedChangeSet);
}

export async function createStagedChangeSet(
  actor: ActorContext,
  input: CreateStagedChangeSetInput
) {
  return prisma.$transaction((tx) =>
    createStagedChangeSetInTransaction(tx, actor, input)
  );
}

export async function createStagedChangeSetInTransaction(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  input: CreateStagedChangeSetInput
) {
  const changes = normalizeStagedChangePatches(input.changes);
  const changesJson = canonicalJson(changes);
  const patchSha256 = sha256(changesJson);
  const title = input.title.trim();
  const summary = input.summary.trim();
  if (!title || !summary) {
    throw new ValidationError('A proposal requires a title and summary.');
  }
  if (!Number.isSafeInteger(input.baseDraftRevision) || input.baseDraftRevision < 0) {
    throw new ValidationError('A proposal base draft revision must be a non-negative integer.');
  }

  const workspace = await tx.document.findFirst({
    where: {
      deletedAt: null,
      id: input.workspaceId,
      organizationId: actor.organizationId,
    },
    select: { draftBaseVersionId: true, draftRevision: true },
  });
  if (!workspace) {
    throw new NotFoundError('Workspace not found.');
  }
  if (workspace.draftRevision !== input.baseDraftRevision) {
    throw new ConflictError('The document draft changed before the proposal was recorded.');
  }
  if (workspace.draftBaseVersionId !== input.baseVersionId) {
    throw new ConflictError('The document base version changed before the proposal was recorded.');
  }

  await assertProposalFilePreimages(tx, {
    changes,
    organizationId: actor.organizationId,
    workspaceId: input.workspaceId,
  });
  const baseVersionSha256 = await resolveBaseVersionSha256(tx, {
    baseVersionId: input.baseVersionId,
    organizationId: actor.organizationId,
    workspaceId: input.workspaceId,
  });

  const changeSet = await tx.stagedChangeSet.create({
    data: {
      organizationId: actor.organizationId,
      documentId: input.workspaceId,
      sessionId: input.conversationId || null,
      baseVersionId: input.baseVersionId,
      baseVersionSha256,
      baseDraftRevision: input.baseDraftRevision,
      patchSchemaVersion: STAGED_CHANGE_PATCH_SCHEMA_VERSION,
      patchSha256,
      title,
      summary,
      sourceType: input.sourceType?.trim() || 'ai',
      changesJson,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
    },
  });

  return mapStagedChangeSet(changeSet);
}

export async function markStagedChangeSetStatus(
  actor: ActorContext,
  input: {
    changeSetId: string;
    checkpointVersionId?: string | null;
    expectedRevision: number;
    status: 'applied' | 'discarded';
  }
) {
  const existing = await prisma.stagedChangeSet.findFirst({
    where: {
      deletedAt: null,
      id: input.changeSetId,
      organizationId: actor.organizationId,
    },
  });

  if (!existing) {
    throw new Error('Staged change set not found.');
  }

  if (existing.status !== 'pending' || existing.revision !== input.expectedRevision) {
    throw new ConflictError('The proposal changed before this review decision.');
  }

  const updated = await prisma.stagedChangeSet.updateMany({
    where: { id: existing.id, revision: input.expectedRevision, status: 'pending' },
    data: {
      status: input.status,
      ...(input.status === 'applied'
        ? {
            appliedAt: new Date(),
            appliedCheckpointVersionId: input.checkpointVersionId || null,
          }
        : {
            discardedAt: new Date(),
          }),
      originDeviceId: actor.deviceId,
      reviewedAt: new Date(),
      reviewedByUserId: actor.userId,
      revision: {
        increment: 1,
      },
    },
  });
  if (updated.count !== 1) {
    throw new ConflictError('The proposal changed before this review decision.');
  }
  const next = await prisma.stagedChangeSet.findUnique({ where: { id: existing.id } });
  if (!next) {
    throw new NotFoundError('Staged change set not found.');
  }

  return mapStagedChangeSet(next);
}

export function buildDeliverable(params: {
  currentVersion: number;
  files: WorkspaceFileData[];
  plan: WorkspacePlanData | null;
  storedDeliverableType?: string | null;
  workspace: WorkspaceRecord;
}): DeliverableData {
  const deliverableFiles = params.files.filter((file) => file.role === 'deliverable');
  const primaryFile =
    deliverableFiles.find((file) => file.isPrimary && file.nodeType === 'file') ||
    deliverableFiles.find((file) => file.nodeType === 'file') ||
    null;
  const inferredType =
    params.plan?.deliverableType ||
    inferDeliverableType({
      goal: params.plan?.goal || params.workspace.title,
      files: deliverableFiles.map((file) => ({ path: file.path, kind: file.kind })),
      title: primaryFile?.name || params.workspace.title,
    });
  const storedDeliverableType = parseStoredDeliverableType(params.storedDeliverableType);
  const content = primaryFile?.content || params.workspace.content;

  return {
    id: primaryFile?.id || params.workspace.id,
    workspaceId: params.workspace.id,
    title: params.workspace.title,
    deliverableType: inferredType,
    storedDeliverableType,
    renderAs: deriveRenderAs({
      content,
      deliverableType: inferredType,
      storedDeliverableType,
    }),
    persistedStatus: params.workspace.status,
    content,
    primaryFileId: primaryFile?.id || null,
    currentVersion: params.currentVersion,
  };
}

export function mapWorkspacePlan(plan: WorkspacePlanRecord): WorkspacePlanData {
  const deliverableType = normalizeDeliverableType(plan.deliverableType);
  const stages = parsePlanStages(plan.stagesJson, deliverableType, plan.status);
  return {
    id: plan.id,
    organizationId: plan.organizationId,
    workspaceId: plan.documentId,
    activeWorkflowPlaybookId: plan.activeWorkflowPlaybookId || null,
    activeWorkflowPlaybook: mapWorkflowPlaybook(plan.activeWorkflowPlaybook || null),
    goal: plan.goal,
    deliverableType,
    constraints: plan.constraints,
    styleGuide: plan.styleGuide,
    status: plan.status,
    version: plan.version,
    activeStageId:
      plan.activeStageId ||
      stages.find((stage) => stage.status === 'in_progress')?.id ||
      stages[0]?.id ||
      null,
    lastProgressNote: plan.lastProgressNote,
    stages,
    createdByUserId: plan.createdByUserId,
    originDeviceId: plan.originDeviceId,
    revision: plan.revision,
    deletedAt: plan.deletedAt,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export function mapStagedChangeSet(changeSet: StagedChangeSetRecord): StagedChangeSetData {
  return {
    id: changeSet.id,
    organizationId: changeSet.organizationId,
    workspaceId: changeSet.documentId,
    conversationId: changeSet.sessionId,
    baseVersionId: changeSet.baseVersionId,
    baseVersionSha256: changeSet.baseVersionSha256,
    baseDraftRevision: changeSet.baseDraftRevision,
    patchSchemaVersion: changeSet.patchSchemaVersion,
    patchSha256: changeSet.patchSha256,
    appliedCheckpointVersionId: changeSet.appliedCheckpointVersionId,
    title: changeSet.title,
    summary: changeSet.summary,
    status: normalizeChangeStatus(changeSet.status),
    sourceType: changeSet.sourceType,
    changes: parseChangeSetPatches(changeSet.changesJson),
    createdByUserId: changeSet.createdByUserId,
    originDeviceId: changeSet.originDeviceId,
    appliedAt: changeSet.appliedAt,
    discardedAt: changeSet.discardedAt,
    reviewedByUserId: changeSet.reviewedByUserId,
    reviewedAt: changeSet.reviewedAt,
    revision: changeSet.revision,
    deletedAt: changeSet.deletedAt,
    createdAt: changeSet.createdAt,
    updatedAt: changeSet.updatedAt,
  };
}

export function isVisibleVersion(version: Pick<WorkspaceVersionData, 'visible'>) {
  return version.visible;
}

export function createInitialWorkspacePlan(params: {
  activeWorkflowPlaybookId?: string | null;
  constraints?: string | null;
  deliverableType: DeliverableType;
  goal: string;
  styleGuide?: string | null;
}): {
  activeStageId: string | null;
  activeWorkflowPlaybookId: string | null;
  constraints: string | null;
  deliverableType: DeliverableType;
  goal: string;
  lastProgressNote: string | null;
  stages: WorkspacePlanStageData[];
  status: string;
  styleGuide: string | null;
  version: number;
} {
  return {
    activeStageId: null,
    activeWorkflowPlaybookId: params.activeWorkflowPlaybookId || null,
    constraints: params.constraints?.trim() || null,
    deliverableType: params.deliverableType,
    goal: params.goal.trim() || 'Create a new deliverable',
    lastProgressNote: null,
    stages: [],
    status: 'generating',
    styleGuide: params.styleGuide?.trim() || null,
    version: 1,
  };
}

function mapWorkflowPlaybook(
  playbook: WorkspacePlanRecord['activeWorkflowPlaybook']
): WorkflowPlaybookData | null {
  if (!playbook) {
    return null;
  }

  const parseStructuredList = (raw: string | null | undefined) =>
    (raw || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '').trim())
      .filter(Boolean);

  return {
    id: playbook.id,
    organizationId: playbook.organizationId,
    workspaceId: playbook.documentId,
    sourceVersionId: playbook.sourceVersionId,
    sourceThreadId: playbook.sourceThreadId,
    status:
      playbook.status === 'active' || playbook.status === 'archived'
        ? playbook.status
        : 'draft',
    title: playbook.title,
    summary: playbook.summary,
    steps: parseStructuredList(playbook.steps),
    constraints: parseStructuredList(playbook.constraints),
    checklist: parseStructuredList(playbook.checklist),
    extensionHints: resolveWorkflowExtensionHints({
      originDeviceId: playbook.originDeviceId,
      serialized: playbook.extensionHints,
    }),
    content: playbook.content,
    archivedAt: playbook.archivedAt || null,
    createdByUserId: playbook.createdByUserId,
    originDeviceId: playbook.originDeviceId,
    revision: playbook.revision,
    deletedAt: playbook.deletedAt,
    createdAt: playbook.createdAt,
    updatedAt: playbook.updatedAt,
  };
}

export function hydrateWorkspacePlanForView(params: {
  activeAssistantRun: AssistantRunData | null;
  plan: WorkspacePlanData | null;
  workflowStatus: WorkspaceWorkflowStatusData | null;
}) {
  if (!params.plan) {
    return null;
  }

  const activeWorkflowPlaybook = params.plan.activeWorkflowPlaybook?.status !== 'active'
    ? null
    : params.plan.activeWorkflowPlaybook;
  const activeWorkflowPlaybookId = activeWorkflowPlaybook
    ? params.plan.activeWorkflowPlaybookId
    : null;

  if (
    (params.plan.status === 'generating' || params.plan.status === 'blocked') &&
    params.plan.stages.length === 0
  ) {
    return {
      ...params.plan,
      activeStageId: null,
      activeWorkflowPlaybook,
      activeWorkflowPlaybookId,
      lastProgressNote:
        params.workflowStatus?.blockedReason ||
        params.workflowStatus?.statusDescription ||
        params.plan.lastProgressNote,
      stages: [],
    };
  }

  const stages =
    params.plan.stages.length > 0
      ? params.plan.stages
      : buildDefaultPlanStages(params.plan.deliverableType);
  const activeStageKind = resolveActiveStageKind({
    activeAssistantRun: params.activeAssistantRun,
    deliverableType: params.plan.deliverableType,
    workflowStatus: params.workflowStatus,
  });
  const activeIndex = stages.findIndex((stage) => stage.kind === activeStageKind);
  const normalizedIndex = activeIndex >= 0 ? activeIndex : 0;
  const normalizedStages = stages.map((stage, index) => {
    if (params.workflowStatus?.phase === 'blocked' && index === normalizedIndex) {
      return { ...stage, status: 'blocked' as const };
    }

    if (params.workflowStatus?.phase === 'finalized') {
      return { ...stage, status: 'completed' as const };
    }

    if (index < normalizedIndex) {
      return { ...stage, status: 'completed' as const };
    }

    if (index === normalizedIndex) {
      return { ...stage, status: 'in_progress' as const };
    }

    return { ...stage, status: 'pending' as const };
  });

  return {
    ...params.plan,
    activeStageId: normalizedStages[normalizedIndex]?.id || params.plan.activeStageId,
    activeWorkflowPlaybook,
    activeWorkflowPlaybookId,
    lastProgressNote:
      params.workflowStatus?.blockedReason ||
      params.workflowStatus?.statusDescription ||
      params.plan.lastProgressNote,
    stages: normalizedStages,
  };
}

function normalizeDeliverableType(value: string): DeliverableType {
  return normalizeStoredDeliverableType(value) || 'document';
}

function normalizeChangeStatus(
  value: string
): StagedChangeSetData['status'] {
  if (value === 'applied' || value === 'discarded') {
    return value;
  }

  return 'pending';
}

function parseChangeSetPatches(changesJson: string): StagedChangePatchData[] {
  const parsed = safeJsonParse<unknown>(changesJson, null);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const change = value as Record<string, unknown>;
    const operation = normalizeStagedChangeOperation(change.operation, change.fileId);
    const preimage = normalizeStoredPreimage(change.preimage);
    return [{
      operation,
      fileId: typeof change.fileId === 'string' ? change.fileId : null,
      name: typeof change.name === 'string' ? change.name : 'Untitled change',
      summary: typeof change.summary === 'string' ? change.summary : '',
      nextContent:
        operation === 'delete'
          ? null
          : typeof change.nextContent === 'string'
            ? change.nextContent
            : '',
      kind: normalizeStagedChangeKind(change.kind),
      preimage,
    } satisfies StagedChangePatchData];
  });
}

function normalizeStagedChangePatches(
  changes: StagedChangePatchInput[]
): StagedChangePatchData[] {
  if (changes.length === 0 || changes.length > 50) {
    throw new ValidationError('A proposal must contain between 1 and 50 file operations.');
  }
  const existingFileIds = changes.flatMap((change) => change.fileId ? [change.fileId] : []);
  if (new Set(existingFileIds).size !== existingFileIds.length) {
    throw new ConflictError('A proposal may contain only one operation per existing file.');
  }

  const createNames = new Set<string>();
  return changes.map((change) => {
    const name = change.name.trim();
    const summary = change.summary.trim();
    if (!name || !summary) {
      throw new ValidationError('Every proposal operation requires a name and summary.');
    }
    if (change.operation === 'create') {
      if (change.fileId !== null || change.preimage !== null || change.nextContent === null) {
        throw new ValidationError('A create operation requires a null file and preimage plus content.');
      }
      if (createNames.has(name)) {
        throw new ConflictError('A proposal may create a file name only once.');
      }
      createNames.add(name);
    } else if (!change.fileId || !change.preimage) {
      throw new ValidationError('Update and delete operations require an existing-file preimage.');
    } else if (change.operation === 'update' && change.nextContent === null) {
      throw new ValidationError('An update operation requires content.');
    } else if (change.operation === 'delete' && change.nextContent !== null) {
      throw new ValidationError('A delete operation cannot include next content.');
    }
    if (change.preimage && (!Number.isSafeInteger(change.preimage.revision) || change.preimage.revision < 1)) {
      throw new ValidationError('A file preimage revision must be a positive integer.');
    }

    return {
      operation: change.operation,
      fileId: change.fileId,
      kind: change.kind,
      name,
      nextContent: change.nextContent,
      preimage: change.preimage
        ? {
            content: change.preimage.content,
            contentSha256: sha256(change.preimage.content),
            revision: change.preimage.revision,
          }
        : null,
      summary,
    };
  });
}

function normalizeStagedChangeOperation(
  value: unknown,
  fileId: unknown
): StagedChangeOperation {
  if (value === 'create' || value === 'update' || value === 'delete') return value;
  return typeof fileId === 'string' ? 'update' : 'create';
}

function normalizeStagedChangeKind(value: unknown): StagedChangePatchData['kind'] {
  return value === 'markdown' || value === 'text' || value === 'code'
    ? value
    : 'richtext';
}

function normalizeStoredPreimage(
  value: unknown
): StagedChangePatchData['preimage'] {
  if (!value || typeof value !== 'object') return null;
  const preimage = value as Record<string, unknown>;
  if (
    typeof preimage.content !== 'string' ||
    typeof preimage.contentSha256 !== 'string' ||
    typeof preimage.revision !== 'number'
  ) {
    return null;
  }
  return {
    content: preimage.content,
    contentSha256: preimage.contentSha256,
    revision: preimage.revision,
  };
}

async function assertProposalFilePreimages(
  db: Prisma.TransactionClient,
  params: {
    changes: StagedChangePatchData[];
    organizationId: string;
    workspaceId: string;
  }
) {
  const fileIds = params.changes.flatMap((change) => change.fileId ? [change.fileId] : []);
  const files = fileIds.length > 0
    ? await db.workspaceFile.findMany({
        where: {
          deletedAt: null,
          documentId: params.workspaceId,
          id: { in: fileIds },
          organizationId: params.organizationId,
        },
        select: { content: true, id: true, revision: true },
      })
    : [];
  const byId = new Map(files.map((file) => [file.id, file]));
  for (const change of params.changes) {
    if (change.operation === 'create') continue;
    const file = change.fileId ? byId.get(change.fileId) : null;
    if (!file) {
      throw new ConflictError('A proposed document file is no longer available.');
    }
    if (
      !change.preimage ||
      file.revision !== change.preimage.revision ||
      file.content !== change.preimage.content ||
      sha256(file.content) !== change.preimage.contentSha256
    ) {
      throw new ConflictError('A proposed document file changed before the proposal was recorded.');
    }
  }
}

async function resolveBaseVersionSha256(
  db: Prisma.TransactionClient,
  params: {
  baseVersionId: string | null;
  organizationId: string;
  workspaceId: string;
  }
) {
  if (!params.baseVersionId) return null;
  const version = await db.version.findFirst({
    where: {
      deletedAt: null,
      documentId: params.workspaceId,
      id: params.baseVersionId,
      organizationId: params.organizationId,
    },
    select: { content: true },
  });
  if (!version) {
    throw new ConflictError('The proposal base version is not available in this workspace.');
  }
  return sha256(version.content);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`;
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function parsePlanStages(
  raw: string,
  deliverableType: DeliverableType,
  status?: string
): WorkspacePlanStageData[] {
  const allowEmptyStages = status === 'generating' || status === 'blocked';

  const parsed = safeJsonParse<unknown>(raw, null);
  if (!Array.isArray(parsed)) {
    return allowEmptyStages ? [] : buildDefaultPlanStages(deliverableType);
  }

  const fallbackStages = buildDefaultPlanStages(deliverableType);
  const normalized = parsed
    .map((stage, index) => {
      if (!stage || typeof stage !== 'object') {
        return null;
      }

      const stageRecord = stage as Record<string, unknown>;
      const fallback = fallbackStages[index] || fallbackStages[fallbackStages.length - 1];
      return {
        id:
          typeof stageRecord.id === 'string' && stageRecord.id.trim()
            ? stageRecord.id.trim()
            : fallback?.id || `stage-${index + 1}`,
        kind:
          typeof stageRecord.kind === 'string' && stageRecord.kind.trim()
            ? stageRecord.kind.trim()
            : fallback?.kind || 'clarify',
        title:
          typeof stageRecord.title === 'string' && stageRecord.title.trim()
            ? stageRecord.title.trim()
            : fallback?.title || 'Stage',
        description:
          typeof stageRecord.description === 'string'
            ? stageRecord.description.trim()
            : fallback?.description || '',
        status:
          stageRecord.status === 'completed' ||
          stageRecord.status === 'blocked' ||
          stageRecord.status === 'in_progress'
            ? stageRecord.status
            : 'pending',
        checkpoint: Boolean(stageRecord.checkpoint ?? fallback?.checkpoint),
      } satisfies WorkspacePlanStageData;
    })
    .filter((stage): stage is WorkspacePlanStageData => Boolean(stage));

  if (normalized.length > 0) {
    return normalized;
  }

  return allowEmptyStages ? [] : fallbackStages;
}

function resolvePlanStages(params: {
  deliverableType: DeliverableType;
  existing: WorkspacePlanData | null;
  nextStages?: WorkspacePlanStageData[];
}) {
  if (params.nextStages !== undefined) {
    return params.nextStages;
  }

  if (params.existing && params.existing.deliverableType === params.deliverableType) {
    return params.existing.stages;
  }

  return buildDefaultPlanStages(params.deliverableType);
}

function resolveActiveStageKind(params: {
  activeAssistantRun: AssistantRunData | null;
  workflowStatus: WorkspaceWorkflowStatusData | null;
  deliverableType: DeliverableType;
}) {
  if (params.workflowStatus?.phase === 'planning') {
    return 'clarify';
  }

  if (params.workflowStatus?.phase === 'implementing') {
    if (params.activeAssistantRun?.mode === 'replan') {
      return 'structure';
    }

    if (params.deliverableType === 'web') {
      return 'render';
    }

    return 'draft';
  }

  if (
    params.workflowStatus?.phase === 'preview_ready' ||
    params.workflowStatus?.phase === 'preview_running'
  ) {
    return params.deliverableType === 'web' ? 'preview' : 'review';
  }

  if (
    params.workflowStatus?.phase === 'reviewing' ||
    params.workflowStatus?.phase === 'blocked'
  ) {
    return 'review';
  }

  if (params.workflowStatus?.phase === 'finalized') {
    return 'finalize';
  }

  if (params.activeAssistantRun?.mode === 'replan') {
    return 'structure';
  }

  return 'clarify';
}
