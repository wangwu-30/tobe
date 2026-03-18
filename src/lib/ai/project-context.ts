import { prisma } from '@/lib/db/prisma';
import { inferDeliverableType } from '@/lib/workspace/planning';
import type { DeliverableType } from '@/types';

type ProjectContextFileRecord = {
  id: string;
  isPrimary: boolean;
  kind: string;
  name: string;
  path: string;
  role: string;
  type: string;
};

type ProjectContextPlanRecord = {
  deliverableType: string;
  goal: string;
} | null;

type ProjectContextWorkspaceRecord = {
  currentVersion: number;
  files: ProjectContextFileRecord[];
  id: string;
  projectId: string | null;
  projectTitle: string | null;
  status: string;
  title: string;
  treeSortOrder: number;
  updatedAt: Date;
  workspacePlan: ProjectContextPlanRecord;
};

export type ProjectDeliverableContextItem = {
  deliverableType: DeliverableType;
  id: string;
  isCurrent: boolean;
  status: string;
  title: string;
  updatedAt: Date;
};

export type ProjectAiContextData = {
  currentWorkspaceId: string;
  deliverableCount: number;
  deliverables: ProjectDeliverableContextItem[];
  id: string;
  title: string;
};

function resolveProjectId(workspace: {
  id: string;
  projectId: string | null;
}) {
  return workspace.projectId || workspace.id;
}

function resolveProjectTitle(workspace: {
  projectTitle: string | null;
  title: string;
}) {
  return workspace.projectTitle?.trim() || workspace.title;
}

function resolveDeliverableType(workspace: ProjectContextWorkspaceRecord): DeliverableType {
  const primaryFile =
    workspace.files.find((file) => file.isPrimary && file.type === 'file') ||
    workspace.files.find((file) => file.type === 'file') ||
    null;

  return inferDeliverableType({
    explicitType: workspace.workspacePlan?.deliverableType || null,
    fileKind: primaryFile?.kind || null,
    files: workspace.files.map((file) => ({ kind: file.kind, path: file.path })),
    goal: workspace.workspacePlan?.goal || workspace.title,
    title: primaryFile?.name || workspace.title,
  });
}

export async function loadProjectAiContextData(params: {
  organizationId: string;
  workspaceId: string;
}): Promise<ProjectAiContextData | null> {
  const workspace = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: params.workspaceId,
      organizationId: params.organizationId,
    },
    select: {
      id: true,
      projectId: true,
      projectTitle: true,
      title: true,
    },
  });

  if (!workspace) {
    return null;
  }

  const projectId = resolveProjectId(workspace);
  const projectDocuments = await prisma.document.findMany({
    where: {
      deletedAt: null,
      organizationId: params.organizationId,
      OR: [
        { id: projectId },
        { projectId },
      ],
    },
    select: {
      currentVersion: true,
      files: {
        where: {
          deletedAt: null,
          role: 'deliverable',
        },
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          isPrimary: true,
          kind: true,
          name: true,
          path: true,
          role: true,
          type: true,
        },
      },
      id: true,
      projectId: true,
      projectTitle: true,
      status: true,
      title: true,
      treeSortOrder: true,
      updatedAt: true,
      workspacePlan: {
        select: {
          deliverableType: true,
          goal: true,
        },
      },
    },
    orderBy: [{ treeSortOrder: 'asc' }, { updatedAt: 'desc' }],
  });

  const deliverables = projectDocuments
    .map((projectWorkspace) => ({
      deliverableType: resolveDeliverableType(projectWorkspace),
      id: projectWorkspace.id,
      isCurrent: projectWorkspace.id === params.workspaceId,
      status: projectWorkspace.status,
      title: projectWorkspace.title,
      updatedAt: projectWorkspace.updatedAt,
    }))
    .sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) {
        return left.isCurrent ? -1 : 1;
      }

      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });

  return {
    currentWorkspaceId: params.workspaceId,
    deliverableCount: deliverables.length,
    deliverables,
    id: projectId,
    title: resolveProjectTitle(workspace),
  };
}

export function formatProjectAiContext(
  context: ProjectAiContextData,
  options?: {
    includeWorkspaceIds?: boolean;
  }
) {
  const lines = [
    `Project: ${context.title} (${context.deliverableCount} deliverable${context.deliverableCount === 1 ? '' : 's'})`,
    'Project deliverables:',
    ...context.deliverables.map((deliverable) => {
      const currentPrefix = deliverable.isCurrent ? '[current] ' : '';
      const workspaceSuffix = options?.includeWorkspaceIds
        ? ` [workspaceId: ${deliverable.id}]`
        : '';
      return `- ${currentPrefix}${deliverable.title}${workspaceSuffix} (${deliverable.deliverableType}, status: ${deliverable.status})`;
    }),
  ];

  return lines.join('\n');
}
