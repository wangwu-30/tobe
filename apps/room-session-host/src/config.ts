import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { isRecord, safeJsonParse } from '@/framework/resilience/safe-data';

export const ROOM_SESSION_HOST_CONFIG_SCHEMA_VERSION_V1 = 1 as const;
export const ROOM_SESSION_HOST_CONFIG_PATH_ENV =
  'DAO_ROOM_SESSION_HOST_CONFIG_PATH' as const;
export const ROOM_SESSION_HOST_DEFAULT_SHUTDOWN_GRACE_MS_V1 = 15_000;
export const ROOM_SESSION_HOST_MAX_DURATION_MS_V1 = 60 * 60_000;

export type StubRoomSessionHostRuntimeConfigV1 = {
  driver: 'stub';
  runtimeId: string;
  runtimeVersion: string;
  responseText: string;
};

export type PiRoomSessionHostRuntimeConfigV1 = {
  driver: 'pi-agent-core';
  runtimeId: 'pi-agent-core';
  runtimeVersion: string;
  providerId: string;
  modelId: string;
  systemPrompt: string;
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
};

export type RoomSessionHostRuntimeConfigV1 =
  | StubRoomSessionHostRuntimeConfigV1
  | PiRoomSessionHostRuntimeConfigV1;

export type RoomSessionHostConfigV1 = {
  schemaVersion: typeof ROOM_SESSION_HOST_CONFIG_SCHEMA_VERSION_V1;
  organizationId: string;
  workerId: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  leaseDurationMs: number;
  shutdownGraceMs: number;
  maxConcurrentSessions: number;
  maxDeliveryAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  runtimes: readonly RoomSessionHostRuntimeConfigV1[];
};

export type RoomSessionHostConfigErrorCodeV1 =
  | 'missing-config-path'
  | 'invalid-config-path'
  | 'config-read-failed'
  | 'invalid-json'
  | 'unsupported-schema-version'
  | 'invalid-config';

export class RoomSessionHostConfigErrorV1 extends Error {
  readonly code: RoomSessionHostConfigErrorCodeV1;
  readonly path?: string;

  constructor(
    code: RoomSessionHostConfigErrorCodeV1,
    message: string,
    fieldPath?: string
  ) {
    super(message);
    this.name = 'RoomSessionHostConfigErrorV1';
    this.code = code;
    this.path = fieldPath;
  }
}

export type LoadRoomSessionHostConfigOptionsV1 = {
  environment?: Readonly<Record<string, string | undefined>>;
  readTrustedFile?: (path: string, encoding: 'utf8') => Promise<string>;
};

const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'organizationId',
  'workerId',
  'pollIntervalMs',
  'heartbeatIntervalMs',
  'leaseDurationMs',
  'shutdownGraceMs',
  'maxConcurrentSessions',
  'maxDeliveryAttempts',
  'retryBaseDelayMs',
  'retryMaxDelayMs',
  'runtimes',
] as const;
const STUB_RUNTIME_KEYS = [
  'driver',
  'runtimeId',
  'runtimeVersion',
  'responseText',
] as const;
const PI_RUNTIME_KEYS = [
  'driver',
  'runtimeId',
  'runtimeVersion',
  'providerId',
  'modelId',
  'systemPrompt',
  'thinkingLevel',
] as const;
const PI_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const;
const INVALID_JSON = Symbol('invalid-room-session-host-json');

