import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';

import { isRecord, safeJsonParse } from '@/framework/resilience/safe-data';

export const EXECUTION_DAEMON_CONFIG_SCHEMA_VERSION_V1 = 1 as const;
export const EXECUTION_DAEMON_CONFIG_PATH_ENV =
  'DAO_EXECUTION_DAEMON_CONFIG_PATH' as const;
export const EXECUTION_DAEMON_MIN_LEASE_DURATION_MS_V1 = 1_000;
export const EXECUTION_DAEMON_MAX_LEASE_DURATION_MS_V1 = 60 * 60_000;
export const EXECUTION_DAEMON_DEFAULT_SHUTDOWN_GRACE_MS_V1 = 15_000;

export type GitWorktreeDaemonConfigV1 = {
  enabled: true;
  managedRoot: string;
  commitAuthor: {
    name: string;
    email: string;
  };
};

export type GenericCliDaemonRuntimeConfigV1 = {
  driver: 'generic-cli';
  runtimeId: string;
  runtimeVersion: string;
  executable: string;
  args: readonly string[];
  cwd: string;
  /** Names only. Values are copied from the daemon environment at startup. */
  envAllowlist: readonly string[];
  capacityTotal: number;
  timeoutMs?: number;
  interruptGracePeriodMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  supportedModels?: readonly string[];
  features?: readonly string[];
  selectionPriority?: number;
  worktree?: GitWorktreeDaemonConfigV1;
};

export type ExternalModuleDaemonRuntimeConfigV1 = {
  driver: 'external-module';
  runtimeId: string;
  contractVersion: 1;
  /** Trusted deployment-owned absolute module path. */
  modulePath: string;
  /** Explicit ESM export name; use `default` for the default export. */
  exportName: string;
  /** Names only. Values are copied from the daemon environment at startup. */
  envAllowlist: readonly string[];
  capacityTotal: number;
  worktree?: GitWorktreeDaemonConfigV1;
};

export type ExecutionDaemonRuntimeConfigV1 =
  | GenericCliDaemonRuntimeConfigV1
  | ExternalModuleDaemonRuntimeConfigV1;

export type ExecutionDaemonConfigV1 = {
  schemaVersion: typeof EXECUTION_DAEMON_CONFIG_SCHEMA_VERSION_V1;
  organizationId: string;
  workerId: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  leaseDurationMs: number;
  shutdownGraceMs: number;
  runtimes: readonly ExecutionDaemonRuntimeConfigV1[];
};

export type ExecutionDaemonConfigErrorCodeV1 =
  | 'missing-config-path'
  | 'invalid-config-path'
  | 'config-read-failed'
  | 'invalid-json'
  | 'unsupported-schema-version'
  | 'invalid-config';

export class ExecutionDaemonConfigErrorV1 extends Error {
  readonly code: ExecutionDaemonConfigErrorCodeV1;
  readonly path?: string;

  constructor(
    code: ExecutionDaemonConfigErrorCodeV1,
    message: string,
    path?: string
  ) {
    super(message);
    this.name = 'ExecutionDaemonConfigErrorV1';
    this.code = code;
    this.path = path;
  }
}

export type LoadExecutionDaemonConfigOptionsV1 = {
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
  'runtimes',
] as const;

const GENERIC_CLI_RUNTIME_KEYS = [
  'driver',
  'runtimeId',
  'runtimeVersion',
  'executable',
  'args',
  'cwd',
  'envAllowlist',
  'capacityTotal',
  'timeoutMs',
  'interruptGracePeriodMs',
  'maxStdoutBytes',
  'maxStderrBytes',
  'supportedModels',
  'features',
  'selectionPriority',
  'worktree',
] as const;

const EXTERNAL_MODULE_RUNTIME_KEYS = [
  'driver',
  'runtimeId',
  'contractVersion',
  'modulePath',
  'exportName',
  'envAllowlist',
  'capacityTotal',
  'worktree',
] as const;

