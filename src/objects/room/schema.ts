import {
  ROOM_RUNTIME_CONTRACT_VERSION_V1,
  type RoomActorRefV1,
  type RoomAgentMentionV1,
  type RoomAgentRefV1,
  type RoomAttachmentRefV1,
  type RoomDelegationInvocationV1,
  type RoomDelegationTraceV1,
  type RoomDeliveryCauseV1,
  type RoomDeliveryEnvelopeV1,
  type RoomDeliveryIntentV1,
  type RoomJsonValueV1,
  type RoomMessageEnvelopeV1,
  type RoomPolicyV1,
} from '@/agent/room-runtime/contracts';
import { ValidationError } from '@/framework/resilience/app-error';
import { isRecord, safeJsonParse } from '@/framework/resilience/safe-data';

export const ROOM_CONTRACT_VERSION_V1 =
  ROOM_RUNTIME_CONTRACT_VERSION_V1;
export const ROOM_DTO_VERSION_V1 = ROOM_CONTRACT_VERSION_V1;
export const ROOM_JSON_MAX_DEPTH_V1 = 32;
export const ROOM_JSON_MAX_NODES_V1 = 10_000;

export const ROOM_ACTOR_TYPES_V1 = ['human', 'agent', 'system'] as const;
export const ROOM_DELIVERY_INTENTS_V1 = ['observe', 'respond'] as const;
export const ROOM_INBOX_DELIVERY_STATUSES_V1 = [
  'pending',
  'claimed',
  'completed',
  'failed',
] as const;
export const ROOM_DELEGATION_GRANT_SCOPES_V1 = ['once', 'room'] as const;
export const ROOM_DELEGATION_GRANT_STATUSES_V1 = [
  'active',
  'consumed',
  'revoked',
] as const;

const ROOM_DTO_FIELDS = [
  'schemaVersion',
  'id',
  'organizationId',
  'key',
  'projectId',
  'name',
  'hostAgentId',
  'policy',
  'messageSequence',
  'eventSequence',
  'createdAt',
  'updatedAt',
] as const;
const ROOM_MESSAGE_FIELDS = [
  'schemaVersion',
  'envelopeType',
  'messageId',
  'organizationId',
  'roomId',
  'sequence',
  'createdAt',
  'actor',
  'text',
  'mentions',
  'attachments',
] as const;
const ROOM_MESSAGE_OPTIONAL_FIELDS = [
  'replyToMessageId',
  'correlationId',
  'metadata',
] as const;
const ROOM_DELIVERY_FIELDS = [
  'schemaVersion',
  'envelopeType',
  'deliveryId',
  'roomSessionId',
  'deliverySequence',
  'attempt',
  'createdAt',
  'target',
  'intent',
  'cause',
  'message',
] as const;
const ROOM_INBOX_DELIVERY_FIELDS = [
  'schemaVersion',
  'id',
  'organizationId',
  'roomId',
  'roomSessionId',
  'messageId',
  'deliverySequence',
  'intent',
  'cause',
  'attempt',
  'status',
  'availableAt',
  'claimedAt',
  'completedAt',
  'lastError',
  'createdAt',
  'updatedAt',
] as const;
const ROOM_EVENT_FIELDS = [
  'schemaVersion',
  'eventId',
  'organizationId',
  'roomId',
  'sequence',
  'type',
  'createdAt',
  'data',
] as const;
const ROOM_GRANT_FIELDS = [
  'schemaVersion',
  'id',
  'organizationId',
  'roomId',
  'issuedByUserId',
  'fromAgentId',
  'targetAgentId',
  'scope',
  'status',
  'rootMessageId',
  'consumedByInvocationId',
  'consumedAt',
  'revokedAt',
  'expiresAt',
  'hopLimit',
  'invocationLimit',
  'invocationCount',
  'createdAt',
  'updatedAt',
] as const;
const ROOM_RECEIPT_FIELDS = [
  'schemaVersion',
  'status',
  'roomId',
  'messageId',
  'messageSequence',
  'eventId',
  'eventSequence',
  'deliveryIds',
] as const;

export type RoomActor = {
  organizationId: string;
  userId: string;
  deviceId?: string;
};

export type RoomActorTypeV1 = (typeof ROOM_ACTOR_TYPES_V1)[number];
export type RoomInboxDeliveryStatusV1 =
  (typeof ROOM_INBOX_DELIVERY_STATUSES_V1)[number];
export type RoomDelegationGrantScopeV1 =
  (typeof ROOM_DELEGATION_GRANT_SCOPES_V1)[number];
export type RoomDelegationGrantStatusV1 =
  (typeof ROOM_DELEGATION_GRANT_STATUSES_V1)[number];

export type RoomDtoV1 = {
  schemaVersion: typeof ROOM_CONTRACT_VERSION_V1;
  id: string;
  organizationId: string;
  key: string;
  projectId: string | null;
  name: string;
  hostAgentId: string;
  policy: RoomPolicyV1;
  messageSequence: number;
  eventSequence: number;
  createdAt: string;
  updatedAt: string;
};

