'use client';

import { apiCallOrThrow } from '@/framework/resilience';

export async function createWorkspaceSupportNode(params: {
  errorMessage: string;
  kind?: 'markdown';
  name: string;
  nodeType?: 'file' | 'folder';
  parentId?: string | null;
  workspaceId: string;
}) {
  return apiCallOrThrow<{ id: string }>(`/api/workspaces/${params.workspaceId}/files`, {
    body: JSON.stringify({
      kind: params.kind,
      name: params.name,
      nodeType: params.nodeType,
      parentId: params.parentId,
      role: 'support',
    }),
    fallbackMessage: params.errorMessage,
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export async function deleteWorkspaceSupportFile(params: {
  errorMessage: string;
  fileId: string;
  workspaceId: string;
}) {
  await apiCallOrThrow<null>(`/api/workspaces/${params.workspaceId}/files/${params.fileId}`, {
    fallbackMessage: params.errorMessage,
    method: 'DELETE',
    parseAs: 'void',
  });
}

export async function renameWorkspaceSupportFile(params: {
  errorMessage: string;
  fileId: string;
  name: string;
  workspaceId: string;
}) {
  await apiCallOrThrow<null>(`/api/workspaces/${params.workspaceId}/files/${params.fileId}`, {
    body: JSON.stringify({ name: params.name }),
    fallbackMessage: params.errorMessage,
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'PATCH',
    parseAs: 'void',
  });
}

export async function moveWorkspaceSupportFile(params: {
  errorMessage: string;
  fileId: string;
  parentId: string | null;
  sortOrder?: number;
  workspaceId: string;
}) {
  await apiCallOrThrow<null>(`/api/workspaces/${params.workspaceId}/files/${params.fileId}`, {
    body: JSON.stringify({
      parentId: params.parentId,
      sortOrder: params.sortOrder,
    }),
    fallbackMessage: params.errorMessage,
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'PATCH',
    parseAs: 'void',
  });
}
