import {
  buildNodePreviewText,
  listMountedProjects,
  listProjectNodes,
  readNodeContent,
  resolveProjectNodeScope,
  serializeNodeContentForAi,
  type MountedProjectSummary,
  type ProjectNodeSummary,
} from '@/lib/workspace/node';

export type ProjectDeliverableContextItem = ProjectNodeSummary;
export type ProjectMountedContextItem = MountedProjectSummary;

const DEFAULT_CURRENT_NODE_CONTENT_MAX_CHARS = 32000;
const DEFAULT_MOUNTED_PROJECT_LIMIT = 3;
const DEFAULT_SIBLING_SUMMARY_LIMIT = 5;

export type ProjectAiContextData = {
  currentNode: ProjectDeliverableContextItem | null;
  currentNodeContent: string | null;
  currentNodeContentTruncated: boolean;
  currentNodePrimaryFilePath: string | null;
  currentWorkspaceId: string;
  deliverableCount: number;
  deliverables: ProjectDeliverableContextItem[];
  id: string;
  mountedProjects: ProjectMountedContextItem[];
  omittedSiblingCount: number;
  omittedMountedProjectCount: number;
  siblingSummaries: ProjectDeliverableContextItem[];
  title: string;
};

export async function loadProjectAiContextData(params: {
  organizationId: string;
  workspaceId: string;
}, options?: {
  includeCurrentNodeContent?: boolean;
  siblingLimit?: number;
}): Promise<ProjectAiContextData | null> {
  const scope = await resolveProjectNodeScope(params);
  if (!scope) {
    return null;
  }

  const siblingLimit = options?.siblingLimit ?? DEFAULT_SIBLING_SUMMARY_LIMIT;
  const [deliverables, mountedProjectSummaries] = await Promise.all([
    listProjectNodes({
      currentNodeId: params.workspaceId,
      organizationId: params.organizationId,
      projectId: scope.projectId,
    }),
    listMountedProjects({
      organizationId: params.organizationId,
      projectId: scope.projectId,
    }),
  ]);
  const currentNode =
    deliverables.find((deliverable) => deliverable.id === params.workspaceId) ||
    deliverables.find((deliverable) => deliverable.isCurrent) ||
    null;
  const siblingSummaries = deliverables
    .filter((deliverable) => !deliverable.isCurrent)
    .slice(0, siblingLimit);
  const mountedProjects = mountedProjectSummaries.slice(0, DEFAULT_MOUNTED_PROJECT_LIMIT);

  let currentNodeContent: string | null = null;
  let currentNodePrimaryFilePath = currentNode?.primaryFilePath || null;
  let currentNodeContentTruncated = false;

  if (options?.includeCurrentNodeContent && currentNode) {
    const nodeContent = await readNodeContent({
      organizationId: params.organizationId,
      projectId: scope.projectId,
      targetNodeId: currentNode.id,
    });
    const normalizedContent = serializeNodeContentForAi(nodeContent.file.content);
    currentNodePrimaryFilePath = nodeContent.file.path;
    currentNodeContent =
      normalizedContent.length > DEFAULT_CURRENT_NODE_CONTENT_MAX_CHARS
        ? `${normalizedContent.slice(0, DEFAULT_CURRENT_NODE_CONTENT_MAX_CHARS - 3)}...`
        : normalizedContent;
    currentNodeContentTruncated =
      normalizedContent.length > DEFAULT_CURRENT_NODE_CONTENT_MAX_CHARS;
  }

  return {
    currentNode,
    currentNodeContent,
    currentNodeContentTruncated,
    currentNodePrimaryFilePath,
    currentWorkspaceId: params.workspaceId,
    deliverableCount: deliverables.length,
    deliverables,
    id: scope.projectId,
    mountedProjects,
    omittedSiblingCount: Math.max(
      deliverables.filter((deliverable) => !deliverable.isCurrent).length -
        siblingSummaries.length,
      0
    ),
    omittedMountedProjectCount: Math.max(
      mountedProjectSummaries.length - mountedProjects.length,
      0
    ),
    siblingSummaries,
    title: scope.projectTitle,
  };
}

