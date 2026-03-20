'use client';

async function readSupportFileActionError(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => null);
  return payload?.error || fallbackMessage;
}

export async function createWorkspaceSupportNode(params: {
  errorMessage: string;
  kind?: 'markdown';
  name: string;
  nodeType?: 'file' | 'folder';
  parentId?: string | null;
  workspaceId: string;
}) {
  const response = await fetch(`/api/workspaces/${params.workspaceId}/files`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      kind: params.kind,
      name: params.name,
      nodeType: params.nodeType,
      parentId: params.parentId,
      role: 'support',
    }),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.id) {
    throw new Error(payload?.error || params.errorMessage);
  }

  return payload as { id: string };
}

export async function deleteWorkspaceSupportFile(params: {
  errorMessage: string;
  fileId: string;
  workspaceId: string;
}) {
  const response = await fetch(`/api/workspaces/${params.workspaceId}/files/${params.fileId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(await readSupportFileActionError(response, params.errorMessage));
  }
}

export async function renameWorkspaceSupportFile(params: {
  errorMessage: string;
  fileId: string;
  name: string;
  workspaceId: string;
}) {
  const response = await fetch(`/api/workspaces/${params.workspaceId}/files/${params.fileId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: params.name }),
  });

  if (!response.ok) {
    throw new Error(await readSupportFileActionError(response, params.errorMessage));
  }
}

export async function moveWorkspaceSupportFile(params: {
  errorMessage: string;
  fileId: string;
  parentId: string | null;
  sortOrder?: number;
  workspaceId: string;
}) {
  const response = await fetch(`/api/workspaces/${params.workspaceId}/files/${params.fileId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parentId: params.parentId,
      sortOrder: params.sortOrder,
    }),
  });

  if (!response.ok) {
    throw new Error(await readSupportFileActionError(response, params.errorMessage));
  }
}
