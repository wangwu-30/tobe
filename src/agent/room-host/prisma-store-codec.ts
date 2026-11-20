import { createHash } from 'node:crypto';

import type {
  RoomJsonValueV1,
  RoomRuntimeEventEnvelopeV1,
  RoomRuntimeOutputDraftV1,
  RoomSessionCheckpointEnvelopeV1,
  RoomSessionCursorV1,
} from '@/agent/room-runtime/contracts';
import {
  isRoomAgentMentionV1,
  isRoomAgentRefV1,
  isRoomAttachmentRefV1,
  isRoomDelegationInvocationV1,
  isRoomJsonValueV1,
} from '@/objects/room/schema';
import { isRecord, safeJsonParse } from '@/framework/resilience/safe-data';

import type {
  BindRoomHostRuntimeInputV1,
  RetryRoomHostDeliveryInputV1,
  RoomHostLeaseV1,
  RoomHostTerminalV1,
} from './store';

export type RawRoomHostDbV1 = {
  $executeRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
  $queryRaw<T>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
};

/** A deliberately small Prisma surface, also convenient for SQLite tests. */
export type PrismaRoomHostClientV1 = RawRoomHostDbV1 & {
  $transaction<T>(
    action: (db: RawRoomHostDbV1) => Promise<T>
  ): Promise<T>;
  $disconnect?(): Promise<void>;
};

export type PrismaRoomHostIdKindV1 =
  | 'event'
  | 'mention'
  | 'message'
  | 'outbox';

export type PrismaRoomHostClockV1 =
  | { now(): Date }
  | (() => Date);

export type PrismaRoomHostStoreOptionsV1 = {
  organizationId: string;
  /** Used when a RoomAgentSession has not selected a runtime yet. */
  defaultRuntimeId?: string | null;
  prisma?: PrismaRoomHostClientV1;
  clock?: PrismaRoomHostClockV1;
  id?: (kind: PrismaRoomHostIdKindV1) => string;
};

export type CandidateRow = {
  roomSessionId: string;
  runtimeId: string;
};

export type ClaimRow = {
  sessionId: string;
  sessionOrganizationId: string;
  sessionRoomId: string;
  agentId: string;
  agentHandle: string;
  agentDisplayName: string | null;
  agentConfigVersion: string;
  lastRoomSequence: number;
  lastDeliverySequence: number;
  lastEventSequence: number;
  generation: number;
  runtimeId: string | null;
  runtimeSessionId: string | null;
  checkpointJson: string | null;
  policyJson: string;
  deliveryId: string;
  deliveryOrganizationId: string;
  deliveryRoomId: string;
  deliveryRoomSessionId: string;
  deliveryMessageId: string;
  deliverySequence: number;
  deliveryIntent: string;
  deliveryCauseJson: string;
  deliveryAttempt: number;
  deliveryStatus: string;
  deliveryAvailableAt: Date | string;
  deliveryClaimedAt: Date | string | null;
  deliveryCompletedAt: Date | string | null;
  deliveryLastError: string | null;
  deliveryCreatedAt: Date | string;
  deliveryUpdatedAt: Date | string;
  messageId: string;
  messageOrganizationId: string;
  messageRoomId: string;
  messageSequence: number;
  messageActorType: string;
  messageActorId: string;
  messageActorDisplayName: string | null;
  messageActorHandle: string | null;
  messageText: string;
  messageAttachmentsJson: string;
  messageReplyToMessageId: string | null;
  messageCorrelationId: string | null;
  messageMetadataJson: string | null;
  messageCreatedAt: Date | string;
};

export type ClaimControlRow = ClaimRow & {
  leaseOwnerId: string | null;
  leaseExpiresAt: Date | string | null;
  currentDeliveryId: string | null;
};

export type CursorRow = {
  lastRoomSequence: number;
  lastDeliverySequence: number;
  lastEventSequence: number;
};

export type EventRow = {
  id: string;
  organizationId: string;
  roomId: string;
  sequence: number;
  type: string;
  dataJson: string;
  createdAt: Date | string;
};

export type RoomCounterRow = {
  messageSequence: number;
  eventSequence: number;
};

