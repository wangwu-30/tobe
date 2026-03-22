'use client';

import type { ProjectDeliverableItem, ProjectFolderItem } from '@/types';
import { apiCallOrThrow } from '@/framework/resilience';

async function patchProjectTreeFolder(params: {
  errorMessage: string;
  folderId: string;
  projectId: string;
  parentId?: string | null;
  title?: string;
  treeSortOrder?: number;
}) {
  return apiCallOrThrow<ProjectFolderItem>(
    `/api/projects/${params.projectId}/folders/${params.folderId}`,
    {
      body: JSON.stringify({
        parentId: params.parentId,
        title: params.title,
        treeSortOrder: params.treeSortOrder,
      }),
      fallbackMessage: params.errorMessage,
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    }
  );
}

async function patchProjectTreeDeliverable(params: {
  errorMessage: string;
  projectFolderId?: string | null;
  title?: string;
  treeSortOrder?: number;
  workspaceId: string;
}) {
  return apiCallOrThrow<ProjectDeliverableItem>(`/api/workspaces/${params.workspaceId}`, {
    body: JSON.stringify({
      projectFolderId: params.projectFolderId,
      title: params.title,
      treeSortOrder: params.treeSortOrder,
    }),
    fallbackMessage: params.errorMessage,
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'PATCH',
  });
}

export async function createProjectTreeFolder(params: {
  errorMessage: string;
  parentId: string | null;
  projectId: string;
  title: string;
}) {
  return apiCallOrThrow<ProjectFolderItem>(`/api/projects/${params.projectId}/folders`, {
    body: JSON.stringify({
      parentId: params.parentId,
      title: params.title,
    }),
    fallbackMessage: params.errorMessage,
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export async function renameProjectTreeFolder(params: {
  errorMessage: string;
  folderId: string;
  projectId: string;
  title: string;
}) {
  return patchProjectTreeFolder(params);
}

export async function deleteProjectTreeFolder(params: {
  errorMessage: string;
  folderId: string;
  projectId: string;
}) {
  await apiCallOrThrow<null>(
    `/api/projects/${params.projectId}/folders/${params.folderId}`,
    {
      fallbackMessage: params.errorMessage,
      method: 'DELETE',
      parseAs: 'void',
    }
  );
}

export async function moveProjectTreeFolder(params: {
  errorMessage: string;
  folderId: string;
  parentId: string | null;
  projectId: string;
}) {
  return patchProjectTreeFolder(params);
}

export async function reorderProjectTreeFolder(params: {
  errorMessage: string;
  folderId: string;
  projectId: string;
  treeSortOrder: number;
}) {
  return patchProjectTreeFolder(params);
}

export async function renameProjectTreeDeliverable(params: {
  errorMessage: string;
  title: string;
  workspaceId: string;
}) {
  return patchProjectTreeDeliverable(params);
}

export async function deleteProjectTreeDeliverable(params: {
  errorMessage: string;
  workspaceId: string;
}) {
  await apiCallOrThrow<null>(`/api/workspaces/${params.workspaceId}`, {
    fallbackMessage: params.errorMessage,
    method: 'DELETE',
    parseAs: 'void',
  });
}

export async function moveProjectTreeDeliverable(params: {
  errorMessage: string;
  projectFolderId: string | null;
  workspaceId: string;
}) {
  return patchProjectTreeDeliverable(params);
}

export async function reorderProjectTreeDeliverable(params: {
  errorMessage: string;
  treeSortOrder: number;
  workspaceId: string;
}) {
  return patchProjectTreeDeliverable(params);
}
