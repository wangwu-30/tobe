import { ValidationError } from '@/framework/resilience/app-error';
import { safeJsonParse } from '@/framework/resilience/safe-data';

const INVALID_KNOWLEDGE_DIFF_METADATA = Symbol(
  'invalid-knowledge-diff-metadata'
);

export const KNOWLEDGE_CONTRACT_VERSION_V1 = 1 as const;

export const KNOWLEDGE_SPACE_SCOPES = ['team', 'agent'] as const;
export type KnowledgeSpaceScope = (typeof KNOWLEDGE_SPACE_SCOPES)[number];

export const KNOWLEDGE_BINDING_ACCESS_LEVELS = ['read', 'propose'] as const;
export type KnowledgeBindingAccess =
  (typeof KNOWLEDGE_BINDING_ACCESS_LEVELS)[number];

export const KNOWLEDGE_CHANGE_REQUEST_STATUSES = [
  'pending_review',
  'approved',
  'conflicted',
  'rejected',
  'merged',
] as const;
export type KnowledgeChangeRequestStatus =
  (typeof KNOWLEDGE_CHANGE_REQUEST_STATUSES)[number];

export const KNOWLEDGE_MERGE_OPERATION_STATUSES = [
  'queued',
  'running',
  'conflicted',
  'failed',
  'succeeded',
] as const;
export type KnowledgeMergeOperationStatus =
  (typeof KNOWLEDGE_MERGE_OPERATION_STATUSES)[number];

export const KNOWLEDGE_INDEX_VERSION_V1 = 'knowledge-index-v1' as const;

export type KnowledgeJsonValue =
  | boolean
  | number
  | string
  | null
  | readonly KnowledgeJsonValue[]
  | { readonly [key: string]: KnowledgeJsonValue };

export type KnowledgeDiffMetadata = {
  readonly [key: string]: KnowledgeJsonValue;
};