const GIT_WORKTREE_KEYS = [
  'enabled',
  'managedRoot',
  'commitAuthor',
] as const;
const COMMIT_AUTHOR_KEYS = ['name', 'email'] as const;
const INVALID_JSON = Symbol('invalid-execution-daemon-json');
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MODULE_EXPORT_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Loads the daemon configuration only from the trusted file named by the
 * process environment. Inline JSON and relative paths are deliberately not
 * accepted at this boundary.
 */
export async function loadExecutionDaemonConfigV1(
  options: LoadExecutionDaemonConfigOptionsV1 = {}
): Promise<ExecutionDaemonConfigV1> {
  const environment = options.environment ?? process.env;
  const configuredPath = environment[EXECUTION_DAEMON_CONFIG_PATH_ENV];
  if (typeof configuredPath !== 'string' || !configuredPath.trim()) {
    throw new ExecutionDaemonConfigErrorV1(
      'missing-config-path',
      `${EXECUTION_DAEMON_CONFIG_PATH_ENV} must name a trusted configuration file.`
    );
  }
  if (!nodePath.isAbsolute(configuredPath)) {
    throw new ExecutionDaemonConfigErrorV1(
      'invalid-config-path',
      `${EXECUTION_DAEMON_CONFIG_PATH_ENV} must be an absolute path.`
    );
  }

  let raw: string;
  try {
    raw = await (options.readTrustedFile ?? readFile)(configuredPath, 'utf8');
  } catch {
    throw new ExecutionDaemonConfigErrorV1(
      'config-read-failed',
      'The trusted execution daemon configuration file could not be read.'
    );
  }

  const parsed = safeJsonParse<unknown | typeof INVALID_JSON>(raw, INVALID_JSON);
  if (parsed === INVALID_JSON) {
    throw new ExecutionDaemonConfigErrorV1(
      'invalid-json',
      'The execution daemon configuration file is not valid JSON.'
    );
  }
  return parseExecutionDaemonConfigV1(parsed);
}

export function parseExecutionDaemonConfigV1(
  value: unknown
): ExecutionDaemonConfigV1 {
  const record = exactRecord(value, '', TOP_LEVEL_KEYS);
  const schemaVersion = requiredField(record, 'schemaVersion', 'schemaVersion');
  if (schemaVersion !== EXECUTION_DAEMON_CONFIG_SCHEMA_VERSION_V1) {
    throw new ExecutionDaemonConfigErrorV1(
      'unsupported-schema-version',
      'Execution daemon configuration must use schemaVersion 1.',
      'schemaVersion'
    );
  }

  const leaseDurationMs = safeInteger(
    requiredField(record, 'leaseDurationMs', 'leaseDurationMs'),
    'leaseDurationMs',
    EXECUTION_DAEMON_MIN_LEASE_DURATION_MS_V1,
    EXECUTION_DAEMON_MAX_LEASE_DURATION_MS_V1
  );
  const heartbeatIntervalMs = safeInteger(
    requiredField(record, 'heartbeatIntervalMs', 'heartbeatIntervalMs'),
    'heartbeatIntervalMs',
    1,
    EXECUTION_DAEMON_MAX_LEASE_DURATION_MS_V1
  );
  if (heartbeatIntervalMs * 3 > leaseDurationMs) {
    invalid(
      'heartbeatIntervalMs',
      'heartbeatIntervalMs must be no greater than one third of leaseDurationMs.'
    );
  }

  const runtimeValues = requiredField(record, 'runtimes', 'runtimes');
  if (!Array.isArray(runtimeValues) || runtimeValues.length === 0) {
    invalid('runtimes', 'runtimes must be a non-empty array.');
  }
  const runtimes = runtimeValues.map((runtime, index) =>
    parseRuntime(runtime, `runtimes[${index}]`)
  );
  const seenRuntimeIds = new Set<string>();
  for (let index = 0; index < runtimes.length; index += 1) {
    const runtimeId = runtimes[index].runtimeId;
    if (seenRuntimeIds.has(runtimeId)) {
      invalid(
        `runtimes[${index}].runtimeId`,
        'runtimeId values must be unique within one daemon configuration.'
      );
    }
    seenRuntimeIds.add(runtimeId);
  }

  return {
    schemaVersion: EXECUTION_DAEMON_CONFIG_SCHEMA_VERSION_V1,
    organizationId: nonEmptyString(
      requiredField(record, 'organizationId', 'organizationId'),
      'organizationId'
    ),
    workerId: nonEmptyString(
      requiredField(record, 'workerId', 'workerId'),
      'workerId'
    ),
    pollIntervalMs: safeInteger(
      requiredField(record, 'pollIntervalMs', 'pollIntervalMs'),
      'pollIntervalMs',
      1,
      EXECUTION_DAEMON_MAX_LEASE_DURATION_MS_V1
    ),
    heartbeatIntervalMs,
    leaseDurationMs,
    shutdownGraceMs: safeInteger(
      Object.prototype.hasOwnProperty.call(record, 'shutdownGraceMs')
        ? record.shutdownGraceMs
        : EXECUTION_DAEMON_DEFAULT_SHUTDOWN_GRACE_MS_V1,
      'shutdownGraceMs',
      1,
      EXECUTION_DAEMON_MAX_LEASE_DURATION_MS_V1
    ),
    runtimes,
  };
}

