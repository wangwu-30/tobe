import type {
  RoomAgentMentionV1,
  RoomJsonValueV1,
} from '@/agent/room-runtime/contracts';
import type {
  RoomDelegationGrantDtoV1,
  RoomDtoV1,
  RoomEventDtoV1,
  RoomMessageDtoV1,
  RoomMessageReceiptV1,
} from '@/objects/room';
import { isRoomDelegationGrantDtoV1 } from '@/objects/room/schema';
import {
  isRoomToolConfirmationRequestDtoV1,
  type RoomToolConfirmationDecisionReceiptV1,
  type RoomToolConfirmationRequestDtoV1,
  type RoomToolConfirmationStatusV1,
} from '@/objects/room-tool-confirmation/schema';
import {
  apiCall,
  apiFetch,
  isRecord,
  safeJsonParse,
} from '@/framework/resilience';

export const ROOM_EVENT_PAGE_SIZE = 100;
export const ROOM_MESSAGE_PAGE_SIZE = 200;

export type RoomAgent = {
  builtin: boolean;
  description: string;
  enabled: boolean;
  handle: string;
  id: string;
  name: string;
  skills: string[];
};

export type SendRoomMessageInput = {
  correlationId: string;
  mentions: readonly RoomAgentMentionV1[];
  replyToMessageId?: string | null;
  text: string;
};

export type IssueRoomDelegationGrantInput = {
  fromAgentId: string;
  rootMessageId?: string | null;
  scope: 'once' | 'room';
  targetAgentId: string;
};

export type RoomClientResult<T> =
  | { data: T; ok: true }
  | { error: string; ok: false; retryable: boolean };

export async function getProjectRoom(
  projectId?: string | null,
  signal?: AbortSignal
): Promise<RoomClientResult<RoomDtoV1>> {
  const query = new URLSearchParams();
  if (projectId) query.set('projectId', projectId);
  const result = await apiCall<unknown>(
    `/api/rooms${query.size ? `?${query.toString()}` : ''}`,
    { signal }
  );
  if (!result.ok) return apiFailure(result.error);

  const room = isRecord(result.data) ? result.data.room : null;
  return isRoom(room)
    ? { data: room, ok: true }
    : invalidResponse('Room response did not contain a valid room.');
}

export async function listRoomAgents(signal?: AbortSignal): Promise<
  RoomClientResult<RoomAgent[]>
> {
  const result = await apiCall<unknown>('/api/agents', { signal });
  if (!result.ok) return apiFailure(result.error);

  const items = isRecord(result.data) && Array.isArray(result.data.agents)
    ? result.data.agents
    : [];
  return {
    data: items
      .map(normalizeRoomAgent)
      .filter((agent): agent is RoomAgent => agent !== null),
    ok: true,
  };
}

export async function listRoomMessages(
  roomId: string,
  after = 0,
  signal?: AbortSignal
): Promise<RoomClientResult<RoomMessageDtoV1[]>> {
  const result = await apiCall<unknown>(
    `/api/rooms/${encodeURIComponent(roomId)}/messages?after=${after}&limit=${ROOM_MESSAGE_PAGE_SIZE}`,
    { signal }
  );
  if (!result.ok) return apiFailure(result.error);

  const items = isRecord(result.data) && Array.isArray(result.data.messages)
    ? result.data.messages
    : null;
  if (!items) return invalidResponse('Room message response was invalid.');

  const messages = items.filter(isRoomMessage);
  return messages.length === items.length
    ? { data: messages, ok: true }
    : invalidResponse('Room message response contained an invalid message.');
}

export async function listRoomEvents(
  roomId: string,
  after = 0,
  signal?: AbortSignal
): Promise<RoomClientResult<RoomEventDtoV1[]>> {
  const result = await apiCall<unknown>(
    `/api/rooms/${encodeURIComponent(roomId)}/events?format=json&after=${after}&limit=${ROOM_EVENT_PAGE_SIZE}`,
    { signal }
  );
  if (!result.ok) return apiFailure(result.error);

  const items = isRecord(result.data) && Array.isArray(result.data.events)
    ? result.data.events
    : null;
  if (!items) return invalidResponse('Room event response was invalid.');

  const events = items.filter(isRoomEvent);
  return events.length === items.length
    ? { data: events, ok: true }
    : invalidResponse('Room event response contained an invalid event.');
}

export async function sendRoomMessage(
  roomId: string,
  input: SendRoomMessageInput
): Promise<RoomClientResult<RoomMessageReceiptV1>> {
  const result = await apiCall<unknown>(
    `/api/rooms/${encodeURIComponent(roomId)}/messages`,
    {
      body: JSON.stringify({
        schemaVersion: 1,
        text: input.text,
        mentions: input.mentions,
        attachments: [],
        ...(input.replyToMessageId
          ? { replyToMessageId: input.replyToMessageId }
          : {}),
        correlationId: input.correlationId,
        metadata: {
          client: 'project-room-web',
          selectedAgentIds: input.mentions.map((mention) => mention.agentId),
        },
      }),
      headers: {
        'Content-Type': 'application/json',
        'x-dao-idempotency-key': input.correlationId,
      },
      method: 'POST',
    }
  );
  if (!result.ok) return apiFailure(result.error);

  const receipt = isRecord(result.data) ? result.data.receipt : null;
  return isRoomMessageReceipt(receipt)
    ? { data: receipt, ok: true }
    : invalidResponse('Room accepted the message without a valid receipt.');
}

