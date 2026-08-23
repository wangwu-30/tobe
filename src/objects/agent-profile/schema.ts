import { ValidationError } from '@/framework/resilience/app-error';
import { isRecord, safeJsonParse } from '@/framework/resilience/safe-data';

export const AGENT_PROFILE_CONTRACT_VERSION_V1 = 1 as const;
export const DEFAULT_ROOM_AGENT_RUNTIME_ID_V1 = 'pi-agent-core' as const;
export const DEFAULT_ROOM_AGENT_CONFIG_VERSION_V1 = 1 as const;

const MAX_HANDLE_LENGTH = 33;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_SKILLS = 32;
const MAX_SKILL_LENGTH = 64;
const SAFE_HANDLE = /^@[a-z0-9](?:[a-z0-9_-]{0,30}[a-z0-9])?$/u;
const UNSAFE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export type AgentProfileCapabilitiesV1 = {
  schemaVersion: typeof AGENT_PROFILE_CONTRACT_VERSION_V1;
  skills: string[];
};

export type AgentProfileRoomBindingV1 = {
  runtimeId: typeof DEFAULT_ROOM_AGENT_RUNTIME_ID_V1;
  configVersion: typeof DEFAULT_ROOM_AGENT_CONFIG_VERSION_V1;
};

export type AgentProfileConfigV1 = {
  schemaVersion: typeof AGENT_PROFILE_CONTRACT_VERSION_V1;
  room: AgentProfileRoomBindingV1;
};

export type AgentProfileDtoV1 = {
  schemaVersion: typeof AGENT_PROFILE_CONTRACT_VERSION_V1;
  id: string;
  organizationId: string;
  handle: string;
  name: string;
  description: string;
  capabilities: AgentProfileCapabilitiesV1;
  /** Compatibility projection for existing mention and assignment clients. */
  skills: string[];
  config: AgentProfileConfigV1;
  enabled: boolean;
  builtin: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type AgentProfileActorV1 = {
  organizationId: string;
  userId: string;
};

export type CreateAgentProfileInputV1 = {
  handle: string;
  name: string;
  description?: string;
  capabilities?: AgentProfileCapabilitiesV1;
  config?: AgentProfileConfigV1;
  enabled?: boolean;
};

export type UpdateAgentProfileInputV1 = {
  expectedRevision: number;
  handle?: string;
  name?: string;
  description?: string;
  capabilities?: AgentProfileCapabilitiesV1;
  config?: AgentProfileConfigV1;
  enabled?: boolean;
};

export type AgentProfileRecordV1 = {
  builtin: boolean;
  capabilitiesJson: string;
  configJson: string;
  createdAt: Date | string;
  description: string;
  enabled: boolean;
  handle: string;
  id: string;
  name: string;
  organizationId: string;
  revision: number;
  skillsJson: string;
  updatedAt: Date | string;
};

export const DEFAULT_AGENT_PROFILE_CAPABILITIES_V1: AgentProfileCapabilitiesV1 = {
  schemaVersion: AGENT_PROFILE_CONTRACT_VERSION_V1,
  skills: [],
};

export const DEFAULT_AGENT_PROFILE_CONFIG_V1: AgentProfileConfigV1 = {
  schemaVersion: AGENT_PROFILE_CONTRACT_VERSION_V1,
  room: {
    runtimeId: DEFAULT_ROOM_AGENT_RUNTIME_ID_V1,
    configVersion: DEFAULT_ROOM_AGENT_CONFIG_VERSION_V1,
  },
};

export const BUILTIN_ASSISTANT_PROFILE_V1 = {
  idPrefix: 'builtin-assistant:',
  handle: '@assistant',
  name: 'AI Assistant',
  description: 'Built-in document and team task assistant.',
  capabilities: {
    schemaVersion: AGENT_PROFILE_CONTRACT_VERSION_V1,
    skills: ['coordination', 'document_editing', 'research', 'team_tasks'],
  } satisfies AgentProfileCapabilitiesV1,
  config: DEFAULT_AGENT_PROFILE_CONFIG_V1,
} as const;

export function builtinAssistantProfileIdV1(organizationId: string) {
  return `${BUILTIN_ASSISTANT_PROFILE_V1.idPrefix}${organizationId}`;
}

const CREATE_FIELDS = new Set([
  'schemaVersion',
  'handle',
  'name',
  'description',
  'capabilities',
  'config',
  'enabled',
]);
const UPDATE_FIELDS = new Set([
  ...CREATE_FIELDS,
  'expectedRevision',
]);

export function parseCreateAgentProfileInputV1(
  value: unknown
): CreateAgentProfileInputV1 {
  const input = exactRecord(value, CREATE_FIELDS, 'Agent profile request');
  requireSchemaVersion(input.schemaVersion);
  return {
    handle: normalizeAgentHandleV1(input.handle),
    name: readName(input.name),
    description: readDescription(input.description),
    capabilities: readCapabilities(input.capabilities),
    config: readConfig(input.config),
    enabled: readOptionalBoolean(input.enabled, 'enabled'),
  };
}

export function parseUpdateAgentProfileInputV1(
  value: unknown
): UpdateAgentProfileInputV1 {
  const input = exactRecord(value, UPDATE_FIELDS, 'Agent profile request');
  requireSchemaVersion(input.schemaVersion);
  const expectedRevision = input.expectedRevision;
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 1) {
    throw new ValidationError('expectedRevision must be a positive integer.');
  }
  const hasMutation = [...CREATE_FIELDS].some(
    (field) => field !== 'schemaVersion' && field in input
  );
  if (!hasMutation) {
    throw new ValidationError('At least one Agent profile field must be updated.');
  }
  return {
    expectedRevision: expectedRevision as number,
    ...('handle' in input
      ? { handle: normalizeAgentHandleV1(input.handle) }
      : {}),
    ...('name' in input ? { name: readName(input.name) } : {}),
    ...('description' in input
      ? { description: readDescription(input.description) }
      : {}),
    ...('capabilities' in input
      ? { capabilities: readCapabilities(input.capabilities) }
      : {}),
    ...('config' in input ? { config: readConfig(input.config) } : {}),
    ...('enabled' in input
      ? { enabled: readOptionalBoolean(input.enabled, 'enabled') as boolean }
      : {}),
  };
}