/** Resolves only allowlisted names and never supplies the full parent env. */
export function resolveExecutionDaemonRuntimeEnvironmentV1(
  runtime: Pick<ExecutionDaemonRuntimeConfigV1, 'envAllowlist'>,
  environment: Readonly<Record<string, string | undefined>> = process.env
): Record<string, string> {
  return Object.fromEntries(
    runtime.envAllowlist.flatMap((name) => {
      if (!Object.prototype.hasOwnProperty.call(environment, name)) {
        return [];
      }
      const value = environment[name];
      return typeof value === 'string' ? [[name, value]] : [];
    })
  );
}

function parseRuntime(
  value: unknown,
  basePath: string
): ExecutionDaemonRuntimeConfigV1 {
  if (!isRecord(value)) {
    invalid(basePath, `${basePath} must be an object.`);
  }
  const driver = requiredField(value, 'driver', `${basePath}.driver`);
  if (driver === 'generic-cli') {
    return parseGenericCliRuntime(value, basePath);
  }
  if (driver === 'external-module') {
    return parseExternalModuleRuntime(value, basePath);
  }
  invalid(
    `${basePath}.driver`,
    'driver must be generic-cli or external-module.'
  );
}

function parseGenericCliRuntime(
  value: unknown,
  basePath: string
): GenericCliDaemonRuntimeConfigV1 {
  const record = exactRecord(value, basePath, GENERIC_CLI_RUNTIME_KEYS);
  if (requiredField(record, 'driver', `${basePath}.driver`) !== 'generic-cli') {
    invalid(`${basePath}.driver`, 'driver must be generic-cli.');
  }

  const executable = absolutePath(
    requiredField(record, 'executable', `${basePath}.executable`),
    `${basePath}.executable`
  );
  const cwd = absolutePath(
    requiredField(record, 'cwd', `${basePath}.cwd`),
    `${basePath}.cwd`
  );
  const args = stringArray(
    requiredField(record, 'args', `${basePath}.args`),
    `${basePath}.args`,
    { allowEmpty: true, unique: false }
  );
  const envAllowlist = environmentAllowlist(
    requiredField(record, 'envAllowlist', `${basePath}.envAllowlist`),
    `${basePath}.envAllowlist`
  );

  return {
    driver: 'generic-cli',
    runtimeId: nonEmptyString(
      requiredField(record, 'runtimeId', `${basePath}.runtimeId`),
      `${basePath}.runtimeId`
    ),
    runtimeVersion: nonEmptyString(
      requiredField(record, 'runtimeVersion', `${basePath}.runtimeVersion`),
      `${basePath}.runtimeVersion`
    ),
    executable,
    args,
    cwd,
    envAllowlist,
    capacityTotal: safeInteger(
      requiredField(record, 'capacityTotal', `${basePath}.capacityTotal`),
      `${basePath}.capacityTotal`,
      1,
      Number.MAX_SAFE_INTEGER
    ),
    ...optionalPositiveInteger(record, 'timeoutMs', basePath),
    ...optionalPositiveInteger(record, 'interruptGracePeriodMs', basePath),
    ...optionalPositiveInteger(record, 'maxStdoutBytes', basePath),
    ...optionalPositiveInteger(record, 'maxStderrBytes', basePath),
    ...optionalStringArray(record, 'supportedModels', basePath),
    ...optionalStringArray(record, 'features', basePath),
    ...optionalFiniteNumber(record, 'selectionPriority', basePath),
    ...optionalWorktree(record, basePath),
  };
}

