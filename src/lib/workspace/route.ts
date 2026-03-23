export const WORKSPACE_AUTO_START_FIRST_PASS_PARAM = 'autoStartFirstPass';
export const WORKSPACE_NODE_SEARCH_PARAM = 'node';

export function buildWorkspacePath(projectId: string) {
  return `/workspace/${projectId}`;
}

export function buildWorkspaceRoute(params: {
  autoStartFirstPass?: boolean;
  conversationId?: string | null;
  fileId?: string | null;
  nodeId?: string | null;
  projectId: string;
  versionId?: string | null;
}) {
  const searchParams = new URLSearchParams();

  if (params.nodeId) {
    searchParams.set(WORKSPACE_NODE_SEARCH_PARAM, params.nodeId);
  }
  if (params.conversationId) {
    searchParams.set('conversationId', params.conversationId);
  }
  if (params.fileId) {
    searchParams.set('fileId', params.fileId);
  }
  if (params.versionId) {
    searchParams.set('versionId', params.versionId);
  }
  if (params.autoStartFirstPass) {
    searchParams.set(WORKSPACE_AUTO_START_FIRST_PASS_PARAM, '1');
  }

  const pathname = buildWorkspacePath(params.projectId);
  return searchParams.size > 0 ? `${pathname}?${searchParams.toString()}` : pathname;
}
