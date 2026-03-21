'use client';

import * as React from 'react';

import type { WorkspaceCreateContext } from '@/lib/workspace/create-request';
import { WorkspaceSidebar } from '@/surfaces/sidebar/workspace-sidebar';

type WorkspaceSidebarProps = React.ComponentProps<typeof WorkspaceSidebar>;

export function WorkspaceRouteSidebar({
  createProjectDeliverable,
  currentVersionId,
  onOpenWorkspaceRoute,
  onSyncSupportFileLocation,
  openWorkspaceCreateEntry,
  ...props
}: Omit<
  WorkspaceSidebarProps,
  | 'onCreateWorkspace'
  | 'onCreateDeliverable'
  | 'onOpenDeliverable'
  | 'onOpenSupportFile'
  | 'onOpenWorkspace'
> & {
  createProjectDeliverable: (projectFolderId: string | null) => Promise<void> | void;
  currentVersionId?: string | null;
  onOpenWorkspaceRoute: (workspaceId: string) => void;
  onSyncSupportFileLocation: (location: {
    fileId: string | null;
    versionId: string | null;
  }) => void;
  openWorkspaceCreateEntry: (context: WorkspaceCreateContext | null) => void;
}) {
  return (
    <WorkspaceSidebar
      {...props}
      onCreateWorkspace={() => openWorkspaceCreateEntry(null)}
      onCreateDeliverable={(context) =>
        void createProjectDeliverable(context?.projectFolderId || null)
      }
      onOpenDeliverable={onOpenWorkspaceRoute}
      onOpenSupportFile={(fileId) =>
        onSyncSupportFileLocation({
          fileId,
          versionId: currentVersionId || null,
        })
      }
      onOpenWorkspace={onOpenWorkspaceRoute}
    />
  );
}