function parseExternalModuleRuntime(
  value: unknown,
  basePath: string
): ExternalModuleDaemonRuntimeConfigV1 {
  const record = exactRecord(value, basePath, EXTERNAL_MODULE_RUNTIME_KEYS);
  if (requiredField(record, 'driver', `${basePath}.driver`) !== 'external-module') {
    invalid(`${basePath}.driver`, 'driver must be external-module.');
  }
  const contractVersion = requiredField(
    record,
    'contractVersion',
    `${basePath}.contractVersion`
  );
  if (contractVersion !== 1) {
    invalid(
      `${basePath}.contractVersion`,
      `${basePath}.contractVersion must be 1.`
    );
  }
  const exportName = nonEmptyString(
    requiredField(record, 'exportName', `${basePath}.exportName`),
    `${basePath}.exportName`
  );
  if (exportName === 'then' || !MODULE_EXPORT_NAME.test(exportName)) {
    invalid(
      `${basePath}.exportName`,
      `${basePath}.exportName must be default or a JavaScript identifier.`
    );
  }

  return {
    driver: 'external-module',
    runtimeId: nonEmptyString(
      requiredField(record, 'runtimeId', `${basePath}.runtimeId`),
      `${basePath}.runtimeId`
    ),
    contractVersion: 1,
    modulePath: absolutePath(
      requiredField(record, 'modulePath', `${basePath}.modulePath`),
      `${basePath}.modulePath`
    ),
    exportName,
    envAllowlist: environmentAllowlist(
      requiredField(record, 'envAllowlist', `${basePath}.envAllowlist`),
      `${basePath}.envAllowlist`
    ),
    capacityTotal: safeInteger(
      requiredField(record, 'capacityTotal', `${basePath}.capacityTotal`),
      `${basePath}.capacityTotal`,
      1,
      Number.MAX_SAFE_INTEGER
    ),
    ...optionalWorktree(record, basePath),
  };
}

function optionalWorktree(
  record: Record<string, unknown>,
  basePath: string
): { worktree?: GitWorktreeDaemonConfigV1 } {
  if (!Object.prototype.hasOwnProperty.call(record, 'worktree')) {
    return {};
  }

  const worktreePath = `${basePath}.worktree`;
  const worktree = exactRecord(
    record.worktree,
    worktreePath,
    GIT_WORKTREE_KEYS
  );
  if (
    requiredField(worktree, 'enabled', `${worktreePath}.enabled`) !== true
  ) {
    invalid(`${worktreePath}.enabled`, `${worktreePath}.enabled must be true.`);
  }

  const authorPath = `${worktreePath}.commitAuthor`;
  const author = exactRecord(
    requiredField(worktree, 'commitAuthor', authorPath),
    authorPath,
    COMMIT_AUTHOR_KEYS
  );

  return {
    worktree: {
      enabled: true,
      managedRoot: absolutePath(
        requiredField(worktree, 'managedRoot', `${worktreePath}.managedRoot`),
        `${worktreePath}.managedRoot`
      ),
      commitAuthor: {
        name: nonEmptyString(
          requiredField(author, 'name', `${authorPath}.name`),
          `${authorPath}.name`
        ),
        email: nonEmptyString(
          requiredField(author, 'email', `${authorPath}.email`),
          `${authorPath}.email`
        ),
      },
    },
  };
}