/** The persisted message read model intentionally reuses the runtime envelope. */
export type RoomMessageDtoV1 = RoomMessageEnvelopeV1;

export type RoomMessageReceiptV1 = {
  schemaVersion: typeof ROOM_CONTRACT_VERSION_V1;
  status: 'accepted';
  roomId: string;
  messageId: string;
  messageSequence: number;
  eventId: string;
  eventSequence: number;
  deliveryIds: string[];
};

/** Compatibility name for the receipt returned after durable routing. */
export type RoomDeliveryReceiptV1 = RoomMessageReceiptV1;

export type RoomEventDtoV1 = {
  schemaVersion: typeof ROOM_CONTRACT_VERSION_V1;
  eventId: string;
  organizationId: string;
  roomId: string;
  sequence: number;
  type: string;
  createdAt: string;
  data: RoomJsonValueV1;
};

export type RoomDelegationGrantDtoV1 = {
  schemaVersion: typeof ROOM_CONTRACT_VERSION_V1;
  id: string;
  organizationId: string;
  roomId: string;
  issuedByUserId: string;
  fromAgentId: string;
  targetAgentId: string;
  scope: RoomDelegationGrantScopeV1;
  status: RoomDelegationGrantStatusV1;
  rootMessageId: string | null;
  consumedByInvocationId: string | null;
  consumedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
  hopLimit: number;
  invocationLimit: number;
  invocationCount: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Durable delivery state is kept separate from the provider-facing delivery
 * envelope so retries and claims do not mutate the immutable input envelope.
 */
export type RoomInboxDeliveryDtoV1 = {
  schemaVersion: typeof ROOM_CONTRACT_VERSION_V1;
  id: string;
  organizationId: string;
  roomId: string;
  roomSessionId: string;
  messageId: string;
  deliverySequence: number;
  intent: RoomDeliveryIntentV1;
  cause: RoomDeliveryCauseV1;
  attempt: number;
  status: RoomInboxDeliveryStatusV1;
  availableAt: string;
  claimedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

// Short names are exported for product consumers while the Dto names make the
// persistence boundary explicit to command and query implementations.
export type RoomV1 = RoomDtoV1;
export type RoomMessageV1 = RoomMessageDtoV1;
export type RoomEventV1 = RoomEventDtoV1;
export type RoomDelegationGrantV1 = RoomDelegationGrantDtoV1;
export type RoomInboxDeliveryV1 = RoomInboxDeliveryDtoV1;

export type {
  RoomActorRefV1,
  RoomAgentMentionV1,
  RoomAgentRefV1,
  RoomAttachmentRefV1,
  RoomDeliveryCauseV1,
  RoomDeliveryEnvelopeV1,
  RoomDeliveryIntentV1,
  RoomJsonValueV1,
  RoomMessageEnvelopeV1,
  RoomPolicyV1,
};

export type RoomRecord = {
  id: string;
  organizationId: string;
  key: string;
  projectId: string | null;
  name: string;
  hostAgentId: string;
  policyJson: string;
  messageSequence: number;
  eventSequence: number;
  createdByUserId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type RoomMentionRecord = {
  id: string;
  organizationId: string;
  roomId: string;
  messageId: string;
  mentionIndex: number;
  agentId: string;
  handle: string;
  rangeStart: number;
  rangeEnd: number;
  createdAt: Date | string;
};

export type RoomMessageRecord = {
  id: string;
  organizationId: string;
  roomId: string;
  sequence: number;
  actorType: string;
  actorId: string;
  actorDisplayName: string | null;
  text: string;
  attachmentsJson: string;
  replyToMessageId: string | null;
  correlationId: string | null;
  metadataJson: string | null;
  createdAt: Date | string;
};

export type RoomMessageMappingRecord = RoomMessageRecord & {
  /** Optional join result. Historical rows fall back to the stable agent id. */
  actorHandle?: string | null;
  mentions?: readonly RoomMentionRecord[];
};

export type RoomInboxDeliveryRecord = {
  id: string;
  organizationId: string;
  roomId: string;
  roomSessionId: string;
  messageId: string;
  deliverySequence: number;
  intent: string;
  causeJson: string;
  attempt: number;
  status: string;
  availableAt: Date | string;
  claimedAt: Date | string | null;
  completedAt: Date | string | null;
  lastError: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type RoomEventRecord = {
  id: string;
  organizationId: string;
  roomId: string;
  sequence: number;
  type: string;
  dataJson: string;
  createdAt: Date | string;
};

export type RoomDelegationGrantRecord = {
  id: string;
  organizationId: string;
  roomId: string;
  issuedByUserId: string;
  fromAgentId: string;
  targetAgentId: string;
  scope: string;
  status: string;
  rootMessageId: string | null;
  consumedByInvocationId: string | null;
  consumedAt: Date | string | null;
  revokedAt: Date | string | null;
  expiresAt: Date | string;
  hopLimit: number;
  invocationLimit: number;
  invocationCount: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export function isRoomJsonValueV1(value: unknown): value is RoomJsonValueV1 {
  return isBoundedRoomJsonValueV1(
    value,
    0,
    { remaining: ROOM_JSON_MAX_NODES_V1 },
    new Set<object>()
  );
}

function isBoundedRoomJsonValueV1(
  value: unknown,
  depth: number,
  budget: { remaining: number },
  seen: Set<object>
): value is RoomJsonValueV1 {
  budget.remaining -= 1;
  if (budget.remaining < 0 || depth > ROOM_JSON_MAX_DEPTH_V1) {
    return false;
  }
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
  if (typeof value !== 'object' || seen.has(value)) {
    return false;
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    return false;
  }

  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) =>
        isBoundedRoomJsonValueV1(entry, depth + 1, budget, seen)
      )
    : Object.values(value).every((entry) =>
        isBoundedRoomJsonValueV1(entry, depth + 1, budget, seen)
      );
  seen.delete(value);
  return valid;
}

export function isRoomDtoV1(value: unknown): value is RoomDtoV1 {
  return (
    isRoomJsonValueV1(value) &&
    hasExactFields(value, ROOM_DTO_FIELDS) &&
    value.schemaVersion === ROOM_CONTRACT_VERSION_V1 &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.key) &&
    isNullableNonEmptyString(value.projectId) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.hostAgentId) &&
    isRoomPolicyV1(value.policy) &&
    value.policy.participation.hostAgentId === value.hostAgentId &&
    isNonNegativeInteger(value.messageSequence) &&
    isNonNegativeInteger(value.eventSequence) &&
    isIsoDateString(value.createdAt) &&
    isIsoDateString(value.updatedAt)
  );
}

export function isRoomActorRefV1(value: unknown): value is RoomActorRefV1 {
  if (!isRoomJsonValueV1(value) || !isRecord(value)) {
    return false;
  }

  switch (value.type) {
    case 'human':
      return (
        hasExactFields(value, ['type', 'userId'], ['displayName']) &&
        isNonEmptyString(value.userId) &&
        isOptionalOwnString(value, 'displayName')
      );
    case 'agent':
      return (
        hasExactFields(
          value,
          ['type', 'agentId', 'handle'],
          ['displayName']
        ) &&
        isNonEmptyString(value.agentId) &&
        isNonEmptyString(value.handle) &&
        isOptionalOwnString(value, 'displayName')
      );
    case 'system':
      return (
        hasExactFields(value, ['type', 'systemId']) &&
        isNonEmptyString(value.systemId)
      );
    default:
      return false;
  }
}

export function isRoomAgentMentionV1(
  value: unknown
): value is RoomAgentMentionV1 {
  return (
    isRoomJsonValueV1(value) &&
    hasExactFields(value, ['type', 'agentId', 'handle', 'range']) &&
    value.type === 'agent' &&
    isNonEmptyString(value.agentId) &&
    isNonEmptyString(value.handle) &&
    hasExactFields(value.range, ['start', 'end']) &&
    isNonNegativeInteger(value.range.start) &&
    isNonNegativeInteger(value.range.end) &&
    value.range.end > value.range.start
  );
}

export function isRoomAttachmentRefV1(
  value: unknown
): value is RoomAttachmentRefV1 {
  return (
    isRoomJsonValueV1(value) &&
    hasExactFields(
      value,
      ['attachmentId', 'mediaType'],
      ['name', 'uri']
    ) &&
    isNonEmptyString(value.attachmentId) &&
    isNonEmptyString(value.mediaType) &&
    isOptionalOwnString(value, 'name') &&
    isOptionalOwnString(value, 'uri')
  );
}

export function isRoomPolicyV1(value: unknown): value is RoomPolicyV1 {
  if (
    !isRoomJsonValueV1(value) ||
    !hasExactFields(value, ['schemaVersion', 'participation', 'delegation']) ||
    value.schemaVersion !== ROOM_CONTRACT_VERSION_V1 ||
    !hasExactFields(value.participation, [
      'mode',
      'hostAgentId',
      'unmentionedHostAction',
    ]) ||
    !hasExactFields(value.delegation, [
      'enabled',
      'maxHops',
      'maxInvocations',
    ])
  ) {
    return false;
  }

  return (
    value.participation.mode === 'quiet-host' &&
    isNonEmptyString(value.participation.hostAgentId) &&
    value.participation.unmentionedHostAction === 'observe' &&
    typeof value.delegation.enabled === 'boolean' &&
    isPositiveInteger(value.delegation.maxHops) &&
    isPositiveInteger(value.delegation.maxInvocations)
  );
}

export function isRoomDeliveryCauseV1(
  value: unknown
): value is RoomDeliveryCauseV1 {
  if (!isRoomJsonValueV1(value) || !isRecord(value)) {
    return false;
  }

  switch (value.type) {
    case 'typed-mention':
      return (
        hasExactFields(value, ['type', 'mentionIndexes']) &&
        Array.isArray(value.mentionIndexes) &&
        value.mentionIndexes.every(isNonNegativeInteger)
      );
    case 'delegation':
      return (
        hasExactFields(value, ['type', 'invocation', 'trace']) &&
        isRoomDelegationInvocationV1(value.invocation) &&
        isRoomDelegationTraceV1(value.trace)
      );
    case 'room-observation':
      return hasExactFields(value, ['type']);
    case 'system':
      return (
        hasExactFields(value, ['type', 'reason']) &&
        typeof value.reason === 'string'
      );
    default:
      return false;
  }
}

export function isRoomMessageEnvelopeV1(
  value: unknown
): value is RoomMessageEnvelopeV1 {
  return (
    isRoomJsonValueV1(value) &&
    hasExactFields(value, ROOM_MESSAGE_FIELDS, ROOM_MESSAGE_OPTIONAL_FIELDS) &&
    value.schemaVersion === ROOM_CONTRACT_VERSION_V1 &&
    value.envelopeType === 'room.message' &&
    isNonEmptyString(value.messageId) &&
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.roomId) &&
    isNonNegativeInteger(value.sequence) &&
    isIsoDateString(value.createdAt) &&
    isRoomActorRefV1(value.actor) &&
    typeof value.text === 'string' &&
    Array.isArray(value.mentions) &&
    value.mentions.every(
      (mention) =>
        isRoomAgentMentionV1(mention) &&
        mention.range.end <= (value.text as string).length
    ) &&
    Array.isArray(value.attachments) &&
    value.attachments.every(isRoomAttachmentRefV1) &&
    isOptionalOwnNonEmptyString(value, 'replyToMessageId') &&
    isOptionalOwnNonEmptyString(value, 'correlationId') &&
    (!hasOwn(value, 'metadata') ||
      isRoomJsonValueV1(value.metadata))
  );
}

