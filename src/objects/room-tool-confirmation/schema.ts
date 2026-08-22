import type {
  AgentToolSafetyLevel,
  AgentToolWritePolicy,
} from '@/agent/tool-policy';
import type { ExecutionJobReceiptV1 } from '@/objects/execution-job';
import { ValidationError } from '@/framework/resilience/app-error';
import { safeJsonParse } from '@/framework/resilience/safe-data';
import { isRecord } from '@/framework/resilience/safe-data';

export const ROOM_TOOL_CONFIRMATION_CONTRACT_VERSION_V1 = 1 as const;

export const ROOM_TOOL_CONFIRMATION_STATUSES_V1 = [
  'pending',
  'approved',
  'executed',
  'rejected',
  'expired',
] as const;

export type RoomToolConfirmationStatusV1 =
  (typeof ROOM_TOOL_CONFIRMATION_STATUSES_V1)[number];

export type RoomToolConfirmationRequestDtoV1 = {
  schemaVersion: typeof ROOM_TOOL_CONFIRMATION_CONTRACT_VERSION_V1;
  id: string;
  organizationId: string;
  roomId: string;
  roomMessageId: string;
  roomSessionId: string;
  deliveryId: string;
  toolCallId: string;
  toolName: string;
  parameters: unknown;
  parametersHash: string;
  safetyLevel: AgentToolSafetyLevel;
  writePolicy: AgentToolWritePolicy;
  status: RoomToolConfirmationStatusV1;
  revision: number;
  expiresAt: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  executedAt: string | null;
  rejectedByUserId: string | null;
  rejectedAt: string | null;
  executionJobReceipt: ExecutionJobReceiptV1 | null;
  createdAt: string;
  updatedAt: string;
};

export type RoomToolConfirmationDecisionReceiptV1 = {
  schemaVersion: typeof ROOM_TOOL_CONFIRMATION_CONTRACT_VERSION_V1;
  request: RoomToolConfirmationRequestDtoV1;
  receipt?: ExecutionJobReceiptV1;
};

