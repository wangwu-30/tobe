import {
  RUNTIME_CONTRACT_VERSION_V1,
  type RuntimeCandidateV1,
  type RuntimeCapabilitiesV1,
  type RuntimeExecutionKindV1,
  type RuntimeHealthStateV1,
  type RuntimeInterruptV1,
  type RuntimeSandboxV1,
  type RuntimeStreamingV1,
  type RuntimeWorkspaceV1,
} from '@/agent/execution/contracts';
import { isRecord, safeJsonParse } from '@/framework/resilience/safe-data';

export const EXECUTION_RUNTIME_DTO_VERSION_V1 = 1 as const;
export const EXECUTION_RUNTIME_HEARTBEAT_TTL_MS_V1 = 30_000;

export type ExecutionRuntimeMappingOptionsV1 = {
  /** Injectable clock used by deterministic tests and snapshot callers. */
  now?: Date;
  heartbeatTtlMs?: number;
};

export type ExecutionRuntimeJsonValueV1 =
  | boolean
  | number
  | string
  | null
  | readonly ExecutionRuntimeJsonValueV1[]
  | { readonly [key: string]: ExecutionRuntimeJsonValueV1 };

export type ExecutionRuntimeJsonObjectV1 = {
  readonly [key: string]: ExecutionRuntimeJsonValueV1;
};

/**
 * Raw shape returned by the ExecutionRuntime SQL queries. Number and boolean
 * unions account for SQLite driver representations without weakening the
 * public DTO.
 */
