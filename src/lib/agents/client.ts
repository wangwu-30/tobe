import { apiCall } from '@/framework/resilience';

export type AgentCapabilitiesDtoV1 = {
  schemaVersion: 1;
  skills: string[];
};

export type AgentRoomConfigDtoV1 = {
  configVersion: 1;
  runtimeId: string;
};

export type AgentConfigDtoV1 = {
  room: AgentRoomConfigDtoV1;
  schemaVersion: 1;
};

export type AgentProfileDtoV1 = {
  builtin: boolean;
  capabilities: AgentCapabilitiesDtoV1;
  config: AgentConfigDtoV1;
  createdAt: string;
  description: string;
  enabled: boolean;
  handle: string;
  id: string;
  name: string;
  organizationId: string;
  revision: number;
  schemaVersion: 1;
  updatedAt: string;
};

export type AgentPermissionsDtoV1 = {
  canManage: boolean;
};

export type AgentListDtoV1 = {
  agents: AgentProfileDtoV1[];
  permissions: AgentPermissionsDtoV1;
  schemaVersion: 1;
};

export type CreateAgentInputV1 = {
  capabilities?: AgentCapabilitiesDtoV1;
  config?: AgentConfigDtoV1;
  description?: string;
  enabled?: boolean;
  handle: string;
  name: string;
  schemaVersion: 1;
};

export type UpdateAgentInputV1 = Partial<CreateAgentInputV1> & {
  expectedRevision: number;
  schemaVersion: 1;
};

export type AgentClientResult<T> =
  | { data: T; ok: true }
  | { error: string; ok: false; status: number | null };

const INVALID_LIST_RESPONSE =
  'The server returned an invalid agent list. Refresh and try again.';
const INVALID_AGENT_RESPONSE =
  'The agent was saved, but the server returned an invalid response.';

export function defaultAgentConfigV1(): AgentConfigDtoV1 {
  return {
    room: {
      configVersion: 1,
      runtimeId: 'pi-agent-core',
    },
    schemaVersion: 1,
  };
}

export async function listAgents(options?: {
  signal?: AbortSignal | null;
}): Promise<AgentClientResult<AgentListDtoV1>> {
  const result = await apiCall<unknown>('/api/agents?includeDisabled=true', {
    signal: options?.signal,
  });
  if (!result.ok) {
    return toClientError(result.error.message, result.error.status);
  }

  const data = parseAgentListDtoV1(result.data);
  return data
    ? { data, ok: true }
    : { error: INVALID_LIST_RESPONSE, ok: false, status: result.response.status };
}

export async function createAgent(
  input: CreateAgentInputV1
): Promise<AgentClientResult<AgentProfileDtoV1>> {
  const result = await apiCall<unknown>('/api/agents', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!result.ok) {
    return toClientError(result.error.message, result.error.status);
  }

  const agent = parseAgentEnvelope(result.data);
  return agent
    ? { data: agent, ok: true }
    : { error: INVALID_AGENT_RESPONSE, ok: false, status: result.response.status };
}

export async function updateAgent(
  agentId: string,
  input: UpdateAgentInputV1
): Promise<AgentClientResult<AgentProfileDtoV1>> {
  const result = await apiCall<unknown>(
    `/api/agents/${encodeURIComponent(agentId)}`,
    {
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    }
  );
  if (!result.ok) {
    return toClientError(result.error.message, result.error.status);
  }

  const agent = parseAgentEnvelope(result.data);
  return agent
    ? { data: agent, ok: true }
    : { error: INVALID_AGENT_RESPONSE, ok: false, status: result.response.status };
}

export function normalizeAgentHandle(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
  if (!normalized) return '';
  return normalized.startsWith('@') ? normalized : `@${normalized}`;
}

export function parseAgentSkills(value: string) {
  const skills = value
    .split(/[\n,]/)
    .map((skill) => skill.trim())
    .filter(Boolean);
  return Array.from(new Set(skills));
}

export function parseAgentListDtoV1(value: unknown): AgentListDtoV1 | null {
  const record = asRecord(value);
  const permissions = asRecord(record.permissions);
  if (
    record.schemaVersion !== 1 ||
    !Array.isArray(record.agents) ||
    typeof permissions.canManage !== 'boolean'
  ) {
    return null;
  }

  const agents = record.agents.map(parseAgentProfileDtoV1);
  if (agents.some((agent) => agent === null)) return null;

  return {
    agents: agents as AgentProfileDtoV1[],
    permissions: { canManage: permissions.canManage },
    schemaVersion: 1,
  };
}

export function parseAgentProfileDtoV1(value: unknown): AgentProfileDtoV1 | null {
  const record = asRecord(value);
  const capabilities = asRecord(record.capabilities);
  const config = asRecord(record.config);
  const room = asRecord(config.room);

  if (
    record.schemaVersion !== 1 ||
    capabilities.schemaVersion !== 1 ||
    !Array.isArray(capabilities.skills) ||
    !capabilities.skills.every((skill) => typeof skill === 'string') ||
    config.schemaVersion !== 1 ||
    room.configVersion !== 1 ||
    !isNonEmptyString(room.runtimeId) ||
    !isNonEmptyString(record.id) ||
    !isNonEmptyString(record.organizationId) ||
    !isNonEmptyString(record.handle) ||
    !isNonEmptyString(record.name) ||
    typeof record.description !== 'string' ||
    typeof record.enabled !== 'boolean' ||
    typeof record.builtin !== 'boolean' ||
    !Number.isInteger(record.revision) ||
    Number(record.revision) < 1 ||
    !isNonEmptyString(record.createdAt) ||
    !isNonEmptyString(record.updatedAt)
  ) {
    return null;
  }

  return {
    builtin: record.builtin,
    capabilities: {
      schemaVersion: 1,
      skills: [...capabilities.skills] as string[],
    },
    config: {
      room: {
        configVersion: 1,
        runtimeId: room.runtimeId,
      },
      schemaVersion: 1,
    },
    createdAt: record.createdAt,
    description: record.description,
    enabled: record.enabled,
    handle: record.handle,
    id: record.id,
    name: record.name,
    organizationId: record.organizationId,
    revision: Number(record.revision),
    schemaVersion: 1,
    updatedAt: record.updatedAt,
  };
}

function parseAgentEnvelope(value: unknown) {
  const record = asRecord(value);
  if (record.schemaVersion !== 1) return null;
  return parseAgentProfileDtoV1(record.agent);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function toClientError(error: string, status: number | null): AgentClientResult<never> {
  return {
    error: error || 'The request could not be completed.',
    ok: false,
    status,
  };
}
