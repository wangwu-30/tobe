'use client';

import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  FilePlus2,
  FileText,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getSidebarWidthClass,
  SidebarIconButton,
  SidebarInfo,
  SidebarSection,
} from '@/components/layout/sidebar-primitives';
import { useT } from '@/components/providers/language-provider';
import { useAppPathname, useAppRouter } from '@/lib/app-router';
import { cn } from '@/lib/utils';
import { getWorkspaceFileDisplayName } from '@/lib/workspace/file-presentation';
import { formatDeliverableTypeLabel } from '@/lib/workspace/deliverable-labels';
import { formatProjectListMeta } from '@/lib/workspace/project-summary';
import type { ProjectDeliverableItem } from '@/types';
import type { ProjectFolderItem } from '@/types';
import type { ProjectSummaryData } from '@/types';
import type { WorkspaceFileData } from '@/types';
import type { WorkspaceVersionFileData } from '@/types';

export type DeliverableOutlineItem = {
  active?: boolean;
  depth: number;
  id: string;
  label: string;
};

type SidebarSupportFile = WorkspaceFileData | WorkspaceVersionFileData;
const PROJECT_TREE_ROOT_VALUE = '__root__';
const SUPPORT_TREE_ROOT_VALUE = '__support_root__';
type ProjectTreeMoveNode = {
  currentParentFolderId: string | null;
  id: string;
  title: string;
  type: 'deliverable' | 'folder';
};
type SupportTreeMoveNode = {
  currentParentId: string | null;
  id: string;
  name: string;
  nodeType: 'file' | 'folder';
  path: string;
};

