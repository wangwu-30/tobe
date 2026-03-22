'use client';

import { apiCall } from '@/framework/resilience';

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

  return apiCall<WorkspaceViewData>(
    `/api/workspaces/${params.workspaceId}${query.size > 0 ? `?${query.toString()}` : ''}`
  );
}

export async function readWorkspaceRuns(workspaceId: string) {
  return apiCall<WorkspaceRunData[]>(`/api/workspaces/${workspaceId}/runs`);
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

  return apiCall<CommentThreadData[]>(`/api/threads?${query.toString()}`);
}
