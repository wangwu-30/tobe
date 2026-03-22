'use client';

import type { WorkspaceRunData } from '@/types';
import { apiCallOrThrow } from '@/framework/resilience';

export async function startWorkspacePreview(params: {
  errorMessage: string;
  versionId: string | null;
  workspaceId: string;
}) {
  return apiCallOrThrow<WorkspaceRunData | null>(
    `/api/workspaces/${params.workspaceId}/preview/start`,
    {
      body: JSON.stringify({
        versionId: params.versionId,
      }),
      fallbackMessage: params.errorMessage,
      headers: { 'Content-Type': 'application/json' },
      // Preview start should survive an immediate reload from the result surface.
      keepalive: true,
      method: 'POST',
    }
  );
}

export async function stopWorkspacePreview(params: {
  errorMessage: string;
  workspaceId: string;
}) {
  await apiCallOrThrow<null>(`/api/workspaces/${params.workspaceId}/preview/stop`, {
    fallbackMessage: params.errorMessage,
    method: 'POST',
    parseAs: 'void',
  });
}
