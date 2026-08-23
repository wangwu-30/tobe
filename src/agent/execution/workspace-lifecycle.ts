import nodePath from 'node:path';

import {
  type FinalizedGitWorktreeV1,
  type PreparedGitWorktreeV1,
} from '@/agent/knowledge/contracts';
import { isRecord, safeJsonParse } from '@/framework/resilience/safe-data';

export const WORKSPACE_LIFECYCLE_SCHEMA_VERSION_V1 = 1 as const;

export type WorkspaceLifecycleJsonValueV1 =
  | boolean
  | number
  | string
  | null
  | readonly WorkspaceLifecycleJsonValueV1[]
  | { readonly [key: string]: WorkspaceLifecycleJsonValueV1 };

/** Public, immutable knowledge identity frozen when the job is admitted. */
export type FrozenKnowledgeBindingV1 = {
  readonly schemaVersion: typeof WORKSPACE_LIFECYCLE_SCHEMA_VERSION_V1;
  readonly bindingId: string;
  readonly spaceId: string;
  readonly workspaceId: string;
  readonly agentId: string | null;
  readonly mountPath: '/';
  readonly defaultBranch: string;
  readonly baseCommit: string;
};

export type WorkspaceRuntimeCompletionV1 = {
  readonly status: 'succeeded' | 'failed' | 'cancelled';
  readonly result?: WorkspaceLifecycleJsonValueV1;
  readonly error?: WorkspaceLifecycleJsonValueV1;
  readonly runtimeRunId?: string;
};

/**
 * Private control-plane receipt. Repository and worktree paths must never be
 * copied from `prepared` into a public context manifest or runtime envelope.
 */
export type GitWorktreeWorkspaceLifecycleV1 = {
  readonly schemaVersion: typeof WORKSPACE_LIFECYCLE_SCHEMA_VERSION_V1;
  readonly kind: 'git-worktree';
  readonly binding: FrozenKnowledgeBindingV1;
  readonly prepared: PreparedGitWorktreeV1;
  readonly runtimeCompletion?: WorkspaceRuntimeCompletionV1;
  readonly finalized?: FinalizedGitWorktreeV1;
  readonly changeRequestId?: string;
  readonly cleanedAt?: string;
};

export type WorkspaceLifecycleV1 = GitWorktreeWorkspaceLifecycleV1;

export type WorkspaceLifecycleErrorCodeV1 =
  | 'invalid-json'
  | 'unsupported-schema-version'
  | 'invalid-lifecycle'
  | 'invalid-advance';

export class WorkspaceLifecycleErrorV1 extends Error {
  constructor(
    readonly code: WorkspaceLifecycleErrorCodeV1,
    message: string,
    readonly path?: string
  ) {
    super(message);
    this.name = 'WorkspaceLifecycleErrorV1';
  }
}