export type StoredRuntimeEventV1 = {
  schemaVersion: 1;
  kind: 'room-host.runtime-event';
  roomSessionId: string;
  deliveryId: string;
  generation: number;
  event: RoomRuntimeEventEnvelopeV1;
};

export type StoredRetryEventV1 = {
  schemaVersion: 1;
  kind: 'room-host.delivery-retrying';
  roomSessionId: string;
  deliveryId: string;
  generation: number;
  nextAttempt: number;
  failure: RetryRoomHostDeliveryInputV1['failure'];
};

export type StoredTerminalEventV1 = {
  schemaVersion: 1;
  kind: 'room-host.delivery-terminal';
  roomSessionId: string;
  deliveryId: string;
  generation: number;
  status: 'completed' | 'failed';
  terminal: RoomHostTerminalV1;
  outputMessageId: string | null;
  commitHash: string;
};

export const DEFAULT_CANDIDATE_LIMIT = 32;
export const MAX_CANDIDATE_LIMIT = 256;
export const FENCED = Symbol('room-host-fenced');

export function validHandleForLease(
  input: BindRoomHostRuntimeInputV1,
  organizationId: string
): boolean {
  const handle = input.handle;
  return (
    handle.schemaVersion === 1 &&
    handle.session.organizationId === organizationId &&
    handle.session.roomSessionId === input.lease.roomSessionId &&
    Boolean(handle.session.agentConfigVersion.trim()) &&
    handle.generation === input.lease.generation &&
    Boolean(handle.runtimeId.trim()) &&
    Boolean(handle.runtimeSessionId.trim())
  );
}

export function assertRuntimeIdentity(
  session: ClaimControlRow,
  event: RoomRuntimeEventEnvelopeV1
): void {
  if (
    event.runtimeSessionId !== session.runtimeSessionId ||
    !session.runtimeSessionId
  ) {
    throw new Error(
      'Room runtime event does not match the bound runtime session.'
    );
  }
}

export function assertRuntimeEvent(
  event: RoomRuntimeEventEnvelopeV1,
  lease: RoomHostLeaseV1,
  terminal: boolean
): void {
  const eventType = event?.event?.type;
  const terminalType =
    eventType === 'delivery-completed' || eventType === 'error';
  if (
    event.schemaVersion !== 1 ||
    event.envelopeType !== 'room.runtime-event' ||
    !event.eventId?.trim() ||
    !Number.isSafeInteger(event.eventSequence) ||
    event.eventSequence < 1 ||
    !validIso(event.occurredAt) ||
    event.roomSessionId !== lease.roomSessionId ||
    event.deliveryId !== lease.deliveryId ||
    !event.runtimeSessionId?.trim() ||
    terminalType !== terminal ||
    !isRuntimePayload(event.event)
  ) {
    throw new Error('Room runtime event is invalid for the active delivery.');
  }
}

export function isRuntimePayload(
  payload: RoomRuntimeEventEnvelopeV1['event']
): boolean {
  switch (payload?.type) {
    case 'session-ready':
      return true;
    case 'response-started':
      return (
        typeof payload.responseId === 'string' &&
        Boolean(payload.responseId.trim())
      );
    case 'text-delta':
      return (
        typeof payload.responseId === 'string' &&
        Boolean(payload.responseId.trim()) &&
        typeof payload.text === 'string'
      );
    case 'message-ready':
      return (
        typeof payload.responseId === 'string' &&
        Boolean(payload.responseId.trim()) &&
        validateOutput(payload.message)
      );
    case 'delegation-requested':
      return (
        isRoomDelegationInvocationV1(payload.invocation) &&
        (payload.instruction === undefined ||
          typeof payload.instruction === 'string')
      );
    case 'room.tool_confirmation.requested':
      return (
        payload.request.schemaVersion === 1 &&
        payload.request.requestType === 'room.tool-confirmation' &&
        typeof payload.request.requestId === 'string' &&
        Boolean(payload.request.requestId.trim()) &&
        validIso(payload.request.expiresAt) &&
        typeof payload.request.toolCallId === 'string' &&
        Boolean(payload.request.toolCallId.trim()) &&
        typeof payload.request.toolName === 'string' &&
        Boolean(payload.request.toolName.trim()) &&
        isRoomJsonValueV1(payload.request.parameters) &&
        ['safe', 'confirm', 'privileged'].includes(
          payload.request.safetyLevel
        ) &&
        [
          'read-only',
          'organization-scoped-append',
          'workspace-write',
          'privileged-write',
        ].includes(payload.request.writePolicy)
      );
    case 'checkpoint-ready':
      return isCheckpoint(payload.checkpoint);
    case 'delivery-completed':
      return ['responded', 'observed', 'ignored'].includes(payload.disposition);
    case 'error':
      return (
        typeof payload.code === 'string' &&
        Boolean(payload.code.trim()) &&
        typeof payload.message === 'string' &&
        typeof payload.retryable === 'boolean'
      );
    default:
      return false;
  }
}