export async function loadRoomSessionHostConfigV1(
  options: LoadRoomSessionHostConfigOptionsV1 = {}
): Promise<RoomSessionHostConfigV1> {
  const environment = options.environment ?? process.env;
  const configuredPath = environment[ROOM_SESSION_HOST_CONFIG_PATH_ENV];
  if (typeof configuredPath !== 'string' || !configuredPath.trim()) {
    throw new RoomSessionHostConfigErrorV1(
      'missing-config-path',
      `${ROOM_SESSION_HOST_CONFIG_PATH_ENV} must name a trusted configuration file.`
    );
  }
  if (!path.isAbsolute(configuredPath)) {
    throw new RoomSessionHostConfigErrorV1(
      'invalid-config-path',
      `${ROOM_SESSION_HOST_CONFIG_PATH_ENV} must be an absolute path.`
    );
  }

  let raw: string;
  try {
    raw = await (options.readTrustedFile ?? readFile)(configuredPath, 'utf8');
  } catch {
    throw new RoomSessionHostConfigErrorV1(
      'config-read-failed',
      'The trusted Room Session Host configuration file could not be read.'
    );
  }
  const parsed = safeJsonParse<unknown | typeof INVALID_JSON>(
    raw,
    INVALID_JSON
  );
  if (parsed === INVALID_JSON) {
    throw new RoomSessionHostConfigErrorV1(
      'invalid-json',
      'The Room Session Host configuration file is not valid JSON.'
    );
  }
  return parseRoomSessionHostConfigV1(parsed);
}

export function parseRoomSessionHostConfigV1(
  value: unknown
): RoomSessionHostConfigV1 {
  const record = exactRecord(value, '', TOP_LEVEL_KEYS);
  if (record.schemaVersion !== ROOM_SESSION_HOST_CONFIG_SCHEMA_VERSION_V1) {
    throw new RoomSessionHostConfigErrorV1(
      'unsupported-schema-version',
      'Room Session Host configuration must use schemaVersion 1.',
      'schemaVersion'
    );
  }
  const leaseDurationMs = positiveInteger(
    record.leaseDurationMs,
    'leaseDurationMs'
  );
  const heartbeatIntervalMs = positiveInteger(
    record.heartbeatIntervalMs,
    'heartbeatIntervalMs'
  );
  if (heartbeatIntervalMs * 3 > leaseDurationMs) {
    invalid(
      'heartbeatIntervalMs',
      'heartbeatIntervalMs must be no greater than one third of leaseDurationMs.'
    );
  }
  const retryBaseDelayMs = positiveInteger(
    record.retryBaseDelayMs,
    'retryBaseDelayMs'
  );
  const retryMaxDelayMs = positiveInteger(
    record.retryMaxDelayMs,
    'retryMaxDelayMs'
  );
  if (retryBaseDelayMs > retryMaxDelayMs) {
    invalid(
      'retryBaseDelayMs',
      'retryBaseDelayMs must not exceed retryMaxDelayMs.'
    );
  }
  if (!Array.isArray(record.runtimes) || record.runtimes.length === 0) {
    invalid('runtimes', 'runtimes must be a non-empty array.');
  }
  const runtimes = record.runtimes.map((runtime, index) =>
    parseRuntime(runtime, `runtimes[${index}]`)
  );
  const runtimeIds = new Set<string>();
  for (let index = 0; index < runtimes.length; index += 1) {
    const runtimeId = runtimes[index].runtimeId;
    if (runtimeIds.has(runtimeId)) {
      invalid(
        `runtimes[${index}].runtimeId`,
        'runtimeId values must be unique.'
      );
    }
    runtimeIds.add(runtimeId);
  }

  return {
    schemaVersion: ROOM_SESSION_HOST_CONFIG_SCHEMA_VERSION_V1,
    organizationId: nonEmptyString(record.organizationId, 'organizationId'),
    workerId: nonEmptyString(record.workerId, 'workerId'),
    pollIntervalMs: positiveInteger(record.pollIntervalMs, 'pollIntervalMs'),
    heartbeatIntervalMs,
    leaseDurationMs,
    shutdownGraceMs: positiveInteger(
      record.shutdownGraceMs ?? ROOM_SESSION_HOST_DEFAULT_SHUTDOWN_GRACE_MS_V1,
      'shutdownGraceMs'
    ),
    maxConcurrentSessions: positiveInteger(
      record.maxConcurrentSessions,
      'maxConcurrentSessions'
    ),
    maxDeliveryAttempts: positiveInteger(
      record.maxDeliveryAttempts,
      'maxDeliveryAttempts'
    ),
    retryBaseDelayMs,
    retryMaxDelayMs,
    runtimes,
  };
}