const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'kind',
  'binding',
  'prepared',
  'runtimeCompletion',
  'finalized',
  'changeRequestId',
  'cleanedAt',
] as const;
const BINDING_KEYS = [
  'schemaVersion',
  'bindingId',
  'spaceId',
  'workspaceId',
  'agentId',
  'mountPath',
  'defaultBranch',
  'baseCommit',
] as const;
const PREPARED_KEYS = [
  'schemaVersion',
  'spaceId',
  'mountPath',
  'repositoryPath',
  'worktreePath',
  'defaultBranch',
  'branch',
  'baseCommit',
  'jobId',
  'attemptId',
  'attemptNumber',
  'agentId',
] as const;
const RUNTIME_COMPLETION_KEYS = [
  'status',
  'result',
  'error',
  'runtimeRunId',
] as const;
const FINALIZED_KEYS = [
  'schemaVersion',
  'spaceId',
  'jobId',
  'attemptId',
  'agentId',
  'changed',
  'baseCommit',
  'headCommit',
  'branch',
  'files',
  'diffSummary',
  'patchSha256',
] as const;
const DIFF_SUMMARY_KEYS = [
  'filesChanged',
  'insertions',
  'deletions',
  'shortStat',
] as const;
const OPTIONAL_STAGES = [
  'runtimeCompletion',
  'finalized',
  'changeRequestId',
  'cleanedAt',
] as const;
const INVALID_JSON = Symbol('invalid-workspace-lifecycle-json');
const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** Strictly validates and deep-copies a V1 private lifecycle receipt. */
export function parseWorkspaceLifecycleV1(
  value: unknown
): WorkspaceLifecycleV1 {
  const record = exactRecord(value, 'lifecycle', TOP_LEVEL_KEYS);
  schemaVersion(record, 'lifecycle.schemaVersion');
  if (required(record, 'kind', 'lifecycle.kind') !== 'git-worktree') {
    invalid('lifecycle.kind', 'Workspace lifecycle kind must be git-worktree.');
  }

  const binding = parseBinding(
    required(record, 'binding', 'lifecycle.binding')
  );
  const prepared = parsePrepared(
    required(record, 'prepared', 'lifecycle.prepared')
  );
  assertPreparedAlignment(binding, prepared);

  const runtimeCompletion = has(record, 'runtimeCompletion')
    ? parseRuntimeCompletion(record.runtimeCompletion)
    : undefined;
  const finalized = has(record, 'finalized')
    ? parseFinalized(record.finalized)
    : undefined;
  if (finalized) {
    if (runtimeCompletion?.status !== 'succeeded') {
      invalid(
        'lifecycle.finalized',
        'A finalized workspace requires a succeeded runtime completion.'
      );
    }
    assertFinalizedAlignment(binding, prepared, finalized);
  }

  const changeRequestId = has(record, 'changeRequestId')
    ? text(record.changeRequestId, 'lifecycle.changeRequestId')
    : undefined;
  if (changeRequestId !== undefined && finalized?.changed !== true) {
    invalid(
      'lifecycle.changeRequestId',
      'A change request requires a changed finalized workspace.'
    );
  }
  const cleanedAt = has(record, 'cleanedAt')
    ? isoDate(record.cleanedAt, 'lifecycle.cleanedAt')
    : undefined;

  return {
    schemaVersion: WORKSPACE_LIFECYCLE_SCHEMA_VERSION_V1,
    kind: 'git-worktree',
    binding,
    prepared,
    ...(runtimeCompletion === undefined ? {} : { runtimeCompletion }),
    ...(finalized === undefined ? {} : { finalized }),
    ...(changeRequestId === undefined ? {} : { changeRequestId }),
    ...(cleanedAt === undefined ? {} : { cleanedAt }),
  };
}

/** Null represents an attempt for which no private workspace was prepared. */
export function parseStoredWorkspaceLifecycleV1(
  raw: string | null
): WorkspaceLifecycleV1 | null {
  if (raw === null) return null;
  const parsed = safeJsonParse<unknown | typeof INVALID_JSON>(raw, INVALID_JSON);
  if (parsed === INVALID_JSON) {
    throw new WorkspaceLifecycleErrorV1(
      'invalid-json',
      'Stored workspace lifecycle is not valid JSON.'
    );
  }
  return parseWorkspaceLifecycleV1(parsed);
}

/** Produces canonical JSON with fixed receipt keys and sorted JSON payload keys. */
export function serializeWorkspaceLifecycleV1(value: unknown): string {
  return JSON.stringify(parseWorkspaceLifecycleV1(value));
}

/**
 * Allows exact replay or one durable stage at a time. This deliberately does
 * not merge receipts: a caller must retry or persist each crash boundary.
 */
export function isWorkspaceLifecycleAdvanceV1(
  previous: WorkspaceLifecycleV1 | null,
  next: WorkspaceLifecycleV1
): boolean {
  try {
    assertWorkspaceLifecycleAdvanceV1(previous, next);
    return true;
  } catch {
    return false;
  }
}

