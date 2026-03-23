import { plateToMarkdown } from '@/lib/ai/serializer';
import { prisma } from '@/lib/db/prisma';
import { safeJsonParse } from '@/framework/resilience';
import { listWorkspaceFiles } from '@/objects/file/queries';
import { listProjectMounts } from '@/objects/project-mount';
import {
  getCanonicalDeliverableType,
  parseStoredDeliverableType,
} from '@/lib/workspace/deliverable-types';
import { inferDeliverableType } from '@/lib/workspace/planning';
import { deriveRenderAs } from '@/lib/workspace/render-as';
import type { DeliverableType, RenderAs, WorkspaceFileData } from '@/types';

type ProjectNodeFileRecord = {
  content: string;
  id: string;
  isPrimary: boolean;
  kind: string;
  name: string;
  path: string;
  type: string;
};

type ProjectNodePlanRecord = {
  deliverableType: string;
  goal: string;
} | null;

type ProjectNodeRecord = {
  files: ProjectNodeFileRecord[];
  id: string;
  projectId: string | null;
  projectTitle: string | null;
  status: string;
  title: string;
  treeSortOrder: number;
  updatedAt: Date;
  workspacePlan: ProjectNodePlanRecord;
};

export type ProjectNodeScope = {
  currentNodeId: string;
  projectId: string;
  projectTitle: string;
};

export type ProjectNodeSummary = {
  deliverableType: DeliverableType;
  id: string;
  isCurrent: boolean;
  previewText: string;
  primaryFilePath: string | null;
  renderAs: RenderAs;
  status: string;
  title: string;
  updatedAt: Date;
};

export type ProjectNodeCatalog = {
  id: string;
  nodes: ProjectNodeSummary[];
  title: string;
};

export type MountedProjectSummary = {
  id: string;
  mountId: string;
  nodeCount: number;
  nodes: Array<{
    id: string;
    title: string;
  }>;
  omittedNodeCount: number;
  title: string;
};

export type ProjectNodeContent = {
  file: WorkspaceFileData;
  files: WorkspaceFileData[];
  node: ProjectNodeSummary;
};

export type ProjectNodeSearchResult = ProjectNodeSummary & {
  matchPreview: string;
  matchedIn: 'content' | 'title';
  projectId: string;
};

function resolveProjectId(node: {
  id: string;
  projectId: string | null;
}) {
  return node.projectId || node.id;
}

function resolveProjectTitle(node: {
  projectTitle: string | null;
  title: string;
}) {
  return node.projectTitle?.trim() || node.title;
}

function resolveNodePresentation(node: ProjectNodeRecord): Pick<
  ProjectNodeSummary,
  'deliverableType' | 'previewText' | 'primaryFilePath' | 'renderAs'
> {
  const primaryFile =
    node.files.find((file) => file.isPrimary && file.type === 'file') ||
    node.files.find((file) => file.type === 'file') ||
    null;

  const deliverableType = getCanonicalDeliverableType(
    inferDeliverableType({
      explicitType: node.workspacePlan?.deliverableType || null,
      fileKind: primaryFile?.kind || null,
      files: node.files.map((file) => ({ kind: file.kind, path: file.path })),
      goal: node.workspacePlan?.goal || node.title,
      title: primaryFile?.name || node.title,
    })
  );
  const storedDeliverableType = parseStoredDeliverableType(
    node.workspacePlan?.deliverableType || null
  );

  return {
    deliverableType,
    previewText: buildNodePreviewText(primaryFile?.content || ''),
    primaryFilePath: primaryFile?.path || null,
    renderAs: deriveRenderAs({
      content: primaryFile?.content || '',
      deliverableType,
      storedDeliverableType,
    }),
  };
}

export function serializeNodeContentForAi(content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    return '';
  }

  const parsed = safeJsonParse<unknown>(trimmed, null);
  if (Array.isArray(parsed)) {
    return plateToMarkdown(parsed as never).trim();
  }

  return trimmed;
}

export function buildNodePreviewText(content: string, maxLength = 200) {
  const collapsed = serializeNodeContentForAi(content).replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return '';
  }

  return collapsed.length > maxLength
    ? `${collapsed.slice(0, maxLength - 3)}...`
    : collapsed;
}

