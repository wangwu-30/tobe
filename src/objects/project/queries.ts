import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/prisma';

type ProjectSummaryData = {
  id: string;
  workspaceId: string;
  title: string;
  preview: string;
  deliverableCount: number;
  latestDeliverableTitle: string | null;
  updatedAt: Date | string;
};

type ProjectFolderItem = {
  id: string;
  projectId: string;
  parentFolderId: string | null;
  sortOrder: number;
  title: string;
  updatedAt: Date | string;
};

type ProjectSummarySeed = {
  id: string;
  projectId: string | null;
  projectTitle: string | null;
  title: string;
  updatedAt: Date;
};

export const PROJECT_TREE_SORT_STEP = 1024;

export function resolveWorkspaceProjectId(workspace: {
  id: string;
  projectId?: string | null;
}) {
  return workspace.projectId || workspace.id;
}

export function resolveWorkspaceProjectTitle(workspace: {
  projectTitle?: string | null;
  title: string;
}) {
  return workspace.projectTitle?.trim() || workspace.title;
}

export function buildProjectSummary(
  projectDocuments: ProjectSummarySeed[],
  workspace?: ProjectSummarySeed | null
): ProjectSummaryData | null {
  const documents = projectDocuments.length > 0
    ? [...projectDocuments].sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      )
    : workspace
      ? [workspace]
      : [];

  const latestWorkspace = documents[0] || workspace || null;
  const anchorWorkspace = workspace || latestWorkspace;

  if (!latestWorkspace || !anchorWorkspace) {
    return null;
  }

  return {
    id: resolveWorkspaceProjectId(anchorWorkspace),
    workspaceId: latestWorkspace.id,
    title: resolveWorkspaceProjectTitle(anchorWorkspace),
    preview: latestWorkspace.title,
    deliverableCount: documents.length,
    latestDeliverableTitle: latestWorkspace.title || null,
    updatedAt: latestWorkspace.updatedAt,
  };
}

export function buildProjectFolders(
  folders: Array<{
    id: string;
    parentId: string | null;
    projectId: string;
    treeSortOrder: number;
    title: string;
    updatedAt: Date;
  }>
): ProjectFolderItem[] {
  return folders
    .map((folder) => ({
      id: folder.id,
      projectId: folder.projectId,
      parentFolderId: folder.parentId || null,
      sortOrder: folder.treeSortOrder,
      title: folder.title,
      updatedAt: folder.updatedAt,
    }))
    .sort((left, right) => {
      if (left.sortOrder === right.sortOrder) {
        const updatedAtDiff =
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
        if (updatedAtDiff !== 0) {
          return updatedAtDiff;
        }

        return left.id.localeCompare(right.id);
      }

      return left.sortOrder - right.sortOrder;
    });
}

export async function getNextProjectTreeSortOrder(
  params: {
    organizationId: string;
    parentFolderId: string | null;
    projectId: string;
  },
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  const [lastDeliverable, lastFolder] = await Promise.all([
    db.document.findFirst({
      where: {
        deletedAt: null,
        organizationId: params.organizationId,
        projectId: params.projectId,
        projectFolderId: params.parentFolderId,
      },
      select: { treeSortOrder: true },
      orderBy: [{ treeSortOrder: 'desc' }, { updatedAt: 'desc' }],
    }),
    db.projectFolder.findFirst({
      where: {
        deletedAt: null,
        organizationId: params.organizationId,
        projectId: params.projectId,
        parentId: params.parentFolderId,
      },
      select: { treeSortOrder: true },
      orderBy: [{ treeSortOrder: 'desc' }, { updatedAt: 'desc' }],
    }),
  ]);

  return (
    Math.max(lastDeliverable?.treeSortOrder || 0, lastFolder?.treeSortOrder || 0) +
    PROJECT_TREE_SORT_STEP
  );
}

export async function listProjects(
  organizationId: string
): Promise<ProjectSummaryData[]> {
  const workspaces = await prisma.document.findMany({
    where: {
      deletedAt: null,
      organizationId,
    },
    select: {
      id: true,
      projectId: true,
      projectTitle: true,
      title: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  const projects = new Map<string, ProjectSummarySeed[]>();

  workspaces.forEach((workspace) => {
    const projectId = resolveWorkspaceProjectId(workspace);
    const bucket = projects.get(projectId) || [];
    bucket.push(workspace);
    projects.set(projectId, bucket);
  });

  return Array.from(projects.values())
    .map((projectDocuments) => buildProjectSummary(projectDocuments))
    .filter((project): project is ProjectSummaryData => Boolean(project))
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
}