export function publicRuntimeEventType(
  event: RoomRuntimeEventEnvelopeV1['event']
): string {
  return event.type === 'room.tool_confirmation.requested'
    ? event.type
    : `room.runtime.${event.type}`;
}

export function assertOutput(output: RoomRuntimeOutputDraftV1): void {
  if (!validateOutput(output)) {
    throw new Error('Room runtime output is invalid.');
  }
}

export function validateOutput(
  value: unknown
): value is RoomRuntimeOutputDraftV1 {
  if (!isRecord(value) || typeof value.text !== 'string') return false;
  const textLength = value.text.length;
  return (
    Array.isArray(value.mentions) &&
    value.mentions.every(
      (mention) =>
        isRoomAgentMentionV1(mention) &&
        mention.range.end <= textLength
    ) &&
    (value.attachments === undefined ||
      (Array.isArray(value.attachments) &&
        value.attachments.every(isRoomAttachmentRefV1)))
  );
}

export function assertTerminal(
  terminal: RoomHostTerminalV1,
  lease: RoomHostLeaseV1,
  session: ClaimControlRow
): void {
  if (terminal.kind === 'runtime-event') {
    assertRuntimeEvent(terminal.event, lease, true);
    assertRuntimeIdentity(session, terminal.event);
    return;
  }
  const failure = terminal.failure;
  if (
    !failure ||
    !['runtime', 'protocol', 'interrupted'].includes(failure.kind) ||
    typeof failure.code !== 'string' ||
    !failure.code.trim() ||
    typeof failure.message !== 'string' ||
    typeof failure.retryable !== 'boolean'
  ) {
    throw new Error('Room host terminal failure is invalid.');
  }
}

export function serializeCurrentCheckpoint(
  checkpoint: RoomSessionCheckpointEnvelopeV1,
  session: ClaimControlRow,
  lease: RoomHostLeaseV1
): string {
  assertCheckpointIdentity(checkpoint, session, lease);
  return stableJson(checkpoint);
}

export function assertCheckpointIdentity(
  checkpoint: RoomSessionCheckpointEnvelopeV1,
  session: ClaimControlRow,
  lease: RoomHostLeaseV1,
  options: { allowOlderGeneration?: boolean } = {}
): void {
  const generationMatches = options.allowOlderGeneration
    ? checkpoint.generation <= lease.generation
    : checkpoint.generation === lease.generation;
  if (
    !isCheckpoint(checkpoint) ||
    checkpoint.session.organizationId !== session.sessionOrganizationId ||
    checkpoint.session.roomId !== session.sessionRoomId ||
    checkpoint.session.roomSessionId !== session.sessionId ||
    checkpoint.session.agent.agentId !== session.agentId ||
    checkpoint.runtimeId !== session.runtimeId ||
    checkpoint.runtimeSessionId !== session.runtimeSessionId ||
    !generationMatches
  ) {
    throw new Error(
      'Room checkpoint does not match the active session generation.'
    );
  }
}