export function formatProjectAiContext(
  context: ProjectAiContextData,
  options?: {
    includeWorkspaceIds?: boolean;
  }
) {
  const lines = [
    `Project: ${context.title} (${context.deliverableCount} node${context.deliverableCount === 1 ? '' : 's'})`,
  ];

  if (options?.includeWorkspaceIds) {
    lines.push(
      'Project nodes:',
      ...context.deliverables.map((deliverable) => {
        const currentPrefix = deliverable.isCurrent ? '[current] ' : '';
        const workspaceSuffix = ` [workspaceId: ${deliverable.id}]`;
        return `- ${currentPrefix}${deliverable.title}${workspaceSuffix} (shape: ${deliverable.renderAs}, status: ${deliverable.status})`;
      })
    );

    if (context.mountedProjects.length > 0) {
      lines.push(
        'Mounted project node titles:',
        ...context.mountedProjects.map((project) => {
          const titles =
            project.nodes.length > 0
              ? project.nodes
                  .map((node) => `${node.title} [nodeId: ${node.id}]`)
                  .join(' | ')
              : 'No mounted nodes.';
          const omittedSuffix =
            project.omittedNodeCount > 0
              ? ` | ... ${project.omittedNodeCount} more title${project.omittedNodeCount === 1 ? '' : 's'} omitted`
              : '';
          return `- ${project.title} [projectId: ${project.id}] :: ${titles}${omittedSuffix}`;
        })
      );
    } else {
      lines.push('Mounted project node titles: none.');
    }

    return lines.join('\n');
  }

  lines.push('Current node:');
  if (context.currentNode) {
    lines.push(
      `- [current] ${context.currentNode.title} (shape: ${context.currentNode.renderAs}, status: ${context.currentNode.status})`
    );
  } else {
    lines.push('- No current node.');
  }

  lines.push(
    `Current node content${context.currentNodePrimaryFilePath ? ` [${context.currentNodePrimaryFilePath}]` : ''}${context.currentNodeContentTruncated ? ' [truncated to default budget]' : ''}:`
  );
  lines.push(context.currentNodeContent || 'No readable current node content.');

  if (context.siblingSummaries.length > 0) {
    lines.push(
      `Sibling node summaries (top ${context.siblingSummaries.length} recent):`,
      ...context.siblingSummaries.map((deliverable) => {
        const preview = deliverable.previewText || 'No preview available.';
        return `- ${deliverable.title} (shape: ${deliverable.renderAs}, status: ${deliverable.status}) :: ${buildNodePreviewText(preview)}`;
      })
    );
  } else {
    lines.push('Sibling node summaries: none.');
  }

  if (context.omittedSiblingCount > 0) {
    lines.push(
      `- ... ${context.omittedSiblingCount} more node${context.omittedSiblingCount === 1 ? '' : 's'} omitted from default context.`
    );
  }

  if (context.mountedProjects.length > 0) {
    lines.push(
      'Mounted project node titles:',
      ...context.mountedProjects.map((project) => {
        const titles =
          project.nodes.length > 0
            ? project.nodes
                .map((node) => `${node.title} [nodeId: ${node.id}]`)
                .join(' | ')
            : 'No mounted nodes.';
        const omittedSuffix =
          project.omittedNodeCount > 0
            ? ` | ... ${project.omittedNodeCount} more title${project.omittedNodeCount === 1 ? '' : 's'} omitted`
            : '';
        return `- ${project.title} [projectId: ${project.id}] :: ${titles}${omittedSuffix}`;
      })
    );
  } else {
    lines.push('Mounted project node titles: none.');
  }

  if (context.omittedMountedProjectCount > 0) {
    lines.push(
      `- ... ${context.omittedMountedProjectCount} more mounted project${context.omittedMountedProjectCount === 1 ? '' : 's'} omitted from default context.`
    );
  }

  return lines.join('\n');
}