export function normalizeAgentHandleV1(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('handle must be a string.');
  }
  const candidate = value.trim().toLocaleLowerCase('en-US');
  const normalized = candidate.startsWith('@') ? candidate : `@${candidate}`;
  if (normalized.length > MAX_HANDLE_LENGTH || !SAFE_HANDLE.test(normalized)) {
    throw new ValidationError(
      'handle must contain only lowercase letters, numbers, underscores, or hyphens and must start and end with a letter or number.'
    );
  }
  return normalized;
}

export function mapAgentProfileV1(
  record: AgentProfileRecordV1
): AgentProfileDtoV1 {
  const legacySkills = parseSkills(record.skillsJson);
  const capabilities = parseStoredCapabilities(record.capabilitiesJson, legacySkills);
  return {
    schemaVersion: AGENT_PROFILE_CONTRACT_VERSION_V1,
    id: record.id,
    organizationId: record.organizationId,
    handle: normalizeStoredHandle(record.handle),
    name: record.name,
    description: record.description,
    capabilities,
    skills: [...capabilities.skills],
    config: parseStoredConfig(record.configJson),
    enabled: record.enabled,
    builtin: record.builtin,
    revision: Number.isSafeInteger(record.revision) && record.revision > 0
      ? record.revision
      : 1,
    createdAt: toIsoString(record.createdAt),
    updatedAt: toIsoString(record.updatedAt),
  };
}

export function serializeAgentCapabilitiesV1(
  capabilities: AgentProfileCapabilitiesV1
) {
  return JSON.stringify(capabilities);
}

export function serializeAgentConfigV1(config: AgentProfileConfigV1) {
  return JSON.stringify(config);
}

export function readAgentProfileRuntimeBindingV1(value: string) {
  return parseStoredConfig(value).room;
}

function readName(value: unknown) {
  return boundedText(value, 'name', MAX_NAME_LENGTH, false);
}

function readDescription(value: unknown) {
  if (value === undefined) return '';
  return boundedText(value, 'description', MAX_DESCRIPTION_LENGTH, true);
}

