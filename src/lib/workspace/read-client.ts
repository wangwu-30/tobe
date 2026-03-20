'use client';

import type {
  CommentThreadData,
  DeliverableType,
  WorkspaceRunData,
  WorkspaceViewData,
} from '@/types';

export async function readWorkspaceView(params: {
  conversationId?: string | null;
  fileId?: string | null;
  versionId?: string | null;
  workspaceId: string;
}) {
  const query = new URLSearchParams();
  if (params.conversationId) query.set('conversationId', params.conversationId);
  if (params.fileId) query.set('fileId', params.fileId);
  if (params.versionId) query.set('versionId', params.versionId);

  const response = await fetch(
    `/api/workspaces/${params.workspaceId}${query.size > 0 ? `?${query.toString()}` : ''}`
  );

  if (!response.ok) {
    return null;
  }

  return (await response.json().catch(() => null)) as WorkspaceViewData | null;
}

export async function readWorkspaceRuns(workspaceId: string) {
  const response = await fetch(`/api/workspaces/${workspaceId}/runs`);
  if (!response.ok) {
    return null;
  }

  return (await response.json().catch(() => null)) as WorkspaceRunData[] | null;
}

export async function readWorkspaceReviewThreads(params: {
  currentFileId?: string | null;
  currentVersionId?: string | null;
  deliverableType: DeliverableType;
  workspaceId: string;
}) {
  const query = new URLSearchParams({ workspaceId: params.workspaceId });
  if (params.deliverableType !== 'web' && params.currentFileId) {
    query.set('fileId', params.currentFileId);
  }
  if (params.currentVersionId) {
    query.set('versionId', params.currentVersionId);
  } else {
    query.set('draftOnly', '1');
  }

  const response = await fetch(`/api/threads?${query.toString()}`);
  if (!response.ok) {
    return null;
  }

  return (await response.json().catch(() => null)) as CommentThreadData[] | null;
}
