'use client';

import * as React from 'react';

import type { WorkspaceCreateContext } from '@/lib/workspace/create-request';
import {
  deleteWorkspaceProject,
  renameWorkspaceProject,
} from '@/lib/workspace/project-client';
import {
  createProjectTreeFolder,
  deleteProjectTreeDeliverable,
  deleteProjectTreeFolder,
  moveProjectTreeDeliverable,
  moveProjectTreeFolder,
  renameProjectTreeDeliverable,
  renameProjectTreeFolder,
  reorderProjectTreeDeliverable,
  reorderProjectTreeFolder,
} from '@/lib/workspace/project-tree-client';
import {
  createWorkspaceSupportNode,
  deleteWorkspaceSupportFile,
  moveWorkspaceSupportFile,
  renameWorkspaceSupportFile,
} from '@/lib/workspace/support-files-client';
import type {
  ProjectDeliverableItem,
  ProjectFolderItem,
  WorkspaceFileData,
  WorkspaceVersionFileData,
  WorkspaceViewData,
} from '@/types';

type SidebarSupportFile = WorkspaceFileData | WorkspaceVersionFileData;
type WorkspaceSidebarNotice = {
  text: string;
  tone: 'error' | 'success';
};

const PROJECT_TREE_SORT_STEP = 1024;

type ProjectTreeSiblingNode = {
  id: string;
  nodeType: 'deliverable' | 'folder';
  parentFolderId: string | null;
  sortOrder: number;
  updatedAt: Date | string;
};

function compareProjectTreeSiblingNodes(
  left: ProjectTreeSiblingNode,
  right: ProjectTreeSiblingNode
) {
  if (left.sortOrder === right.sortOrder) {
    const updatedAtDiff =
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    if (updatedAtDiff !== 0) {
      return updatedAtDiff;
    }

    return left.id.localeCompare(right.id);
  }

  return left.sortOrder - right.sortOrder;
}

function buildProjectTreeSiblingNodes(args: {
  deliverables: ProjectDeliverableItem[];
  folders: ProjectFolderItem[];
  parentFolderId: string | null;
}) {
  return [
    ...args.folders
      .filter((folder) => folder.parentFolderId === args.parentFolderId)
      .map(
        (folder): ProjectTreeSiblingNode => ({
          id: folder.id,
          nodeType: 'folder',
          parentFolderId: folder.parentFolderId,
          sortOrder: folder.sortOrder,
          updatedAt: folder.updatedAt,
        })
      ),
    ...args.deliverables
      .filter((deliverable) => deliverable.projectFolderId === args.parentFolderId)
      .map(
        (deliverable): ProjectTreeSiblingNode => ({
          id: deliverable.id,
          nodeType: 'deliverable',
          parentFolderId: deliverable.projectFolderId,
          sortOrder: deliverable.sortOrder,
          updatedAt: deliverable.updatedAt,
        })
      ),
  ].sort(compareProjectTreeSiblingNodes);
}

function getAdjacentProjectTreeSortOrder(args: {
  direction: 'up' | 'down';
  siblings: ProjectTreeSiblingNode[];
  targetId: string;
}) {
  const currentIndex = args.siblings.findIndex((node) => node.id === args.targetId);
  if (currentIndex < 0) {
    return null;
  }

  if (args.direction === 'up') {
    if (currentIndex === 0) {
      return null;
    }

    const previousNode = args.siblings[currentIndex - 1];
    const beforePreviousNode = currentIndex > 1 ? args.siblings[currentIndex - 2] : null;
    return beforePreviousNode
      ? (beforePreviousNode.sortOrder + previousNode.sortOrder) / 2
      : previousNode.sortOrder - PROJECT_TREE_SORT_STEP;
  }

  if (currentIndex >= args.siblings.length - 1) {
    return null;
  }

  const nextNode = args.siblings[currentIndex + 1];
  const afterNextNode =
    currentIndex < args.siblings.length - 2 ? args.siblings[currentIndex + 2] : null;
  return afterNextNode
    ? (nextNode.sortOrder + afterNextNode.sortOrder) / 2
    : nextNode.sortOrder + PROJECT_TREE_SORT_STEP;
}