export function assertWorkspaceLifecycleAdvanceV1(
  previous: WorkspaceLifecycleV1 | null,
  next: WorkspaceLifecycleV1
): void {
  const normalizedPrevious =
    previous === null ? null : parseWorkspaceLifecycleV1(previous);
  const normalizedNext = parseWorkspaceLifecycleV1(next);

  if (normalizedPrevious === null) {
    if (presentStages(normalizedNext).length === 0) return;
    invalidAdvance('The first workspace lifecycle write must contain only prepare state.');
  }
  if (sameJson(normalizedPrevious, normalizedNext)) return;
  if (
    !sameJson(normalizedPrevious.binding, normalizedNext.binding) ||
    !sameJson(normalizedPrevious.prepared, normalizedNext.prepared)
  ) {
    invalidAdvance('Workspace lifecycle identity and prepare state are immutable.');
  }

  for (const stage of OPTIONAL_STAGES) {
    if (
      has(normalizedPrevious, stage) &&
      (!has(normalizedNext, stage) ||
        !sameJson(normalizedPrevious[stage], normalizedNext[stage]))
    ) {
      invalidAdvance(`Workspace lifecycle stage ${stage} is immutable.`);
    }
  }
  const added = OPTIONAL_STAGES.filter(
    (stage) => !has(normalizedPrevious, stage) && has(normalizedNext, stage)
  );
  if (added.length !== 1 || added[0] !== nextStage(normalizedPrevious)) {
    invalidAdvance('Workspace lifecycle must add exactly its next durable stage.');
  }
}

function parseBinding(value: unknown): FrozenKnowledgeBindingV1 {
  const record = exactRecord(value, 'lifecycle.binding', BINDING_KEYS);
  schemaVersion(record, 'lifecycle.binding.schemaVersion');
  const mountPath = required(record, 'mountPath', 'lifecycle.binding.mountPath');
  if (mountPath !== '/') {
    invalid('lifecycle.binding.mountPath', 'V1 knowledge mounts must use /.');
  }
  const agentId = required(record, 'agentId', 'lifecycle.binding.agentId');
  if (agentId !== null && typeof agentId !== 'string') {
    invalid('lifecycle.binding.agentId', 'agentId must be a string or null.');
  }
  return {
    schemaVersion: WORKSPACE_LIFECYCLE_SCHEMA_VERSION_V1,
    bindingId: text(required(record, 'bindingId', 'lifecycle.binding.bindingId'), 'lifecycle.binding.bindingId'),
    spaceId: text(required(record, 'spaceId', 'lifecycle.binding.spaceId'), 'lifecycle.binding.spaceId'),
    workspaceId: text(required(record, 'workspaceId', 'lifecycle.binding.workspaceId'), 'lifecycle.binding.workspaceId'),
    agentId: agentId === null ? null : text(agentId, 'lifecycle.binding.agentId'),
    mountPath: '/',
    defaultBranch: text(required(record, 'defaultBranch', 'lifecycle.binding.defaultBranch'), 'lifecycle.binding.defaultBranch'),
    baseCommit: objectId(required(record, 'baseCommit', 'lifecycle.binding.baseCommit'), 'lifecycle.binding.baseCommit'),
  };
}

