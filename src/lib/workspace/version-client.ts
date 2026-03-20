'use client';

import type { WorkspaceVersionData } from '@/types';

async function readVersionActionError(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => null);
  return payload?.error || fallbackMessage;
}

export async function createWorkspaceVersion(params: {
  errorMessage: string;
  title: string;
  workspaceId: string;
}) {
  const response = await fetch(`/api/workspaces/${params.workspaceId}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: params.title,
    }),
  });

  if (!response.ok) {
    throw new Error(await readVersionActionError(response, params.errorMessage));
  }

  return (await response.json()) as WorkspaceVersionData;
}

export async function toggleWorkspaceRecoveryPointPin(params: {
  errorMessage: string;
  pinned: boolean;
  versionId: string;
  workspaceId: string;
}) {
  const response = await fetch(
    `/api/workspaces/${params.workspaceId}/versions/${params.versionId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: params.pinned }),
    }
  );

  if (!response.ok) {
    throw new Error(await readVersionActionError(response, params.errorMessage));
  }

  return (await response.json()) as WorkspaceVersionData;
}

export async function restoreWorkspaceVersion(params: {
  errorMessage: string;
  versionId: string;
  workspaceId: string;
}) {
  const response = await fetch(
    `/api/workspaces/${params.workspaceId}/versions/${params.versionId}/restore`,
    {
      method: 'POST',
    }
  );

  if (!response.ok) {
    throw new Error(await readVersionActionError(response, params.errorMessage));
  }

  return (await response.json()) as {
    restoredVersion: WorkspaceVersionData;
  };
}

export async function branchConversationFromMessage(params: {
  conversationId: string;
  messageId: string;
}) {
  const response = await fetch(`/api/conversations/${params.conversationId}/branch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId: params.messageId }),
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as {
    conversation: {
      id: string;
    };
  };
}

type WorkspaceVersionConversationActionParams = {
  activeFileId: string | null;
  errorMessage: string;
  parentConversationId: string | null;
  safetyCheckpointTitle: string;
  title: string;
  versionId: string;
  workspaceId: string;
};

export async function continueWorkspaceConversationFromVersion(
  params: WorkspaceVersionConversationActionParams
) {
  const response = await fetch(
    `/api/workspaces/${params.workspaceId}/versions/${params.versionId}/continue`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activeFileId: params.activeFileId,
        parentConversationId: params.parentConversationId,
        safetyCheckpointTitle: params.safetyCheckpointTitle,
        title: params.title,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(await readVersionActionError(response, params.errorMessage));
  }

  return (await response.json()) as {
    baseVersion: WorkspaceVersionData;
    conversation: { id: string };
  };
}

export async function switchWorkspaceConversationToVersionBranch(
  params: WorkspaceVersionConversationActionParams
) {
  const response = await fetch(
    `/api/workspaces/${params.workspaceId}/versions/${params.versionId}/switch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activeFileId: params.activeFileId,
        parentConversationId: params.parentConversationId,
        safetyCheckpointTitle: params.safetyCheckpointTitle,
        title: params.title,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(await readVersionActionError(response, params.errorMessage));
  }

  return (await response.json()) as {
    baseVersion: WorkspaceVersionData;
    conversation: { id: string };
  };
}