export function isRoomDeliveryEnvelopeV1(
  value: unknown
): value is RoomDeliveryEnvelopeV1 {
  return (
    isRoomJsonValueV1(value) &&
    hasExactFields(value, ROOM_DELIVERY_FIELDS) &&
    value.schemaVersion === ROOM_CONTRACT_VERSION_V1 &&
    value.envelopeType === 'room.delivery' &&
    isNonEmptyString(value.deliveryId) &&
    isNonEmptyString(value.roomSessionId) &&
    isNonNegativeInteger(value.deliverySequence) &&
    isPositiveInteger(value.attempt) &&
    isIsoDateString(value.createdAt) &&
    isRoomAgentRefV1(value.target) &&
    isRoomDeliveryIntentV1(value.intent) &&
    isRoomDeliveryCauseV1(value.cause) &&
    isRoomMessageEnvelopeV1(value.message)
  );
}

export function isRoomInboxDeliveryDtoV1(
  value: unknown
): value is RoomInboxDeliveryDtoV1 {
  return (
    isRoomJsonValueV1(value) &&
    hasExactFields(value, ROOM_INBOX_DELIVERY_FIELDS) &&
    value.schemaVersion === ROOM_CONTRACT_VERSION_V1 &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.roomId) &&
    isNonEmptyString(value.roomSessionId) &&
    isNonEmptyString(value.messageId) &&
    isNonNegativeInteger(value.deliverySequence) &&
    isRoomDeliveryIntentV1(value.intent) &&
    isRoomDeliveryCauseV1(value.cause) &&
    isPositiveInteger(value.attempt) &&
    isRoomInboxDeliveryStatusV1(value.status) &&
    isIsoDateString(value.availableAt) &&
    isNullableIsoDateString(value.claimedAt) &&
    isNullableIsoDateString(value.completedAt) &&
    (value.lastError === null || typeof value.lastError === 'string') &&
    isIsoDateString(value.createdAt) &&
    isIsoDateString(value.updatedAt)
  );
}

