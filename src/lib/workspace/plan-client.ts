import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import type { WorkspacePlanData } from '@/types';

async function readWorkspacePlanError(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => null);
  return payload?.error || fallbackMessage;
}

export async function generateWorkspacePlan(workspaceId: string) {
  return fetch(`/api/workspaces/${workspaceId}/plan/generate`, {
    method: 'POST',
    headers: {
      ...getStoredAISettingsHeader(),
    },
  });
}

export async function updateWorkspacePlanActiveWorkflow(params: {
  errorMessage: string;
  workflowPlaybookId: string | null;
  workspaceId: string;
}) {
  const response = await fetch(`/api/workspaces/${params.workspaceId}/plan`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      activeWorkflowPlaybookId: params.workflowPlaybookId,
    }),
  });

  if (!response.ok) {
    throw new Error(await readWorkspacePlanError(response, params.errorMessage));
  }

  return (await response.json()) as WorkspacePlanData;
}
