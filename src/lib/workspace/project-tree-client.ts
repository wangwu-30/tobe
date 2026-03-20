'use client';

import type { ProjectDeliverableItem, ProjectFolderItem } from '@/types';

async function readProjectTreeActionError(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => null);
  return payload?.error || fallbackMessage;
}

async function patchProjectTreeFolder(params: {
  errorMessage: string;
  folderId: string;
  projectId: string;
  parentId?: string | null;
  title?: string;
  treeSortOrder?: number;
}) {
  const response = await fetch(`/api/projects/${params.projectId}/folders/${params.folderId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parentId: params.parentId,
      title: params.title,
      treeSortOrder: params.treeSortOrder,
    }),
  });

  if (!response.ok) {
    throw new Error(await readProjectTreeActionError(response, params.errorMessage));
  }

  return (await response.json()) as ProjectFolderItem;
}

async function patchProjectTreeDeliverable(params: {
  errorMessage: string;
  projectFolderId?: string | null;
  title?: string;
  treeSortOrder?: number;
  workspaceId: string;
}) {
  const response = await fetch(`/api/workspaces/${params.workspaceId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      projectFolderId: params.projectFolderId,
      title: params.title,
      treeSortOrder: params.treeSortOrder,
    }),
  });

  if (!response.ok) {
    throw new Error(await readProjectTreeActionError(response, params.errorMessage));
  }

  return (await response.json()) as ProjectDeliverableItem;
}

export async function createProjectTreeFolder(params: {
  errorMessage: string;
  parentId: string | null;
  projectId: string;
  title: string;
}) {
  const response = await fetch(`/api/projects/${params.projectId}/folders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parentId: params.parentId,
      title: params.title,
    }),
  });

  if (!response.ok) {
    throw new Error(await readProjectTreeActionError(response, params.errorMessage));
  }

  return (await response.json()) as ProjectFolderItem;
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
  const response = await fetch(`/api/projects/${params.projectId}/folders/${params.folderId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(await readProjectTreeActionError(response, params.errorMessage));
  }
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
  const response = await fetch(`/api/workspaces/${params.workspaceId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(await readProjectTreeActionError(response, params.errorMessage));
  }
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