export function isRoomEventDtoV1(value: unknown): value is RoomEventDtoV1 {
  return (
    isRoomJsonValueV1(value) &&
    hasExactFields(value, ROOM_EVENT_FIELDS) &&
    value.schemaVersion === ROOM_CONTRACT_VERSION_V1 &&
    isNonEmptyString(value.eventId) &&
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.roomId) &&
    isNonNegativeInteger(value.sequence) &&
    isNonEmptyString(value.type) &&
    isIsoDateString(value.createdAt) &&
    isRoomJsonValueV1(value.data)
  );
}

export function isRoomDelegationGrantDtoV1(
  value: unknown
): value is RoomDelegationGrantDtoV1 {
  return (
    isRoomJsonValueV1(value) &&
    hasExactFields(value, ROOM_GRANT_FIELDS) &&
    value.schemaVersion === ROOM_CONTRACT_VERSION_V1 &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.roomId) &&
    isNonEmptyString(value.issuedByUserId) &&
    isNonEmptyString(value.fromAgentId) &&
    isNonEmptyString(value.targetAgentId) &&
    isRoomDelegationGrantScopeV1(value.scope) &&
    isRoomDelegationGrantStatusV1(value.status) &&
    isNullableNonEmptyString(value.rootMessageId) &&
    isNullableNonEmptyString(value.consumedByInvocationId) &&
    isNullableIsoDateString(value.consumedAt) &&
    isNullableIsoDateString(value.revokedAt) &&
    isIsoDateString(value.expiresAt) &&
    isPositiveInteger(value.hopLimit) &&
    isPositiveInteger(value.invocationLimit) &&
    isNonNegativeInteger(value.invocationCount) &&
    isIsoDateString(value.createdAt) &&
    isIsoDateString(value.updatedAt)
  );
}

