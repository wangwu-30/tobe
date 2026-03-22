import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import type { WorkspacePlanData } from '@/types';
import { apiCallOrThrow } from '@/framework/resilience';

export async function generateWorkspacePlan(workspaceId: string) {
  await apiCallOrThrow<null>(`/api/workspaces/${workspaceId}/plan/generate`, {
    fallbackMessage: 'Could not generate the workspace plan.',
    headers: {
      ...getStoredAISettingsHeader(),
    },
    method: 'POST',
    parseAs: 'void',
  });
}

export async function updateWorkspacePlanActiveWorkflow(params: {
  errorMessage: string;
  workflowPlaybookId: string | null;
  workspaceId: string;
}) {
  return apiCallOrThrow<WorkspacePlanData>(`/api/workspaces/${params.workspaceId}/plan`, {
    body: JSON.stringify({
      activeWorkflowPlaybookId: params.workflowPlaybookId,
    }),
    fallbackMessage: params.errorMessage,
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'PATCH',
  });
}
