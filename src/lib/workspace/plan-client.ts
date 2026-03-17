import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';

export async function generateWorkspacePlan(workspaceId: string) {
  return fetch(`/api/workspaces/${workspaceId}/plan/generate`, {
    method: 'POST',
    headers: {
      ...getStoredAISettingsHeader(),
    },
  });
}