export function isCheckpoint(
  value: unknown
): value is RoomSessionCheckpointEnvelopeV1 {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.envelopeType !== 'room.checkpoint' ||
    typeof value.checkpointId !== 'string' ||
    !value.checkpointId.trim() ||
    !validIso(value.createdAt) ||
    !isRecord(value.session) ||
    typeof value.session.organizationId !== 'string' ||
    typeof value.session.roomId !== 'string' ||
    typeof value.session.roomSessionId !== 'string' ||
    !isRoomAgentRefV1(value.session.agent) ||
    typeof value.runtimeId !== 'string' ||
    !value.runtimeId.trim() ||
    typeof value.runtimeVersion !== 'string' ||
    !value.runtimeVersion.trim() ||
    typeof value.runtimeSessionId !== 'string' ||
    !value.runtimeSessionId.trim() ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 1 ||
    !isCursor(value.cursor) ||
    !isRoomJsonValueV1(value.runtimeState)
  ) {
    return false;
  }
  return true;
}

export function isCursor(value: unknown): value is RoomSessionCursorV1 {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.messageSequence) &&
    isNonNegativeInteger(value.deliverySequence) &&
    isNonNegativeInteger(value.eventSequence)
  );
}

export function parseStoredCheckpoint(
  raw: string | null
): RoomSessionCheckpointEnvelopeV1 | null {
  if (raw === null) return null;
  const parsed = safeJsonParse<RoomSessionCheckpointEnvelopeV1 | null>(
    raw,
    null,
    (value): value is RoomSessionCheckpointEnvelopeV1 | null =>
      isCheckpoint(value)
  );
  if (!parsed) return failStored('checkpoint');
  return parsed;
}

export function parseStoredRuntimeEvent(row: EventRow): StoredRuntimeEventV1 {
  const parsed = safeJsonParse<StoredRuntimeEventV1 | null>(
    row.dataJson,
    null,
    isStoredRuntimeEvent
  );
  if (!parsed) return failStored('runtime event');
  return parsed;
}

export function isStoredRuntimeEvent(
  value: unknown
): value is StoredRuntimeEventV1 {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== 'room-host.runtime-event' ||
    typeof value.roomSessionId !== 'string' ||
    typeof value.deliveryId !== 'string' ||
    !Number.isSafeInteger(value.generation) ||
    !isRecord(value.event)
  ) {
    return false;
  }
  const event = value.event;
  return (
    event.schemaVersion === 1 &&
    event.envelopeType === 'room.runtime-event' &&
    typeof event.eventId === 'string' &&
    Number.isSafeInteger(event.eventSequence) &&
    typeof event.occurredAt === 'string' &&
    typeof event.roomSessionId === 'string' &&
    typeof event.runtimeSessionId === 'string' &&
    typeof event.deliveryId === 'string' &&
    isRecord(event.event) &&
    typeof event.event.type === 'string'
  );
}

export function parseStoredTerminal(row: EventRow): StoredTerminalEventV1 {
  const parsed = safeJsonParse<StoredTerminalEventV1 | null>(
    row.dataJson,
    null,
    (value): value is StoredTerminalEventV1 | null =>
      isRecord(value) &&
      value.schemaVersion === 1 &&
      value.kind === 'room-host.delivery-terminal' &&
      typeof value.roomSessionId === 'string' &&
      typeof value.deliveryId === 'string' &&
      Number.isSafeInteger(value.generation) &&
      (value.status === 'completed' || value.status === 'failed') &&
      isRecord(value.terminal) &&
      (value.outputMessageId === null ||
        typeof value.outputMessageId === 'string') &&
      typeof value.commitHash === 'string'
  );
  if (!parsed) return failStored('terminal event');
  return parsed;
}

export function parseStoredJson(raw: string, field: string): RoomJsonValueV1 {
  const parsed = safeJsonParse<RoomJsonValueV1 | undefined>(
    raw,
    undefined,
    (value): value is RoomJsonValueV1 | undefined =>
      isRoomJsonValueV1(value)
  );
  if (parsed === undefined) return failStored(field);
  return parsed;
}

export function runtimeEventPrefix(
  organizationId: string,
  roomSessionId: string,
  generation: number
): string {
  return `rh:runtime:${shortHash(organizationId)}:${shortHash(
    roomSessionId
  )}:${generation}:`;
}

export function runtimeEventId(
  organizationId: string,
  lease: RoomHostLeaseV1,
  providerEventId: string
): string {
  return `${runtimeEventPrefix(
    organizationId,
    lease.roomSessionId,
    lease.generation
  )}${shortHash(providerEventId)}`;
}

