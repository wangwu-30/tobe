'use client';

import type { WorkspaceRunData } from '@/types';

async function readPreviewError(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => null);
  return payload?.error || fallbackMessage;
}

export async function startWorkspacePreview(params: {
  errorMessage: string;
  versionId: string | null;
  workspaceId: string;
}) {
  const response = await fetch(`/api/workspaces/${params.workspaceId}/preview/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Preview start should survive an immediate reload from the result surface.
    keepalive: true,
    body: JSON.stringify({
      versionId: params.versionId,
    }),
  });

  if (!response.ok) {
    throw new Error(await readPreviewError(response, params.errorMessage));
  }

  return (await response.json().catch(() => null)) as WorkspaceRunData | null;
}

export async function stopWorkspacePreview(params: {
  errorMessage: string;
  workspaceId: string;
}) {
  const response = await fetch(`/api/workspaces/${params.workspaceId}/preview/stop`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(await readPreviewError(response, params.errorMessage));
  }
}
