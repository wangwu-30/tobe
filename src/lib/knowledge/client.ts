import { apiCall, isRecord } from '@/framework/resilience';
import type { AgentProfileData } from '@/types';
import type {
  KnowledgeBindingDto,
  KnowledgeChangeRequestDto,
  KnowledgeMergeOperationDto,
  KnowledgeSnapshotDto,
  KnowledgeSpaceDto,
} from '@/objects/knowledge';

export type KnowledgeClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type KnowledgeChangeRequestDetail = {
  changeRequest: KnowledgeChangeRequestDto;
  diff: { patch: string; patchSha256: string; baseCommit: string; headCommit: string };
  mergeOperations: KnowledgeMergeOperationDto[];
  activeSnapshot: KnowledgeSnapshotDto | null;
  space: Pick<KnowledgeSpaceDto, 'id' | 'scope' | 'ownerAgentId' | 'defaultBranch' | 'activeSnapshotId'>;
};

export type KnowledgeActorSummary = {
  agentId: string | null;
  goal: string | null;
};

export type KnowledgeWorkspaceOption = {
  id: string;
  projectTitle: string | null;
  title: string;
};

export async function listKnowledgeChangeRequestsClient() {
  return call<{ changeRequests: KnowledgeChangeRequestDto[] }, KnowledgeChangeRequestDto[]>(
    '/api/knowledge/change-requests', undefined, (value) => value.changeRequests
  );
}

export async function getKnowledgeChangeRequestClient(id: string) {
  return call<KnowledgeChangeRequestDetail, KnowledgeChangeRequestDetail>(
    '/api/knowledge/change-requests/' + encodeURIComponent(id)
  );
}

export async function getKnowledgeActorSummaryClient(jobId: string) {
  const result = await apiCall<unknown>(
    '/api/execution-jobs/' + encodeURIComponent(jobId)
  );
  if (!result.ok) return { ok: false, error: result.error.message } as const;
  const root = isRecord(result.data) ? result.data : {};
  const job = isRecord(root.job) ? root.job : root;
  if (!readText(job.id)) {
    return invalidResponse<KnowledgeActorSummary>('Execution provenance response was invalid.');
  }
  const manifest = isRecord(job.contextManifest) ? job.contextManifest : {};
  const binding = isRecord(manifest.knowledgeCommit) ? manifest.knowledgeCommit : {};
  const spec = isRecord(job.spec) ? job.spec : {};
  return {
    ok: true,
    data: {
      agentId: readText(binding.agentId),
      goal: readText(spec.goal) || readText(job.goal),
    },
  } as const;
}

export async function reviewKnowledgeChangeRequestClient(
  id: string,
  input: { action: 'approve' | 'reject'; expectedRevision: number; note?: string | null }
) {
  return call<{ changeRequest: KnowledgeChangeRequestDto }, KnowledgeChangeRequestDto>(
    '/api/knowledge/change-requests/' + encodeURIComponent(id) + '/review',
    request('POST', input),
    (value) => value.changeRequest
  );
}

export async function queueKnowledgeMergeClient(id: string, expectedRevision: number) {
  return call<{ operation: KnowledgeMergeOperationDto }, KnowledgeMergeOperationDto>(
    '/api/knowledge/change-requests/' + encodeURIComponent(id) + '/merge',
    request('POST', { expectedRevision }),
    (value) => value.operation
  );
}

export async function listKnowledgeSpacesClient() {
  return call<{ spaces: KnowledgeSpaceDto[] }, KnowledgeSpaceDto[]>(
    '/api/knowledge/spaces', undefined, (value) => value.spaces
  );
}

export async function createKnowledgeSpaceClient(input: {
  scope: 'team' | 'agent';
  ownerAgentId?: string | null;
  repoPath: string;
  defaultBranch: string;
}) {
  return call<{ space: KnowledgeSpaceDto }, KnowledgeSpaceDto>(
    '/api/knowledge/spaces', request('POST', input), (value) => value.space
  );
}