export function isRoomMessageReceiptV1(
  value: unknown
): value is RoomMessageReceiptV1 {
  return (
    isRoomJsonValueV1(value) &&
    hasExactFields(value, ROOM_RECEIPT_FIELDS) &&
    value.schemaVersion === ROOM_CONTRACT_VERSION_V1 &&
    value.status === 'accepted' &&
    isNonEmptyString(value.roomId) &&
    isNonEmptyString(value.messageId) &&
    isNonNegativeInteger(value.messageSequence) &&
    isNonEmptyString(value.eventId) &&
    isNonNegativeInteger(value.eventSequence) &&
    Array.isArray(value.deliveryIds) &&
    value.deliveryIds.every(isNonEmptyString)
  );
}

export function safeParseRoomPolicyJsonV1(
  raw: string | null | undefined
): RoomPolicyV1 | null {
  return safeJsonParse<RoomPolicyV1 | null>(
    raw,
    null,
    (value): value is RoomPolicyV1 | null => isRoomPolicyV1(value)
  );
}

export function parseRoomPolicyJsonV1(raw: string): RoomPolicyV1 {
  const policy = safeParseRoomPolicyJsonV1(raw);
  if (!policy) {
    throw storedRoomDataError('policy');
  }
  return policy;
}

export function safeParseRoomAttachmentsJsonV1(
  raw: string | null | undefined
): readonly RoomAttachmentRefV1[] | null {
  return safeJsonParse<readonly RoomAttachmentRefV1[] | null>(
    raw,
    null,
    (value): value is readonly RoomAttachmentRefV1[] | null =>
      isRoomJsonValueV1(value) &&
      Array.isArray(value) &&
      value.every(isRoomAttachmentRefV1)
  );
}

export function parseRoomAttachmentsJsonV1(
  raw: string
): readonly RoomAttachmentRefV1[] {
  const attachments = safeParseRoomAttachmentsJsonV1(raw);
  if (!attachments) {
    throw storedRoomDataError('message attachments');
  }
  return attachments;
}

export function safeParseRoomDeliveryCauseJsonV1(
  raw: string | null | undefined
): RoomDeliveryCauseV1 | null {
  return safeJsonParse<RoomDeliveryCauseV1 | null>(
    raw,
    null,
    (value): value is RoomDeliveryCauseV1 | null =>
      isRoomDeliveryCauseV1(value)
  );
}

export function parseRoomDeliveryCauseJsonV1(
  raw: string
): RoomDeliveryCauseV1 {
  const cause = safeParseRoomDeliveryCauseJsonV1(raw);
  if (!cause) {
    throw storedRoomDataError('delivery cause');
  }
  return cause;
}

export function safeParseRoomJsonValueV1(
  raw: string | null | undefined
): RoomJsonValueV1 | undefined {
  const invalid = Symbol('invalid-room-json');
  const value = safeJsonParse<RoomJsonValueV1 | typeof invalid>(raw, invalid);
  return value !== invalid && isRoomJsonValueV1(value) ? value : undefined;
}

export function parseRoomEventDataJsonV1(raw: string): RoomJsonValueV1 {
  const invalid = Symbol('invalid-room-event-data');
  const value = safeJsonParse<RoomJsonValueV1 | typeof invalid>(raw, invalid);
  if (value === invalid || !isRoomJsonValueV1(value)) {
    throw storedRoomDataError('event data');
  }
  return value;
}

export function parseRoomMessageMetadataJsonV1(
  raw: string | null
): RoomJsonValueV1 | undefined {
  if (raw === null) {
    return undefined;
  }

  const invalid = Symbol('invalid-room-message-metadata');
  const value = safeJsonParse<RoomJsonValueV1 | typeof invalid>(raw, invalid);
  if (value === invalid || !isRoomJsonValueV1(value)) {
    throw storedRoomDataError('message metadata');
  }
  return value;
}

export function parseRoomMessageEnvelopeV1(
  value: unknown
): RoomMessageEnvelopeV1 {
  if (!isRoomMessageEnvelopeV1(value)) {
    throw new ValidationError('Room message must be a valid V1 envelope.');
  }
  return value;
}

export function parseRoomDeliveryEnvelopeV1(
  value: unknown
): RoomDeliveryEnvelopeV1 {
  if (!isRoomDeliveryEnvelopeV1(value)) {
    throw new ValidationError('Room delivery must be a valid V1 envelope.');
  }
  return value;
}

export function parseRoomInboxDeliveryStatusV1(
  value: unknown
): RoomInboxDeliveryStatusV1 {
  if (
    ROOM_INBOX_DELIVERY_STATUSES_V1.some((status) => status === value)
  ) {
    return value as RoomInboxDeliveryStatusV1;
  }
  throw storedRoomDataError('delivery status');
}

