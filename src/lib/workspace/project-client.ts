'use client';

import { apiCallOrThrow } from '@/framework/resilience';

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