function parsePrepared(value: unknown): PreparedGitWorktreeV1 {
  const record = exactRecord(value, 'lifecycle.prepared', PREPARED_KEYS);
  schemaVersion(record, 'lifecycle.prepared.schemaVersion');
  const mountPath = required(record, 'mountPath', 'lifecycle.prepared.mountPath');
  if (mountPath !== '/') {
    invalid('lifecycle.prepared.mountPath', 'V1 worktree mounts must use /.');
  }
  return {
    schemaVersion: WORKSPACE_LIFECYCLE_SCHEMA_VERSION_V1,
    spaceId: text(required(record, 'spaceId', 'lifecycle.prepared.spaceId'), 'lifecycle.prepared.spaceId'),
    mountPath: '/',
    repositoryPath: absolutePath(required(record, 'repositoryPath', 'lifecycle.prepared.repositoryPath'), 'lifecycle.prepared.repositoryPath'),
    worktreePath: absolutePath(required(record, 'worktreePath', 'lifecycle.prepared.worktreePath'), 'lifecycle.prepared.worktreePath'),
    defaultBranch: text(required(record, 'defaultBranch', 'lifecycle.prepared.defaultBranch'), 'lifecycle.prepared.defaultBranch'),
    branch: text(required(record, 'branch', 'lifecycle.prepared.branch'), 'lifecycle.prepared.branch'),
    baseCommit: objectId(required(record, 'baseCommit', 'lifecycle.prepared.baseCommit'), 'lifecycle.prepared.baseCommit'),
    jobId: text(required(record, 'jobId', 'lifecycle.prepared.jobId'), 'lifecycle.prepared.jobId'),
    attemptId: text(required(record, 'attemptId', 'lifecycle.prepared.attemptId'), 'lifecycle.prepared.attemptId'),
    attemptNumber: positiveInteger(required(record, 'attemptNumber', 'lifecycle.prepared.attemptNumber'), 'lifecycle.prepared.attemptNumber'),
    ...(has(record, 'agentId')
      ? { agentId: text(record.agentId, 'lifecycle.prepared.agentId') }
      : {}),
  };
}

function parseRuntimeCompletion(value: unknown): WorkspaceRuntimeCompletionV1 {
  const record = exactRecord(
    value,
    'lifecycle.runtimeCompletion',
    RUNTIME_COMPLETION_KEYS
  );
  const status = required(
    record,
    'status',
    'lifecycle.runtimeCompletion.status'
  );
  if (status !== 'succeeded' && status !== 'failed' && status !== 'cancelled') {
    invalid(
      'lifecycle.runtimeCompletion.status',
      'Runtime completion status is invalid.'
    );
  }
  return {
    status,
    ...(has(record, 'result')
      ? {
          result: jsonValue(
            record.result,
            'lifecycle.runtimeCompletion.result',
            new WeakSet<object>()
          ),
        }
      : {}),
    ...(has(record, 'error')
      ? {
          error: jsonValue(
            record.error,
            'lifecycle.runtimeCompletion.error',
            new WeakSet<object>()
          ),
        }
      : {}),
    ...(has(record, 'runtimeRunId')
      ? {
          runtimeRunId: text(
            record.runtimeRunId,
            'lifecycle.runtimeCompletion.runtimeRunId'
          ),
        }
      : {}),
  };
}

