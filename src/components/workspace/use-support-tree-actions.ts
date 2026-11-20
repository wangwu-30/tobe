'use client';

import * as React from 'react';
import type { useT } from '@/components/providers/language-provider';
import { apiFetch } from '@/framework/resilience';
import { getWorkspaceFileDisplayName } from '@/lib/workspace/file-presentation';
import {
  buildWorkspaceFileTree,
  buildWorkspaceFolderOptions,
  type SidebarSupportFile,
  type SupportTreeMoveNode,
} from './support-material-tree';

export const SUPPORT_TREE_ROOT_VALUE = '__support_root__';

export function useSupportTreeActions({
  currentWorkspaceId,
  onDeleteSupportFile,
  onMoveSupportFile,
  onRenameSupportFile,
  onReorderSupportFile,
  supportFiles,
  t,
}: {
  currentWorkspaceId?: string | null;
  onDeleteSupportFile?: (fileId: string) => Promise<void> | void;
  onMoveSupportFile?: (
    fileId: string,
    parentId: string | null,
    sortOrder?: number
  ) => Promise<void> | void;
  onRenameSupportFile?: (fileId: string, name: string) => Promise<void> | void;
  onReorderSupportFile?: (fileId: string, direction: 'up' | 'down') => Promise<void> | void;
  supportFiles: SidebarSupportFile[];
  t: ReturnType<typeof useT>;
}) {
  const [renameSupportFileId, setRenameSupportFileId] = React.useState<string | null>(null);
  const [renameSupportValue, setRenameSupportValue] = React.useState('');
  const [renameSupportError, setRenameSupportError] = React.useState<string | null>(null);
  const [isRenamingSupportFile, setIsRenamingSupportFile] = React.useState(false);

  const [supportTreeError, setSupportTreeError] = React.useState<string | null>(null);
  const [dragSupportNode, setDragSupportNode] = React.useState<SupportTreeMoveNode | null>(null);
  const [dropTargetSupportParentId, setDropTargetSupportParentId] = React.useState<string | null>(
    null
  );

  const [moveSupportNode, setMoveSupportNode] = React.useState<SupportTreeMoveNode | null>(null);
  const [moveSupportTargetId, setMoveSupportTargetId] = React.useState<string>(
    SUPPORT_TREE_ROOT_VALUE
  );
  const [moveSupportError, setMoveSupportError] = React.useState<string | null>(null);
  const [isMovingSupportNode, setIsMovingSupportNode] = React.useState(false);

  const supportItemsById = React.useMemo(
    () => new Map(supportFiles.map((file) => [file.id, file])),
    [supportFiles]
  );
  const supportTree = React.useMemo(
    () => buildWorkspaceFileTree(supportFiles),
    [supportFiles]
  );
  const supportFolderOptions = React.useMemo(
    () => buildWorkspaceFolderOptions(supportFiles),
    [supportFiles]
  );

  const openRenameSupportDialog = React.useCallback((file: SidebarSupportFile) => {
    setRenameSupportFileId(file.id);
    setRenameSupportValue(getWorkspaceFileDisplayName(file));
    setRenameSupportError(null);
  }, []);
  const closeRenameSupportDialog = React.useCallback(
    (open: boolean) => {
      if (open || isRenamingSupportFile) {
        return;
      }

      setRenameSupportFileId(null);
      setRenameSupportValue('');
      setRenameSupportError(null);
    },
    [isRenamingSupportFile]
  );
  const handleRenameSupportFile = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!renameSupportFileId) {
        return;
      }

      const nextName = renameSupportValue.trim();
      const currentName = getWorkspaceFileDisplayName(
        supportItemsById.get(renameSupportFileId)
      ).trim();

      if (!nextName) {
        setRenameSupportError(t('sidebar.renameSupportMaterialRequired'));
        return;
      }

      if (nextName === currentName) {
        setRenameSupportFileId(null);
        setRenameSupportValue('');
        setRenameSupportError(null);
        return;
      }

      setIsRenamingSupportFile(true);
      setRenameSupportError(null);

      try {
        if (onRenameSupportFile) {
          await onRenameSupportFile(renameSupportFileId, nextName);
        } else if (currentWorkspaceId) {
          const response = await apiFetch(
            `/api/workspaces/${currentWorkspaceId}/files/${renameSupportFileId}`,
            {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ name: nextName }),
            }
          );
          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(payload?.error || t('sidebar.renameSupportMaterialFailed'));
          }
        }

        setRenameSupportFileId(null);
        setRenameSupportValue('');
        setRenameSupportError(null);
      } catch (error) {
        setRenameSupportError(
          error instanceof Error ? error.message : t('sidebar.renameSupportMaterialFailed')
        );
      } finally {
        setIsRenamingSupportFile(false);
      }
    },
    [
      currentWorkspaceId,
      onRenameSupportFile,
      renameSupportFileId,
      renameSupportValue,
      supportItemsById,
      t,
    ]
  );

  const handleDeleteSupportFile = React.useCallback(
    async (fileId: string) => {
      if (!window.confirm(t('sidebar.deleteSupportMaterialConfirm'))) {
        return;
      }

      if (onDeleteSupportFile) {
        await onDeleteSupportFile(fileId);
        return;
      }

      if (!currentWorkspaceId) {
        return;
      }

      await apiFetch(`/api/workspaces/${currentWorkspaceId}/files/${fileId}`, {
        method: 'DELETE',
      });
    },
    [currentWorkspaceId, onDeleteSupportFile, t]
  );

  const openMoveSupportDialog = React.useCallback((file: SidebarSupportFile) => {
    setMoveSupportNode({
      currentParentId: file.parentId || null,
      id: file.id,
      name: getWorkspaceFileDisplayName(file),
      nodeType: file.nodeType,
      path: file.path,
    });
    setMoveSupportTargetId(file.parentId || SUPPORT_TREE_ROOT_VALUE);
    setMoveSupportError(null);
  }, []);
  const closeMoveSupportDialog = React.useCallback((open: boolean) => {
    if (open) {
      return;
    }

    setMoveSupportNode(null);
    setMoveSupportTargetId(SUPPORT_TREE_ROOT_VALUE);
    setMoveSupportError(null);
  }, []);

  const availableSupportMoveTargets = React.useMemo(() => {
    if (!moveSupportNode || moveSupportNode.nodeType !== 'folder') {
      return supportFolderOptions;
    }

    return supportFolderOptions.filter(
      (option) =>
        option.id !== moveSupportNode.id &&
        !option.path.startsWith(`${moveSupportNode.path}/`)
    );
  }, [moveSupportNode, supportFolderOptions]);

  const canMoveSupportNode = React.useCallback(
    (node: SupportTreeMoveNode, parentId: string | null) => {
      if (parentId === node.currentParentId) {
        return false;
      }

      if (node.nodeType !== 'folder' || !parentId) {
        return true;
      }

      const target = supportItemsById.get(parentId);
      if (!target) {
        return false;
      }

      return target.id !== node.id && !target.path.startsWith(`${node.path}/`);
    },
    [supportItemsById]
  );

  const executeSupportMove = React.useCallback(
    async (node: SupportTreeMoveNode, parentId: string | null, sortOrder?: number) => {
      if (!onMoveSupportFile || !canMoveSupportNode(node, parentId)) {
        return false;
      }

      await onMoveSupportFile(node.id, parentId, sortOrder);
      setSupportTreeError(null);
      return true;
    },
    [canMoveSupportNode, onMoveSupportFile]
  );

  const handleReorderSupportNode = React.useCallback(
    async (fileId: string, direction: 'up' | 'down') => {
      try {
        setSupportTreeError(null);
        await onReorderSupportFile?.(fileId, direction);
      } catch (error) {
        setSupportTreeError(
          error instanceof Error ? error.message : t('sidebar.moveSupportMaterialFailed')
        );
      }
    },
    [onReorderSupportFile, t]
  );

  const handleSupportTreeDragStart = React.useCallback((node: SupportTreeMoveNode) => {
    setDragSupportNode(node);
    setDropTargetSupportParentId(node.currentParentId);
    setSupportTreeError(null);
  }, []);
  const handleSupportTreeDragEnd = React.useCallback(() => {
    setDragSupportNode(null);
    setDropTargetSupportParentId(null);
  }, []);
  const handleSupportTreeDrop = React.useCallback(
    async (parentId: string | null, sortOrder?: number) => {
      if (!dragSupportNode) {
        return;
      }

      try {
        await executeSupportMove(dragSupportNode, parentId, sortOrder);
      } catch (error) {
        setSupportTreeError(
          error instanceof Error ? error.message : t('sidebar.moveSupportMaterialFailed')
        );
      } finally {
        setDragSupportNode(null);
        setDropTargetSupportParentId(null);
      }
    },
    [dragSupportNode, executeSupportMove, t]
  );

  const handleMoveSupportNode = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!moveSupportNode) {
        return;
      }

      const nextParentId =
        moveSupportTargetId === SUPPORT_TREE_ROOT_VALUE ? null : moveSupportTargetId;

      if (nextParentId === moveSupportNode.currentParentId) {
        closeMoveSupportDialog(false);
        return;
      }

      setIsMovingSupportNode(true);
      setMoveSupportError(null);

      try {
        await executeSupportMove(moveSupportNode, nextParentId);
        closeMoveSupportDialog(false);
      } catch (error) {
        setMoveSupportError(
          error instanceof Error ? error.message : t('sidebar.moveSupportMaterialFailed')
        );
      } finally {
        setIsMovingSupportNode(false);
      }
    },
    [closeMoveSupportDialog, executeSupportMove, moveSupportNode, moveSupportTargetId, t]
  );

  return {
    availableSupportMoveTargets,
    closeMoveSupportDialog,
    closeRenameSupportDialog,
    dragSupportNode,
    dropTargetSupportParentId,
    handleDeleteSupportFile,
    handleMoveSupportNode,
    handleRenameSupportFile,
    handleReorderSupportNode,
    handleSupportTreeDragEnd,
    handleSupportTreeDragStart,
    handleSupportTreeDrop,
    isMovingSupportNode,
    isRenamingSupportFile,
    moveSupportError,
    moveSupportNode,
    moveSupportTargetId,
    openMoveSupportDialog,
    openRenameSupportDialog,
    renameSupportError,
    renameSupportFileId,
    renameSupportValue,
    setDropTargetSupportParentId,
    setMoveSupportError,
    setMoveSupportTargetId,
    setRenameSupportError,
    setRenameSupportValue,
    supportTree,
    supportTreeError,
  };
}