export type ExecutionRuntimeRow = {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  driver: string;
  version: string | null;
  endpoint: string | null;
  enabled: boolean | number | bigint;
  registrationJson: string;
  capabilitiesJson: string;
  healthStatus: string;
  healthJson: string;
  lastHeartbeatAt: Date | string | null;
  capacityTotal: number | bigint;
  capacityUsed: number | bigint;
  capacityJson: string;
  capacityUpdatedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

/**
 * Organization-scoped control-plane projection. `runtimeId` is always the
 * database primary key used by ExecutionJob and ExecutionAttempt foreign
 * keys. `key` remains a separate, human-readable organization-local label.
 */
export type ExecutionRuntimeV1 = {
  schemaVersion: typeof EXECUTION_RUNTIME_DTO_VERSION_V1;
  runtimeId: string;
  organizationId: string;
  key: string;
  name: string;
  driver: string;
  version: string | null;
  endpoint: string | null;
  enabled: boolean;
  registration: ExecutionRuntimeJsonObjectV1;
  capabilities: RuntimeCapabilitiesV1 | null;
  health: RuntimeCandidateV1['health'];
  lastHeartbeatAt: string | null;
  capacity: RuntimeCandidateV1['capacity'];
  capacityDetails: ExecutionRuntimeJsonObjectV1;
  capacityUpdatedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

const EXECUTION_KINDS: readonly RuntimeExecutionKindV1[] = [
  'coding',
  'research',
  'browser',
  'document',
  'workflow',
];
const STREAMING_LEVELS: readonly RuntimeStreamingV1[] = [
  'none',
  'text',
  'typed-events',
];
const INTERRUPT_LEVELS: readonly RuntimeInterruptV1[] = [
  'none',
  'process-kill',
  'graceful',
];
const WORKSPACE_LEVELS: readonly RuntimeWorkspaceV1[] = [
  'none',
  'directory',
  'git-worktree',
];
const SANDBOX_KINDS: readonly RuntimeSandboxV1[] = [
  'host',
  'container',
  'vm',
  'remote',
];
const HEALTH_STATES: readonly RuntimeHealthStateV1[] = [
  'healthy',
  'degraded',
  'unhealthy',
  'offline',
];

export function mapExecutionRuntimeV1(
  row: ExecutionRuntimeRow,
  options: ExecutionRuntimeMappingOptionsV1 = {}
): ExecutionRuntimeV1 {
  const enabled = normalizeBoolean(row.enabled);
  const registration = parseJsonObject(row.registrationJson);
  const capabilities = parseRuntimeCapabilitiesJsonV1(
    row.capabilitiesJson
  );
  const healthDetails = parseJsonObject(row.healthJson);
  const capacityDetails = parseJsonObject(row.capacityJson);
  const lastHeartbeatAt = toIsoString(row.lastHeartbeatAt);
  const capacityTotal = toNonNegativeSafeInteger(row.capacityTotal);
  const capacityUsed = toNonNegativeSafeInteger(row.capacityUsed);
  const capacityColumnsValid =
    capacityTotal !== null && capacityUsed !== null;
  const heartbeatFresh = isHeartbeatFresh(lastHeartbeatAt, options);
  const effectivelyOnline = enabled && heartbeatFresh;
  const observedAt = readObservedAt(healthDetails, lastHeartbeatAt);
  const healthMessage = readNonEmptyString(healthDetails.message);

  return {
    schemaVersion: EXECUTION_RUNTIME_DTO_VERSION_V1,
    runtimeId: row.id,
    organizationId: row.organizationId,
    key: row.key,
    name: row.name,
    driver: row.driver,
    version: normalizeOptionalString(row.version),
    endpoint: normalizeOptionalString(row.endpoint),
    enabled,
    registration,
    capabilities,
    health: {
      state: effectivelyOnline
        ? normalizeHealthState(row.healthStatus)
        : 'offline',
      acceptingNewAttempts:
        effectivelyOnline && healthDetails.acceptingNewAttempts === true,
      ...(observedAt ? { observedAt } : {}),
      ...(healthMessage ? { message: healthMessage } : {}),
    },
    lastHeartbeatAt,
    capacity: {
      availableSlots: capacityColumnsValid
        ? effectivelyOnline
          ? Math.max(0, capacityTotal - capacityUsed)
          : 0
        : 0,
      activeAttempts: capacityUsed ?? 0,
      maxConcurrentAttempts: capacityTotal ?? 0,
    },
    capacityDetails,
    capacityUpdatedAt: toIsoString(row.capacityUpdatedAt),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

/**
 * Builds the immutable matcher snapshot from database-backed facts. Invalid
 * capabilities fail closed, invalid capacity yields zero slots, and a
 * disabled runtime is forced offline even if stale health JSON says otherwise.
 */
export function mapExecutionRuntimeCandidateV1(
  row: ExecutionRuntimeRow,
  options: ExecutionRuntimeMappingOptionsV1 = {}
): RuntimeCandidateV1 {
  const runtime = mapExecutionRuntimeV1(row, options);
  const selectionPriority = readFiniteNumber(
    runtime.registration.selectionPriority
  );

  return {
    descriptor: {
      schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
      runtimeId: runtime.runtimeId,
      displayName:
        readNonEmptyString(runtime.name) ||
        readNonEmptyString(runtime.key) ||
        runtime.runtimeId,
      runtimeVersion: runtime.version || 'unknown',
      capabilities: runtime.capabilities || createDenyAllCapabilitiesV1(),
      ...(selectionPriority === null ? {} : { selectionPriority }),
    },
    health: runtime.enabled
      ? runtime.health
      : {
          ...runtime.health,
          state: 'offline',
          acceptingNewAttempts: false,
        },
    capacity: runtime.enabled
      ? runtime.capacity
      : {
          ...runtime.capacity,
          availableSlots: 0,
        },
  };
}

function isHeartbeatFresh(
  lastHeartbeatAt: string | null,
  options: ExecutionRuntimeMappingOptionsV1
): boolean {
  if (!lastHeartbeatAt) return false;
  const heartbeatMs = new Date(lastHeartbeatAt).valueOf();
  const nowMs = (options.now ?? new Date()).valueOf();
  const ttlMs =
    options.heartbeatTtlMs ?? EXECUTION_RUNTIME_HEARTBEAT_TTL_MS_V1;
  if (
    Number.isNaN(heartbeatMs) ||
    Number.isNaN(nowMs) ||
    !Number.isFinite(ttlMs) ||
    ttlMs < 0
  ) {
    return false;
  }
  return nowMs - heartbeatMs <= ttlMs;
}

export function parseRuntimeCapabilitiesJsonV1(
  raw: string | null | undefined
): RuntimeCapabilitiesV1 | null {
  const value = safeJsonParse<unknown>(raw, null);
  if (!isRecord(value)) {
    return null;
  }

  const kinds = readEnumArray(value.kinds, EXECUTION_KINDS);
  const supportedModels = readStringArray(value.supportedModels);
  const features =
    value.features === undefined ? undefined : readStringArray(value.features);

  if (
    value.schemaVersion !== RUNTIME_CONTRACT_VERSION_V1 ||
    kinds === null ||
    typeof value.nativeResume !== 'boolean' ||
    typeof value.checkpoint !== 'boolean' ||
    !isEnumValue(value.streaming, STREAMING_LEVELS) ||
    !isEnumValue(value.interrupt, INTERRUPT_LEVELS) ||
    !isEnumValue(value.workspace, WORKSPACE_LEVELS) ||
    !isEnumValue(value.sandbox, SANDBOX_KINDS) ||
    typeof value.structuredArtifacts !== 'boolean' ||
    typeof value.waitingForHuman !== 'boolean' ||
    (value.waitingForHuman === true && value.nativeResume !== true) ||
    supportedModels === null ||
    features === null
  ) {
    return null;
  }

  return {
    schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
    kinds,
    nativeResume: value.nativeResume,
    checkpoint: value.checkpoint,
    streaming: value.streaming,
    interrupt: value.interrupt,
    workspace: value.workspace,
    sandbox: value.sandbox,
    structuredArtifacts: value.structuredArtifacts,
    waitingForHuman: value.waitingForHuman,
    supportedModels,
    ...(features ? { features } : {}),
  };
}

function createDenyAllCapabilitiesV1(): RuntimeCapabilitiesV1 {
  return {
    schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
    kinds: [],
    nativeResume: false,
    checkpoint: false,
    streaming: 'none',
    interrupt: 'none',
    workspace: 'none',
    sandbox: 'remote',
    structuredArtifacts: false,
    waitingForHuman: false,
    supportedModels: [],
  };
}

function parseJsonObject(raw: string): ExecutionRuntimeJsonObjectV1 {
  const value = safeJsonParse<unknown>(raw, null);
  return isRecord(value) && isExecutionRuntimeJsonValue(value)
    ? value
    : {};
}

function isExecutionRuntimeJsonValue(
  value: unknown
): value is ExecutionRuntimeJsonValueV1 {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isExecutionRuntimeJsonValue);
  }
  return (
    isRecord(value) &&
    Object.values(value).every(isExecutionRuntimeJsonValue)
  );
}

function normalizeBoolean(value: boolean | number | bigint): boolean {
  return (
    value === true ||
    value === 1 ||
    (typeof value === 'bigint' && value.toString() === '1')
  );
}

function toNonNegativeSafeInteger(
  value: number | bigint
): number | null {
  const normalized = typeof value === 'bigint' ? Number(value) : value;
  return Number.isSafeInteger(normalized) && normalized >= 0
    ? normalized
    : null;
}

function normalizeOptionalString(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function normalizeHealthState(value: string): RuntimeHealthStateV1 {
  return isEnumValue(value, HEALTH_STATES) ? value : 'offline';
}

function readObservedAt(
  healthDetails: ExecutionRuntimeJsonObjectV1,
  fallback: string | null
): string | undefined {
  return toIsoString(
    typeof healthDetails.observedAt === 'string'
      ? healthDetails.observedAt
      : null
  ) || fallback || undefined;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): readonly string[] | null {
  if (
    !Array.isArray(value) ||
    !value.every(
      (entry) =>
        typeof entry === 'string' &&
        entry.length > 0 &&
        entry.trim() === entry
    )
  ) {
    return null;
  }
  return [...value];
}

function readEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[]
): readonly T[] | null {
  if (!Array.isArray(value) || !value.every((entry) => isEnumValue(entry, allowed))) {
    return null;
  }
  return [...value];
}

function isEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[]
): value is T {
  return typeof value === 'string' && allowed.some((entry) => entry === value);
}

function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}