function buildNodeSearchMatchPreview(content: string, query: string, maxLength = 160) {
  const normalizedContent = serializeNodeContentForAi(content).replace(/\s+/g, ' ').trim();
  if (!normalizedContent) {
    return '';
  }

  const loweredContent = normalizedContent.toLocaleLowerCase();
  const loweredQuery = query.trim().toLocaleLowerCase();
  const matchIndex = loweredQuery ? loweredContent.indexOf(loweredQuery) : -1;

  if (matchIndex < 0) {
    return buildNodePreviewText(normalizedContent, maxLength);
  }

  const contextBefore = Math.floor(maxLength * 0.35);
  const contextAfter = maxLength - loweredQuery.length - contextBefore;
  const start = Math.max(0, matchIndex - contextBefore);
  const end = Math.min(
    normalizedContent.length,
    matchIndex + loweredQuery.length + Math.max(contextAfter, 24)
  );
  const snippet = normalizedContent.slice(start, end).trim();

  if (!snippet) {
    return '';
  }

  return `${start > 0 ? '...' : ''}${snippet}${end < normalizedContent.length ? '...' : ''}`;
}

function resolveProjectMembershipWhere(params: {
  organizationId: string;
  projectId: string;
}) {
  return {
    deletedAt: null,
    organizationId: params.organizationId,
    OR: [{ id: params.projectId }, { projectId: params.projectId }],
  };
}