function resolveCurrentProjectId(
  currentProjectId: string | null,
  currentWorkspace: WorkspaceViewData['workspace'] | null
) {
  return currentProjectId || currentWorkspace?.projectId || currentWorkspace?.id || null;
}

type WorkspaceSidebarLocation = {
  conversationId?: string | null;
  fileId?: string | null;
  versionId?: string | null;
  workspaceId?: string | null;
};

export function useWorkspaceSidebarActions<TTranslate extends (...args: any[]) => string>({
  currentFile,
  currentFileId,
  currentProject,
  currentProjectId,
  currentWorkspace,
  loadWorkspace,
  onNavigateHome,
  onOpenWorkspaceRoute,
  openWorkspaceCreateEntry,
  projectDeliverables,
  projectFolders,
  setWorkspaceNotice,
  setWorkspaceView,
  supportFiles,
  syncLocation,
  t,
  workspaceId,
}: {
  currentFile: WorkspaceViewData['currentFile'] | null;
  currentFileId: string | null;
  currentProject: WorkspaceViewData['currentProject'] | null;
  currentProjectId: string | null;
  currentWorkspace: WorkspaceViewData['workspace'] | null;
  loadWorkspace: () => Promise<WorkspaceViewData | null>;
  onNavigateHome: () => void;
  onOpenWorkspaceRoute: (workspaceId: string) => void;
  openWorkspaceCreateEntry: (context: WorkspaceCreateContext | null) => void;
  projectDeliverables: ProjectDeliverableItem[];
  projectFolders: ProjectFolderItem[];
  setWorkspaceNotice: (notice: WorkspaceSidebarNotice) => void;
  setWorkspaceView: React.Dispatch<React.SetStateAction<WorkspaceViewData | null>>;
  supportFiles: SidebarSupportFile[];
  syncLocation: (next: WorkspaceSidebarLocation) => void;
  t: TTranslate;
  workspaceId: string;
}) {
  const createSupportNode = React.useCallback(
    async (params: {
      kind?: 'markdown';
      name: string;
      nodeType?: 'file' | 'folder';
      parentId?: string | null;
    }) => {
      try {
        return await createWorkspaceSupportNode({
          errorMessage: t('sidebar.createSupportMaterialFailed'),
          kind: params.kind,
          name: params.name,
          nodeType: params.nodeType,
          parentId: params.parentId,
          workspaceId,
        });
      } catch (error) {
        setWorkspaceNotice({
          tone: 'error',
          text:
            error instanceof Error ? error.message : t('sidebar.createSupportMaterialFailed'),
        });
        return null;
      }
    },
    [setWorkspaceNotice, t, workspaceId]
  );

  const createSupportFile = React.useCallback(
    async (parentId?: string | null) => {
      const payload = await createSupportNode({
        kind: 'markdown',
        name: t('sidebar.newSupportNoteDefaultName'),
        parentId,
      });

      if (!payload?.id) {
        return;
      }

      setWorkspaceNotice({
        tone: 'success',
        text: t('sidebar.createSupportMaterialSuccess'),
      });
      syncLocation({
        fileId: payload.id,
        versionId: null,
      });
    },
    [createSupportNode, setWorkspaceNotice, syncLocation, t]
  );

  const createSupportFolder = React.useCallback(
    async (parentId?: string | null) => {
      const payload = await createSupportNode({
        name: t('sidebar.newSupportFolderDefaultName'),
        nodeType: 'folder',
        parentId,
      });

      if (!payload?.id) {
        return;
      }

      setWorkspaceNotice({
        tone: 'success',
        text: t('sidebar.createSupportMaterialSuccess'),
      });
      await loadWorkspace();
    },
    [createSupportNode, loadWorkspace, setWorkspaceNotice, t]
  );

  const deleteSupportFile = React.useCallback(
    async (fileId: string) => {
      const target = supportFiles.find((file) => file.id === fileId) || null;
      try {
        await deleteWorkspaceSupportFile({
          errorMessage: t('sidebar.deleteSupportMaterialFailed'),
          fileId,
          workspaceId,
        });
      } catch (error) {
        setWorkspaceNotice({
          tone: 'error',
          text:
            error instanceof Error ? error.message : t('sidebar.deleteSupportMaterialFailed'),
        });
        return;
      }

      const deletedCurrentSupportFile =
        currentFile?.role === 'support' &&
        target &&
        (currentFile.id === target.id ||
          currentFile.path === target.path ||
          currentFile.path.startsWith(`${target.path}/`));

      if (deletedCurrentSupportFile || currentFileId === fileId) {
        setWorkspaceNotice({
          tone: 'success',
          text: t('sidebar.deleteSupportMaterialSuccess'),
        });
        syncLocation({ fileId: null });
        return;
      }

      setWorkspaceNotice({
        tone: 'success',
        text: t('sidebar.deleteSupportMaterialSuccess'),
      });
      await loadWorkspace();
    },
    [
      currentFile,
      currentFileId,
      loadWorkspace,
      setWorkspaceNotice,
      supportFiles,
      syncLocation,
      t,
      workspaceId,
    ]
  );

  const renameSupportFile = React.useCallback(
    async (fileId: string, name: string) => {
      await renameWorkspaceSupportFile({
        errorMessage: t('sidebar.renameSupportMaterialFailed'),
        fileId,
        name,
        workspaceId,
      });

      await loadWorkspace();
      setWorkspaceNotice({
        tone: 'success',
        text: t('sidebar.renameSupportMaterialSuccess'),
      });
    },
    [loadWorkspace, setWorkspaceNotice, t, workspaceId]
  );

  const moveSupportFile = React.useCallback(
    async (fileId: string, parentId: string | null, sortOrder?: number) => {
      await moveWorkspaceSupportFile({
        errorMessage: t('sidebar.moveSupportMaterialFailed'),
        fileId,
        parentId,
        sortOrder,
        workspaceId,
      });

      await loadWorkspace();
      setWorkspaceNotice({
        tone: 'success',
        text: t('sidebar.moveSupportMaterialSuccess'),
      });
    },
    [loadWorkspace, setWorkspaceNotice, t, workspaceId]
  );

  const reorderSupportFile = React.useCallback(
    async (fileId: string, direction: 'up' | 'down') => {
      const target = supportFiles.find((file) => file.id === fileId) || null;
      if (!target) {
        return;
      }

      const siblings = supportFiles
        .filter((file) => file.parentId === target.parentId)
        .slice()
        .sort((left, right) => {
          if (left.sortOrder === right.sortOrder) {
            return left.path.localeCompare(right.path);
          }
          return left.sortOrder - right.sortOrder;
        });
      const currentIndex = siblings.findIndex((file) => file.id === fileId);
      if (currentIndex < 0) {
        return;
      }

      const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= siblings.length) {
        return;
      }

      await moveSupportFile(fileId, target.parentId, nextIndex);
    },
    [moveSupportFile, supportFiles]
  );

  const createProjectDeliverable = React.useCallback(
    (projectFolderId: string | null) => {
      openWorkspaceCreateEntry({
        conversationId: null,
        projectFolderId,
        projectId: currentWorkspace?.projectId || currentWorkspace?.id || null,
        projectTitle:
          currentWorkspace?.projectTitle ||
          currentProject?.title ||
          currentWorkspace?.title ||
          null,
      });
    },
    [
      currentProject?.title,
      currentWorkspace?.id,
      currentWorkspace?.projectId,
      currentWorkspace?.projectTitle,
      currentWorkspace?.title,
      openWorkspaceCreateEntry,
    ]
  );

  const createSiblingDeliverable = React.useCallback(
    (targetWorkspaceId: string) => {
      const target = projectDeliverables.find((item) => item.id === targetWorkspaceId) || null;
      createProjectDeliverable(target?.projectFolderId || null);
    },
    [createProjectDeliverable, projectDeliverables]
  );

  const createProjectFolder = React.useCallback(
    async (parentFolderId: string | null) => {
      const projectId = resolveCurrentProjectId(currentProjectId, currentWorkspace);
      if (!projectId) {
        return;
      }

      try {
        await createProjectTreeFolder({
          errorMessage: t('sidebar.createProjectFolderFailed'),
          parentId: parentFolderId,
          projectId,
          title: t('sidebar.newProjectFolderDefaultName'),
        });
      } catch (error) {
        setWorkspaceNotice({
          tone: 'error',
          text:
            error instanceof Error ? error.message : t('sidebar.createProjectFolderFailed'),
        });
        return;
      }

      await loadWorkspace();
    },
    [currentProjectId, currentWorkspace, loadWorkspace, setWorkspaceNotice, t]
  );

  const deleteProject = React.useCallback(
    async (projectId: string) => {
      try {
        await deleteWorkspaceProject({
          errorMessage: t('workspace.deleteFailed'),
          projectId,
        });
      } catch (error) {
        setWorkspaceNotice({
          tone: 'error',
          text: error instanceof Error ? error.message : t('workspace.deleteFailed'),
        });
        return;
      }

      if (projectId === currentProjectId) {
        onNavigateHome();
      }
    },
    [currentProjectId, onNavigateHome, setWorkspaceNotice, t]
  );

  const renameProject = React.useCallback(
    async (projectId: string, title: string) => {
      const payload = await renameWorkspaceProject({
        errorMessage: t('workspace.renameFailed'),
        projectId,
        title,
      });
      if (projectId !== currentProjectId) {
        return;
      }

      setWorkspaceView((current) =>
        current?.currentProject || current?.workspace
          ? {
              ...current,
              currentProject: current.currentProject
                ? {
                    ...current.currentProject,
                    title: payload?.title || title,
                  }
                : current.currentProject,
              workspace: current.workspace
                ? {
                    ...current.workspace,
                    projectTitle: payload?.title || title,
                  }
                : current.workspace,
            }
          : current
      );
    },
    [currentProjectId, setWorkspaceView, t]
  );

  const renameProjectFolder = React.useCallback(
    async (folderId: string, title: string) => {
      const projectId = resolveCurrentProjectId(currentProjectId, currentWorkspace);
      if (!projectId) {
        throw new Error(t('sidebar.renameProjectFolderFailed'));
      }

      await renameProjectTreeFolder({
        errorMessage: t('sidebar.renameProjectFolderFailed'),
        folderId,
        projectId,
        title,
      });

      await loadWorkspace();
    },
    [currentProjectId, currentWorkspace, loadWorkspace, t]
  );

  const deleteProjectFolder = React.useCallback(
    async (folderId: string) => {
      const projectId = resolveCurrentProjectId(currentProjectId, currentWorkspace);
      if (!projectId) {
        return;
      }

      try {
        await deleteProjectTreeFolder({
          errorMessage: t('sidebar.deleteProjectFolderFailed'),
          folderId,
          projectId,
        });
      } catch (error) {
        setWorkspaceNotice({
          tone: 'error',
          text:
            error instanceof Error ? error.message : t('sidebar.deleteProjectFolderFailed'),
        });
        return;
      }

      await loadWorkspace();
    },
    [currentProjectId, currentWorkspace, loadWorkspace, setWorkspaceNotice, t]
  );

  const renameDeliverable = React.useCallback(
    async (targetWorkspaceId: string, title: string) => {
      const payload = await renameProjectTreeDeliverable({
        errorMessage: t('workspace.renameDeliverableFailed'),
        title,
        workspaceId: targetWorkspaceId,
      });

      if (targetWorkspaceId === workspaceId) {
        await loadWorkspace();
        return;
      }

      setWorkspaceView((current) =>
        current
          ? {
              ...current,
              projectDeliverables: current.projectDeliverables.map((item) =>
                item.id === targetWorkspaceId
                  ? {
                      ...item,
                      title: payload?.title || title,
                    }
                  : item
              ),
            }
          : current
      );
    },
    [loadWorkspace, setWorkspaceView, t, workspaceId]
  );

  const deleteDeliverable = React.useCallback(
    async (targetWorkspaceId: string) => {
      try {
        await deleteProjectTreeDeliverable({
          errorMessage: t('workspace.deleteDeliverableFailed'),
          workspaceId: targetWorkspaceId,
        });
      } catch (error) {
        setWorkspaceNotice({
          tone: 'error',
          text:
            error instanceof Error ? error.message : t('workspace.deleteDeliverableFailed'),
        });
        return;
      }

      if (targetWorkspaceId === workspaceId) {
        const nextWorkspace =
          projectDeliverables.find((item) => item.id !== targetWorkspaceId) || null;
        if (nextWorkspace) {
          onOpenWorkspaceRoute(nextWorkspace.id);
        } else {
          onNavigateHome();
        }
        return;
      }

      await loadWorkspace();
    },
    [
      loadWorkspace,
      onNavigateHome,
      onOpenWorkspaceRoute,
      projectDeliverables,
      setWorkspaceNotice,
      t,
      workspaceId,
    ]
  );

  const moveDeliverable = React.useCallback(
    async (targetWorkspaceId: string, projectFolderId: string | null) => {
      await moveProjectTreeDeliverable({
        errorMessage: t('sidebar.moveDeliverableFailed'),
        projectFolderId,
        workspaceId: targetWorkspaceId,
      });

      await loadWorkspace();
    },
    [loadWorkspace, t]
  );

  const reorderDeliverable = React.useCallback(
    async (targetWorkspaceId: string, direction: 'up' | 'down') => {
      const deliverable =
        projectDeliverables.find((item) => item.id === targetWorkspaceId) || null;
      if (!deliverable) {
        return;
      }

      const nextTreeSortOrder = getAdjacentProjectTreeSortOrder({
        direction,
        siblings: buildProjectTreeSiblingNodes({
          deliverables: projectDeliverables,
          folders: projectFolders,
          parentFolderId: deliverable.projectFolderId,
        }),
        targetId: targetWorkspaceId,
      });
      if (nextTreeSortOrder === null) {
        return;
      }

      await reorderProjectTreeDeliverable({
        errorMessage: t('sidebar.moveDeliverableFailed'),
        treeSortOrder: nextTreeSortOrder,
        workspaceId: targetWorkspaceId,
      });

      await loadWorkspace();
    },
    [loadWorkspace, projectDeliverables, projectFolders, t]
  );

  const moveProjectFolder = React.useCallback(
    async (folderId: string, parentFolderId: string | null) => {
      const projectId = resolveCurrentProjectId(currentProjectId, currentWorkspace);
      if (!projectId) {
        throw new Error(t('sidebar.moveProjectFolderFailed'));
      }

      await moveProjectTreeFolder({
        errorMessage: t('sidebar.moveProjectFolderFailed'),
        folderId,
        parentId: parentFolderId,
        projectId,
      });

      await loadWorkspace();
    },
    [currentProjectId, currentWorkspace, loadWorkspace, t]
  );

  const reorderProjectFolder = React.useCallback(
    async (folderId: string, direction: 'up' | 'down') => {
      const projectId = resolveCurrentProjectId(currentProjectId, currentWorkspace);
      if (!projectId) {
        throw new Error(t('sidebar.moveProjectFolderFailed'));
      }

      const folder = projectFolders.find((item) => item.id === folderId) || null;
      if (!folder) {
        return;
      }

      const nextTreeSortOrder = getAdjacentProjectTreeSortOrder({
        direction,
        siblings: buildProjectTreeSiblingNodes({
          deliverables: projectDeliverables,
          folders: projectFolders,
          parentFolderId: folder.parentFolderId,
        }),
        targetId: folderId,
      });
      if (nextTreeSortOrder === null) {
        return;
      }

      await reorderProjectTreeFolder({
        errorMessage: t('sidebar.moveProjectFolderFailed'),
        folderId,
        projectId,
        treeSortOrder: nextTreeSortOrder,
      });

      await loadWorkspace();
    },
    [currentProjectId, currentWorkspace, loadWorkspace, projectDeliverables, projectFolders, t]
  );

  return {
    createProjectDeliverable,
    createProjectFolder,
    createSiblingDeliverable,
    createSupportFile,
    createSupportFolder,
    deleteDeliverable,
    deleteProject,
    deleteProjectFolder,
    deleteSupportFile,
    moveDeliverable,
    moveProjectFolder,
    moveSupportFile,
    renameDeliverable,
    renameProject,
    renameProjectFolder,
    renameSupportFile,
    reorderDeliverable,
    reorderProjectFolder,
    reorderSupportFile,
  };
}
