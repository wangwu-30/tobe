'use client';

import type { WorkspaceVersionData } from '@/types';
import { apiCall, apiCallOrThrow } from '@/framework/resilience';

export async function createWorkspaceVersion(params: {
  errorMessage: string;
  title: string;
  workspaceId: string;
}) {
  return apiCallOrThrow<WorkspaceVersionData>(`/api/workspaces/${params.workspaceId}/versions`, {
    body: JSON.stringify({
      title: params.title,
    }),
    fallbackMessage: params.errorMessage,
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

export async function alignWorkspaceVersion(params: {
  errorMessage: string;
  versionId: string;
  workspaceId: string;
}) {
  return apiCallOrThrow<{ schemaVersion: 1; version: WorkspaceVersionData }>(
    `/api/workspaces/${params.workspaceId}/alignment`,
    {
      body: JSON.stringify({ versionId: params.versionId }),
      fallbackMessage: params.errorMessage,
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }
  );
}

export async function toggleWorkspaceRecoveryPointPin(params: {
  errorMessage: string;
  pinned: boolean;
  versionId: string;
  workspaceId: string;
}) {
  return apiCallOrThrow<WorkspaceVersionData>(
    `/api/workspaces/${params.workspaceId}/versions/${params.versionId}`,
    {
      body: JSON.stringify({ pinned: params.pinned }),
      fallbackMessage: params.errorMessage,
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    }
  );
}

export async function restoreWorkspaceVersion(params: {
  errorMessage: string;
  versionId: string;
  workspaceId: string;
}) {
  return apiCallOrThrow<{
    restoredVersion: WorkspaceVersionData;
  }>(`/api/workspaces/${params.workspaceId}/versions/${params.versionId}/restore`, {
    fallbackMessage: params.errorMessage,
    method: 'POST',
  });
}

export async function branchConversationFromMessage(params: {
  conversationId: string;
  messageId: string;
}) {
  const result = await apiCall<{
    conversation: {
      id: string;
    };
  }>(`/api/conversations/${params.conversationId}/branch`, {
    body: JSON.stringify({ messageId: params.messageId }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

  if (!result.ok) {
    return null;
  }

  return result.data;
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
  return apiCallOrThrow<{
    baseVersion: WorkspaceVersionData;
    conversation: { id: string };
  }>(`/api/workspaces/${params.workspaceId}/versions/${params.versionId}/continue`, {
    body: JSON.stringify({
      activeFileId: params.activeFileId,
      parentConversationId: params.parentConversationId,
      safetyCheckpointTitle: params.safetyCheckpointTitle,
      title: params.title,
    }),
    fallbackMessage: params.errorMessage,
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

export async function switchWorkspaceConversationToVersionBranch(
  params: WorkspaceVersionConversationActionParams
) {
  return apiCallOrThrow<{
    baseVersion: WorkspaceVersionData;
    conversation: { id: string };
  }>(`/api/workspaces/${params.workspaceId}/versions/${params.versionId}/switch`, {
    body: JSON.stringify({
      activeFileId: params.activeFileId,
      parentConversationId: params.parentConversationId,
      safetyCheckpointTitle: params.safetyCheckpointTitle,
      title: params.title,
    }),
    fallbackMessage: params.errorMessage,
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}
