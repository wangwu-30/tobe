import {
  ensureWorkspaceFiles,
} from './commands';
import {
  mapWorkspaceFile,
} from './schema';

export async function listWorkspaceFiles(params: {
  organizationId: string;
  workspaceId: string;
}) {
  const files = await ensureWorkspaceFiles(params.organizationId, params.workspaceId);
  return files.map(mapWorkspaceFile);
}