export function DeliverableSidebar({
  activeSupportFileId,
  className,
  collapsed = false,
  currentProjectId,
  currentWorkspaceId,
  currentWorkspaceStatusLabel,
  onCreateWorkspace,
  onCreateDeliverable,
  onCreateProjectFolder,
  onCreateSiblingDeliverable,
  onCreateSupportFile,
  onCreateSupportFolder,
  onDeleteDeliverable,
  onDeleteProjectFolder,
  onDeleteWorkspace,
  onDeleteSupportFile,
  onMoveDeliverable,
  onMoveProjectFolder,
  onMoveSupportFile,
  onNavigate,
  onOpenOutline,
  onOpenDeliverable,
  onReorderDeliverable,
  onReorderProjectFolder,
  onReorderSupportFile,
  onRenameDeliverable,
  onRenameProjectFolder,
  onRenameSupportFile,
  onRenameWorkspace,
  onOpenSupportFile,
  onOpenWorkspace,
  outlineItems,
  projectFolders = [],
  projectDeliverables = [],
  supportFiles = [],
}: {
  activeSupportFileId?: string | null;
  className?: string;
  collapsed?: boolean;
  currentProjectId?: string | null;
  currentWorkspaceId?: string | null;
  currentWorkspaceStatusLabel?: string | null;
  onCreateWorkspace?: () => void;
  onCreateDeliverable?: (context?: {
    projectFolderId?: string | null;
  }) => Promise<void> | void;
  onCreateProjectFolder?: (parentFolderId?: string | null) => Promise<void> | void;
  onCreateSiblingDeliverable?: (workspaceId: string) => Promise<void> | void;
  onDeleteDeliverable?: (workspaceId: string) => Promise<void> | void;
  onCreateSupportFile?: (parentId?: string | null) => Promise<void> | void;
  onCreateSupportFolder?: (parentId?: string | null) => Promise<void> | void;
  onDeleteProjectFolder?: (folderId: string) => Promise<void> | void;
  onDeleteWorkspace?: (workspaceId: string) => Promise<void> | void;
  onDeleteSupportFile?: (fileId: string) => Promise<void> | void;
  onMoveDeliverable?: (workspaceId: string, projectFolderId: string | null) => Promise<void> | void;
  onMoveProjectFolder?: (folderId: string, parentFolderId: string | null) => Promise<void> | void;
  onMoveSupportFile?: (
    fileId: string,
    parentId: string | null,
    sortOrder?: number
  ) => Promise<void> | void;
  onNavigate?: () => void;
  onOpenDeliverable?: (workspaceId: string) => void;
  onOpenOutline?: (outlineId: string) => void;
  onReorderDeliverable?: (
    workspaceId: string,
    direction: 'up' | 'down'
  ) => Promise<void> | void;
  onReorderProjectFolder?: (
    folderId: string,
    direction: 'up' | 'down'
  ) => Promise<void> | void;
  onReorderSupportFile?: (
    fileId: string,
    direction: 'up' | 'down'
  ) => Promise<void> | void;
  onRenameDeliverable?: (workspaceId: string, title: string) => Promise<void> | void;
  onRenameProjectFolder?: (folderId: string, title: string) => Promise<void> | void;
  onRenameSupportFile?: (fileId: string, name: string) => Promise<void> | void;
  onRenameWorkspace?: (workspaceId: string, title: string) => Promise<void> | void;
  onOpenSupportFile?: (fileId: string) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
  outlineItems: DeliverableOutlineItem[];
  projectFolders?: ProjectFolderItem[];
  projectDeliverables?: ProjectDeliverableItem[];
  supportFiles?: SidebarSupportFile[];
}) {
  const t = useT();
  const pathname = useAppPathname();
  const router = useAppRouter();
  const [isLoading, setIsLoading] = React.useState(true);
  const [projects, setProjects] = React.useState<ProjectSummaryData[]>([]);
  const [renameWorkspaceId, setRenameWorkspaceId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [isRenamingWorkspace, setIsRenamingWorkspace] = React.useState(false);
  const [projectTreeError, setProjectTreeError] = React.useState<string | null>(null);
  const [dragNode, setDragNode] = React.useState<ProjectTreeMoveNode | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = React.useState<string | null>(null);
  const [renameDeliverableId, setRenameDeliverableId] = React.useState<string | null>(null);
  const [renameDeliverableValue, setRenameDeliverableValue] = React.useState('');
  const [renameDeliverableError, setRenameDeliverableError] = React.useState<string | null>(null);
  const [isRenamingDeliverable, setIsRenamingDeliverable] = React.useState(false);
  const [moveNode, setMoveNode] = React.useState<ProjectTreeMoveNode | null>(null);
  const [moveTargetFolderId, setMoveTargetFolderId] = React.useState<string>(PROJECT_TREE_ROOT_VALUE);
  const [moveNodeError, setMoveNodeError] = React.useState<string | null>(null);
  const [isMovingNode, setIsMovingNode] = React.useState(false);
  const [renameProjectFolderId, setRenameProjectFolderId] = React.useState<string | null>(null);
  const [renameProjectFolderValue, setRenameProjectFolderValue] = React.useState('');
  const [renameProjectFolderError, setRenameProjectFolderError] = React.useState<string | null>(null);
  const [isRenamingProjectFolder, setIsRenamingProjectFolder] = React.useState(false);
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

  const loadProjects = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) {
        return;
      }

      const data = await res.json();
      setProjects(data.items || []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const handleDelete = React.useCallback(
    async (projectId: string) => {
      if (!window.confirm(t('sidebar.deleteProjectConfirm'))) {
        return;
      }

      if (onDeleteWorkspace) {
        await onDeleteWorkspace(projectId);
      } else {
        const response = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
        if (!response.ok) {
          return;
        }
        if (projectId === currentProjectId) {
          router.push('/');
        }
      }
      await loadProjects();
    },
    [currentProjectId, loadProjects, onDeleteWorkspace, router, t]
  );

  const openProject = React.useCallback(
    (project: ProjectSummaryData) => {
      onNavigate?.();
      if (onOpenWorkspace) {
        onOpenWorkspace(project.workspaceId);
        return;
      }
      router.push(`/workspace/${project.workspaceId}`);
    },
    [onNavigate, onOpenWorkspace, router]
  );
  const openSupportFile = React.useCallback(
    (fileId: string) => {
      onNavigate?.();
      if (onOpenSupportFile) {
        onOpenSupportFile(fileId);
        return;
      }
      if (currentWorkspaceId) {
        router.push(`/workspace/${currentWorkspaceId}?fileId=${fileId}`);
      }
    },
    [currentWorkspaceId, onNavigate, onOpenSupportFile, router]
  );
  const openRenameDialog = React.useCallback((project: ProjectSummaryData) => {
    setRenameWorkspaceId(project.id);
    setRenameValue(project.title);
    setRenameError(null);
  }, []);
  const openRenameSupportDialog = React.useCallback((file: SidebarSupportFile) => {
    setRenameSupportFileId(file.id);
    setRenameSupportValue(getWorkspaceFileDisplayName(file));
    setRenameSupportError(null);
  }, []);
  const closeRenameDialog = React.useCallback(
    (open: boolean) => {
      if (open || isRenamingWorkspace) {
        return;
      }

      setRenameWorkspaceId(null);
      setRenameValue('');
      setRenameError(null);
    },
    [isRenamingWorkspace]
  );
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
  const handleRename = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!renameWorkspaceId) {
        return;
      }

      const nextTitle = renameValue.trim();
      const currentTitle =
        projects.find((project) => project.id === renameWorkspaceId)?.title.trim() || '';

      if (!nextTitle) {
        setRenameError(t('sidebar.renameProjectRequired'));
        return;
      }

      if (nextTitle === currentTitle) {
        setRenameWorkspaceId(null);
        setRenameValue('');
        setRenameError(null);
        return;
      }

      setIsRenamingWorkspace(true);
      setRenameError(null);

      try {
        if (onRenameWorkspace) {
          await onRenameWorkspace(renameWorkspaceId, nextTitle);
        } else {
          const response = await fetch(`/api/projects/${renameWorkspaceId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title: nextTitle }),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(payload?.error || t('sidebar.renameProjectFailed'));
          }
        }

        await loadProjects();
        setRenameWorkspaceId(null);
        setRenameValue('');
        setRenameError(null);
      } catch (error) {
        setRenameError(
          error instanceof Error ? error.message : t('sidebar.renameProjectFailed')
        );
      } finally {
        setIsRenamingWorkspace(false);
      }
    },
    [loadProjects, onRenameWorkspace, projects, renameValue, renameWorkspaceId, t]
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
  const openMoveDeliverableDialog = React.useCallback(
    (deliverable: ProjectDeliverableItem) => {
      setMoveNode({
        currentParentFolderId: deliverable.projectFolderId || null,
        id: deliverable.id,
        title: deliverable.title,
        type: 'deliverable',
      });
      setMoveTargetFolderId(deliverable.projectFolderId || PROJECT_TREE_ROOT_VALUE);
      setMoveNodeError(null);
    },
    []
  );
  const openMoveProjectFolderDialog = React.useCallback(
    (folder: ProjectFolderItem) => {
      setMoveNode({
        currentParentFolderId: folder.parentFolderId || null,
        id: folder.id,
        title: folder.title,
        type: 'folder',
      });
      setMoveTargetFolderId(folder.parentFolderId || PROJECT_TREE_ROOT_VALUE);
      setMoveNodeError(null);
    },
    []
  );
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
  const openRenameProjectFolderDialog = React.useCallback(
    (folder: ProjectFolderItem) => {
      setRenameProjectFolderId(folder.id);
      setRenameProjectFolderValue(folder.title);
      setRenameProjectFolderError(null);
    },
    []
  );
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
          const response = await fetch(
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

      await fetch(`/api/workspaces/${currentWorkspaceId}/files/${fileId}`, {
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
  const outlineInteractive = Boolean(onOpenOutline);

  return (
    <>
      <aside
        className={cn(
          'h-full shrink-0 overflow-hidden border-r border-border bg-muted/25 transition-[width] duration-200 ease-out',
          getSidebarWidthClass(collapsed),
          className
        )}
      >
        <div className="flex h-full min-w-0 w-full flex-col overflow-hidden">
          <div
            className={cn(
              'min-w-0 w-full overflow-hidden border-b border-border',
              collapsed ? 'px-2 py-3' : 'px-3 py-3'
            )}
          >
            <button
              className={cn(
                'flex max-w-full items-center rounded-xl text-left transition-colors hover:bg-accent',
                collapsed
                  ? 'mx-auto h-11 w-11 justify-center px-0 py-0'
                  : 'w-full min-w-0 gap-2 px-2 py-2'
              )}
              onClick={() => {
                onNavigate?.();
                router.push('/');
              }}
              type="button"
            >
              <div className="rounded-lg bg-background p-2 shadow-sm">
                <FileText className="h-4 w-4 text-primary" />
              </div>
              {!collapsed ? (
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="truncate text-sm font-semibold">成形</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {t('sidebar.aiNativeStudio')}
                  </div>
                </div>
              ) : null}
            </button>

            {collapsed ? (
              <SidebarIconButton
                className="mt-3"
                icon={<Plus className="h-4 w-4" />}
                label={t('sidebar.newProject')}
                onClick={() => onCreateWorkspace?.()}
              />
            ) : (
              <Button
                className="mt-3 w-full min-w-0 max-w-full justify-start gap-2 overflow-hidden rounded-xl"
                onClick={onCreateWorkspace}
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span className="truncate">{t('sidebar.newProject')}</span>
              </Button>
            )}
          </div>

          <ScrollArea className="min-h-0 w-full flex-1 overflow-hidden">
            {collapsed ? (
              <div className="flex min-w-0 flex-col items-center gap-2 px-2 py-3">
                {isLoading ? (
                  <SidebarInfo compact text="..." />
                ) : projects.length === 0 ? (
                  <SidebarInfo compact text="-" />
                ) : (
                  projects.map((project) => (
                    <SidebarIconButton
                      key={project.id}
                      active={currentProjectId === project.id}
                      icon={<FolderClosed className="h-4 w-4" />}
                      label={project.title}
                      onClick={() => openProject(project)}
                    />
                  ))
                )}
              </div>
            ) : (
              <div className="min-w-0 space-y-4 px-2 py-3">
                <SidebarSection
                  title={t('sidebar.projects')}
                  action={
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={onCreateWorkspace}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  }
                >
                  {isLoading ? (
                    <SidebarInfo text={t('sidebar.loadingProjects')} />
                  ) : projects.length === 0 ? (
                    <SidebarInfo text={t('sidebar.noProjectsYet')} />
                  ) : (
                    <div className="min-w-0 space-y-1">
                      {projects.map((project) => (
                        <div
                          key={project.id}
                          className={cn(
                            'group flex min-w-0 items-center gap-2 overflow-hidden rounded-xl px-2 py-1.5 transition-colors hover:bg-accent',
                            currentProjectId === project.id
                              ? 'bg-background shadow-sm ring-1 ring-border'
                              : ''
                          )}
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left"
                            onClick={() => openProject(project)}
                          >
                            <div className="rounded-md bg-background/80 p-1.5 ring-1 ring-border/60">
                              <FolderClosed className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                            <div className="min-w-0 flex-1 overflow-hidden">
                              <div className="truncate text-sm font-medium leading-5">
                                {project.title}
                              </div>
                              <div className="truncate text-[11px] text-muted-foreground/80">
                                {currentProjectId === project.id && currentWorkspaceStatusLabel
                                  ? currentWorkspaceStatusLabel
                                  : formatProjectListMeta(project, t)}
                              </div>
                            </div>
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => openRenameDialog(project)}>
                                <Pencil className="h-3.5 w-3.5" />
                                {t('sidebar.renameProject')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => void handleDelete(project.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                {t('sidebar.deleteProject')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ))}
                    </div>
                  )}
                </SidebarSection>

                {currentWorkspaceId ? (
                  <SidebarSection
                    title={t('sidebar.projectTree')}
                    action={
                      onCreateDeliverable || onCreateProjectFolder ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 shrink-0"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {onCreateDeliverable ? (
                              <DropdownMenuItem
                                onSelect={() =>
                                  void onCreateDeliverable({
                                    projectFolderId: null,
                                  })
                                }
                              >
                                <FilePlus2 className="h-3.5 w-3.5" />
                                {t('sidebar.newDeliverable')}
                              </DropdownMenuItem>
                            ) : null}
                            {onCreateProjectFolder ? (
                              <DropdownMenuItem onSelect={() => void onCreateProjectFolder(null)}>
                                <FolderPlus className="h-3.5 w-3.5" />
                                {t('sidebar.newProjectFolder')}
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : undefined
                    }
                  >
                    {projectTreeError ? (
                      <div className="mb-2 rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                        {projectTreeError}
                      </div>
                    ) : null}
                    {projectFolders.length === 0 && projectDeliverables.length === 0 ? (
                      <SidebarInfo text={t('sidebar.noProjectTreeYet')} />
                    ) : (
                      <ProjectDeliverableTree
                        currentWorkspaceId={currentWorkspaceId}
                        dragNode={dragNode}
                        folders={projectFolders}
                        deliverables={projectDeliverables}
                        dropTargetFolderId={dropTargetFolderId}
                        onCreateDeliverable={onCreateDeliverable}
                        onCreateProjectFolder={onCreateProjectFolder}
                        onCreateSiblingDeliverable={onCreateSiblingDeliverable}
                        onDeleteDeliverable={
                          onDeleteDeliverable
                            ? (targetWorkspaceId) => void handleDeleteDeliverable(targetWorkspaceId)
                            : undefined
                        }
                        onDeleteProjectFolder={
                          onDeleteProjectFolder
                            ? (folderId) => void handleDeleteProjectFolder(folderId)
                            : undefined
                        }
                        onMoveDeliverable={
                          onMoveDeliverable ? openMoveDeliverableDialog : undefined
                        }
                        onMoveProjectFolder={
                          onMoveProjectFolder ? openMoveProjectFolderDialog : undefined
                        }
                        onOpenDeliverable={onOpenDeliverable || onOpenWorkspace}
                        onReorderDeliverable={
                          onReorderDeliverable
                            ? (node, direction) =>
                                void handleReorderProjectTreeNode(node, direction)
                            : undefined
                        }
                        onReorderProjectFolder={
                          onReorderProjectFolder
                            ? (node, direction) =>
                                void handleReorderProjectTreeNode(node, direction)
                            : undefined
                        }
                        onDragEndNode={
                          onMoveDeliverable || onMoveProjectFolder
                            ? handleProjectTreeDragEnd
                            : undefined
                        }
                        onDragStartNode={
                          onMoveDeliverable || onMoveProjectFolder
                            ? handleProjectTreeDragStart
                            : undefined
                        }
                        onDropNodeOnFolder={
                          onMoveDeliverable || onMoveProjectFolder
                            ? (folderId) => void handleProjectTreeDrop(folderId)
                            : undefined
                        }
                        onDropNodeOnRoot={
                          onMoveDeliverable || onMoveProjectFolder
                            ? () => void handleProjectTreeDrop(null)
                            : undefined
                        }
                        onSetDropTargetFolderId={
                          onMoveDeliverable || onMoveProjectFolder
                            ? setDropTargetFolderId
                            : undefined
                        }
                        onRequestRenameDeliverable={
                          onRenameDeliverable ? openRenameDeliverableDialog : undefined
                        }
                        onRequestRenameProjectFolder={
                          onRenameProjectFolder ? openRenameProjectFolderDialog : undefined
                        }
                      />
                    )}
                  </SidebarSection>
                ) : null}

                <SidebarSection title={t('sidebar.deliverableOutline')}>
                  {outlineItems.length === 0 ? (
                    <SidebarInfo text={t('sidebar.outlineEmpty')} />
                  ) : (
                    <div className="min-w-0 space-y-1 overflow-hidden">
                      {outlineItems.map((item) =>
                        outlineInteractive ? (
                          <button
                            key={item.id}
                            type="button"
                            data-testid={`outline-item-${item.id}`}
                            onClick={() => onOpenOutline?.(item.id)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                              item.active && 'bg-background shadow-sm ring-1 ring-border'
                            )}
                            style={{ paddingLeft: `${item.depth * 14 + 8}px` }}
                          >
                            <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{item.label}</span>
                          </button>
                        ) : (
                          <div
                            key={item.id}
                            className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm text-foreground"
                            style={{ paddingLeft: `${item.depth * 14 + 8}px` }}
                          >
                            <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{item.label}</span>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </SidebarSection>

                <SidebarSection
                  title={t('sidebar.uploads')}
                  action={
                    onCreateSupportFile || onCreateSupportFolder ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0"
                            data-testid="support-tree-add-trigger"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {onCreateSupportFile ? (
                            <DropdownMenuItem onSelect={() => void onCreateSupportFile(null)}>
                              <FilePlus2 className="h-3.5 w-3.5" />
                              {t('sidebar.newSupportNote')}
                            </DropdownMenuItem>
                          ) : null}
                          {onCreateSupportFolder ? (
                            <DropdownMenuItem onSelect={() => void onCreateSupportFolder(null)}>
                              <FolderPlus className="h-3.5 w-3.5" />
                              {t('sidebar.newSupportFolder')}
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : undefined
                  }
                >
                  {supportTreeError ? (
                    <div className="mb-2 rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      {supportTreeError}
                    </div>
                  ) : null}
                  {supportTree.length === 0 ? (
                    <div data-testid="support-tree-empty">
                      <SidebarInfo text={t('sidebar.noUploadsYet')} />
                    </div>
                  ) : (
                    <SupportMaterialTree
                      activeSupportFileId={activeSupportFileId}
                      dragNode={dragSupportNode}
                      files={supportTree}
                      onCreateSupportFile={onCreateSupportFile}
                      onCreateSupportFolder={onCreateSupportFolder}
                      onDeleteSupportFile={
                        onDeleteSupportFile ? (fileId) => void handleDeleteSupportFile(fileId) : undefined
                      }
                      onDragEndNode={
                        onMoveSupportFile ? handleSupportTreeDragEnd : undefined
                      }
                      onDragStartNode={
                        onMoveSupportFile ? handleSupportTreeDragStart : undefined
                      }
                      onDropNodeOnFolder={
                        onMoveSupportFile
                          ? (parentId, sortOrder) => void handleSupportTreeDrop(parentId, sortOrder)
                          : undefined
                      }
                      onDropNodeOnRoot={
                        onMoveSupportFile
                          ? (sortOrder) => void handleSupportTreeDrop(null, sortOrder)
                          : undefined
                      }
                      onMoveSupportFile={
                        onMoveSupportFile ? openMoveSupportDialog : undefined
                      }
                      onOpenSupportFile={openSupportFile}
                      onReorderSupportFile={
                        onReorderSupportFile
                          ? (fileId, direction) => void handleReorderSupportNode(fileId, direction)
                          : undefined
                      }
                      onRenameSupportFile={
                        onRenameSupportFile
                          ? (file) => openRenameSupportDialog(file)
                          : undefined
                      }
                      onSetDropTargetParentId={
                        onMoveSupportFile ? setDropTargetSupportParentId : undefined
                      }
                      dropTargetParentId={dropTargetSupportParentId}
                    />
                  )}
                </SidebarSection>
              </div>
            )}
          </ScrollArea>

          <div
            className={cn(
              'min-w-0 w-full overflow-hidden border-t border-border',
              collapsed ? 'px-2 py-3' : 'p-3'
            )}
          >
            {collapsed ? (
              <SidebarIconButton
                active={pathname === '/settings'}
                icon={<Settings className="h-4 w-4" />}
                label={t('common.settings')}
                onClick={() => {
                  onNavigate?.();
                  router.push('/settings');
                }}
              />
            ) : (
              <Button
                variant={pathname === '/settings' ? 'secondary' : 'ghost'}
                className="w-full min-w-0 max-w-full justify-start gap-2 overflow-hidden rounded-xl"
                onClick={() => {
                  onNavigate?.();
                  router.push('/settings');
                }}
              >
                <Settings className="h-4 w-4 shrink-0" />
                <span className="truncate">{t('common.settings')}</span>
              </Button>
            )}
          </div>
        </div>
      </aside>

      <Dialog open={Boolean(renameWorkspaceId)} onOpenChange={closeRenameDialog}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t('sidebar.renameProject')}</DialogTitle>
            <DialogDescription>{t('sidebar.renameProjectDescription')}</DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={(event) => void handleRename(event)}>
            <Input
              value={renameValue}
              onChange={(event) => {
                setRenameValue(event.target.value);
                if (renameError) {
                  setRenameError(null);
                }
              }}
              placeholder={t('sidebar.renameProjectPlaceholder')}
              disabled={isRenamingWorkspace}
              autoFocus
            />

            {renameError ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {renameError}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => closeRenameDialog(false)}
                disabled={isRenamingWorkspace}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={isRenamingWorkspace}>
                {isRenamingWorkspace
                  ? t('common.saving')
                  : t('sidebar.renameProjectSave')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(renameDeliverableId)} onOpenChange={closeRenameDeliverableDialog}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t('sidebar.renameDeliverable')}</DialogTitle>
            <DialogDescription>
              {t('sidebar.renameDeliverableDescription')}
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(event) => void handleRenameDeliverable(event)}
          >
            <Input
              value={renameDeliverableValue}
              onChange={(event) => {
                setRenameDeliverableValue(event.target.value);
                if (renameDeliverableError) {
                  setRenameDeliverableError(null);
                }
              }}
              placeholder={t('sidebar.renameDeliverablePlaceholder')}
              disabled={isRenamingDeliverable}
              autoFocus
            />

            {renameDeliverableError ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {renameDeliverableError}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => closeRenameDeliverableDialog(false)}
                disabled={isRenamingDeliverable}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={isRenamingDeliverable}>
                {isRenamingDeliverable
                  ? t('common.saving')
                  : t('sidebar.renameDeliverableSave')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(moveNode)} onOpenChange={closeMoveDialog}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {moveNode?.type === 'folder'
                ? t('sidebar.moveProjectFolder')
                : t('sidebar.moveDeliverable')}
            </DialogTitle>
            <DialogDescription>
              {moveNode?.type === 'folder'
                ? t('sidebar.moveProjectFolderDescription', { title: moveNode.title })
                : t('sidebar.moveDeliverableDescription', { title: moveNode?.title || '' })}
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={(event) => void handleMoveNode(event)}>
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">
                {t('sidebar.moveDestination')}
              </div>
              <Select
                value={moveTargetFolderId}
                onValueChange={(value) => {
                  setMoveTargetFolderId(value);
                  if (moveNodeError) {
                    setMoveNodeError(null);
                  }
                }}
                disabled={isMovingNode}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('sidebar.moveToRoot')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PROJECT_TREE_ROOT_VALUE}>
                    {t('sidebar.moveToRoot')}
                  </SelectItem>
                  {availableMoveTargets.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                      {`${'> '.repeat(option.depth)}${option.title}`}
                  </SelectItem>
                ))}
                </SelectContent>
              </Select>
            </div>

            {moveNodeError ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {moveNodeError}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => closeMoveDialog(false)}
                disabled={isMovingNode}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={isMovingNode}>
                {isMovingNode ? t('common.saving') : t('sidebar.moveConfirm')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(renameProjectFolderId)}
        onOpenChange={closeRenameProjectFolderDialog}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t('sidebar.renameProjectFolder')}</DialogTitle>
            <DialogDescription>
              {t('sidebar.renameProjectFolderDescription')}
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(event) => void handleRenameProjectFolder(event)}
          >
            <Input
              value={renameProjectFolderValue}
              onChange={(event) => {
                setRenameProjectFolderValue(event.target.value);
                if (renameProjectFolderError) {
                  setRenameProjectFolderError(null);
                }
              }}
              placeholder={t('sidebar.renameProjectFolderPlaceholder')}
              disabled={isRenamingProjectFolder}
              autoFocus
            />

            {renameProjectFolderError ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {renameProjectFolderError}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => closeRenameProjectFolderDialog(false)}
                disabled={isRenamingProjectFolder}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={isRenamingProjectFolder}>
                {isRenamingProjectFolder
                  ? t('common.saving')
                  : t('sidebar.renameProjectFolderSave')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(renameSupportFileId)} onOpenChange={closeRenameSupportDialog}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t('sidebar.renameSupportMaterial')}</DialogTitle>
            <DialogDescription>{t('sidebar.renameSupportMaterialDescription')}</DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={(event) => void handleRenameSupportFile(event)}>
            <Input
              value={renameSupportValue}
              onChange={(event) => {
                setRenameSupportValue(event.target.value);
                if (renameSupportError) {
                  setRenameSupportError(null);
                }
              }}
              placeholder={t('sidebar.renameSupportMaterialPlaceholder')}
              disabled={isRenamingSupportFile}
              autoFocus
            />

            {renameSupportError ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {renameSupportError}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => closeRenameSupportDialog(false)}
                disabled={isRenamingSupportFile}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={isRenamingSupportFile}>
                {isRenamingSupportFile
                  ? t('common.saving')
                  : t('sidebar.renameSupportMaterialSave')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(moveSupportNode)} onOpenChange={closeMoveSupportDialog}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t('sidebar.moveSupportMaterial')}</DialogTitle>
            <DialogDescription>
              {t('sidebar.moveSupportMaterialDescription', {
                title: moveSupportNode?.name || '',
              })}
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={(event) => void handleMoveSupportNode(event)}>
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">
                {t('sidebar.moveDestination')}
              </div>
              <Select
                value={moveSupportTargetId}
                onValueChange={(value) => {
                  setMoveSupportTargetId(value);
                  if (moveSupportError) {
                    setMoveSupportError(null);
                  }
                }}
                disabled={isMovingSupportNode}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('sidebar.moveSupportToRoot')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SUPPORT_TREE_ROOT_VALUE}>
                    {t('sidebar.moveSupportToRoot')}
                  </SelectItem>
                  {availableSupportMoveTargets.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {`${'> '.repeat(option.depth)}${option.name}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {moveSupportError ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {moveSupportError}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => closeMoveSupportDialog(false)}
                disabled={isMovingSupportNode}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={isMovingSupportNode}>
                {isMovingSupportNode ? t('common.saving') : t('sidebar.moveConfirm')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

type ProjectDeliverableTreeNode = ProjectDeliverableItem & {
  children: ProjectDeliverableTreeNode[];
  depth: number;
  nodeType: 'deliverable';
};

type ProjectFolderTreeNode = ProjectFolderItem & {
  children: ProjectTreeNode[];
  depth: number;
  nodeType: 'folder';
};

type ProjectTreeNode = ProjectFolderTreeNode | ProjectDeliverableTreeNode;

type WorkspaceFileTreeNode = SidebarSupportFile & {
  children: WorkspaceFileTreeNode[];
  depth: number;
};

function ProjectDeliverableTree({
  currentWorkspaceId,
  dragNode,
  folders,
  deliverables,
  dropTargetFolderId,
  onCreateDeliverable,
  onCreateProjectFolder,
  onCreateSiblingDeliverable,
  onDeleteDeliverable,
  onDeleteProjectFolder,
  onMoveDeliverable,
  onMoveProjectFolder,
  onOpenDeliverable,
  onReorderDeliverable,
  onReorderProjectFolder,
  onDragEndNode,
  onDragStartNode,
  onDropNodeOnFolder,
  onDropNodeOnRoot,
  onSetDropTargetFolderId,
  onRequestRenameDeliverable,
  onRequestRenameProjectFolder,
}: {
  currentWorkspaceId?: string | null;
  dragNode?: ProjectTreeMoveNode | null;
  folders: ProjectFolderItem[];
  deliverables: ProjectDeliverableItem[];
  dropTargetFolderId?: string | null;
  onCreateDeliverable?: (context?: {
    projectFolderId?: string | null;
  }) => Promise<void> | void;
  onCreateProjectFolder?: (parentFolderId: string | null) => Promise<void> | void;
  onCreateSiblingDeliverable?: (workspaceId: string) => Promise<void> | void;
  onDeleteDeliverable?: (workspaceId: string) => Promise<void> | void;
  onDeleteProjectFolder?: (folderId: string) => Promise<void> | void;
  onMoveDeliverable?: (deliverable: ProjectDeliverableItem) => void;
  onMoveProjectFolder?: (folder: ProjectFolderItem) => void;
  onOpenDeliverable?: (workspaceId: string) => void;
  onReorderDeliverable?: (
    deliverable: ProjectDeliverableTreeNode,
    direction: 'up' | 'down'
  ) => void;
  onReorderProjectFolder?: (
    folder: ProjectFolderTreeNode,
    direction: 'up' | 'down'
  ) => void;
  onDragEndNode?: () => void;
  onDragStartNode?: (node: ProjectTreeMoveNode) => void;
  onDropNodeOnFolder?: (folderId: string) => Promise<void> | void;
  onDropNodeOnRoot?: () => Promise<void> | void;
  onSetDropTargetFolderId?: (folderId: string | null) => void;
  onRequestRenameDeliverable?: (deliverable: ProjectDeliverableItem) => void;
  onRequestRenameProjectFolder?: (folder: ProjectFolderItem) => void;
}) {
  const tree = React.useMemo(
    () => buildProjectTree({ deliverables, folders }),
    [deliverables, folders]
  );
  const t = useT();

  return (
    <div className="min-w-0 space-y-1 overflow-hidden">
      {dragNode ? (
        <div
          className={cn(
            'rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground transition-colors',
            dropTargetFolderId === null && 'border-primary/60 bg-primary/5 text-foreground'
          )}
          onDragOver={(event) => {
            event.preventDefault();
            onSetDropTargetFolderId?.(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void onDropNodeOnRoot?.();
          }}
        >
          {t('sidebar.moveSupportToRoot')}
        </div>
      ) : null}
      {tree.map((node, index) => (
        <ProjectTreeNodeRow
          key={node.id}
          currentWorkspaceId={currentWorkspaceId}
          dragNode={dragNode}
          node={node}
          dropTargetFolderId={dropTargetFolderId}
          siblingCount={tree.length}
          siblingIndex={index}
          onCreateDeliverable={onCreateDeliverable}
          onCreateProjectFolder={onCreateProjectFolder}
          onCreateSiblingDeliverable={onCreateSiblingDeliverable}
          onDeleteDeliverable={onDeleteDeliverable}
          onDeleteProjectFolder={onDeleteProjectFolder}
          onMoveDeliverable={onMoveDeliverable}
          onMoveProjectFolder={onMoveProjectFolder}
          onOpenDeliverable={onOpenDeliverable}
          onReorderDeliverable={onReorderDeliverable}
          onReorderProjectFolder={onReorderProjectFolder}
          onDragEndNode={onDragEndNode}
          onDragStartNode={onDragStartNode}
          onDropNodeOnFolder={onDropNodeOnFolder}
          onSetDropTargetFolderId={onSetDropTargetFolderId}
          onRequestRenameDeliverable={onRequestRenameDeliverable}
          onRequestRenameProjectFolder={onRequestRenameProjectFolder}
        />
      ))}
    </div>
  );
}

function ProjectTreeNodeRow({
  currentWorkspaceId,
  dragNode,
  node,
  dropTargetFolderId,
  siblingCount,
  siblingIndex,
  onCreateDeliverable,
  onCreateProjectFolder,
  onCreateSiblingDeliverable,
  onDeleteDeliverable,
  onDeleteProjectFolder,
  onMoveDeliverable,
  onMoveProjectFolder,
  onOpenDeliverable,
  onReorderDeliverable,
  onReorderProjectFolder,
  onDragEndNode,
  onDragStartNode,
  onDropNodeOnFolder,
  onSetDropTargetFolderId,
  onRequestRenameDeliverable,
  onRequestRenameProjectFolder,
}: {
  currentWorkspaceId?: string | null;
  dragNode?: ProjectTreeMoveNode | null;
  node: ProjectTreeNode;
  dropTargetFolderId?: string | null;
  siblingCount: number;
  siblingIndex: number;
  onCreateDeliverable?: (context?: {
    projectFolderId?: string | null;
  }) => Promise<void> | void;
  onCreateProjectFolder?: (parentFolderId: string | null) => Promise<void> | void;
  onCreateSiblingDeliverable?: (workspaceId: string) => Promise<void> | void;
  onDeleteDeliverable?: (workspaceId: string) => Promise<void> | void;
  onDeleteProjectFolder?: (folderId: string) => Promise<void> | void;
  onMoveDeliverable?: (deliverable: ProjectDeliverableItem) => void;
  onMoveProjectFolder?: (folder: ProjectFolderItem) => void;
  onOpenDeliverable?: (workspaceId: string) => void;
  onReorderDeliverable?: (
    deliverable: ProjectDeliverableTreeNode,
    direction: 'up' | 'down'
  ) => void;
  onReorderProjectFolder?: (
    folder: ProjectFolderTreeNode,
    direction: 'up' | 'down'
  ) => void;
  onDragEndNode?: () => void;
  onDragStartNode?: (node: ProjectTreeMoveNode) => void;
  onDropNodeOnFolder?: (folderId: string) => Promise<void> | void;
  onSetDropTargetFolderId?: (folderId: string | null) => void;
  onRequestRenameDeliverable?: (deliverable: ProjectDeliverableItem) => void;
  onRequestRenameProjectFolder?: (folder: ProjectFolderItem) => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(true);
  const hasChildren = node.children.length > 0;
  const isFolder = node.nodeType === 'folder';
  const isActiveDeliverable = !isFolder && currentWorkspaceId === node.id;
  const isDropTarget = isFolder && dragNode && dropTargetFolderId === node.id;
  const canMoveUp = siblingIndex > 0;
  const canMoveDown = siblingIndex < siblingCount - 1;

  return (
    <div className="min-w-0 overflow-hidden">
      <div
        className={cn(
          'group flex min-w-0 items-center gap-2 overflow-hidden rounded-xl px-2 py-1.5 transition-colors hover:bg-accent',
          isActiveDeliverable && 'bg-background shadow-sm ring-1 ring-border',
          isDropTarget && 'bg-primary/5 ring-1 ring-primary/40'
        )}
        style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
        draggable={Boolean(onDragStartNode)}
        onDragEnd={() => onDragEndNode?.()}
        onDragStart={(event) => {
          if (!onDragStartNode) {
            return;
          }

          event.dataTransfer.effectAllowed = 'move';
          onDragStartNode(toProjectTreeMoveNode(node));
        }}
        onDragOver={(event) => {
          if (!isFolder || !dragNode) {
            return;
          }

          event.preventDefault();
          onSetDropTargetFolderId?.(node.id);
          setOpen(true);
        }}
        onDrop={(event) => {
          if (!isFolder) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          void onDropNodeOnFolder?.(node.id);
        }}
      >
        {isFolder ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <FolderClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="block truncate text-sm">{node.title}</span>
          </button>
        ) : (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left"
            onClick={() => {
              if (hasChildren && isActiveDeliverable) {
                setOpen((value) => !value);
                return;
              }

              onOpenDeliverable?.(node.id);
            }}
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{node.title}</span>
              <span className="block truncate text-[11px] text-muted-foreground/80">
                {formatDeliverableKindLabel(node.deliverableType, t)}
              </span>
            </span>
          </button>
        )}

        {isFolder ? (
          onCreateDeliverable ||
          onCreateProjectFolder ||
          onMoveProjectFolder ||
          onRequestRenameProjectFolder ||
          onDeleteProjectFolder ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onCreateDeliverable ? (
                  <DropdownMenuItem
                    onSelect={() =>
                      void onCreateDeliverable({
                        projectFolderId: node.id,
                      })
                    }
                  >
                    <FilePlus2 className="h-3.5 w-3.5" />
                    {t('sidebar.newDeliverable')}
                  </DropdownMenuItem>
                ) : null}
                {onCreateProjectFolder ? (
                  <DropdownMenuItem onSelect={() => void onCreateProjectFolder(node.id)}>
                    <FolderPlus className="h-3.5 w-3.5" />
                    {t('sidebar.newProjectFolder')}
                  </DropdownMenuItem>
                ) : null}
                {onReorderProjectFolder ? (
                  <DropdownMenuItem
                    disabled={!canMoveUp}
                    onSelect={() => onReorderProjectFolder(node, 'up')}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                    {t('sidebar.moveUp')}
                  </DropdownMenuItem>
                ) : null}
                {onReorderProjectFolder ? (
                  <DropdownMenuItem
                    disabled={!canMoveDown}
                    onSelect={() => onReorderProjectFolder(node, 'down')}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                    {t('sidebar.moveDown')}
                  </DropdownMenuItem>
                ) : null}
                {onMoveProjectFolder ? (
                  <DropdownMenuItem onSelect={() => onMoveProjectFolder(node)}>
                    <FolderOpen className="h-3.5 w-3.5" />
                    {t('sidebar.moveProjectFolder')}
                  </DropdownMenuItem>
                ) : null}
                {onRequestRenameProjectFolder ? (
                  <DropdownMenuItem onSelect={() => onRequestRenameProjectFolder(node)}>
                    <Pencil className="h-3.5 w-3.5" />
                    {t('sidebar.renameProjectFolder')}
                  </DropdownMenuItem>
                ) : null}
                {onDeleteProjectFolder ? (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => void onDeleteProjectFolder(node.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('sidebar.deleteProjectFolder')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        ) : onCreateSiblingDeliverable ||
            onMoveDeliverable ||
            onRequestRenameDeliverable ||
            onDeleteDeliverable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onCreateSiblingDeliverable ? (
                <DropdownMenuItem onSelect={() => void onCreateSiblingDeliverable(node.id)}>
                  <Plus className="h-3.5 w-3.5" />
                  {t('sidebar.newSiblingDeliverable')}
                </DropdownMenuItem>
              ) : null}
              {onRequestRenameDeliverable ? (
                <DropdownMenuItem onSelect={() => onRequestRenameDeliverable(node)}>
                  <Pencil className="h-3.5 w-3.5" />
                  {t('sidebar.renameDeliverable')}
                </DropdownMenuItem>
              ) : null}
              {onReorderDeliverable ? (
                <DropdownMenuItem
                  disabled={!canMoveUp}
                  onSelect={() => onReorderDeliverable(node, 'up')}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                  {t('sidebar.moveUp')}
                </DropdownMenuItem>
              ) : null}
              {onReorderDeliverable ? (
                <DropdownMenuItem
                  disabled={!canMoveDown}
                  onSelect={() => onReorderDeliverable(node, 'down')}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  {t('sidebar.moveDown')}
                </DropdownMenuItem>
              ) : null}
              {onMoveDeliverable ? (
                <DropdownMenuItem onSelect={() => onMoveDeliverable(node)}>
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t('sidebar.moveDeliverable')}
                </DropdownMenuItem>
              ) : null}
              {onDeleteDeliverable ? (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => void onDeleteDeliverable(node.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('sidebar.deleteDeliverable')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {hasChildren && open ? (
        <div className="mt-0.5 min-w-0 space-y-1 overflow-hidden">
          {node.children.map((child, index) => (
            <ProjectTreeNodeRow
              key={child.id}
              currentWorkspaceId={currentWorkspaceId}
              dragNode={dragNode}
              node={child}
              dropTargetFolderId={dropTargetFolderId}
              siblingCount={node.children.length}
              siblingIndex={index}
              onCreateDeliverable={onCreateDeliverable}
              onCreateProjectFolder={onCreateProjectFolder}
              onCreateSiblingDeliverable={onCreateSiblingDeliverable}
              onDeleteDeliverable={onDeleteDeliverable}
              onDeleteProjectFolder={onDeleteProjectFolder}
              onMoveDeliverable={onMoveDeliverable}
              onMoveProjectFolder={onMoveProjectFolder}
              onOpenDeliverable={onOpenDeliverable}
              onReorderDeliverable={onReorderDeliverable}
              onReorderProjectFolder={onReorderProjectFolder}
              onDragEndNode={onDragEndNode}
              onDragStartNode={onDragStartNode}
              onDropNodeOnFolder={onDropNodeOnFolder}
              onSetDropTargetFolderId={onSetDropTargetFolderId}
              onRequestRenameDeliverable={onRequestRenameDeliverable}
              onRequestRenameProjectFolder={onRequestRenameProjectFolder}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function buildProjectTree({
  deliverables,
  folders,
}: {
  deliverables: ProjectDeliverableItem[];
  folders: ProjectFolderItem[];
}) {
  const nodeMap = new Map<string, ProjectDeliverableTreeNode>();
  const folderMap = new Map<string, ProjectFolderTreeNode>();
  const roots: ProjectTreeNode[] = [];

  deliverables.forEach((deliverable) => {
    nodeMap.set(deliverable.id, {
      ...deliverable,
      children: [],
      depth: 0,
      nodeType: 'deliverable',
    });
  });

  folders.forEach((folder) => {
    folderMap.set(folder.id, {
      ...folder,
      children: [],
      depth: 0,
      nodeType: 'folder',
    });
  });

  folderMap.forEach((folder) => {
    if (folder.parentFolderId) {
      const parent = folderMap.get(folder.parentFolderId);
      if (parent) {
        parent.children.push(folder);
        return;
      }
    }

    roots.push(folder);
  });

  nodeMap.forEach((node) => {
    if (node.projectFolderId) {
      const folder = folderMap.get(node.projectFolderId);
      if (folder) {
        folder.children.push(node);
        return;
      }
    }

    roots.push(node);
  });

  const sortTree = (nodes: ProjectTreeNode[]) => {
    nodes.sort(compareProjectTreeItems);
    nodes.forEach((treeNode) => sortTree(treeNode.children));
  };

  const assignDepth = (nodes: ProjectTreeNode[], depth = 0) => {
    nodes.forEach((treeNode) => {
      treeNode.depth = depth;
      assignDepth(treeNode.children, depth + 1);
    });
  };

  sortTree(roots);
  assignDepth(roots);
  return roots;
}

function toProjectTreeMoveNode(node: ProjectTreeNode): ProjectTreeMoveNode {
  if (node.nodeType === 'folder') {
    return {
      currentParentFolderId: node.parentFolderId || null,
      id: node.id,
      title: node.title,
      type: 'folder',
    };
  }

  return {
    currentParentFolderId: node.projectFolderId || null,
    id: node.id,
    title: node.title,
    type: 'deliverable',
  };
}

function buildProjectFolderOptions(folders: ProjectFolderItem[]) {
  const folderMap = new Map<
    string,
    ProjectFolderItem & {
      children: Array<ProjectFolderItem & { children: unknown[]; depth: number }>;
      depth: number;
    }
  >();
  const roots: Array<ProjectFolderItem & { children: unknown[]; depth: number }> = [];

  folders.forEach((folder) => {
    folderMap.set(folder.id, {
      ...folder,
      children: [],
      depth: 0,
    });
  });

  folderMap.forEach((folder) => {
    if (folder.parentFolderId) {
      const parent = folderMap.get(folder.parentFolderId);
      if (parent) {
        parent.children.push(folder);
        return;
      }
    }

    roots.push(folder);
  });

  const sortTree = (nodes: Array<ProjectFolderItem & { children: unknown[]; depth: number }>) => {
    nodes.sort(compareProjectTreeItems);
    nodes.forEach((node) =>
      sortTree(node.children as Array<ProjectFolderItem & { children: unknown[]; depth: number }>)
    );
  };

  const flatten = (
    nodes: Array<ProjectFolderItem & { children: unknown[]; depth: number }>,
    depth = 0
  ): Array<ProjectFolderItem & { depth: number }> =>
    nodes.flatMap((node) => [
      {
        id: node.id,
        parentFolderId: node.parentFolderId,
        projectId: node.projectId,
        sortOrder: node.sortOrder,
        title: node.title,
        updatedAt: node.updatedAt,
        depth,
      },
      ...flatten(
        node.children as Array<ProjectFolderItem & { children: unknown[]; depth: number }>,
        depth + 1
      ),
    ]);

  sortTree(roots);
  return flatten(roots);
}

function compareProjectTreeItems(
  left: { id: string; sortOrder: number; updatedAt: Date | string },
  right: { id: string; sortOrder: number; updatedAt: Date | string }
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

function collectProjectFolderDescendantIds(
  folders: ProjectFolderItem[],
  folderId: string
) {
  const descendants = new Set<string>();
  const childrenByParent = new Map<string | null, string[]>();

  folders.forEach((folder) => {
    const siblings = childrenByParent.get(folder.parentFolderId || null) || [];
    siblings.push(folder.id);
    childrenByParent.set(folder.parentFolderId || null, siblings);
  });

  const visit = (parentId: string) => {
    const children = childrenByParent.get(parentId) || [];
    children.forEach((childId) => {
      if (descendants.has(childId)) {
        return;
      }

      descendants.add(childId);
      visit(childId);
    });
  };

  visit(folderId);
  return descendants;
}

function formatDeliverableKindLabel(
  deliverableType: ProjectDeliverableItem['deliverableType'],
  t: ReturnType<typeof useT>
) {
  return formatDeliverableTypeLabel(deliverableType, t);
}

function SupportMaterialTree({
  activeSupportFileId,
  dragNode,
  dropTargetParentId,
  files,
  onCreateSupportFile,
  onCreateSupportFolder,
  onDeleteSupportFile,
  onDragEndNode,
  onDragStartNode,
  onDropNodeOnFolder,
  onDropNodeOnRoot,
  onMoveSupportFile,
  onOpenSupportFile,
  onReorderSupportFile,
  onRenameSupportFile,
  onSetDropTargetParentId,
}: {
  activeSupportFileId?: string | null;
  dragNode?: SupportTreeMoveNode | null;
  dropTargetParentId?: string | null;
  files: WorkspaceFileTreeNode[];
  onCreateSupportFile?: (parentId?: string | null) => Promise<void> | void;
  onCreateSupportFolder?: (parentId?: string | null) => Promise<void> | void;
  onDeleteSupportFile?: (fileId: string) => Promise<void> | void;
  onDragEndNode?: () => void;
  onDragStartNode?: (node: SupportTreeMoveNode) => void;
  onDropNodeOnFolder?: (parentId: string, sortOrder?: number) => Promise<void> | void;
  onDropNodeOnRoot?: (sortOrder?: number) => Promise<void> | void;
  onMoveSupportFile?: (file: SidebarSupportFile) => void;
  onOpenSupportFile?: (fileId: string) => void;
  onReorderSupportFile?: (fileId: string, direction: 'up' | 'down') => void;
  onRenameSupportFile?: (file: SidebarSupportFile) => void;
  onSetDropTargetParentId?: (parentId: string | null) => void;
}) {
  const t = useT();
  return (
    <div className="min-w-0 space-y-1 overflow-hidden">
      {dragNode ? (
        <div
          className={cn(
            'rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground transition-colors',
            dropTargetParentId === null && 'border-primary/60 bg-primary/5 text-foreground'
          )}
          onDragOver={(event) => {
            event.preventDefault();
            onSetDropTargetParentId?.(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void onDropNodeOnRoot?.(files.length);
          }}
        >
          {t('sidebar.moveToRoot')}
        </div>
      ) : null}
      {files.map((file) => (
        <SupportMaterialTreeNode
          key={file.id}
          activeSupportFileId={activeSupportFileId}
          dragNode={dragNode}
          dropTargetParentId={dropTargetParentId}
          file={file}
          siblingCount={files.length}
          siblingIndex={files.findIndex((item) => item.id === file.id)}
          onCreateSupportFile={onCreateSupportFile}
          onCreateSupportFolder={onCreateSupportFolder}
          onDeleteSupportFile={onDeleteSupportFile}
          onDragEndNode={onDragEndNode}
          onDragStartNode={onDragStartNode}
          onDropNodeOnFolder={onDropNodeOnFolder}
          onMoveSupportFile={onMoveSupportFile}
          onOpenSupportFile={onOpenSupportFile}
          onReorderSupportFile={onReorderSupportFile}
          onRenameSupportFile={onRenameSupportFile}
          onSetDropTargetParentId={onSetDropTargetParentId}
        />
      ))}
    </div>
  );
}

function SupportMaterialTreeNode({
  activeSupportFileId,
  dragNode,
  dropTargetParentId,
  file,
  siblingCount,
  siblingIndex,
  onCreateSupportFile,
  onCreateSupportFolder,
  onDeleteSupportFile,
  onDragEndNode,
  onDragStartNode,
  onDropNodeOnFolder,
  onMoveSupportFile,
  onOpenSupportFile,
  onReorderSupportFile,
  onRenameSupportFile,
  onSetDropTargetParentId,
}: {
  activeSupportFileId?: string | null;
  dragNode?: SupportTreeMoveNode | null;
  dropTargetParentId?: string | null;
  file: WorkspaceFileTreeNode;
  siblingCount: number;
  siblingIndex: number;
  onCreateSupportFile?: (parentId?: string | null) => Promise<void> | void;
  onCreateSupportFolder?: (parentId?: string | null) => Promise<void> | void;
  onDeleteSupportFile?: (fileId: string) => Promise<void> | void;
  onDragEndNode?: () => void;
  onDragStartNode?: (node: SupportTreeMoveNode) => void;
  onDropNodeOnFolder?: (parentId: string, sortOrder?: number) => Promise<void> | void;
  onMoveSupportFile?: (file: SidebarSupportFile) => void;
  onOpenSupportFile?: (fileId: string) => void;
  onReorderSupportFile?: (fileId: string, direction: 'up' | 'down') => void;
  onRenameSupportFile?: (file: SidebarSupportFile) => void;
  onSetDropTargetParentId?: (parentId: string | null) => void;
}) {
  const t = useT();
  const isFolder = file.nodeType === 'folder';
  const hasActiveDescendant = containsWorkspaceFileId(file, activeSupportFileId);
  const [open, setOpen] = React.useState(true);
  const isDropTarget = Boolean(isFolder && dragNode && dropTargetParentId === file.id);
  const canMoveUp = siblingIndex > 0;
  const canMoveDown = siblingIndex < siblingCount - 1;

  return (
    <div className="min-w-0 overflow-hidden">
      <div
        className={cn(
          'group flex min-w-0 items-center gap-2 overflow-hidden rounded-xl px-2 py-1.5 transition-colors hover:bg-accent',
          !isFolder && activeSupportFileId === file.id
            ? 'bg-background shadow-sm ring-1 ring-border'
            : isFolder && hasActiveDescendant
              ? 'bg-background/70 ring-1 ring-border/60'
              : '',
          isDropTarget && 'bg-primary/5 ring-1 ring-primary/40'
        )}
        style={{ paddingLeft: `${file.depth * 16 + 8}px` }}
        draggable={Boolean(onDragStartNode)}
        onDragEnd={() => onDragEndNode?.()}
        onDragStart={(event) => {
          if (!onDragStartNode) {
            return;
          }

          event.dataTransfer.effectAllowed = 'move';
          onDragStartNode({
            currentParentId: file.parentId || null,
            id: file.id,
            name: getWorkspaceFileDisplayName(file),
            nodeType: file.nodeType,
            path: file.path,
          });
        }}
        onDragOver={(event) => {
          if (!isFolder || !dragNode) {
            return;
          }

          event.preventDefault();
          onSetDropTargetParentId?.(file.id);
          setOpen(true);
        }}
        onDrop={(event) => {
          if (!isFolder) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          void onDropNodeOnFolder?.(file.id, file.children.length);
        }}
      >
        <button
          type="button"
          data-testid={`support-tree-node-${file.id}`}
          className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left text-sm"
          onClick={() => {
            if (isFolder) {
              setOpen((value) => !value);
              return;
            }

            onOpenSupportFile?.(file.id);
          }}
        >
          {isFolder ? (
            open ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <FolderClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )
          ) : (
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{getWorkspaceFileDisplayName(file)}</span>
        </button>

        {onCreateSupportFile ||
        onCreateSupportFolder ||
        onMoveSupportFile ||
        onReorderSupportFile ||
        onRenameSupportFile ||
        onDeleteSupportFile ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                data-testid={`support-tree-actions-${file.id}`}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isFolder && onCreateSupportFile ? (
                <DropdownMenuItem onSelect={() => void onCreateSupportFile(file.id)}>
                  <FilePlus2 className="h-3.5 w-3.5" />
                  {t('sidebar.newSupportNote')}
                </DropdownMenuItem>
              ) : null}
              {isFolder && onCreateSupportFolder ? (
                <DropdownMenuItem onSelect={() => void onCreateSupportFolder(file.id)}>
                  <FolderPlus className="h-3.5 w-3.5" />
                  {t('sidebar.newSupportFolder')}
                </DropdownMenuItem>
              ) : null}
              {onReorderSupportFile ? (
                <DropdownMenuItem
                  disabled={!canMoveUp}
                  onSelect={() => onReorderSupportFile(file.id, 'up')}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                  {t('sidebar.moveUp')}
                </DropdownMenuItem>
              ) : null}
              {onReorderSupportFile ? (
                <DropdownMenuItem
                  disabled={!canMoveDown}
                  onSelect={() => onReorderSupportFile(file.id, 'down')}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  {t('sidebar.moveDown')}
                </DropdownMenuItem>
              ) : null}
              {onMoveSupportFile ? (
                <DropdownMenuItem onSelect={() => onMoveSupportFile(file)}>
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t('sidebar.moveSupportMaterial')}
                </DropdownMenuItem>
              ) : null}
              {onRenameSupportFile ? (
                <DropdownMenuItem onSelect={() => onRenameSupportFile(file)}>
                  <Pencil className="h-3.5 w-3.5" />
                  {t('sidebar.renameSupportMaterial')}
                </DropdownMenuItem>
              ) : null}
              {onDeleteSupportFile ? (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => void onDeleteSupportFile(file.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('sidebar.deleteSupportMaterial')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {isFolder && open && file.children.length > 0 ? (
        <div className="mt-0.5 min-w-0 space-y-1 overflow-hidden">
          {file.children.map((child) => (
            <SupportMaterialTreeNode
              key={child.id}
              activeSupportFileId={activeSupportFileId}
              dragNode={dragNode}
              dropTargetParentId={dropTargetParentId}
              file={child}
              siblingCount={file.children.length}
              siblingIndex={file.children.findIndex((item) => item.id === child.id)}
              onCreateSupportFile={onCreateSupportFile}
              onCreateSupportFolder={onCreateSupportFolder}
              onDeleteSupportFile={onDeleteSupportFile}
              onDragEndNode={onDragEndNode}
              onDragStartNode={onDragStartNode}
              onDropNodeOnFolder={onDropNodeOnFolder}
              onMoveSupportFile={onMoveSupportFile}
              onOpenSupportFile={onOpenSupportFile}
              onReorderSupportFile={onReorderSupportFile}
              onRenameSupportFile={onRenameSupportFile}
              onSetDropTargetParentId={onSetDropTargetParentId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function buildWorkspaceFolderOptions(files: SidebarSupportFile[]) {
  return files
    .filter((file) => file.nodeType === 'folder')
    .slice()
    .sort((left, right) => {
      if (left.path === right.path) {
        return left.sortOrder - right.sortOrder;
      }
      return left.path.localeCompare(right.path);
    })
    .map((file) => ({
      id: file.id,
      depth: file.path.split('/').length - 1,
      name: getWorkspaceFileDisplayName(file),
      path: file.path,
    }));
}

function containsWorkspaceFileId(
  file: WorkspaceFileTreeNode,
  activeSupportFileId?: string | null
): boolean {
  if (!activeSupportFileId) {
    return false;
  }

  if (file.id === activeSupportFileId) {
    return true;
  }

  return file.children.some((child) => containsWorkspaceFileId(child, activeSupportFileId));
}

function buildWorkspaceFileTree(files: SidebarSupportFile[]) {
  const nodeMap = new Map<string, WorkspaceFileTreeNode>();
  const roots: WorkspaceFileTreeNode[] = [];

  files
    .slice()
    .sort((left, right) => {
      if (left.path === right.path) {
        return left.sortOrder - right.sortOrder;
      }
      return left.path.localeCompare(right.path);
    })
    .forEach((file) => {
      nodeMap.set(file.id, {
        ...file,
        children: [],
        depth: 0,
      });
    });

  nodeMap.forEach((node) => {
    if (node.parentId) {
      const parent = nodeMap.get(node.parentId);
      if (parent) {
        node.depth = parent.depth + 1;
        parent.children.push(node);
        return;
      }
    }

    roots.push(node);
  });

  const sortTree = (nodes: WorkspaceFileTreeNode[]) => {
    nodes.sort((left, right) => {
      if (left.sortOrder === right.sortOrder) {
        return left.path.localeCompare(right.path);
      }
      return left.sortOrder - right.sortOrder;
    });
    nodes.forEach((node) => sortTree(node.children));
  };

  sortTree(roots);
  return roots;
}