export function parseRoomDelegationGrantScopeV1(
  value: unknown
): RoomDelegationGrantScopeV1 {
  if (ROOM_DELEGATION_GRANT_SCOPES_V1.some((scope) => scope === value)) {
    return value as RoomDelegationGrantScopeV1;
  }
  throw storedRoomDataError('delegation grant scope');
}

export function parseRoomDelegationGrantStatusV1(
  value: unknown
): RoomDelegationGrantStatusV1 {
  if (
    ROOM_DELEGATION_GRANT_STATUSES_V1.some((status) => status === value)
  ) {
    return value as RoomDelegationGrantStatusV1;
  }
  throw storedRoomDataError('delegation grant status');
}

export function mapRoomV1(record: RoomRecord): RoomDtoV1 {
  const policy = parseRoomPolicyJsonV1(record.policyJson);
  if (policy.participation.hostAgentId !== record.hostAgentId) {
    throw storedRoomDataError('policy host agent');
  }

  return requireStoredRoomDto('room', {
    schemaVersion: ROOM_CONTRACT_VERSION_V1,
    id: record.id,
    organizationId: record.organizationId,
    key: record.key,
    projectId: record.projectId,
    name: record.name,
    hostAgentId: record.hostAgentId,
    policy,
    messageSequence: readNonNegativeInteger(
      record.messageSequence,
      'message sequence'
    ),
    eventSequence: readNonNegativeInteger(
      record.eventSequence,
      'event sequence'
    ),
    createdAt: toRequiredIsoString(record.createdAt, 'createdAt'),
    updatedAt: toRequiredIsoString(record.updatedAt, 'updatedAt'),
  }, isRoomDtoV1);
}

export function mapRoomMessageV1(
  record: RoomMessageMappingRecord
): RoomMessageEnvelopeV1 {
  const metadata = parseRoomMessageMetadataJsonV1(record.metadataJson);
  const mentions = [...(record.mentions || [])]
    .sort((left, right) => left.mentionIndex - right.mentionIndex)
    .map((mention) => mapRoomMentionV1(mention, record));

  return requireStoredRoomDto('message', {
    schemaVersion: ROOM_CONTRACT_VERSION_V1,
    envelopeType: 'room.message',
    messageId: record.id,
    organizationId: record.organizationId,
    roomId: record.roomId,
    sequence: readNonNegativeInteger(record.sequence, 'message sequence'),
    createdAt: toRequiredIsoString(record.createdAt, 'message createdAt'),
    actor: mapStoredRoomActorV1(record),
    text: record.text,
    mentions,
    attachments: parseRoomAttachmentsJsonV1(record.attachmentsJson),
    ...(record.replyToMessageId !== null
      ? { replyToMessageId: record.replyToMessageId }
      : {}),
    ...(record.correlationId !== null
      ? { correlationId: record.correlationId }
      : {}),
    ...(metadata === undefined ? {} : { metadata }),
  }, isRoomMessageEnvelopeV1);
}

export function mapRoomInboxDeliveryV1(
  record: RoomInboxDeliveryRecord
): RoomInboxDeliveryDtoV1 {
  return requireStoredRoomDto('inbox delivery', {
    schemaVersion: ROOM_CONTRACT_VERSION_V1,
    id: record.id,
    organizationId: record.organizationId,
    roomId: record.roomId,
    roomSessionId: record.roomSessionId,
    messageId: record.messageId,
    deliverySequence: readNonNegativeInteger(
      record.deliverySequence,
      'delivery sequence'
    ),
    intent: parseRoomDeliveryIntentV1(record.intent),
    cause: parseRoomDeliveryCauseJsonV1(record.causeJson),
    attempt: readPositiveInteger(record.attempt, 'delivery attempt'),
    status: parseRoomInboxDeliveryStatusV1(record.status),
    availableAt: toRequiredIsoString(
      record.availableAt,
      'delivery availableAt'
    ),
    claimedAt: toNullableIsoString(record.claimedAt, 'delivery claimedAt'),
    completedAt: toNullableIsoString(
      record.completedAt,
      'delivery completedAt'
    ),
    lastError: record.lastError,
    createdAt: toRequiredIsoString(record.createdAt, 'delivery createdAt'),
    updatedAt: toRequiredIsoString(record.updatedAt, 'delivery updatedAt'),
  }, isRoomInboxDeliveryDtoV1);
}

export function mapRoomDeliveryEnvelopeV1(
  record: RoomInboxDeliveryRecord | RoomInboxDeliveryDtoV1,
  message: RoomMessageEnvelopeV1,
  target: RoomAgentRefV1
): RoomDeliveryEnvelopeV1 {
  const delivery =
    'schemaVersion' in record ? record : mapRoomInboxDeliveryV1(record);
  if (!isRoomInboxDeliveryDtoV1(delivery)) {
    throw new ValidationError('Room delivery DTO must use the V1 schema.');
  }

  if (
    delivery.organizationId !== message.organizationId ||
    delivery.roomId !== message.roomId ||
    delivery.messageId !== message.messageId
  ) {
    throw new ValidationError(
      'Room delivery and message identities must match.'
    );
  }

  return parseRoomDeliveryEnvelopeV1({
    schemaVersion: ROOM_CONTRACT_VERSION_V1,
    envelopeType: 'room.delivery',
    deliveryId: delivery.id,
    roomSessionId: delivery.roomSessionId,
    deliverySequence: delivery.deliverySequence,
    attempt: delivery.attempt,
    createdAt: delivery.createdAt,
    target,
    intent: delivery.intent,
    cause: delivery.cause,
    message,
  });
}