function parseFinalized(value: unknown): FinalizedGitWorktreeV1 {
  const record = exactRecord(value, 'lifecycle.finalized', FINALIZED_KEYS);
  schemaVersion(record, 'lifecycle.finalized.schemaVersion');
  const changed = required(record, 'changed', 'lifecycle.finalized.changed');
  if (typeof changed !== 'boolean') {
    invalid('lifecycle.finalized.changed', 'changed must be a boolean.');
  }
  const filesValue = required(record, 'files', 'lifecycle.finalized.files');
  if (!Array.isArray(filesValue)) {
    invalid('lifecycle.finalized.files', 'files must be an array.');
  }
  const files = filesValue.map((file, index) =>
    string(file, `lifecycle.finalized.files[${index}]`)
  );
  const summaryRecord = exactRecord(
    required(record, 'diffSummary', 'lifecycle.finalized.diffSummary'),
    'lifecycle.finalized.diffSummary',
    DIFF_SUMMARY_KEYS
  );
  return {
    schemaVersion: WORKSPACE_LIFECYCLE_SCHEMA_VERSION_V1,
    spaceId: text(required(record, 'spaceId', 'lifecycle.finalized.spaceId'), 'lifecycle.finalized.spaceId'),
    jobId: text(required(record, 'jobId', 'lifecycle.finalized.jobId'), 'lifecycle.finalized.jobId'),
    attemptId: text(required(record, 'attemptId', 'lifecycle.finalized.attemptId'), 'lifecycle.finalized.attemptId'),
    ...(has(record, 'agentId')
      ? { agentId: text(record.agentId, 'lifecycle.finalized.agentId') }
      : {}),
    changed,
    baseCommit: objectId(required(record, 'baseCommit', 'lifecycle.finalized.baseCommit'), 'lifecycle.finalized.baseCommit'),
    headCommit: objectId(required(record, 'headCommit', 'lifecycle.finalized.headCommit'), 'lifecycle.finalized.headCommit'),
    branch: text(required(record, 'branch', 'lifecycle.finalized.branch'), 'lifecycle.finalized.branch'),
    files,
    diffSummary: {
      filesChanged: nonNegativeInteger(required(summaryRecord, 'filesChanged', 'lifecycle.finalized.diffSummary.filesChanged'), 'lifecycle.finalized.diffSummary.filesChanged'),
      insertions: nonNegativeInteger(required(summaryRecord, 'insertions', 'lifecycle.finalized.diffSummary.insertions'), 'lifecycle.finalized.diffSummary.insertions'),
      deletions: nonNegativeInteger(required(summaryRecord, 'deletions', 'lifecycle.finalized.diffSummary.deletions'), 'lifecycle.finalized.diffSummary.deletions'),
      shortStat: string(required(summaryRecord, 'shortStat', 'lifecycle.finalized.diffSummary.shortStat'), 'lifecycle.finalized.diffSummary.shortStat'),
    },
    patchSha256: sha256(required(record, 'patchSha256', 'lifecycle.finalized.patchSha256'), 'lifecycle.finalized.patchSha256'),
  };
}

function assertPreparedAlignment(
  binding: FrozenKnowledgeBindingV1,
  prepared: PreparedGitWorktreeV1
): void {
  const expected = {
    spaceId: binding.spaceId,
    agentId: binding.agentId,
    mountPath: binding.mountPath,
    defaultBranch: binding.defaultBranch,
    baseCommit: binding.baseCommit,
  };
  const actual = {
    spaceId: prepared.spaceId,
    agentId: prepared.agentId ?? null,
    mountPath: prepared.mountPath,
    defaultBranch: prepared.defaultBranch,
    baseCommit: prepared.baseCommit,
  };
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (expected[key] !== actual[key]) {
      invalid(
        `lifecycle.prepared.${key}`,
        `Prepared workspace ${key} does not match its frozen binding.`
      );
    }
  }
}

function assertFinalizedAlignment(
  binding: FrozenKnowledgeBindingV1,
  prepared: PreparedGitWorktreeV1,
  finalized: FinalizedGitWorktreeV1
): void {
  const expected = {
    spaceId: binding.spaceId,
    jobId: prepared.jobId,
    attemptId: prepared.attemptId,
    agentId: binding.agentId,
    baseCommit: binding.baseCommit,
    branch: prepared.branch,
  };
  const actual = {
    spaceId: finalized.spaceId,
    jobId: finalized.jobId,
    attemptId: finalized.attemptId,
    agentId: finalized.agentId ?? null,
    baseCommit: finalized.baseCommit,
    branch: finalized.branch,
  };
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (expected[key] !== actual[key]) {
      invalid(
        `lifecycle.finalized.${key}`,
        `Finalized workspace ${key} does not match its prepare state.`
      );
    }
  }
}