function parseRuntime(
  value: unknown,
  basePath: string
): RoomSessionHostRuntimeConfigV1 {
  if (!isRecord(value)) {
    invalid(basePath, 'must be an object.');
  }
  if (value.driver === 'stub') return parseStubRuntime(value, basePath);
  if (value.driver === 'pi-agent-core') return parsePiRuntime(value, basePath);
  invalid(`${basePath}.driver`, 'must be stub or pi-agent-core.');
}

function parseStubRuntime(
  value: unknown,
  basePath: string
): StubRoomSessionHostRuntimeConfigV1 {
  const record = exactRecord(value, basePath, STUB_RUNTIME_KEYS);
  if (record.driver !== 'stub') {
    invalid(`${basePath}.driver`, 'driver must be stub.');
  }
  const runtimeId = nonEmptyString(record.runtimeId, `${basePath}.runtimeId`);
  if (runtimeId === 'pi-agent-core') {
    invalid(
      `${basePath}.runtimeId`,
      'stub runtimes must not impersonate pi-agent-core.'
    );
  }
  return {
    driver: 'stub',
    runtimeId,
    runtimeVersion: nonEmptyString(
      record.runtimeVersion,
      `${basePath}.runtimeVersion`
    ),
    responseText: nonEmptyString(
      record.responseText,
      `${basePath}.responseText`
    ),
  };
}

function parsePiRuntime(
  value: unknown,
  basePath: string
): PiRoomSessionHostRuntimeConfigV1 {
  const record = exactRecord(value, basePath, PI_RUNTIME_KEYS);
  if (record.driver !== 'pi-agent-core') {
    invalid(`${basePath}.driver`, 'driver must be pi-agent-core.');
  }
  if (record.runtimeId !== 'pi-agent-core') {
    invalid(
      `${basePath}.runtimeId`,
      'pi-agent-core driver must use runtimeId pi-agent-core.'
    );
  }
  const thinkingLevel = record.thinkingLevel;
  if (
    thinkingLevel !== undefined &&
    !PI_THINKING_LEVELS.includes(thinkingLevel as never)
  ) {
    invalid(`${basePath}.thinkingLevel`, 'is not supported.');
  }
  return {
    driver: 'pi-agent-core',
    runtimeId: 'pi-agent-core',
    runtimeVersion: nonEmptyString(
      record.runtimeVersion,
      `${basePath}.runtimeVersion`
    ),
    providerId: nonEmptyString(record.providerId, `${basePath}.providerId`),
    modelId: nonEmptyString(record.modelId, `${basePath}.modelId`),
    systemPrompt: nonEmptyString(
      record.systemPrompt,
      `${basePath}.systemPrompt`
    ),
    ...(thinkingLevel === undefined
      ? {}
      : { thinkingLevel: thinkingLevel as PiRoomSessionHostRuntimeConfigV1['thinkingLevel'] }),
  };
}

function exactRecord(
  value: unknown,
  fieldPath: string,
  keys: readonly string[]
): Record<string, unknown> {
  if (!isRecord(value)) {
    invalid(fieldPath || 'config', 'must be an object.');
  }
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length > 0) {
    invalid(
      fieldPath ? `${fieldPath}.${unknown[0]}` : unknown[0],
      'unknown configuration field.'
    );
  }
  return value;
}

function nonEmptyString(value: unknown, fieldPath: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    invalid(fieldPath, 'must be a non-empty string.');
  }
  return value;
}

function positiveInteger(value: unknown, fieldPath: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > ROOM_SESSION_HOST_MAX_DURATION_MS_V1
  ) {
    invalid(fieldPath, 'must be a positive safe integer within bounds.');
  }
  return value;
}

function invalid(fieldPath: string, message: string): never {
  throw new RoomSessionHostConfigErrorV1(
    'invalid-config',
    `${fieldPath} ${message}`,
    fieldPath
  );
}
