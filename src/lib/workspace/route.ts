export const WORKSPACE_AUTO_START_FIRST_PASS_PARAM = 'autoStartFirstPass';
export const WORKSPACE_ASSISTANT_SEARCH_PARAM = 'assistant';
export const WORKSPACE_NODE_SEARCH_PARAM = 'node';

export const WORKSPACE_ASSISTANT_TABS = [
  'chat',
  'room',
  'status',
  'review',
  'context',
] as const;

export type WorkspaceAssistantTab = (typeof WORKSPACE_ASSISTANT_TABS)[number];

export function parseWorkspaceAssistantTab(
  value: string | null | undefined
): WorkspaceAssistantTab {
  return WORKSPACE_ASSISTANT_TABS.includes(value as WorkspaceAssistantTab)
    ? (value as WorkspaceAssistantTab)
    : 'chat';
}

export function isCanonicalWorkspaceAssistantParam(values: readonly string[]) {
  if (values.length === 0) {
    return true;
  }

  if (values.length !== 1 || values[0] === 'chat') {
    return false;
  }

  return WORKSPACE_ASSISTANT_TABS.includes(values[0] as WorkspaceAssistantTab);
}

export function buildWorkspacePath(projectId: string) {
  return `/workspace/${projectId}`;
}

export function buildWorkspaceRoute(params: {
  assistant?: WorkspaceAssistantTab | null;
  autoStartFirstPass?: boolean;
  conversationId?: string | null;
  fileId?: string | null;
  nodeId?: string | null;
  projectId: string;
  versionId?: string | null;
}) {
  const searchParams = new URLSearchParams();

  if (params.assistant && params.assistant !== 'chat') {
    searchParams.set(WORKSPACE_ASSISTANT_SEARCH_PARAM, params.assistant);
  }

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