export async function listKnowledgeBindingsClient() {
  return call<{ bindings: KnowledgeBindingDto[] }, KnowledgeBindingDto[]>(
    '/api/knowledge/bindings', undefined, (value) => value.bindings
  );
}

export async function listKnowledgeAgentsClient() {
  const result = await apiCall<unknown>('/api/agents');
  if (!result.ok) return { ok: false, error: result.error.message } as const;
  const items = isRecord(result.data) && Array.isArray(result.data.agents)
    ? result.data.agents
    : null;
  if (!items) return invalidResponse<AgentProfileData[]>('Agent list response was invalid.');

  const agents = items
    .map(normalizeAgent)
    .filter((agent): agent is AgentProfileData => agent !== null);
  return items.length === agents.length
    ? ({ ok: true, data: agents } as const)
    : invalidResponse<AgentProfileData[]>('Agent list contained an invalid agent.');
}

export async function listKnowledgeWorkspacesClient() {
  const result = await apiCall<unknown>('/api/workspaces');
  if (!result.ok) return { ok: false, error: result.error.message } as const;
  const items = isRecord(result.data) && Array.isArray(result.data.items)
    ? result.data.items
    : null;
  if (!items) {
    return invalidResponse<KnowledgeWorkspaceOption[]>('Workspace list response was invalid.');
  }

  const workspaces = items
    .map(normalizeWorkspace)
    .filter((workspace): workspace is KnowledgeWorkspaceOption => workspace !== null);
  return items.length === workspaces.length
    ? ({ ok: true, data: workspaces } as const)
    : invalidResponse<KnowledgeWorkspaceOption[]>('Workspace list contained an invalid workspace.');
}

export async function createKnowledgeBindingClient(input: {
  workspaceId: string;
  agentId?: string | null;
  spaceId: string;
  access: 'read' | 'propose';
}) {
  return call<{ binding: KnowledgeBindingDto }, KnowledgeBindingDto>(
    '/api/knowledge/bindings',
    request('POST', { ...input, mountPath: '/' }),
    (value) => value.binding
  );
}

async function call<TResponse, TResult = TResponse>(
  url: string,
  options?: RequestInit,
  select?: (response: TResponse) => TResult
): Promise<KnowledgeClientResult<TResult>> {
  const result = await apiCall<TResponse>(url, options);
  if (!result.ok) return { ok: false, error: result.error.message };
  let data: TResult;
  try {
    data = select ? select(result.data) : (result.data as unknown as TResult);
  } catch {
    return invalidResponse<TResult>('Knowledge response was invalid.');
  }
  if (data === undefined || data === null) {
    return invalidResponse<TResult>('Knowledge response was invalid.');
  }
  return {
    ok: true,
    data,
  };
}

function request(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function normalizeAgent(value: unknown): AgentProfileData | null {
  if (!isRecord(value) || !readText(value.id) || !readText(value.name)) return null;
  return {
    id: readText(value.id)!,
    organizationId: readText(value.organizationId) || '',
    handle: readText(value.handle) || '',
    name: readText(value.name)!,
    description: readText(value.description) || '',
    skills: Array.isArray(value.skills)
      ? value.skills.filter((skill): skill is string => typeof skill === 'string')
      : [],
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    builtin: typeof value.builtin === 'boolean' ? value.builtin : false,
    createdAt: readText(value.createdAt) || '',
    updatedAt: readText(value.updatedAt) || '',
  };
}

function normalizeWorkspace(value: unknown): KnowledgeWorkspaceOption | null {
  if (!isRecord(value)) return null;
  const id = readText(value.workspaceId) || readText(value.id);
  const title =
    readText(value.latestDeliverableTitle) ||
    readText(value.preview) ||
    readText(value.title);
  if (!id || !title) return null;
  return { id, title, projectTitle: readText(value.title) };
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function invalidResponse<T>(error: string): KnowledgeClientResult<T> {
  return { ok: false, error };
}