export function terminalEventId(
  organizationId: string,
  lease: RoomHostLeaseV1
): string {
  return `rh:terminal:${shortHash(organizationId)}:${shortHash(
    lease.roomSessionId
  )}:${shortHash(lease.deliveryId)}`;
}

export function retryEventId(
  organizationId: string,
  lease: RoomHostLeaseV1
): string {
  return `rh:retry:${shortHash(organizationId)}:${shortHash(
    lease.roomSessionId
  )}:${shortHash(lease.deliveryId)}:${lease.generation}`;
}

export function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

export function hashJson(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function stableJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value, new WeakSet<object>()));
}

export function normalizeJson(
  value: unknown,
  ancestors: WeakSet<object>
): RoomJsonValueV1 {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    throw new Error('Room Host persistence value must be JSON-compatible.');
  }
  if (typeof value !== 'object' || ancestors.has(value)) {
    throw new Error('Room Host persistence value must be JSON-compatible.');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => normalizeJson(entry, ancestors));
    }
    if (!isRecord(value)) {
      throw new Error('Room Host persistence value must be JSON-compatible.');
    }
    const normalized: Record<string, RoomJsonValueV1> = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child !== undefined) {
        normalized[key] = normalizeJson(child, ancestors);
      }
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

export function isSuccessfulCompletion(terminal: RoomHostTerminalV1): boolean {
  return (
    terminal.kind === 'runtime-event' &&
    terminal.event.event.type === 'delivery-completed'
  );
}

export function terminalError(terminal: RoomHostTerminalV1): string | null {
  if (terminal.kind === 'host-failure') return terminal.failure.message;
  return terminal.event.event.type === 'error'
    ? terminal.event.event.message
    : null;
}

export function createClock(
  clock: PrismaRoomHostClockV1 | undefined
): () => Date {
  if (typeof clock === 'function') return clock;
  if (clock) return () => clock.now();
  return () => new Date();
}

export function operationNow(
  value: Date | undefined,
  fallback: () => Date
): Date {
  return requireDate(value ?? fallback(), 'now');
}

export function addDuration(now: Date, value: number, field: string): Date {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer.`);
  }
  const expiresAt = new Date(now.valueOf() + value);
  if (Number.isNaN(expiresAt.valueOf())) {
    throw new Error(`${field} produced an invalid expiry.`);
  }
  return expiresAt;
}

export function readRuntimeIds(value: readonly string[]): string[] {
  if (!Array.isArray(value)) throw new Error('runtimeIds must be an array.');
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const runtimeId = requireText(entry, 'runtimeIds entry');
    if (!seen.has(runtimeId)) {
      result.push(runtimeId);
      seen.add(runtimeId);
    }
  }
  return result;
}

export function readCandidateLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_CANDIDATE_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_CANDIDATE_LIMIT
  ) {
    throw new Error(
      `limit must be an integer from 1 to ${MAX_CANDIDATE_LIMIT}.`
    );
  }
  return limit;
}

export function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be non-empty.`);
  }
  return value.trim();
}

export function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function requireDate(value: Date | string, field: string): Date {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`${field} is invalid.`);
  return date;
}

export function nullableDate(
  value: Date | string | null,
  field: string
): Date | null {
  return value === null ? null : requireDate(value, field);
}

export function toIso(value: Date | string, field: string): string {
  return requireDate(value, field).toISOString();
}

export function validIso(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !Number.isNaN(Date.parse(value))
  );
}

export function isNonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function readNonNegativeInteger(value: unknown, field: string): number {
  if (!isNonNegativeInteger(value)) {
    throw new Error(`Stored Room ${field} is invalid.`);
  }
  return value as number;
}

export function readPositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`Stored Room ${field} is invalid.`);
  }
  return value as number;
}

export function nextId(
  createId: (kind: PrismaRoomHostIdKindV1) => string,
  kind: PrismaRoomHostIdKindV1
): string {
  return requireText(createId(kind), `${kind} id`);
}

export function failStored(field: string): never {
  throw new Error(`Stored Room ${field} is invalid.`);
}