function readCapabilities(value: unknown): AgentProfileCapabilitiesV1 {
  if (value === undefined) return { ...DEFAULT_AGENT_PROFILE_CAPABILITIES_V1, skills: [] };
  const input = exactRecord(
    value,
    new Set(['schemaVersion', 'skills']),
    'capabilities'
  );
  requireSchemaVersion(input.schemaVersion, 'capabilities.schemaVersion');
  if (!Array.isArray(input.skills) || input.skills.length > MAX_SKILLS) {
    throw new ValidationError(`capabilities.skills must contain at most ${MAX_SKILLS} items.`);
  }
  const skills: string[] = [];
  const seen = new Set<string>();
  for (const value of input.skills) {
    const skill = boundedText(value, 'capabilities.skills item', MAX_SKILL_LENGTH, false);
    const key = skill.toLocaleLowerCase('en-US');
    if (!seen.has(key)) {
      seen.add(key);
      skills.push(skill);
    }
  }
  return { schemaVersion: AGENT_PROFILE_CONTRACT_VERSION_V1, skills };
}

function readConfig(value: unknown): AgentProfileConfigV1 {
  if (value === undefined) return DEFAULT_AGENT_PROFILE_CONFIG_V1;
  const input = exactRecord(value, new Set(['schemaVersion', 'room']), 'config');
  requireSchemaVersion(input.schemaVersion, 'config.schemaVersion');
  const room = exactRecord(
    input.room,
    new Set(['runtimeId', 'configVersion']),
    'config.room'
  );
  if (room.runtimeId !== DEFAULT_ROOM_AGENT_RUNTIME_ID_V1) {
    throw new ValidationError(
      `config.room.runtimeId must reference ${DEFAULT_ROOM_AGENT_RUNTIME_ID_V1}.`
    );
  }
  if (room.configVersion !== DEFAULT_ROOM_AGENT_CONFIG_VERSION_V1) {
    throw new ValidationError('config.room.configVersion must be 1.');
  }
  return DEFAULT_AGENT_PROFILE_CONFIG_V1;
}

function parseStoredCapabilities(
  value: string,
  fallbackSkills: string[]
): AgentProfileCapabilitiesV1 {
  const parsed = safeJsonParse<unknown>(value, null);
  try {
    const capabilities = readCapabilities(parsed);
    // Databases brought to the current Prisma schema with `db push` receive
    // the JSON default before this migration is marked. Preserve legacy
    // `skillsJson` until the first explicit profile write synchronizes both.
    return capabilities.skills.length === 0 && fallbackSkills.length > 0
      ? { ...capabilities, skills: fallbackSkills }
      : capabilities;
  } catch {
    return {
      schemaVersion: AGENT_PROFILE_CONTRACT_VERSION_V1,
      skills: fallbackSkills,
    };
  }
}

function parseStoredConfig(value: string): AgentProfileConfigV1 {
  const parsed = safeJsonParse<unknown>(value, null);
  try {
    return readConfig(parsed);
  } catch {
    return DEFAULT_AGENT_PROFILE_CONFIG_V1;
  }
}

function parseSkills(value: string) {
  const parsed = safeJsonParse<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (skill): skill is string =>
      typeof skill === 'string' &&
      skill.length > 0 &&
      skill.length <= MAX_SKILL_LENGTH &&
      !UNSAFE_CONTROL.test(skill)
  );
}

function exactRecord(
  value: unknown,
  allowed: ReadonlySet<string>,
  field: string
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ValidationError(`${field} must be an object.`);
  }
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) {
    throw new ValidationError(`${field} contains an unknown field: ${unknown}.`);
  }
  return value;
}

function requireSchemaVersion(value: unknown, field = 'schemaVersion') {
  if (value !== AGENT_PROFILE_CONTRACT_VERSION_V1) {
    throw new ValidationError(`${field} must be 1.`);
  }
}

function boundedText(
  value: unknown,
  field: string,
  maxLength: number,
  allowEmpty: boolean
) {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string.`);
  }
  const text = value.trim();
  if ((!allowEmpty && !text) || text.length > maxLength || UNSAFE_CONTROL.test(text)) {
    throw new ValidationError(
      `${field} must ${allowEmpty ? '' : 'not be empty and '}contain at most ${maxLength} safe characters.`
    );
  }
  return text;
}

function readOptionalBoolean(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${field} must be a boolean.`);
  }
  return value;
}

function normalizeStoredHandle(value: string) {
  try {
    return normalizeAgentHandleV1(value);
  } catch {
    return value;
  }
}

function toIsoString(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toISOString();
}