export async function issueRoomDelegationGrant(
  roomId: string,
  input: IssueRoomDelegationGrantInput
): Promise<RoomClientResult<RoomDelegationGrantDtoV1>> {
  const result = await apiCall<unknown>(
    `/api/rooms/${encodeURIComponent(roomId)}/grants`,
    {
      body: JSON.stringify({
        schemaVersion: 1,
        fromAgentId: input.fromAgentId,
        targetAgentId: input.targetAgentId,
        scope: input.scope,
        ...(input.rootMessageId
          ? { rootMessageId: input.rootMessageId }
          : {}),
      }),
      headers: {
        'Content-Type': 'application/json',
        'x-dao-idempotency-key': `room-web:grant:issue:${crypto.randomUUID()}`,
      },
      method: 'POST',
    }
  );
  if (!result.ok) return apiFailure(result.error);

  const grant = isRecord(result.data) && result.data.schemaVersion === 1
    ? result.data.grant
    : null;
  return isRoomDelegationGrantDtoV1(grant)
    ? { data: grant, ok: true }
    : invalidResponse('Room grant response did not contain a valid grant.');
}

export async function revokeRoomDelegationGrant(
  roomId: string,
  grantId: string
): Promise<RoomClientResult<RoomDelegationGrantDtoV1>> {
  const result = await apiCall<unknown>(
    `/api/rooms/${encodeURIComponent(roomId)}/grants/${encodeURIComponent(grantId)}/revoke`,
    {
      headers: {
        'x-dao-idempotency-key': `room-web:grant:revoke:${crypto.randomUUID()}`,
      },
      method: 'POST',
    }
  );
  if (!result.ok) return apiFailure(result.error);

  const grant = isRecord(result.data) && result.data.schemaVersion === 1
    ? result.data.grant
    : null;
  return isRoomDelegationGrantDtoV1(grant)
    ? { data: grant, ok: true }
    : invalidResponse('Room grant response did not contain a valid grant.');
}

export async function listRoomToolConfirmations(
  roomId: string,
  status?: RoomToolConfirmationStatusV1,
  signal?: AbortSignal
): Promise<RoomClientResult<RoomToolConfirmationRequestDtoV1[]>> {
  const query = new URLSearchParams({ roomId });
  if (status) query.set('status', status);
  const result = await apiCall<unknown>(
    `/api/room-tool-confirmations?${query.toString()}`,
    { signal }
  );
  if (!result.ok) return apiFailure(result.error);
  const items =
    isRecord(result.data) &&
    result.data.schemaVersion === 1 &&
    Array.isArray(result.data.items)
      ? result.data.items
      : null;
  if (!items || !items.every(isRoomToolConfirmationRequestDtoV1)) {
    return invalidResponse('Room confirmation response was invalid.');
  }
  return { data: items, ok: true };
}

export function approveRoomToolConfirmation(
  requestId: string,
  expectedRevision: number
): Promise<RoomClientResult<RoomToolConfirmationDecisionReceiptV1>> {
  return decideRoomToolConfirmation(requestId, 'approve', expectedRevision);
}

export function rejectRoomToolConfirmation(
  requestId: string,
  expectedRevision: number
): Promise<RoomClientResult<RoomToolConfirmationDecisionReceiptV1>> {
  return decideRoomToolConfirmation(requestId, 'reject', expectedRevision);
}

