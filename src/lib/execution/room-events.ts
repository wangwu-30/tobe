import type { RoomEventDtoV1 } from '@/objects/room';

export const EXECUTION_ROOM_EVENT_TYPES = [
  'execution.input_requested',
  'execution.input_answered',
  'execution.input_cancelled',
  'execution.completed',
] as const;

export type ExecutionRoomEventType =
  (typeof EXECUTION_ROOM_EVENT_TYPES)[number];

export type ExecutionRoomEventJobStatus =
  | 'cancelled'
  | 'failed'
  | 'queued'
  | 'succeeded'
  | 'waiting_input';

export type ExecutionRoomEventPayload = {
  schemaVersion: 1;
  jobId: string;
  requestId?: string;
  jobStatus: ExecutionRoomEventJobStatus;
  jobRevision: number;
  inputRevision?: number;
  occurredAt: string;
  teamTaskId?: string;
};

export type ExecutionRoomLifecycleEvent = {
  eventId: string;
  roomId: string;
  sequence: number;
  type: ExecutionRoomEventType;
  data: ExecutionRoomEventPayload;
};

const COMMON_FIELDS = [
  'schemaVersion',
  'jobId',
  'jobStatus',
  'jobRevision',
  'occurredAt',
] as const;
const INPUT_FIELDS = [...COMMON_FIELDS, 'requestId', 'inputRevision'] as const;
const OPTIONAL_FIELDS = ['teamTaskId'] as const;
const INPUT_EVENT_STATUSES = {
  'execution.input_requested': 'waiting_input',
  'execution.input_answered': 'queued',
  'execution.input_cancelled': 'cancelled',
} as const;
const TERMINAL_STATUSES = new Set<ExecutionRoomEventJobStatus>([
  'cancelled',
  'failed',
  'succeeded',
]);

/**
 * Parses the public Execution projection carried by a durable Room event.
 * Unknown event types and malformed payloads are intentionally invisible to
 * the Room UI so a bad projection cannot break the rest of the feed.
 */
export function parseExecutionRoomEvent(
  event: RoomEventDtoV1
): ExecutionRoomLifecycleEvent | null {
  if (!isExecutionRoomEventType(event.type) || !isPlainRecord(event.data)) {
    return null;
  }

  const isCompleted = event.type === 'execution.completed';
  if (
    !hasExactFields(
      event.data,
      isCompleted ? COMMON_FIELDS : INPUT_FIELDS,
      OPTIONAL_FIELDS
    ) ||
    event.data.schemaVersion !== 1 ||
    !isNonEmptyString(event.data.jobId) ||
    !isPositiveSafeInteger(event.data.jobRevision) ||
    !isCanonicalIsoDateString(event.data.occurredAt) ||
    (hasOwn(event.data, 'teamTaskId') &&
      !isNonEmptyString(event.data.teamTaskId))
  ) {
    return null;
  }

  if (event.type === 'execution.completed') {
    if (!TERMINAL_STATUSES.has(event.data.jobStatus as ExecutionRoomEventJobStatus)) {
      return null;
    }

    return {
      eventId: event.eventId,
      roomId: event.roomId,
      sequence: event.sequence,
      type: event.type,
      data: {
        schemaVersion: 1,
        jobId: event.data.jobId,
        jobStatus: event.data.jobStatus as ExecutionRoomEventJobStatus,
        jobRevision: event.data.jobRevision,
        occurredAt: event.data.occurredAt,
        ...(hasOwn(event.data, 'teamTaskId')
          ? { teamTaskId: event.data.teamTaskId as string }
          : {}),
      },
    };
  }

  const expectedStatus = INPUT_EVENT_STATUSES[event.type];
  if (
    event.data.jobStatus !== expectedStatus ||
    !isNonEmptyString(event.data.requestId) ||
    !isPositiveSafeInteger(event.data.inputRevision)
  ) {
    return null;
  }

  return {
    eventId: event.eventId,
    roomId: event.roomId,
    sequence: event.sequence,
    type: event.type,
    data: {
      schemaVersion: 1,
      jobId: event.data.jobId,
      jobStatus: event.data.jobStatus as ExecutionRoomEventJobStatus,
      jobRevision: event.data.jobRevision,
      occurredAt: event.data.occurredAt,
      requestId: event.data.requestId,
      inputRevision: event.data.inputRevision,
      ...(hasOwn(event.data, 'teamTaskId')
        ? { teamTaskId: event.data.teamTaskId as string }
        : {}),
    },
  };
}

function isExecutionRoomEventType(
  value: string
): value is ExecutionRoomEventType {
  return EXECUTION_ROOM_EVENT_TYPES.some((type) => type === value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactFields(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[]
) {
  const allowed = new Set([...required, ...optional]);
  const fields = Object.keys(value);
  return (
    required.every((field) => hasOwn(value, field)) &&
    fields.every((field) => allowed.has(field))
  );
}

function hasOwn(value: Record<string, unknown>, field: string) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isCanonicalIsoDateString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}