export async function resolveProjectNodeScope(params: {
  organizationId: string;
  workspaceId: string;
}): Promise<ProjectNodeScope | null> {
  const node = await prisma.document.findFirst({
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

  if (!node) {
    return null;
  }

  return {
    currentNodeId: params.workspaceId,
    projectId: resolveProjectId(node),
    projectTitle: resolveProjectTitle(node),
  };
}

export async function listProjectNodes(params: {
  currentNodeId?: string | null;
  organizationId: string;
  projectId: string;
}): Promise<ProjectNodeSummary[]> {
  const nodes = (await prisma.document.findMany({
    where: resolveProjectMembershipWhere(params),
    select: {
      files: {
        where: {
          deletedAt: null,
          role: 'deliverable',
        },
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          content: true,
          id: true,
          isPrimary: true,
          kind: true,
          name: true,
          path: true,
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
  })) as ProjectNodeRecord[];

  return nodes
    .map((node) => ({
      ...resolveNodePresentation(node),
      id: node.id,
      isCurrent: node.id === params.currentNodeId,
      status: node.status,
      title: node.title,
      updatedAt: node.updatedAt,
    }))
    .sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) {
        return left.isCurrent ? -1 : 1;
      }

      const updatedAtDiff =
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      if (updatedAtDiff !== 0) {
        return updatedAtDiff;
      }

      return left.title.localeCompare(right.title);
    });
}

export async function readNodeContent(params: {
  fileId?: string;
  organizationId: string;
  path?: string;
  projectId: string;
  targetNodeId: string;
}): Promise<ProjectNodeContent> {
  const [nodes, files] = await Promise.all([
    listProjectNodes({
      organizationId: params.organizationId,
      projectId: params.projectId,
      currentNodeId: params.targetNodeId,
    }),
    listWorkspaceFiles({
      organizationId: params.organizationId,
      workspaceId: params.targetNodeId,
    }),
  ]);
  const node = nodes.find((candidate) => candidate.id === params.targetNodeId);

  if (!node) {
    throw new Error('The requested node is not in the current project.');
  }

  const file =
    (params.fileId ? files.find((candidate) => candidate.id === params.fileId) : null) ||
    (params.path ? files.find((candidate) => candidate.path === params.path) : null) ||
    files.find((candidate) => candidate.nodeType === 'file' && candidate.isPrimary) ||
    files.find((candidate) => candidate.nodeType === 'file') ||
    null;

  if (!file) {
    throw new Error('No readable file found in the requested node.');
  }

  return {
    file,
    files,
    node,
  };
}

export async function searchProjectNodes(params: {
  currentNodeId?: string | null;
  limit?: number;
  organizationId: string;
  projectId: string;
  query: string;
}): Promise<ProjectNodeSearchResult[]> {
  const normalizedQuery = params.query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const loweredQuery = normalizedQuery.toLocaleLowerCase();
  const limit = Math.max(1, Math.min(params.limit ?? 8, 20));
  const nodes = (await prisma.document.findMany({
    where: {
      AND: [
        resolveProjectMembershipWhere(params),
        {
          OR: [
            { title: { contains: normalizedQuery } },
            {
              files: {
                some: {
                  content: { contains: normalizedQuery },
                  deletedAt: null,
                  role: 'deliverable',
                },
              },
            },
          ],
        },
      ],
    },
    select: {
      files: {
        where: {
          deletedAt: null,
          role: 'deliverable',
        },
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          content: true,
          id: true,
          isPrimary: true,
          kind: true,
          name: true,
          path: true,
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
  })) as ProjectNodeRecord[];

  return nodes
    .map((node): ProjectNodeSearchResult & { treeSortOrder: number } => {
      const titleMatched = node.title.toLocaleLowerCase().includes(loweredQuery);
      const matchingFile = node.files.find((file) =>
        serializeNodeContentForAi(file.content).toLocaleLowerCase().includes(loweredQuery)
      );
      const presentation = resolveNodePresentation(node);

      return {
        ...presentation,
        id: node.id,
        isCurrent: node.id === params.currentNodeId,
        matchPreview:
          (matchingFile && buildNodeSearchMatchPreview(matchingFile.content, normalizedQuery)) ||
          presentation.previewText ||
          node.title,
        matchedIn: titleMatched ? 'title' : 'content',
        projectId: resolveProjectId(node),
        status: node.status,
        title: node.title,
        treeSortOrder: node.treeSortOrder,
        updatedAt: node.updatedAt,
      };
    })
    .sort((left, right) => {
      const leftTitle = left.title.toLocaleLowerCase();
      const rightTitle = right.title.toLocaleLowerCase();
      const leftExactMatch = leftTitle === loweredQuery;
      const rightExactMatch = rightTitle === loweredQuery;
      if (leftExactMatch !== rightExactMatch) {
        return leftExactMatch ? -1 : 1;
      }

      const leftPrefixMatch = leftTitle.startsWith(loweredQuery);
      const rightPrefixMatch = rightTitle.startsWith(loweredQuery);
      if (leftPrefixMatch !== rightPrefixMatch) {
        return leftPrefixMatch ? -1 : 1;
      }

      if (left.matchedIn !== right.matchedIn) {
        return left.matchedIn === 'title' ? -1 : 1;
      }

      if (left.isCurrent !== right.isCurrent) {
        return left.isCurrent ? -1 : 1;
      }

      const updatedAtDiff =
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      if (updatedAtDiff !== 0) {
        return updatedAtDiff;
      }

      const treeSortDiff = left.treeSortOrder - right.treeSortOrder;
      if (treeSortDiff !== 0) {
        return treeSortDiff;
      }

      return left.title.localeCompare(right.title);
    })
    .slice(0, limit)
    .map(({ treeSortOrder: _treeSortOrder, ...result }) => result);
}

export async function getProjectNodeCatalog(params: {
  currentNodeId?: string | null;
  organizationId: string;
  projectId: string;
}): Promise<ProjectNodeCatalog | null> {
  const project = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: params.projectId,
      organizationId: params.organizationId,
    },
    select: {
      id: true,
      projectTitle: true,
      title: true,
    },
  });

  if (!project) {
    return null;
  }

  return {
    id: project.id,
    nodes: await listProjectNodes({
      currentNodeId: params.currentNodeId,
      organizationId: params.organizationId,
      projectId: params.projectId,
    }),
    title: resolveProjectTitle(project),
  };
}

export async function listMountedProjects(params: {
  nodeLimit?: number;
  organizationId: string;
  projectId: string;
}): Promise<MountedProjectSummary[]> {
  const mounts = await listProjectMounts({
    organizationId: params.organizationId,
    sourceProjectId: params.projectId,
  });
  const nodeLimit = params.nodeLimit ?? 5;

  const mountedProjects = await Promise.all(
    mounts.map(async (mount) => {
      const catalog = await getProjectNodeCatalog({
        organizationId: params.organizationId,
        projectId: mount.targetProjectId,
      });

      if (!catalog) {
        return null;
      }

      return {
        id: catalog.id,
        mountId: mount.id,
        nodeCount: catalog.nodes.length,
        nodes: catalog.nodes.slice(0, nodeLimit).map((node) => ({
          id: node.id,
          title: node.title,
        })),
        omittedNodeCount: Math.max(catalog.nodes.length - nodeLimit, 0),
        title: mount.targetProjectTitle || catalog.title,
      } satisfies MountedProjectSummary;
    })
  );

  return mountedProjects.filter(
    (mountedProject): mountedProject is MountedProjectSummary =>
      mountedProject !== null
  );
}