export type KnowledgeSpaceDto = {
  schemaVersion: 1;
  id: string;
  organizationId: string;
  scope: KnowledgeSpaceScope;
  ownerAgentId: string | null;
  repoPath: string | null;
  repoUrl: string | null;
  defaultBranch: string;
  credentialRef: string | null;
  activeSnapshotId: string | null;
  readPolicy: string;
  writePolicy: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeBindingDto = {
  schemaVersion: 1;
  id: string;
  organizationId: string;
  workspaceId: string;
  agentId: string | null;
  spaceId: string;
  mountPath: string;
  access: KnowledgeBindingAccess;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeSnapshotDto = {
  schemaVersion: 1;
  id: string;
  organizationId: string;
  spaceId: string;
  changeRequestId: string;
  commitSha: string;
  indexVersion: string;
  artifactPath: string;
  artifactSha256: string;
  readyAt: string;
  createdAt: string;
};

export type KnowledgeChangeRequestDto = {
  schemaVersion: 1;
  id: string;
  organizationId: string;
  jobId: string;
  attemptId: string;
  spaceId: string;
  baseCommit: string;
  headCommit: string;
  branchName: string;
  status: KnowledgeChangeRequestStatus;
  diffSummary: string;
  diffMetadata: KnowledgeDiffMetadata;
  reviewerId: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  mergedCommit: string | null;
  mergedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeMergeOperationDto = {
  schemaVersion: 1;
  id: string;
  organizationId: string;
  changeRequestId: string;
  requestedById: string;
  expectedRevision: number;
  expectedBaseCommit: string;
  expectedHeadCommit: string;
  indexVersion: string;
  status: KnowledgeMergeOperationStatus;
  attemptCount: number;
  leaseOwnerId: string | null;
  leaseExpiresAt: string | null;
  mergedCommit: string | null;
  snapshotId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeSpaceRecord = Omit<
  KnowledgeSpaceDto,
  'schemaVersion' | 'scope' | 'createdAt' | 'updatedAt'
> & {
  scope: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type KnowledgeBindingRecord = Omit<
  KnowledgeBindingDto,
  'schemaVersion' | 'access' | 'createdAt' | 'updatedAt'
> & {
  access: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type KnowledgeSnapshotRecord = Omit<
  KnowledgeSnapshotDto,
  'schemaVersion' | 'readyAt' | 'createdAt'
> & {
  readyAt: Date | string;
  createdAt: Date | string;
};

export type KnowledgeChangeRequestRecord = Omit<
  KnowledgeChangeRequestDto,
  | 'schemaVersion'
  | 'status'
  | 'diffMetadata'
  | 'reviewedAt'
  | 'mergedAt'
  | 'createdAt'
  | 'updatedAt'
> & {
  status: string;
  diffMetadataJson: string;
  reviewedAt: Date | string | null;
  mergedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type KnowledgeMergeOperationRecord = Omit<
  KnowledgeMergeOperationDto,
  | 'schemaVersion'
  | 'status'
  | 'leaseExpiresAt'
  | 'startedAt'
  | 'completedAt'
  | 'createdAt'
  | 'updatedAt'
> & {
  status: string;
  leaseExpiresAt: Date | string | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export function parseKnowledgeSpaceScope(
  value: unknown
): KnowledgeSpaceScope {
  if (KNOWLEDGE_SPACE_SCOPES.some((scope) => scope === value)) {
    return value as KnowledgeSpaceScope;
  }
  throw new ValidationError('Knowledge space scope must be team or agent.');
}

export function parseKnowledgeBindingAccess(
  value: unknown
): KnowledgeBindingAccess {
  if (KNOWLEDGE_BINDING_ACCESS_LEVELS.some((access) => access === value)) {
    return value as KnowledgeBindingAccess;
  }
  throw new ValidationError('Knowledge binding access must be read or propose.');
}

export function parseKnowledgeChangeRequestStatus(
  value: unknown
): KnowledgeChangeRequestStatus {
  if (
    KNOWLEDGE_CHANGE_REQUEST_STATUSES.some((status) => status === value)
  ) {
    return value as KnowledgeChangeRequestStatus;
  }
  throw new ValidationError('Knowledge change request status is invalid.');
}

export function parseKnowledgeMergeOperationStatus(
  value: unknown
): KnowledgeMergeOperationStatus {
  if (
    KNOWLEDGE_MERGE_OPERATION_STATUSES.some((status) => status === value)
  ) {
    return value as KnowledgeMergeOperationStatus;
  }
  throw new ValidationError('Knowledge merge operation status is invalid.');
}

export function normalizeKnowledgeDiffMetadata(
  value: unknown
): KnowledgeDiffMetadata {
  if (!isPlainObject(value) || !isKnowledgeJsonValue(value)) {
    throw new ValidationError('diffMetadata must be a JSON object.');
  }
  return value;
}

export function parseKnowledgeDiffMetadata(
  value: string
): KnowledgeDiffMetadata {
  const parsed = safeJsonParse<
    unknown | typeof INVALID_KNOWLEDGE_DIFF_METADATA
  >(value, INVALID_KNOWLEDGE_DIFF_METADATA);
  if (parsed === INVALID_KNOWLEDGE_DIFF_METADATA) {
    throw new ValidationError('Stored knowledge diff metadata is invalid JSON.');
  }
  return normalizeKnowledgeDiffMetadata(parsed);
}

export function mapKnowledgeSpace(
  record: KnowledgeSpaceRecord
): KnowledgeSpaceDto {
  return {
    schemaVersion: KNOWLEDGE_CONTRACT_VERSION_V1,
    ...record,
    scope: parseKnowledgeSpaceScope(record.scope),
    createdAt: toIsoString(record.createdAt),
    updatedAt: toIsoString(record.updatedAt),
  };
}

export function mapKnowledgeBinding(
  record: KnowledgeBindingRecord
): KnowledgeBindingDto {
  return {
    schemaVersion: KNOWLEDGE_CONTRACT_VERSION_V1,
    ...record,
    access: parseKnowledgeBindingAccess(record.access),
    createdAt: toIsoString(record.createdAt),
    updatedAt: toIsoString(record.updatedAt),
  };
}

export function mapKnowledgeSnapshot(
  record: KnowledgeSnapshotRecord
): KnowledgeSnapshotDto {
  return {
    schemaVersion: KNOWLEDGE_CONTRACT_VERSION_V1,
    ...record,
    readyAt: toIsoString(record.readyAt),
    createdAt: toIsoString(record.createdAt),
  };
}

export function mapKnowledgeChangeRequest(
  record: KnowledgeChangeRequestRecord
): KnowledgeChangeRequestDto {
  const { diffMetadataJson, ...rest } = record;
  return {
    schemaVersion: KNOWLEDGE_CONTRACT_VERSION_V1,
    ...rest,
    status: parseKnowledgeChangeRequestStatus(record.status),
    diffMetadata: parseKnowledgeDiffMetadata(diffMetadataJson),
    reviewedAt: toNullableIsoString(record.reviewedAt),
    mergedAt: toNullableIsoString(record.mergedAt),
    createdAt: toIsoString(record.createdAt),
    updatedAt: toIsoString(record.updatedAt),
  };
}

export function mapKnowledgeMergeOperation(
  record: KnowledgeMergeOperationRecord
): KnowledgeMergeOperationDto {
  return {
    schemaVersion: KNOWLEDGE_CONTRACT_VERSION_V1,
    ...record,
    status: parseKnowledgeMergeOperationStatus(record.status),
    leaseExpiresAt: toNullableIsoString(record.leaseExpiresAt),
    startedAt: toNullableIsoString(record.startedAt),
    completedAt: toNullableIsoString(record.completedAt),
    createdAt: toIsoString(record.createdAt),
    updatedAt: toIsoString(record.updatedAt),
  };
}

export function canReviewKnowledgeChangeRequest(
  status: KnowledgeChangeRequestStatus,
  action: 'approve' | 'mark_conflicted' | 'reject'
) {
  switch (action) {
    case 'approve':
      return status === 'pending_review' || status === 'conflicted';
    case 'mark_conflicted':
      return status === 'approved';
    case 'reject':
      return (
        status === 'pending_review' ||
        status === 'approved' ||
        status === 'conflicted'
      );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKnowledgeJsonValue(value: unknown): value is KnowledgeJsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isKnowledgeJsonValue);
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(isKnowledgeJsonValue);
}

function toIsoString(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError('Stored knowledge timestamp is invalid.');
  }
  return date.toISOString();
}

function toNullableIsoString(value: Date | string | null) {
  return value === null ? null : toIsoString(value);
}
