import { mapWorkspaceFile } from '@/objects/file/schema';
import {
  buildProjectFolders,
  buildProjectSummary,
  resolveWorkspaceProjectId,
} from '@/objects/project/queries';
import {
  buildDeliverable,
  mapWorkspacePlan,
} from '@/lib/workspace/planning';
import type {
  ProjectDeliverableItem,
  ProjectFolderItem,
  ProjectSummaryData,
} from '@/types';

type ProjectDeliverableSeed = {
  content: string;
  currentVersion: number;
  files: Array<Parameters<typeof mapWorkspaceFile>[0]>;
  id: string;
  projectFolderId?: string | null;
  projectId: string | null;
  projectTitle: string | null;
  status: string;
  title: string;
  treeSortOrder: number;
  updatedAt: Date;
  workspacePlan: Parameters<typeof mapWorkspacePlan>[0] | null;
};

type ProjectSurfaceSeed = {
  id: string;
  projectId: string | null;
  projectTitle: string | null;
  title: string;
  updatedAt: Date;
};

export function buildProjectDeliverables(
  projectDocuments: ProjectDeliverableSeed[]
): ProjectDeliverableItem[] {
  return projectDocuments
    .map((workspace) => {
      const deliverable = buildDeliverable({
        currentVersion: workspace.currentVersion,
        files: workspace.files.map(mapWorkspaceFile),
        plan: workspace.workspacePlan ? mapWorkspacePlan(workspace.workspacePlan) : null,
        storedDeliverableType: workspace.workspacePlan?.deliverableType || null,
        workspace,
      });

      return {
        id: workspace.id,
        projectId: resolveWorkspaceProjectId(workspace),
        projectFolderId: workspace.projectFolderId || null,
        sortOrder: workspace.treeSortOrder,
        title: workspace.title,
        deliverableType: deliverable.deliverableType,
        updatedAt: workspace.updatedAt,
      };
    })
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

export function buildWorkspaceProjectSurface(params: {
  projectDocuments: ProjectDeliverableSeed[];
  projectFolders: Array<{
    id: string;
    parentId: string | null;
    projectId: string;
    treeSortOrder: number;
    title: string;
    updatedAt: Date;
  }>;
  workspace: ProjectSurfaceSeed;
}): {
  currentProject: ProjectSummaryData | null;
  projectDeliverables: ProjectDeliverableItem[];
  projectFolders: ProjectFolderItem[];
} {
  return {
    currentProject: buildProjectSummary(params.projectDocuments, params.workspace),
    projectDeliverables: buildProjectDeliverables(params.projectDocuments),
    projectFolders: buildProjectFolders(params.projectFolders),
  };
}