export function mapRoomEventV1(record: RoomEventRecord): RoomEventDtoV1 {
  return requireStoredRoomDto('event', {
    schemaVersion: ROOM_CONTRACT_VERSION_V1,
    eventId: record.id,
    organizationId: record.organizationId,
    roomId: record.roomId,
    sequence: readNonNegativeInteger(record.sequence, 'event sequence'),
    type: record.type,
    createdAt: toRequiredIsoString(record.createdAt, 'event createdAt'),
    data: parseRoomEventDataJsonV1(record.dataJson),
  }, isRoomEventDtoV1);
}

export function mapRoomDelegationGrantV1(
  record: RoomDelegationGrantRecord
): RoomDelegationGrantDtoV1 {
  return requireStoredRoomDto('delegation grant', {
    schemaVersion: ROOM_CONTRACT_VERSION_V1,
    id: record.id,
    organizationId: record.organizationId,
    roomId: record.roomId,
    issuedByUserId: record.issuedByUserId,
    fromAgentId: record.fromAgentId,
    targetAgentId: record.targetAgentId,
    scope: parseRoomDelegationGrantScopeV1(record.scope),
    status: parseRoomDelegationGrantStatusV1(record.status),
    rootMessageId: record.rootMessageId,
    consumedByInvocationId: record.consumedByInvocationId,
    consumedAt: toNullableIsoString(record.consumedAt, 'grant consumedAt'),
    revokedAt: toNullableIsoString(record.revokedAt, 'grant revokedAt'),
    expiresAt: toRequiredIsoString(record.expiresAt, 'grant expiresAt'),
    hopLimit: readPositiveInteger(record.hopLimit, 'grant hopLimit'),
    invocationLimit: readPositiveInteger(
      record.invocationLimit,
      'grant invocationLimit'
    ),
    invocationCount: readNonNegativeInteger(
      record.invocationCount,
      'grant invocationCount'
    ),
    createdAt: toRequiredIsoString(record.createdAt, 'grant createdAt'),
    updatedAt: toRequiredIsoString(record.updatedAt, 'grant updatedAt'),
  }, isRoomDelegationGrantDtoV1);
}

export function toRoomMessageReceiptV1(input: {
  roomId: string;
  messageId: string;
  messageSequence: number;
  eventId: string;
  eventSequence: number;
  deliveryIds: readonly string[];
}): RoomMessageReceiptV1 {
  return requireStoredRoomDto('message receipt', {
    schemaVersion: ROOM_CONTRACT_VERSION_V1,
    status: 'accepted',
    roomId: input.roomId,
    messageId: input.messageId,
    messageSequence: readNonNegativeInteger(
      input.messageSequence,
      'receipt message sequence'
    ),
    eventId: input.eventId,
    eventSequence: readNonNegativeInteger(
      input.eventSequence,
      'receipt event sequence'
    ),
    deliveryIds: [...input.deliveryIds],
  }, isRoomMessageReceiptV1);
}

export const mapRoom = mapRoomV1;
export const mapRoomMessage = mapRoomMessageV1;
export const mapRoomInboxDelivery = mapRoomInboxDeliveryV1;
export const mapRoomEvent = mapRoomEventV1;
export const mapRoomDelegationGrant = mapRoomDelegationGrantV1;
export const toRoomDeliveryReceiptV1 = toRoomMessageReceiptV1;

function mapStoredRoomActorV1(
  record: Pick<
    RoomMessageMappingRecord,
    'actorType' | 'actorId' | 'actorDisplayName' | 'actorHandle'
  >
): RoomActorRefV1 {
  let actor: RoomActorRefV1;
  switch (record.actorType) {
    case 'human':
      actor = {
        type: 'human',
        userId: record.actorId,
        ...(record.actorDisplayName !== null
          ? { displayName: record.actorDisplayName }
          : {}),
      };
      break;
    case 'agent':
      actor = {
        type: 'agent',
        agentId: record.actorId,
        handle: record.actorHandle || record.actorId,
        ...(record.actorDisplayName !== null
          ? { displayName: record.actorDisplayName }
          : {}),
      };
      break;
    case 'system':
      actor = {
        type: 'system',
        systemId: record.actorId,
      };
      break;
    default:
      throw storedRoomDataError('message actor type');
  }
  return requireStoredRoomDto('message actor', actor, isRoomActorRefV1);
}

