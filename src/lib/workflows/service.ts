import { prisma } from '@/lib/db/prisma';
import { getWorkspacePlan } from '@/lib/workspace/planning';
import type {
  WorkflowPlaybookData,
  WorkflowPlaybookDraftData,
  WorkflowPlaybookDraftWarningKey,
  WorkflowPlaybookStatus,
} from '@/types';

type ActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

type WorkflowPlaybookRecord = {
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
  content: string;
  archivedAt?: Date | null;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const DEFAULT_WORKFLOW_REVIEW_SIGNAL_PATTERNS = [
  /verify the structure is complete before saving a milestone/i,
  /resolve or confirm applied comments before closing review/i,
];

function parseStructuredList(raw: string | null | undefined) {
  return (raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '').trim())
    .filter(Boolean);
}

function serializeStructuredList(input?: string[] | string | null) {
  if (Array.isArray(input)) {
    return input
      .map((item) => item.trim())
      .filter(Boolean)
      .join('\n');
  }

  if (typeof input === 'string') {
    return parseStructuredList(input).join('\n');
  }

  return '';
}

function normalizeWorkflowPlaybookStatus(
  value: string | null | undefined
): WorkflowPlaybookStatus {
  if (value === 'active' || value === 'archived') {
    return value;
  }

  return 'draft';
}

function evaluateWorkflowDraftWarnings(input: {
  checklist?: string[] | null;
  constraints?: string[] | null;
  steps?: string[] | null;
}) {
  const warnings: WorkflowPlaybookDraftWarningKey[] = [];
  const normalizedSteps = (input.steps || []).map((item) => item.trim()).filter(Boolean);
  const normalizedConstraints = (input.constraints || [])
    .map((item) => item.trim())
    .filter(Boolean);
  const normalizedChecklist = (input.checklist || []).map((item) => item.trim()).filter(Boolean);
  const uniqueChecklist = [...new Set(normalizedChecklist)];

  if (normalizedSteps.length === 0) {
    warnings.push('context.workflowDraftWarningDefaultSteps');
  }

  if (
    normalizedConstraints.length === 0 ||
    normalizedConstraints.every((item) =>
      /align with the current goal|keep the method aligned/i.test(item)
    )
  ) {
    warnings.push('context.workflowDraftWarningDefaultConstraints');
  }

  if (normalizedChecklist.length !== uniqueChecklist.length) {
    warnings.push('context.workflowDraftWarningDedupedSignals');
  }

  const hasOnlyDefaultChecklist =
    uniqueChecklist.length > 0 &&
    uniqueChecklist.every((item) =>
      DEFAULT_WORKFLOW_REVIEW_SIGNAL_PATTERNS.some((pattern) => pattern.test(item))
    );

  if (uniqueChecklist.length === 0 || hasOnlyDefaultChecklist) {
    warnings.push('context.workflowDraftWarningReviewSignals');
  }

  return warnings;
}

const findWorkflowPlaybooks = prisma.workflowPlaybook.findMany as unknown as (
  args: object
) => Promise<WorkflowPlaybookRecord[]>;
const findWorkflowPlaybook = prisma.workflowPlaybook.findFirst as unknown as (
  args: object
) => Promise<WorkflowPlaybookRecord | null>;
const createWorkflowPlaybookRecord = prisma.workflowPlaybook.create as unknown as (
  args: object
) => Promise<WorkflowPlaybookRecord>;
const updateWorkflowPlaybookRecord = prisma.workflowPlaybook.update as unknown as (
  args: object
) => Promise<WorkflowPlaybookRecord>;