export type RoomToolConfirmationRequestRecord = {
  id: string;
  organizationId: string;
  roomId: string;
  roomMessageId: string;
  roomSessionId: string;
  deliveryId: string;
  toolCallId: string;
  toolName: string;
  parametersJson: string;
  parametersHash: string;
  safetyLevel: string;
  writePolicy: string;
  status: string;
  revision: number;
  expiresAt: Date;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  executedAt: Date | null;
  rejectedByUserId: string | null;
  rejectedAt: Date | null;
  executionJobReceiptJson: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function mapRoomToolConfirmationRequestV1(
  record: RoomToolConfirmationRequestRecord
): RoomToolConfirmationRequestDtoV1 {
  const status = readStatus(record.status);
  const safetyLevel = readSafetyLevel(record.safetyLevel);
  const writePolicy = readWritePolicy(record.writePolicy);
  return {
    schemaVersion: ROOM_TOOL_CONFIRMATION_CONTRACT_VERSION_V1,
    id: record.id,
    organizationId: record.organizationId,
    roomId: record.roomId,
    roomMessageId: record.roomMessageId,
    roomSessionId: record.roomSessionId,
    deliveryId: record.deliveryId,
    toolCallId: record.toolCallId,
    toolName: record.toolName,
    parameters: parseJson(record.parametersJson, 'parameters'),
    parametersHash: record.parametersHash,
    safetyLevel,
    writePolicy,
    status,
    revision: record.revision,
    expiresAt: record.expiresAt.toISOString(),
    approvedByUserId: record.approvedByUserId,
    approvedAt: record.approvedAt?.toISOString() ?? null,
    executedAt: record.executedAt?.toISOString() ?? null,
    rejectedByUserId: record.rejectedByUserId,
    rejectedAt: record.rejectedAt?.toISOString() ?? null,
    executionJobReceipt: record.executionJobReceiptJson
      ? (parseJson(
          record.executionJobReceiptJson,
          'executionJobReceipt'
        ) as ExecutionJobReceiptV1)
      : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function isRoomToolConfirmationStatusV1(
  value: unknown
): value is RoomToolConfirmationStatusV1 {
  return ROOM_TOOL_CONFIRMATION_STATUSES_V1.includes(
    value as RoomToolConfirmationStatusV1
  );
}

export function isRoomToolConfirmationRequestDtoV1(
  value: unknown
): value is RoomToolConfirmationRequestDtoV1 {
  return (
    isRecord(value) &&
    hasExactPublicRequestFields(value) &&
    value.schemaVersion === 1 &&
    typeof value.id === 'string' &&
    typeof value.organizationId === 'string' &&
    typeof value.roomId === 'string' &&
    typeof value.roomMessageId === 'string' &&
    typeof value.roomSessionId === 'string' &&
    typeof value.deliveryId === 'string' &&
    typeof value.toolCallId === 'string' &&
    typeof value.toolName === 'string' &&
    isJsonValue(value.parameters) &&
    typeof value.parametersHash === 'string' &&
    (value.safetyLevel === 'safe' ||
      value.safetyLevel === 'confirm' ||
      value.safetyLevel === 'privileged') &&
    (value.writePolicy === 'read-only' ||
      value.writePolicy === 'organization-scoped-append' ||
      value.writePolicy === 'workspace-write' ||
      value.writePolicy === 'privileged-write') &&
    isRoomToolConfirmationStatusV1(value.status) &&
    Number.isSafeInteger(value.revision) &&
    typeof value.expiresAt === 'string' &&
    (value.approvedByUserId === null ||
      typeof value.approvedByUserId === 'string') &&
    (value.approvedAt === null || typeof value.approvedAt === 'string') &&
    (value.executedAt === null || typeof value.executedAt === 'string') &&
    (value.rejectedByUserId === null ||
      typeof value.rejectedByUserId === 'string') &&
    (value.rejectedAt === null || typeof value.rejectedAt === 'string') &&
    (value.executionJobReceipt === null ||
      isExecutionJobReceiptV1(value.executionJobReceipt)) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

const PUBLIC_REQUEST_FIELDS = new Set([
  'schemaVersion',
  'id',
  'organizationId',
  'roomId',
  'roomMessageId',
  'roomSessionId',
  'deliveryId',
  'toolCallId',
  'toolName',
  'parameters',
  'parametersHash',
  'safetyLevel',
  'writePolicy',
  'status',
  'revision',
  'expiresAt',
  'approvedByUserId',
  'approvedAt',
  'executedAt',
  'rejectedByUserId',
  'rejectedAt',
  'executionJobReceipt',
  'createdAt',
  'updatedAt',
]);

function hasExactPublicRequestFields(value: Record<string, unknown>) {
  const keys = Object.keys(value);
  return (
    keys.length === PUBLIC_REQUEST_FIELDS.size &&
    keys.every((key) => PUBLIC_REQUEST_FIELDS.has(key))
  );
}

function isExecutionJobReceiptV1(value: unknown) {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.jobId === 'string' &&
    (value.teamTaskId === null || typeof value.teamTaskId === 'string') &&
    (value.status === 'queued' || value.status === 'blocked') &&
    Number.isSafeInteger(value.revision) &&
    (value.selectedRuntimeId === null ||
      typeof value.selectedRuntimeId === 'string') &&
    isJsonValue(value.selection) &&
    typeof value.acceptedAt === 'string'
  );
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, ancestors))
    : Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function readStatus(value: string): RoomToolConfirmationStatusV1 {
  if (!isRoomToolConfirmationStatusV1(value)) {
    throw new ValidationError('Stored Room tool confirmation status is invalid.');
  }
  return value;
}

function readSafetyLevel(value: string): AgentToolSafetyLevel {
  if (value === 'safe' || value === 'confirm' || value === 'privileged') {
    return value;
  }
  throw new ValidationError('Stored Room tool confirmation safety level is invalid.');
}

function readWritePolicy(value: string): AgentToolWritePolicy {
  if (
    value === 'read-only' ||
    value === 'organization-scoped-append' ||
    value === 'workspace-write' ||
    value === 'privileged-write'
  ) {
    return value;
  }
  throw new ValidationError('Stored Room tool confirmation write policy is invalid.');
}

function parseJson(raw: string, field: string): unknown {
  const invalid = Symbol('invalid');
  const parsed = safeJsonParse<unknown | typeof invalid>(raw, invalid);
  if (parsed === invalid) {
    throw new ValidationError(`Stored Room tool confirmation ${field} is invalid.`);
  }
  return parsed;
}