async function decideRoomToolConfirmation(
  requestId: string,
  decision: 'approve' | 'reject',
  expectedRevision: number
): Promise<RoomClientResult<RoomToolConfirmationDecisionReceiptV1>> {
  const result = await apiCall<unknown>(
    `/api/room-tool-confirmations/${encodeURIComponent(requestId)}/${decision}`,
    {
      body: JSON.stringify({ schemaVersion: 1, expectedRevision }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }
  );
  if (!result.ok) return apiFailure(result.error);
  const request = isRecord(result.data) ? result.data.request : null;
  if (
    !isRecord(result.data) ||
    result.data.schemaVersion !== 1 ||
    !isRoomToolConfirmationRequestDtoV1(request)
  ) {
    return invalidResponse('Room confirmation decision response was invalid.');
  }
  return {
    data: result.data as RoomToolConfirmationDecisionReceiptV1,
    ok: true,
  };
}

export type RoomEventStreamCallbacks = {
  onConnectionChange?: (state: 'connecting' | 'live') => void;
  onEvent: (event: RoomEventDtoV1) => void;
};

/**
 * Opens a fetch-based SSE stream so reconnects can explicitly carry the last
 * durable sequence in both query and Last-Event-ID header.
 */
export async function consumeRoomEventStream(
  roomId: string,
  after: number,
  signal: AbortSignal,
  callbacks: RoomEventStreamCallbacks
): Promise<number> {
  callbacks.onConnectionChange?.('connecting');
  const response = await apiFetch(
    `/api/rooms/${encodeURIComponent(roomId)}/events?format=sse&after=${after}&limit=${ROOM_EVENT_PAGE_SIZE}`,
    {
      headers: {
        Accept: 'text/event-stream',
        'Last-Event-ID': String(after),
      },
      retries: 0,
      signal,
      timeoutMs: 0,
    }
  );
  if (!response.ok || !response.body) {
    throw new Error(`Room event stream failed (${response.status}).`);
  }

  callbacks.onConnectionChange?.('live');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let cursor = after;

  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseRoomSseFrame(frame);
        if (event && event.sequence > cursor) {
          cursor = event.sequence;
          callbacks.onEvent(event);
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }

  return cursor;
}

export function parseRoomSseFrame(frame: string): RoomEventDtoV1 | null {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (!data) return null;

  const value = safeJsonParse<unknown>(data, null);
  return isRoomEvent(value) ? value : null;
}

export function getRoomEventMessage(
  event: RoomEventDtoV1
): RoomMessageDtoV1 | null {
  if (
    event.type !== 'message.accepted' &&
    event.type !== 'room.message.created'
  ) {
    return null;
  }
  if (!isRecord(event.data)) return null;
  return isRoomMessage(event.data.message) ? event.data.message : null;
}

export function getRoomDeliveryAgentIds(event: RoomEventDtoV1): string[] {
  if (event.type !== 'message.accepted' || !isRecord(event.data)) return [];
  const deliveries = Array.isArray(event.data.deliveries)
    ? event.data.deliveries
    : [];
  return deliveries
    .map((delivery) => {
      if (!isRecord(delivery)) return null;
      if (typeof delivery.targetAgentId === 'string') return delivery.targetAgentId;
      const target = isRecord(delivery.target) ? delivery.target : null;
      return target && typeof target.agentId === 'string'
        ? target.agentId
        : null;
    })
    .filter((id): id is string => Boolean(id));
}

function normalizeRoomAgent(value: unknown): RoomAgent | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  const handle = typeof value.handle === 'string' ? value.handle.trim() : '';
  if (!handle) return null;
  return {
    builtin: value.builtin === true,
    description: typeof value.description === 'string' ? value.description : '',
    enabled: value.enabled !== false,
    handle: handle.startsWith('@') ? handle : `@${handle}`,
    id: value.id,
    name:
      typeof value.name === 'string' && value.name.trim()
        ? value.name
        : handle.replace(/^@/, ''),
    skills: Array.isArray(value.skills)
      ? value.skills.filter((skill): skill is string => typeof skill === 'string')
      : [],
  };
}

function isRoom(value: unknown): value is RoomDtoV1 {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.hostAgentId === 'string' &&
    Number.isSafeInteger(value.messageSequence) &&
    Number.isSafeInteger(value.eventSequence)
  );
}

function isRoomMessage(value: unknown): value is RoomMessageDtoV1 {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    value.envelopeType === 'room.message' &&
    typeof value.messageId === 'string' &&
    typeof value.roomId === 'string' &&
    Number.isSafeInteger(value.sequence) &&
    typeof value.createdAt === 'string' &&
    isRecord(value.actor) &&
    typeof value.actor.type === 'string' &&
    typeof value.text === 'string' &&
    Array.isArray(value.mentions) &&
    Array.isArray(value.attachments)
  );
}

function isRoomEvent(value: unknown): value is RoomEventDtoV1 {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.eventId === 'string' &&
    typeof value.roomId === 'string' &&
    Number.isSafeInteger(value.sequence) &&
    typeof value.type === 'string' &&
    typeof value.createdAt === 'string' &&
    isRoomJson(value.data)
  );
}

function isRoomMessageReceipt(value: unknown): value is RoomMessageReceiptV1 {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    value.status === 'accepted' &&
    typeof value.roomId === 'string' &&
    typeof value.messageId === 'string' &&
    Number.isSafeInteger(value.messageSequence) &&
    typeof value.eventId === 'string' &&
    Number.isSafeInteger(value.eventSequence) &&
    Array.isArray(value.deliveryIds) &&
    value.deliveryIds.every((id) => typeof id === 'string')
  );
}

function isRoomJson(value: unknown): value is RoomJsonValueV1 {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isRoomJson);
  return isRecord(value) && Object.values(value).every(isRoomJson);
}

function apiFailure(error: { message: string; retryable: boolean }) {
  return { error: error.message, ok: false, retryable: error.retryable } as const;
}

function invalidResponse(message: string) {
  return { error: message, ok: false, retryable: true } as const;
}