export function mapWorkflowPlaybook(
  item: WorkflowPlaybookRecord
): WorkflowPlaybookData {
  return {
    id: item.id,
    organizationId: item.organizationId,
    workspaceId: item.documentId,
    sourceVersionId: item.sourceVersionId,
    sourceThreadId: item.sourceThreadId,
    status: normalizeWorkflowPlaybookStatus(item.status),
    title: item.title,
    summary: item.summary,
    steps: parseStructuredList(item.steps),
    constraints: parseStructuredList(item.constraints),
    checklist: parseStructuredList(item.checklist),
    content: item.content,
    archivedAt: item.archivedAt || null,
    createdByUserId: item.createdByUserId,
    originDeviceId: item.originDeviceId,
    revision: item.revision,
    deletedAt: item.deletedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export async function listWorkflowPlaybooks(params: {
  includeArchived?: boolean;
  organizationId: string;
  workspaceId?: string | null;
}) {
  const items = await findWorkflowPlaybooks({
    where: {
      deletedAt: null,
      ...(params.includeArchived ? {} : { status: { not: 'archived' } }),
      organizationId: params.organizationId,
      ...(params.workspaceId
        ? { OR: [{ documentId: params.workspaceId }, { documentId: null }] }
        : {}),
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });

  return items.map(mapWorkflowPlaybook);
}

export async function getWorkflowPlaybook(params: {
  includeArchived?: boolean;
  id: string;
  organizationId: string;
}) {
  const item = await findWorkflowPlaybook({
    where: {
      deletedAt: null,
      id: params.id,
      organizationId: params.organizationId,
    },
  });

  if (item?.status === 'archived' && !params.includeArchived) {
    return null;
  }

  return item ? mapWorkflowPlaybook(item) : null;
}

export async function createWorkflowPlaybook(
  actor: ActorContext,
  input: {
    checklist?: string[] | string | null;
    content?: string | null;
    constraints?: string[] | string | null;
    forceActivate?: boolean;
    sourceThreadId?: string | null;
    sourceVersionId?: string | null;
    status?: WorkflowPlaybookStatus | null;
    steps?: string[] | string | null;
    summary?: string | null;
    title: string;
    workspaceId?: string | null;
  }
) {
  const steps = parseStructuredList(serializeStructuredList(input.steps));
  const constraints = parseStructuredList(serializeStructuredList(input.constraints));
  const checklist = parseStructuredList(serializeStructuredList(input.checklist));
  const nextStatus = normalizeWorkflowPlaybookStatus(input.status);
  const warnings = evaluateWorkflowDraftWarnings({
    checklist,
    constraints,
    steps,
  });

  if (nextStatus === 'active' && warnings.length > 0 && !input.forceActivate) {
    const error = new Error('Workflow draft needs review before activation.');
    (error as Error & { warnings?: WorkflowPlaybookDraftWarningKey[] }).warnings = warnings;
    throw error;
  }

  const item = await createWorkflowPlaybookRecord({
    data: {
      organizationId: actor.organizationId,
      documentId: input.workspaceId || null,
      sourceVersionId: input.sourceVersionId || null,
      sourceThreadId: input.sourceThreadId || null,
      status: nextStatus,
      title: input.title.trim(),
      summary: input.summary?.trim() || '',
      steps: serializeStructuredList(steps),
      constraints: serializeStructuredList(constraints),
      checklist: serializeStructuredList(checklist),
      content: input.content?.trim() || '',
      archivedAt: nextStatus === 'archived' ? new Date() : null,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
    },
  });

  return mapWorkflowPlaybook(item);
}

export async function updateWorkflowPlaybook(
  actor: ActorContext,
  input: {
    checklist?: string[] | string | null;
    content?: string | null;
    constraints?: string[] | string | null;
    forceActivate?: boolean;
    id: string;
    status?: WorkflowPlaybookStatus | null;
    steps?: string[] | string | null;
    summary?: string | null;
    title?: string | null;
  }
) {
  const existing = await findWorkflowPlaybook({
    where: {
      deletedAt: null,
      id: input.id,
      organizationId: actor.organizationId,
    },
  });

  if (!existing) {
    throw new Error('Workflow playbook not found.');
  }

  const currentStatus = normalizeWorkflowPlaybookStatus(existing.status);
  const nextStatus =
    input.status === null || input.status === undefined
      ? currentStatus
      : normalizeWorkflowPlaybookStatus(input.status);
  const nextSteps =
    input.steps !== undefined
      ? parseStructuredList(serializeStructuredList(input.steps))
      : parseStructuredList(existing.steps);
  const nextConstraints =
    input.constraints !== undefined
      ? parseStructuredList(serializeStructuredList(input.constraints))
      : parseStructuredList(existing.constraints);
  const nextChecklist =
    input.checklist !== undefined
      ? parseStructuredList(serializeStructuredList(input.checklist))
      : parseStructuredList(existing.checklist);
  const warnings = evaluateWorkflowDraftWarnings({
    checklist: nextChecklist,
    constraints: nextConstraints,
    steps: nextSteps,
  });

  if (nextStatus === 'active' && warnings.length > 0 && !input.forceActivate) {
    const error = new Error('Workflow draft needs review before activation.');
    (error as Error & { warnings?: WorkflowPlaybookDraftWarningKey[] }).warnings = warnings;
    throw error;
  }

  const item = await updateWorkflowPlaybookRecord({
    where: { id: existing.id },
    data: {
      ...(input.status !== undefined
        ? {
            status: nextStatus,
            archivedAt:
              nextStatus === 'archived'
                ? existing.archivedAt || new Date()
                : null,
          }
        : {}),
      ...(input.title !== undefined ? { title: input.title?.trim() || 'Untitled Workflow' } : {}),
      ...(input.summary !== undefined ? { summary: input.summary?.trim() || '' } : {}),
      ...(input.steps !== undefined ? { steps: serializeStructuredList(nextSteps) } : {}),
      ...(input.constraints !== undefined
        ? { constraints: serializeStructuredList(nextConstraints) }
        : {}),
      ...(input.checklist !== undefined
        ? { checklist: serializeStructuredList(nextChecklist) }
        : {}),
      ...(input.content !== undefined ? { content: input.content?.trim() || '' } : {}),
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      revision: {
        increment: 1,
      },
    },
  });

  if (nextStatus !== 'active') {
    await prisma.workspacePlan.updateMany({
      where: {
        deletedAt: null,
        organizationId: actor.organizationId,
        activeWorkflowPlaybookId: item.id,
      },
      data: {
        activeWorkflowPlaybookId: null,
        revision: {
          increment: 1,
        },
      },
    });
  }

  return mapWorkflowPlaybook(item);
}

export async function deleteWorkflowPlaybook(
  actor: Pick<ActorContext, 'organizationId'>,
  id: string
) {
  const playbook = await prisma.workflowPlaybook.findFirst({
    where: {
      deletedAt: null,
      id,
      organizationId: actor.organizationId,
    },
    select: { id: true },
  });

  if (!playbook) {
    return;
  }

  await prisma.workflowPlaybook.updateMany({
    where: {
      deletedAt: null,
      id,
      organizationId: actor.organizationId,
    },
    data: {
      deletedAt: new Date(),
      revision: {
        increment: 1,
      },
    },
  });

  await prisma.workspacePlan.updateMany({
    where: {
      deletedAt: null,
      organizationId: actor.organizationId,
      activeWorkflowPlaybookId: playbook.id,
    },
    data: {
      activeWorkflowPlaybookId: null,
      revision: {
        increment: 1,
      },
    },
  });
}

export function formatWorkflowPlaybookForPrompt(
  playbook: Pick<
    WorkflowPlaybookData,
    'title' | 'summary' | 'steps' | 'constraints' | 'checklist' | 'content'
  >
) {
  const parts = [`Workflow Playbook: ${playbook.title}`];

  if (playbook.summary.trim()) {
    parts.push(`Summary: ${playbook.summary.trim()}`);
  }

  if (playbook.steps.length > 0) {
    parts.push('', 'Steps:');
    playbook.steps.forEach((step, index) => {
      parts.push(`${index + 1}. ${step}`);
    });
  }

  if (playbook.constraints.length > 0) {
    parts.push('', 'Constraints:');
    playbook.constraints.forEach((item) => {
      parts.push(`- ${item}`);
    });
  }

  if (playbook.checklist.length > 0) {
    parts.push('', 'Review checklist:');
    playbook.checklist.forEach((item) => {
      parts.push(`- ${item}`);
    });
  }

  if (playbook.content.trim()) {
    parts.push('', 'Notes:', playbook.content.trim());
  }

  return parts.join('\n');
}

export async function buildWorkflowPlaybookDraft(params: {
  organizationId: string;
  workspaceId: string;
}): Promise<WorkflowPlaybookDraftData> {
  const workspace = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: params.workspaceId,
      organizationId: params.organizationId,
    },
    select: {
      id: true,
      title: true,
    },
  });

  if (!workspace) {
    throw new Error('Workspace not found.');
  }

  const [plan, latestVisibleVersion, threadRecords] = await Promise.all([
    getWorkspacePlan({
      organizationId: params.organizationId,
      workspaceId: params.workspaceId,
    }),
    prisma.version.findFirst({
      where: {
        deletedAt: null,
        documentId: params.workspaceId,
        organizationId: params.organizationId,
        NOT: {
          versionType: {
            in: ['checkpoint', 'checkpoint_pinned'],
          },
        },
      },
      orderBy: [{ versionNum: 'desc' }, { lockedAt: 'desc' }],
    }),
    prisma.commentThread.findMany({
      where: {
        deletedAt: null,
        documentId: params.workspaceId,
        organizationId: params.organizationId,
        status: {
          in: ['applied', 'resolved'],
        },
      },
      include: {
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 6,
    }),
  ]);

  if (!latestVisibleVersion) {
    throw new Error('Save a milestone before extracting a workflow draft.');
  }

  const deliverableType = plan?.deliverableType || 'document';
  const recommendedSteps =
    plan?.stages.length
      ? plan.stages.map(
          (stage) => `${stage.title}${stage.description ? `: ${stage.description}` : ''}`
        )
      : [
          'Clarify the goal and success criteria.',
          'Produce the first pass in the live draft.',
          'Review with focused comments before saving a milestone.',
        ];
  const constraints = [plan?.constraints?.trim() || null, plan?.styleGuide?.trim() || null]
    .filter((item): item is string => Boolean(item))
    .slice(0, 4);
  const checklist = threadRecords
    .map((thread) => {
      const latestUserMessage = [...thread.messages]
        .reverse()
        .find((message) => message.role === 'user');
      const basis = latestUserMessage?.content.trim() || thread.anchorText.trim();
      if (!basis) {
        return null;
      }
      return basis.replace(/\s+/g, ' ').slice(0, 160);
    })
    .filter((item): item is string => Boolean(item));
  const uniqueChecklist = [...new Set(checklist)];
  const content = [
    `Use this method for ${deliverableType} deliverables that need a repeatable path from first pass to milestone.`,
    'Work in the live draft first, then save a visible milestone when the result is stable.',
    'Use comments for local, anchored revisions instead of broad chat-only rewrites.',
  ].join('\n\n');

  return {
    sourceVersionId: latestVisibleVersion.id,
    sourceThreadId: threadRecords[0]?.id || null,
    summary:
      plan?.goal?.trim()
        ? `Reusable method for ${plan.goal.trim()}`
        : `Reusable method for ${workspace.title}`,
    title: `${workspace.title} Workflow`,
    steps: recommendedSteps,
    constraints:
      constraints.length > 0
        ? constraints
        : ['Keep the method aligned with the current goal and deliverable type.'],
    checklist:
      uniqueChecklist.length > 0
        ? uniqueChecklist
        : [
            'Verify the structure is complete before saving a milestone.',
            'Resolve or confirm applied comments before closing review.',
          ],
    content,
    warnings: evaluateWorkflowDraftWarnings({
      checklist: uniqueChecklist,
      constraints,
      steps: recommendedSteps,
    }),
  };
}