function nextStage(
  lifecycle: WorkspaceLifecycleV1
): (typeof OPTIONAL_STAGES)[number] | null {
  if (lifecycle.cleanedAt) return null;
  if (!lifecycle.runtimeCompletion) return 'runtimeCompletion';
  if (lifecycle.runtimeCompletion.status !== 'succeeded') return 'cleanedAt';
  if (!lifecycle.finalized) return 'finalized';
  if (!lifecycle.finalized.changed) return 'cleanedAt';
  if (!lifecycle.changeRequestId) return 'changeRequestId';
  return 'cleanedAt';
}

function presentStages(
  lifecycle: WorkspaceLifecycleV1
): Array<(typeof OPTIONAL_STAGES)[number]> {
  return OPTIONAL_STAGES.filter((stage) => has(lifecycle, stage));
}

function exactRecord(
  value: unknown,
  path: string,
  allowedKeys: readonly string[]
): Record<string, unknown> {
  if (!isRecord(value) || !isPlainRecord(value)) {
    invalid(path, `${path} must be an object.`);
  }
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      invalid(`${path}.${key}`, `Unknown workspace lifecycle field ${path}.${key}.`);
    }
  }
  return value;
}

function required(
  record: Record<string, unknown>,
  key: string,
  path: string
): unknown {
  if (!has(record, key)) invalid(path, `Missing required field ${path}.`);
  return record[key];
}

function has(record: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function schemaVersion(record: Record<string, unknown>, path: string): void {
  if (required(record, 'schemaVersion', path) !== WORKSPACE_LIFECYCLE_SCHEMA_VERSION_V1) {
    throw new WorkspaceLifecycleErrorV1(
      'unsupported-schema-version',
      `${path} must be 1.`,
      path
    );
  }
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.includes('\0')) {
    invalid(path, `${path} must be a string.`);
  }
  return value;
}

function text(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!parsed || parsed.trim() !== parsed) {
    invalid(path, `${path} must be a non-empty, trimmed string.`);
  }
  return parsed;
}

function absolutePath(value: unknown, path: string): string {
  const parsed = text(value, path);
  if (!nodePath.isAbsolute(parsed)) {
    invalid(path, `${path} must be an absolute path.`);
  }
  return parsed;
}

function objectId(value: unknown, path: string): string {
  const parsed = text(value, path);
  if (!GIT_OBJECT_ID.test(parsed)) {
    invalid(path, `${path} must be a lowercase full Git object id.`);
  }
  return parsed;
}

function sha256(value: unknown, path: string): string {
  const parsed = text(value, path);
  if (!SHA256.test(parsed)) {
    invalid(path, `${path} must be a lowercase SHA-256 digest.`);
  }
  return parsed;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = nonNegativeInteger(value, path);
  if (parsed === 0) invalid(path, `${path} must be positive.`);
  return parsed;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(path, `${path} must be a non-negative safe integer.`);
  }
  return value as number;
}

function isoDate(value: unknown, path: string): string {
  const parsed = text(value, path);
  const date = new Date(parsed);
  if (Number.isNaN(date.valueOf())) invalid(path, `${path} must be an ISO date.`);
  return date.toISOString();
}

function jsonValue(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>
): WorkspaceLifecycleJsonValueV1 {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(path, `${path} must be JSON-compatible.`);
    return value;
  }
  if (typeof value !== 'object' || !isPlainRecord(value) && !Array.isArray(value)) {
    invalid(path, `${path} must be JSON-compatible.`);
  }
  if (ancestors.has(value)) invalid(path, `${path} must not be cyclic.`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) =>
        jsonValue(entry, `${path}[${index}]`, ancestors)
      );
    }
    const normalized: Record<string, WorkspaceLifecycleJsonValueV1> = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = jsonValue(
        (value as Record<string, unknown>)[key],
        `${path}.${key}`,
        ancestors
      );
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function invalid(path: string, message: string): never {
  throw new WorkspaceLifecycleErrorV1('invalid-lifecycle', message, path);
}

function invalidAdvance(message: string): never {
  throw new WorkspaceLifecycleErrorV1(
    'invalid-advance',
    message,
    'lifecycle'
  );
}
