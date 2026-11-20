'use client';

import * as React from 'react';
import type { useT } from '@/components/providers/language-provider';
import type { ProjectDeliverableItem, ProjectFolderItem } from '@/types';
import {
  buildProjectFolderOptions,
  collectProjectFolderDescendantIds,
  type ProjectTreeMoveNode,
  type ProjectTreeNode,
} from './project-deliverable-tree';

export const PROJECT_TREE_ROOT_VALUE = '__root__';

export function useProjectTreeActions({
  loadProjects,
  onDeleteDeliverable,
  onDeleteProjectFolder,
  onMoveDeliverable,
  onMoveProjectFolder,
  onRenameDeliverable,
  onRenameProjectFolder,
  onReorderDeliverable,
  onReorderProjectFolder,
  projectDeliverables,
  projectFolders,
  t,
}: {
  loadProjects: () => Promise<void>;
  onDeleteDeliverable?: (workspaceId: string) => Promise<void> | void;
  onDeleteProjectFolder?: (folderId: string) => Promise<void> | void;
  onMoveDeliverable?: (workspaceId: string, projectFolderId: string | null) => Promise<void> | void;
  onMoveProjectFolder?: (folderId: string, parentFolderId: string | null) => Promise<void> | void;
  onRenameDeliverable?: (workspaceId: string, title: string) => Promise<void> | void;
  onRenameProjectFolder?: (folderId: string, title: string) => Promise<void> | void;
  onReorderDeliverable?: (workspaceId: string, direction: 'up' | 'down') => Promise<void> | void;
  onReorderProjectFolder?: (folderId: string, direction: 'up' | 'down') => Promise<void> | void;
  projectDeliverables: ProjectDeliverableItem[];
  projectFolders: ProjectFolderItem[];
  t: ReturnType<typeof useT>;
}) {
  const [projectTreeError, setProjectTreeError] = React.useState<string | null>(null);
  const [dragNode, setDragNode] = React.useState<ProjectTreeMoveNode | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = React.useState<string | null>(null);

  const [renameDeliverableId, setRenameDeliverableId] = React.useState<string | null>(null);
  const [renameDeliverableValue, setRenameDeliverableValue] = React.useState('');
  const [renameDeliverableError, setRenameDeliverableError] = React.useState<string | null>(null);
  const [isRenamingDeliverable, setIsRenamingDeliverable] = React.useState(false);

  const [moveNode, setMoveNode] = React.useState<ProjectTreeMoveNode | null>(null);
  const [moveTargetFolderId, setMoveTargetFolderId] = React.useState<string>(
    PROJECT_TREE_ROOT_VALUE
  );
  const [moveNodeError, setMoveNodeError] = React.useState<string | null>(null);
  const [isMovingNode, setIsMovingNode] = React.useState(false);

  const [renameProjectFolderId, setRenameProjectFolderId] = React.useState<string | null>(null);
  const [renameProjectFolderValue, setRenameProjectFolderValue] = React.useState('');
  const [renameProjectFolderError, setRenameProjectFolderError] = React.useState<string | null>(
    null
  );
  const [isRenamingProjectFolder, setIsRenamingProjectFolder] = React.useState(false);

  const projectFoldersById = React.useMemo(
    () => new Map(projectFolders.map((folder) => [folder.id, folder])),
    [projectFolders]
  );
  const projectFolderOptions = React.useMemo(
    () => buildProjectFolderOptions(projectFolders),
    [projectFolders]
  );
  const projectDeliverablesById = React.useMemo(
    () => new Map(projectDeliverables.map((deliverable) => [deliverable.id, deliverable])),
    [projectDeliverables]
  );

  const openRenameDeliverableDialog = React.useCallback(
    (deliverable: ProjectDeliverableItem) => {
      setRenameDeliverableId(deliverable.id);
      setRenameDeliverableValue(deliverable.title);
      setRenameDeliverableError(null);
    },
    []
  );
  const closeRenameDeliverableDialog = React.useCallback((open: boolean) => {
    if (open) {
      return;
    }

    setRenameDeliverableId(null);
    setRenameDeliverableValue('');
    setRenameDeliverableError(null);
  }, []);
  const handleRenameDeliverable = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!renameDeliverableId) {
        return;
      }

      const nextTitle = renameDeliverableValue.trim();
      const currentTitle = projectDeliverablesById.get(renameDeliverableId)?.title.trim() || '';

      if (!nextTitle) {
        setRenameDeliverableError(t('sidebar.renameDeliverableRequired'));
        return;
      }

      if (nextTitle === currentTitle) {
        setRenameDeliverableId(null);
        setRenameDeliverableValue('');
        setRenameDeliverableError(null);
        return;
      }

      setIsRenamingDeliverable(true);
      setRenameDeliverableError(null);

      try {
        if (onRenameDeliverable) {
          await onRenameDeliverable(renameDeliverableId, nextTitle);
        }

        await loadProjects();
        setRenameDeliverableId(null);
        setRenameDeliverableValue('');
        setRenameDeliverableError(null);
      } catch (error) {
        setRenameDeliverableError(
          error instanceof Error ? error.message : t('sidebar.renameDeliverableFailed')
        );
      } finally {
        setIsRenamingDeliverable(false);
      }
    },
    [
      loadProjects,
      onRenameDeliverable,
      projectDeliverablesById,
      renameDeliverableId,
      renameDeliverableValue,
      t,
    ]
  );

  const handleDeleteDeliverable = React.useCallback(
    async (workspaceId: string) => {
      if (!window.confirm(t('sidebar.deleteDeliverableConfirm'))) {
        return;
      }

      if (onDeleteDeliverable) {
        await onDeleteDeliverable(workspaceId);
        await loadProjects();
      }
    },
    [loadProjects, onDeleteDeliverable, t]
  );

  const openMoveDeliverableDialog = React.useCallback((deliverable: ProjectDeliverableItem) => {
    setMoveNode({
      currentParentFolderId: deliverable.projectFolderId || null,
      id: deliverable.id,
      title: deliverable.title,
      type: 'deliverable',
    });
    setMoveTargetFolderId(deliverable.projectFolderId || PROJECT_TREE_ROOT_VALUE);
    setMoveNodeError(null);
  }, []);
  const openMoveProjectFolderDialog = React.useCallback((folder: ProjectFolderItem) => {
    setMoveNode({
      currentParentFolderId: folder.parentFolderId || null,
      id: folder.id,
      title: folder.title,
      type: 'folder',
    });
    setMoveTargetFolderId(folder.parentFolderId || PROJECT_TREE_ROOT_VALUE);
    setMoveNodeError(null);
  }, []);
  const closeMoveDialog = React.useCallback((open: boolean) => {
    if (open) {
      return;
    }

    setMoveNode(null);
    setMoveTargetFolderId(PROJECT_TREE_ROOT_VALUE);
    setMoveNodeError(null);
  }, []);

  const availableMoveTargets = React.useMemo(() => {
    if (!moveNode) {
      return projectFolderOptions;
    }

    if (moveNode.type !== 'folder') {
      return projectFolderOptions;
    }

    const blockedIds = collectProjectFolderDescendantIds(projectFolders, moveNode.id);
    blockedIds.add(moveNode.id);

    return projectFolderOptions.filter((option) => !blockedIds.has(option.id));
  }, [moveNode, projectFolderOptions, projectFolders]);

  const canMoveProjectTreeNode = React.useCallback(
    (node: ProjectTreeMoveNode, targetFolderId: string | null) => {
      if (targetFolderId === node.currentParentFolderId) {
        return false;
      }

      if (node.type !== 'folder' || !targetFolderId) {
        return true;
      }

      if (targetFolderId === node.id) {
        return false;
      }

      const blockedIds = collectProjectFolderDescendantIds(projectFolders, node.id);
      return !blockedIds.has(targetFolderId);
    },
    [projectFolders]
  );

  const executeProjectTreeMove = React.useCallback(
    async (node: ProjectTreeMoveNode, targetFolderId: string | null) => {
      if (!canMoveProjectTreeNode(node, targetFolderId)) {
        return false;
      }

      if (node.type === 'deliverable') {
        if (!onMoveDeliverable) {
          return false;
        }

        await onMoveDeliverable(node.id, targetFolderId);
      } else {
        if (!onMoveProjectFolder) {
          return false;
        }

        await onMoveProjectFolder(node.id, targetFolderId);
      }

      await loadProjects();
      setProjectTreeError(null);
      return true;
    },
    [canMoveProjectTreeNode, loadProjects, onMoveDeliverable, onMoveProjectFolder]
  );

  const handleReorderProjectTreeNode = React.useCallback(
    async (node: ProjectTreeNode, direction: 'up' | 'down') => {
      try {
        setProjectTreeError(null);

        if (node.nodeType === 'folder') {
          if (!onReorderProjectFolder) {
            return;
          }

          await onReorderProjectFolder(node.id, direction);
        } else {
          if (!onReorderDeliverable) {
            return;
          }

          await onReorderDeliverable(node.id, direction);
        }

        await loadProjects();
      } catch (error) {
        setProjectTreeError(
          error instanceof Error
            ? error.message
            : node.nodeType === 'folder'
              ? t('sidebar.moveProjectFolderFailed')
              : t('sidebar.moveDeliverableFailed')
        );
      }
    },
    [loadProjects, onReorderDeliverable, onReorderProjectFolder, t]
  );

  const handleProjectTreeDragStart = React.useCallback((node: ProjectTreeMoveNode) => {
    setDragNode(node);
    setDropTargetFolderId(node.currentParentFolderId);
    setProjectTreeError(null);
  }, []);
  const handleProjectTreeDragEnd = React.useCallback(() => {
    setDragNode(null);
    setDropTargetFolderId(null);
  }, []);
  const handleProjectTreeDrop = React.useCallback(
    async (targetFolderId: string | null) => {
      if (!dragNode) {
        return;
      }

      try {
        await executeProjectTreeMove(dragNode, targetFolderId);
      } catch (error) {
        setProjectTreeError(
          error instanceof Error
            ? error.message
            : dragNode.type === 'folder'
              ? t('sidebar.moveProjectFolderFailed')
              : t('sidebar.moveDeliverableFailed')
        );
      } finally {
        setDragNode(null);
        setDropTargetFolderId(null);
      }
    },
    [dragNode, executeProjectTreeMove, t]
  );

  const handleMoveNode = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!moveNode) {
        return;
      }

      const nextParentFolderId =
        moveTargetFolderId === PROJECT_TREE_ROOT_VALUE ? null : moveTargetFolderId;

      if (nextParentFolderId === moveNode.currentParentFolderId) {
        setMoveNode(null);
        setMoveTargetFolderId(PROJECT_TREE_ROOT_VALUE);
        setMoveNodeError(null);
        return;
      }

      setIsMovingNode(true);
      setMoveNodeError(null);

      try {
        await executeProjectTreeMove(moveNode, nextParentFolderId);
        setMoveNode(null);
        setMoveTargetFolderId(PROJECT_TREE_ROOT_VALUE);
        setMoveNodeError(null);
      } catch (error) {
        setMoveNodeError(
          error instanceof Error
            ? error.message
            : moveNode.type === 'folder'
              ? t('sidebar.moveProjectFolderFailed')
              : t('sidebar.moveDeliverableFailed')
        );
      } finally {
        setIsMovingNode(false);
      }
    },
    [executeProjectTreeMove, moveNode, moveTargetFolderId, t]
  );

  const openRenameProjectFolderDialog = React.useCallback((folder: ProjectFolderItem) => {
    setRenameProjectFolderId(folder.id);
    setRenameProjectFolderValue(folder.title);
    setRenameProjectFolderError(null);
  }, []);
  const closeRenameProjectFolderDialog = React.useCallback((open: boolean) => {
    if (open) {
      return;
    }

    setRenameProjectFolderId(null);
    setRenameProjectFolderValue('');
    setRenameProjectFolderError(null);
  }, []);
  const handleRenameProjectFolder = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!renameProjectFolderId) {
        return;
      }

      const nextTitle = renameProjectFolderValue.trim();
      const currentTitle = projectFoldersById.get(renameProjectFolderId)?.title.trim() || '';

      if (!nextTitle) {
        setRenameProjectFolderError(t('sidebar.renameProjectFolderRequired'));
        return;
      }

      if (nextTitle === currentTitle) {
        setRenameProjectFolderId(null);
        setRenameProjectFolderValue('');
        setRenameProjectFolderError(null);
        return;
      }

      setIsRenamingProjectFolder(true);
      setRenameProjectFolderError(null);

      try {
        if (onRenameProjectFolder) {
          await onRenameProjectFolder(renameProjectFolderId, nextTitle);
        }

        setRenameProjectFolderId(null);
        setRenameProjectFolderValue('');
        setRenameProjectFolderError(null);
      } catch (error) {
        setRenameProjectFolderError(
          error instanceof Error ? error.message : t('sidebar.renameProjectFolderFailed')
        );
      } finally {
        setIsRenamingProjectFolder(false);
      }
    },
    [
      onRenameProjectFolder,
      projectFoldersById,
      renameProjectFolderId,
      renameProjectFolderValue,
      t,
    ]
  );

  const handleDeleteProjectFolder = React.useCallback(
    async (folderId: string) => {
      if (!window.confirm(t('sidebar.deleteProjectFolderConfirm'))) {
        return;
      }

      if (onDeleteProjectFolder) {
        await onDeleteProjectFolder(folderId);
      }
    },
    [onDeleteProjectFolder, t]
  );

  return {
    availableMoveTargets,
    closeMoveDialog,
    closeRenameDeliverableDialog,
    closeRenameProjectFolderDialog,
    dragNode,
    dropTargetFolderId,
    handleDeleteDeliverable,
    handleDeleteProjectFolder,
    handleMoveNode,
    handleProjectTreeDragEnd,
    handleProjectTreeDragStart,
    handleProjectTreeDrop,
    handleRenameDeliverable,
    handleRenameProjectFolder,
    handleReorderProjectTreeNode,
    isMovingNode,
    isRenamingDeliverable,
    isRenamingProjectFolder,
    moveNode,
    moveNodeError,
    moveTargetFolderId,
    openMoveDeliverableDialog,
    openMoveProjectFolderDialog,
    openRenameDeliverableDialog,
    openRenameProjectFolderDialog,
    projectDeliverablesById,
    projectTreeError,
    renameDeliverableError,
    renameDeliverableId,
    renameDeliverableValue,
    renameProjectFolderError,
    renameProjectFolderId,
    renameProjectFolderValue,
    setDropTargetFolderId,
    setMoveNodeError,
    setMoveTargetFolderId,
    setRenameDeliverableError,
    setRenameDeliverableValue,
    setRenameProjectFolderError,
    setRenameProjectFolderValue,
  };
}