function exactRecord(
  value: unknown,
  basePath: string,
  allowedKeys: readonly string[]
): Record<string, unknown> {
  if (!isRecord(value)) {
    invalid(basePath || 'config', `${basePath || 'config'} must be an object.`);
  }
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      const fieldPath = basePath ? `${basePath}.${key}` : key;
      invalid(fieldPath, `Unknown configuration field ${fieldPath}.`);
    }
  }
  return value;
}

function requiredField(
  record: Record<string, unknown>,
  key: string,
  fieldPath: string
): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    invalid(fieldPath, `Missing required configuration field ${fieldPath}.`);
  }
  return record[key];
}

function nonEmptyString(value: unknown, fieldPath: string): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.trim() !== value ||
    value.includes('\0')
  ) {
    invalid(fieldPath, `${fieldPath} must be a non-empty, trimmed string.`);
  }
  return value;
}

function absolutePath(value: unknown, fieldPath: string): string {
  const parsed = nonEmptyString(value, fieldPath);
  if (!nodePath.isAbsolute(parsed)) {
    invalid(fieldPath, `${fieldPath} must be an absolute path.`);
  }
  return parsed;
}

function safeInteger(
  value: unknown,
  fieldPath: string,
  minimum: number,
  maximum: number
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalid(
      fieldPath,
      `${fieldPath} must be a safe integer from ${minimum} to ${maximum}.`
    );
  }
  return value;
}

function stringArray(
  value: unknown,
  fieldPath: string,
  options: { allowEmpty: boolean; unique: boolean }
): string[] {
  if (!Array.isArray(value)) {
    invalid(fieldPath, `${fieldPath} must be an array of strings.`);
  }
  const result = value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.includes('\0')) {
      invalid(`${fieldPath}[${index}]`, `${fieldPath} must contain strings.`);
    }
    if (!options.allowEmpty && (!entry || entry.trim() !== entry)) {
      invalid(
        `${fieldPath}[${index}]`,
        `${fieldPath} must contain non-empty, trimmed strings.`
      );
    }
    return entry;
  });
  if (options.unique && new Set(result).size !== result.length) {
    invalid(fieldPath, `${fieldPath} must not contain duplicate entries.`);
  }
  return result;
}

function environmentAllowlist(value: unknown, fieldPath: string): string[] {
  const names = stringArray(value, fieldPath, {
    allowEmpty: false,
    unique: true,
  });
  for (let index = 0; index < names.length; index += 1) {
    if (!ENVIRONMENT_NAME.test(names[index])) {
      invalid(
        `${fieldPath}[${index}]`,
        'Environment allowlist entries must be variable names without values.'
      );
    }
  }
  return names;
}

function optionalPositiveInteger(
  record: Record<string, unknown>,
  key:
    | 'timeoutMs'
    | 'interruptGracePeriodMs'
    | 'maxStdoutBytes'
    | 'maxStderrBytes',
  basePath: string
): Partial<Record<typeof key, number>> {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return {};
  return {
    [key]: safeInteger(
      record[key],
      `${basePath}.${key}`,
      1,
      Number.MAX_SAFE_INTEGER
    ),
  };
}

function optionalStringArray(
  record: Record<string, unknown>,
  key: 'supportedModels' | 'features',
  basePath: string
): Partial<Record<typeof key, string[]>> {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return {};
  return {
    [key]: stringArray(record[key], `${basePath}.${key}`, {
      allowEmpty: false,
      unique: true,
    }),
  };
}

function optionalFiniteNumber(
  record: Record<string, unknown>,
  key: 'selectionPriority',
  basePath: string
): Partial<Record<typeof key, number>> {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return {};
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(`${basePath}.${key}`, `${basePath}.${key} must be finite.`);
  }
  return { [key]: value };
}

function invalid(path: string, message: string): never {
  throw new ExecutionDaemonConfigErrorV1(
    'invalid-config',
    message,
    path
  );
}
