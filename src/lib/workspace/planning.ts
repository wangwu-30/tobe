import { prisma } from '@/lib/db/prisma';
import {
  normalizeStoredDeliverableType,
  parseStoredDeliverableType,
} from '@/lib/workspace/deliverable-types';
import { resolveWorkflowExtensionHints } from '@/lib/workflows/extension-hints';
import { buildDefaultPlanStages } from '@/lib/workspace/plan-blueprints';
import type {
  AssistantRunData,
  DeliverableData,
  DeliverableType,
  StagedChangePatchData,
  StagedChangeSetData,
  WorkflowPlaybookData,
  WorkspaceCurrentStatusData,
  WorkspaceFileData,
  WorkspacePlanData,
  WorkspacePlanStageData,
  WorkspaceVersionType,
  WorkspaceVersionData,
} from '@/types';

type ActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
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
  revision: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
  input: {
    baseVersionId?: string | null;
    changes: StagedChangePatchData[];
    conversationId?: string | null;
    sourceType?: string;
    summary: string;
    title: string;
    workspaceId: string;
  }
) {
  const changeSet = await prisma.stagedChangeSet.create({
    data: {
      organizationId: actor.organizationId,
      documentId: input.workspaceId,
      sessionId: input.conversationId || null,
      baseVersionId: input.baseVersionId || null,
      title: input.title.trim(),
      summary: input.summary.trim(),
      sourceType: input.sourceType || 'ai',
      changesJson: JSON.stringify(input.changes),
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

  const next = await prisma.stagedChangeSet.update({
    where: { id: existing.id },
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
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      revision: {
        increment: 1,
      },
    },
  });

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

  return {
    id: primaryFile?.id || params.workspace.id,
    workspaceId: params.workspace.id,
    title: params.workspace.title,
    deliverableType: inferredType,
    storedDeliverableType: parseStoredDeliverableType(params.storedDeliverableType),
    persistedStatus: params.workspace.status,
    content: primaryFile?.content || params.workspace.content,
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
    revision: changeSet.revision,
    deletedAt: changeSet.deletedAt,
    createdAt: changeSet.createdAt,
    updatedAt: changeSet.updatedAt,
  };
}

export function isRecoveryVersionType(versionType: WorkspaceVersionType | null | undefined) {
  return versionType === 'checkpoint' || versionType === 'checkpoint_pinned';
}

export function isPinnedRecoveryVersionType(versionType: WorkspaceVersionType | null | undefined) {
  return versionType === 'checkpoint_pinned';
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
  currentStatus: WorkspaceCurrentStatusData | null;
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
        params.currentStatus?.blockedReason ||
        params.currentStatus?.statusDescription ||
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
    currentStatus: params.currentStatus,
  });
  const activeIndex = stages.findIndex((stage) => stage.kind === activeStageKind);
  const normalizedIndex = activeIndex >= 0 ? activeIndex : 0;
  const normalizedStages = stages.map((stage, index) => {
    if (params.currentStatus?.phase === 'blocked' && index === normalizedIndex) {
      return { ...stage, status: 'blocked' as const };
    }

    if (params.currentStatus?.phase === 'finalized') {
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
      params.currentStatus?.blockedReason ||
      params.currentStatus?.statusDescription ||
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
  try {
    const parsed = JSON.parse(changesJson);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((change) => ({
      fileId: typeof change?.fileId === 'string' ? change.fileId : null,
      name: typeof change?.name === 'string' ? change.name : 'Untitled change',
      summary: typeof change?.summary === 'string' ? change.summary : '',
      nextContent: typeof change?.nextContent === 'string' ? change.nextContent : '',
      kind:
        change?.kind === 'markdown' ||
        change?.kind === 'text' ||
        change?.kind === 'code'
          ? change.kind
          : 'richtext',
    }));
  } catch {
    return [];
  }
}

function parsePlanStages(
  raw: string,
  deliverableType: DeliverableType,
  status?: string
): WorkspacePlanStageData[] {
  const allowEmptyStages = status === 'generating' || status === 'blocked';

  try {
    const parsed = JSON.parse(raw) as unknown;
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
  } catch {
    return allowEmptyStages ? [] : buildDefaultPlanStages(deliverableType);
  }
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
  currentStatus: WorkspaceCurrentStatusData | null;
  deliverableType: DeliverableType;
}) {
  if (params.currentStatus?.phase === 'planning') {
    return 'clarify';
  }

  if (params.currentStatus?.phase === 'implementing') {
    if (params.activeAssistantRun?.mode === 'replan') {
      return 'structure';
    }

    if (params.deliverableType === 'web') {
      return 'render';
    }

    return 'draft';
  }

  if (
    params.currentStatus?.phase === 'preview_ready' ||
    params.currentStatus?.phase === 'preview_running'
  ) {
    return params.deliverableType === 'web' ? 'preview' : 'review';
  }

  if (params.currentStatus?.phase === 'reviewing' || params.currentStatus?.phase === 'blocked') {
    return 'review';
  }

  if (params.currentStatus?.phase === 'finalized') {
    return 'finalize';
  }

  if (params.activeAssistantRun?.mode === 'replan') {
    return 'structure';
  }

  return 'clarify';
}
