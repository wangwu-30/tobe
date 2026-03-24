'use client';

import { DeliverableSidebar, type DeliverableOutlineItem } from '@/components/workspace/deliverable-sidebar';
import type {
  ProjectDeliverableItem,
  ProjectFolderItem,
  WorkspaceFileData,
  WorkspaceVersionFileData,
} from '@/types';

type SidebarSupportFile = WorkspaceFileData | WorkspaceVersionFileData;

export function WorkspaceSidebar({
  activeSupportFileId,
  canOpenOutline,
  collapsed,
  currentProjectId,
  currentProjectTitle,
  currentWorkspaceId,
  currentWorkspaceStatusLabel,
  isVersionView,
  onCreateDeliverable,
  onCreateProjectFolder,
  onCreateSiblingDeliverable,
  onCreateSupportFile,
  onCreateSupportFolder,
  onCreateWorkspace,
  onDeleteDeliverable,
  onDeleteProjectFolder,
  onDeleteSupportFile,
  onDeleteWorkspace,
  onMoveDeliverable,
  onMoveProjectFolder,
  onMoveSupportFile,
  onNavigate,
  onOpenDeliverable,
  onOpenOutline,
  onOpenSupportFile,
  onOpenWorkspace,
  onRenameDeliverable,
  onRenameProjectFolder,
  onRenameSupportFile,
  onRenameWorkspace,
  onReorderDeliverable,
  onReorderProjectFolder,
  onReorderSupportFile,
  outlineItems,
  projectDeliverables,
  projectFolders,
  supportFiles,
}: {
  activeSupportFileId?: string | null;
  canOpenOutline: boolean;
  collapsed: boolean;
  currentProjectId?: string | null;
  currentProjectTitle?: string | null;
  currentWorkspaceId: string;
  currentWorkspaceStatusLabel?: string | null;
  isVersionView: boolean;
  onCreateDeliverable: (context?: {
    projectFolderId?: string | null;
  }) => Promise<void> | void;
  onCreateProjectFolder: (parentFolderId: string | null) => Promise<void> | void;
  onCreateSiblingDeliverable?: (workspaceId: string) => Promise<void> | void;
  onCreateSupportFile: (parentId: string | null) => Promise<void> | void;
  onCreateSupportFolder: (parentId: string | null) => Promise<void> | void;
  onCreateWorkspace: () => void;
  onDeleteDeliverable: (workspaceId: string) => Promise<void> | void;
  onDeleteProjectFolder: (folderId: string) => Promise<void> | void;
  onDeleteSupportFile: (fileId: string) => Promise<void> | void;
  onDeleteWorkspace: (workspaceId: string) => Promise<void> | void;
  onMoveDeliverable: (
    workspaceId: string,
    projectFolderId: string | null
  ) => Promise<void> | void;
  onMoveProjectFolder: (
    folderId: string,
    parentFolderId: string | null
  ) => Promise<void> | void;
  onMoveSupportFile: (
    fileId: string,
    parentId: string | null,
    sortOrder?: number
  ) => Promise<void> | void;
  onNavigate?: () => void;
  onOpenDeliverable: (workspaceId: string) => void;
  onOpenOutline: (outlineId: string) => void;
  onOpenSupportFile: (fileId: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onRenameDeliverable: (workspaceId: string, title: string) => Promise<void> | void;
  onRenameProjectFolder: (folderId: string, title: string) => Promise<void> | void;
  onRenameSupportFile: (fileId: string, name: string) => Promise<void> | void;
  onRenameWorkspace: (workspaceId: string, title: string) => Promise<void> | void;
  onReorderDeliverable: (
    workspaceId: string,
    direction: 'up' | 'down'
  ) => Promise<void> | void;
  onReorderProjectFolder: (
    folderId: string,
    direction: 'up' | 'down'
  ) => Promise<void> | void;
  onReorderSupportFile: (
    fileId: string,
    direction: 'up' | 'down'
  ) => Promise<void> | void;
  outlineItems: DeliverableOutlineItem[];
  projectDeliverables: ProjectDeliverableItem[];
  projectFolders: ProjectFolderItem[];
  supportFiles: SidebarSupportFile[];
}) {
  return (
    <DeliverableSidebar
      activeSupportFileId={activeSupportFileId}
      collapsed={collapsed}
      currentProjectId={currentProjectId}
      currentProjectTitle={currentProjectTitle}
      currentWorkspaceId={currentWorkspaceId}
      currentWorkspaceStatusLabel={currentWorkspaceStatusLabel}
      onCreateWorkspace={onCreateWorkspace}
      onCreateDeliverable={(context) =>
        void onCreateDeliverable({ projectFolderId: context?.projectFolderId || null })
      }
      onCreateProjectFolder={
        isVersionView ? undefined : (parentFolderId) => void onCreateProjectFolder(parentFolderId || null)
      }
      onCreateSiblingDeliverable={
        onCreateSiblingDeliverable
          ? (targetWorkspaceId) => void onCreateSiblingDeliverable(targetWorkspaceId)
          : undefined
      }
      onDeleteWorkspace={(projectId) => void onDeleteWorkspace(projectId)}
      onCreateSupportFile={
        isVersionView ? undefined : (parentId) => void onCreateSupportFile(parentId || null)
      }
      onCreateSupportFolder={
        isVersionView ? undefined : (parentId) => void onCreateSupportFolder(parentId || null)
      }
      onDeleteSupportFile={
        isVersionView ? undefined : (fileId) => void onDeleteSupportFile(fileId)
      }
      onMoveSupportFile={
        isVersionView
          ? undefined
          : (fileId, parentId, sortOrder) =>
              void onMoveSupportFile(fileId, parentId, sortOrder)
      }
      onReorderSupportFile={
        isVersionView
          ? undefined
          : (fileId, direction) => void onReorderSupportFile(fileId, direction)
      }
      onRenameSupportFile={
        isVersionView ? undefined : (fileId, name) => void onRenameSupportFile(fileId, name)
      }
      onOpenDeliverable={onOpenDeliverable}
      onRenameWorkspace={onRenameWorkspace}
      onNavigate={onNavigate}
      onOpenOutline={canOpenOutline ? onOpenOutline : undefined}
      onOpenSupportFile={onOpenSupportFile}
      onOpenWorkspace={onOpenWorkspace}
      onRenameDeliverable={
        isVersionView ? undefined : (targetWorkspaceId, title) => void onRenameDeliverable(targetWorkspaceId, title)
      }
      onDeleteDeliverable={
        isVersionView ? undefined : (targetWorkspaceId) => void onDeleteDeliverable(targetWorkspaceId)
      }
      onMoveDeliverable={
        isVersionView
          ? undefined
          : (targetWorkspaceId, projectFolderId) =>
              void onMoveDeliverable(targetWorkspaceId, projectFolderId)
      }
      onMoveProjectFolder={
        isVersionView
          ? undefined
          : (folderId, parentFolderId) => void onMoveProjectFolder(folderId, parentFolderId)
      }
      onReorderDeliverable={
        isVersionView
          ? undefined
          : (targetWorkspaceId, direction) => void onReorderDeliverable(targetWorkspaceId, direction)
      }
      onReorderProjectFolder={
        isVersionView
          ? undefined
          : (folderId, direction) => void onReorderProjectFolder(folderId, direction)
      }
      onRenameProjectFolder={
        isVersionView ? undefined : (folderId, title) => void onRenameProjectFolder(folderId, title)
      }
      onDeleteProjectFolder={
        isVersionView ? undefined : (folderId) => void onDeleteProjectFolder(folderId)
      }
      projectFolders={projectFolders}
      projectDeliverables={projectDeliverables}
      supportFiles={supportFiles}
      outlineItems={outlineItems}
    />
  );
}