function mapRoomMentionV1(
  mention: RoomMentionRecord,
  message: Pick<RoomMessageRecord, 'id' | 'organizationId' | 'roomId' | 'text'>
): RoomAgentMentionV1 {
  if (
    mention.messageId !== message.id ||
    mention.organizationId !== message.organizationId ||
    mention.roomId !== message.roomId ||
    !isNonNegativeInteger(mention.mentionIndex)
  ) {
    throw storedRoomDataError('message mention identity');
  }

  const mapped: RoomAgentMentionV1 = {
    type: 'agent',
    agentId: mention.agentId,
    handle: mention.handle,
    range: {
      start: mention.rangeStart,
      end: mention.rangeEnd,
    },
  };

  if (
    !isRoomAgentMentionV1(mapped) ||
    mapped.range.end > message.text.length
  ) {
    throw storedRoomDataError('message mention range');
  }
  return mapped;
}

export function isRoomAgentRefV1(value: unknown): value is RoomAgentRefV1 {
  return (
    isRoomJsonValueV1(value) &&
    hasExactFields(
      value,
      ['agentId', 'handle'],
      ['displayName']
    ) &&
    isNonEmptyString(value.agentId) &&
    isNonEmptyString(value.handle) &&
    isOptionalOwnString(value, 'displayName')
  );
}

export function isRoomDelegationInvocationV1(
  value: unknown
): value is RoomDelegationInvocationV1 {
  return (
    isRoomJsonValueV1(value) &&
    hasExactFields(value, [
      'invocationId',
      'rootMessageId',
      'fromAgentId',
      'targetAgentId',
    ]) &&
    isNonEmptyString(value.invocationId) &&
    isNonEmptyString(value.rootMessageId) &&
    isNonEmptyString(value.fromAgentId) &&
    isNonEmptyString(value.targetAgentId)
  );
}

export function isRoomDelegationTraceV1(
  value: unknown
): value is RoomDelegationTraceV1 {
  return (
    isRoomJsonValueV1(value) &&
    hasExactFields(value, ['rootMessageId', 'lineage', 'invocations']) &&
    isNonEmptyString(value.rootMessageId) &&
    Array.isArray(value.lineage) &&
    value.lineage.every(isNonEmptyString) &&
    Array.isArray(value.invocations) &&
    value.invocations.every(isRoomDelegationInvocationV1)
  );
}

export function isRoomDeliveryIntentV1(
  value: unknown
): value is RoomDeliveryIntentV1 {
  return ROOM_DELIVERY_INTENTS_V1.some((intent) => intent === value);
}

export function parseRoomDeliveryIntentV1(
  value: unknown
): RoomDeliveryIntentV1 {
  if (isRoomDeliveryIntentV1(value)) {
    return value;
  }
  throw storedRoomDataError('delivery intent');
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isOptionalOwnString(
  value: Record<string, unknown>,
  field: string
) {
  return !hasOwn(value, field) || typeof value[field] === 'string';
}

function isOptionalOwnNonEmptyString(
  value: Record<string, unknown>,
  field: string
) {
  return !hasOwn(value, field) || isNonEmptyString(value[field]);
}

function hasExactFields(
  value: unknown,
  requiredFields: readonly string[],
  optionalFields: readonly string[] = []
): value is Record<string, unknown> {
  if (!isRecord(value) || !isPlainObject(value)) return false;
  const allowedFields = new Set([...requiredFields, ...optionalFields]);
  return (
    requiredFields.every((field) => hasOwn(value, field)) &&
    Object.keys(value).every((field) => allowedFields.has(field))
  );
}

function hasOwn(value: object, field: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isRoomInboxDeliveryStatusV1(
  value: unknown
): value is RoomInboxDeliveryStatusV1 {
  return ROOM_INBOX_DELIVERY_STATUSES_V1.some(
    (status) => status === value
  );
}

function isRoomDelegationGrantScopeV1(
  value: unknown
): value is RoomDelegationGrantScopeV1 {
  return ROOM_DELEGATION_GRANT_SCOPES_V1.some((scope) => scope === value);
}

function isRoomDelegationGrantStatusV1(
  value: unknown
): value is RoomDelegationGrantStatusV1 {
  return ROOM_DELEGATION_GRANT_STATUSES_V1.some(
    (status) => status === value
  );
}

function readNonNegativeInteger(value: number, field: string): number {
  if (!isNonNegativeInteger(value)) {
    throw storedRoomDataError(field);
  }
  return value;
}

function readPositiveInteger(value: number, field: string): number {
  if (!isPositiveInteger(value)) {
    throw storedRoomDataError(field);
  }
  return value;
}

function isIsoDateString(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function isNullableIsoDateString(value: unknown): value is string | null {
  return value === null || isIsoDateString(value);
}

function toRequiredIsoString(
  value: Date | string,
  field: string
): string {
  if (typeof value === 'string' && !isIsoDateString(value)) {
    throw storedRoomDataError(field);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw storedRoomDataError(field);
  }
  return date.toISOString();
}

function toNullableIsoString(
  value: Date | string | null,
  field: string
): string | null {
  return value === null ? null : toRequiredIsoString(value, field);
}

function requireStoredRoomDto<T>(
  field: string,
  value: unknown,
  validator: (value: unknown) => value is T
): T {
  if (!validator(value)) {
    throw storedRoomDataError(field);
  }
  return value;
}

function storedRoomDataError(field: string) {
  return new ValidationError(`Stored room ${field} is invalid.`);
}
