'use client';

import { apiCallOrThrow } from '@/framework/resilience';
import type {
  ProjectMountData,
  ProjectNodeSearchResultData,
} from '@/types';

export async function renameWorkspaceProject(params: {
  errorMessage: string;
  projectId: string;
  title: string;
}) {
  return apiCallOrThrow<{
    id: string;
    title: string;
  } | null>(`/api/projects/${params.projectId}`, {
    body: JSON.stringify({ title: params.title }),
    fallbackMessage: params.errorMessage,
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'PATCH',
  });
}

export async function deleteWorkspaceProject(params: {
  errorMessage: string;
  projectId: string;
}) {
  await apiCallOrThrow<null>(`/api/projects/${params.projectId}`, {
    fallbackMessage: params.errorMessage,
    method: 'DELETE',
    parseAs: 'void',
  });
}

export async function listWorkspaceProjectMounts(params: {
  errorMessage: string;
  projectId: string;
}) {
  return apiCallOrThrow<ProjectMountData[]>(`/api/projects/${params.projectId}/mounts`, {
    fallbackMessage: params.errorMessage,
  });
}

export async function createWorkspaceProjectMount(params: {
  errorMessage: string;
  projectId: string;
  targetProjectId: string;
}) {
  return apiCallOrThrow<ProjectMountData>(`/api/projects/${params.projectId}/mounts`, {
    body: JSON.stringify({
      targetProjectId: params.targetProjectId,
    }),
    fallbackMessage: params.errorMessage,
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export async function searchWorkspaceProjectNodes(params: {
  currentNodeId?: string | null;
  errorMessage: string;
  limit?: number;
  projectId: string;
  query: string;
}) {
  const searchParams = new URLSearchParams({
    projectId: params.projectId,
    q: params.query,
  });
  if (params.currentNodeId) {
    searchParams.set('currentNodeId', params.currentNodeId);
  }
  if (params.limit) {
    searchParams.set('limit', String(params.limit));
  }

  return apiCallOrThrow<ProjectNodeSearchResultData[]>(
    `/api/search/nodes?${searchParams.toString()}`,
    {
      fallbackMessage: params.errorMessage,
    }
  );
}
