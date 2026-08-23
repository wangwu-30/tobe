import type {
  RoomAgentMentionV1,
  RoomAttachmentRefV1,
  RoomJsonValueV1,
} from '@/agent/room-runtime';
import {
  UnauthorizedError,
  ValidationError,
  isRecord,
  safeJsonParse,
} from '@/framework/resilience';
import {
  DAO_DEVICE_HEADER,
  DAO_ORGANIZATION_HEADER,
  DAO_USER_HEADER,
  LOCAL_DEVICE_ID,
  LOCAL_ORGANIZATION_ID,
  LOCAL_USER_ID,
} from '@/lib/platform/defaults';
import type {
  EnsureDefaultRoomInput,
  IssueRoomDelegationGrantInputV1,
  PostRoomMessageInputV1,
} from '@/objects/room';
import { isRoomJsonValueV1 } from '@/objects/room/schema';

export const DEFAULT_ROOM_LIST_LIMIT = 100;
export const MAX_ROOM_LIST_LIMIT = 200;

const MAX_REQUEST_BODY_LENGTH = 1_000_000;
const MAX_ID_LENGTH = 256;
const MAX_NAME_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 100_000;
const MAX_COLLECTION_LENGTH = 100;
const MAX_IDEMPOTENCY_KEY_LENGTH = 512;
const INVALID_JSON = Symbol('invalid-json');

type RoomActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

type RoomActorResolverDependencies = {
  getLocalContext: () => Promise<RoomActorContext>;
  isExistingContext: (actor: RoomActorContext) => Promise<boolean>;
};

const defaultRoomActorResolverDependencies: RoomActorResolverDependencies = {
  getLocalContext: async () => {
    const { getPlatformContextFromHeaders } = await import(
      '@/lib/platform/server-context'
    );
    return getPlatformContextFromHeaders();
  },
  isExistingContext: isExistingRoomActorContext,
};

const ROOM_ENSURE_FIELDS = new Set([
  'schemaVersion',
  'projectId',
  'hostAgentId',
  'name',
]);

const ROOM_MESSAGE_FIELDS = new Set([
  'schemaVersion',
  'text',
  'mentions',
  'attachments',
  'replyToMessageId',
  'correlationId',
  'metadata',
]);

const ROOM_GRANT_FIELDS = new Set([
  'schemaVersion',
  'fromAgentId',
  'targetAgentId',
  'scope',
  'rootMessageId',
]);
const ROOM_MENTION_FIELDS = new Set(['type', 'agentId', 'handle', 'range']);
const ROOM_MENTION_RANGE_FIELDS = new Set(['start', 'end']);
const ROOM_ATTACHMENT_FIELDS = new Set([
  'attachmentId',
  'mediaType',
  'name',
  'uri',
]);

export type RoomEnsureHttpInput = EnsureDefaultRoomInput;
export type RoomMessageHttpInput = PostRoomMessageInputV1;
export type RoomGrantHttpInput = IssueRoomDelegationGrantInputV1;

/**
 * Resolves a Room caller without letting untrusted identity headers create or
 * promote platform records. Only a completely headerless local request may
 * use the local runtime bootstrap path; any explicit identity header must describe
 * an actor tuple that already exists in full.
 */
export async function getRoomActorFromHeaders(
  headers: Headers,
  dependencies: RoomActorResolverDependencies =
    defaultRoomActorResolverDependencies
): Promise<RoomActorContext> {
  const hasExplicitIdentity = [
    DAO_DEVICE_HEADER,
    DAO_ORGANIZATION_HEADER,
    DAO_USER_HEADER,
  ].some((header) => headers.has(header));
  const actor = {
    deviceId: readRoomActorHeader(
      headers,
      DAO_DEVICE_HEADER,
      LOCAL_DEVICE_ID
    ),
    organizationId: readRoomActorHeader(
      headers,
      DAO_ORGANIZATION_HEADER,
      LOCAL_ORGANIZATION_ID
    ),
    userId: readRoomActorHeader(headers, DAO_USER_HEADER, LOCAL_USER_ID),
  };

  if (!hasExplicitIdentity) {
    return dependencies.getLocalContext();
  }

  if (!(await dependencies.isExistingContext(actor))) {
    throw new UnauthorizedError('Room actor headers are not authorized.');
  }

  return actor;
}

export function readRoomEnsureQuery(searchParams: URLSearchParams) {
  return omitUndefined({
    projectId: readOptionalQueryText(searchParams, 'projectId', MAX_ID_LENGTH),
    hostAgentId: readOptionalQueryText(
      searchParams,
      'hostAgentId',
      MAX_ID_LENGTH
    ),
    name: readOptionalQueryText(searchParams, 'name', MAX_NAME_LENGTH),
  });
}

export async function readRoomEnsureBody(
  request: Request
): Promise<RoomEnsureHttpInput> {
  const body = await readJsonObject(request, { allowEmpty: true });
  assertAllowedFields(body, ROOM_ENSURE_FIELDS);
  assertSchemaVersion(body.schemaVersion);

  return omitUndefined({
    projectId: readOptionalNullableText(
      body.projectId,
      'projectId',
      MAX_ID_LENGTH
    ),
    hostAgentId: readOptionalNullableText(
      body.hostAgentId,
      'hostAgentId',
      MAX_ID_LENGTH
    ),
    name: readOptionalNullableText(body.name, 'name', MAX_NAME_LENGTH),
  });
}

export async function readRoomMessageBody(
  request: Request
): Promise<RoomMessageHttpInput> {
  const body = await readJsonObject(request);
  assertAllowedFields(body, ROOM_MESSAGE_FIELDS);
  assertSchemaVersion(body.schemaVersion);

  const text = readRequiredText(body.text, 'text', MAX_MESSAGE_LENGTH, false);

  return omitUndefined({
    text,
    mentions: readMentions(body.mentions, text),
    attachments: readAttachments(body.attachments),
    replyToMessageId: readOptionalText(
      body.replyToMessageId,
      'replyToMessageId',
      MAX_ID_LENGTH
    ),
    correlationId: readOptionalText(
      body.correlationId,
      'correlationId',
      MAX_ID_LENGTH
    ),
    metadata: readOptionalJsonValue(body.metadata, 'metadata'),
  });
}

export async function readRoomGrantBody(
  request: Request
): Promise<RoomGrantHttpInput> {
  const body = await readJsonObject(request);
  assertAllowedFields(body, ROOM_GRANT_FIELDS);
  assertSchemaVersion(body.schemaVersion);

  const scope = readRequiredText(body.scope, 'scope', 64);
  if (scope !== 'once' && scope !== 'room') {
    throw new ValidationError('scope must be either once or room.');
  }

  return omitUndefined({
    fromAgentId: readRequiredText(
      body.fromAgentId,
      'fromAgentId',
      MAX_ID_LENGTH
    ),
    targetAgentId: readRequiredText(
      body.targetAgentId,
      'targetAgentId',
      MAX_ID_LENGTH
    ),
    scope,
    rootMessageId: readOptionalText(
      body.rootMessageId,
      'rootMessageId',
      MAX_ID_LENGTH
    ),
  });
}

export function readRoomListOptions(
  searchParams: URLSearchParams,
  options: { lastEventId?: string | null } = {}
) {
  const queryAfter = searchParams.get('after');
  const queryCursor = readNonNegativeInteger(queryAfter, 'after', 0);
  const headerCursor = readNonNegativeInteger(
    options.lastEventId ?? null,
    'Last-Event-ID',
    0
  );
  // Never move a reconnecting consumer backwards when both cursor forms are
  // present. This also makes an explicitly supplied query cursor safe for
  // clients that automatically retain Last-Event-ID.
  const after = Math.max(queryCursor, headerCursor);
  const limit = readPositiveInteger(
    searchParams.get('limit'),
    'limit',
    DEFAULT_ROOM_LIST_LIMIT
  );

  if (limit > MAX_ROOM_LIST_LIMIT) {
    throw new ValidationError(
      `limit must be no greater than ${MAX_ROOM_LIST_LIMIT}.`
    );
  }

  return { after, limit };
}

export function readRoomId(value: string, field = 'roomId') {
  return readRequiredText(value, field, MAX_ID_LENGTH);
}

export function readIdempotencyKey(
  headers: Headers,
  canonicalHeader: string
) {
  const value =
    headers.get(canonicalHeader)?.trim() ||
    headers.get('x-idempotency-key')?.trim() ||
    headers.get('idempotency-key')?.trim() ||
    null;

  if (value && value.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new ValidationError(
      `Idempotency key must be no longer than ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`
    );
  }

  return value;
}

export function wantsRoomEventStream(
  request: Request,
  searchParams: URLSearchParams
) {
  const format = searchParams.get('format');
  if (format !== null) {
    if (format === 'sse') return true;
    if (format === 'json') return false;
    throw new ValidationError('format must be either json or sse.');
  }

  return (request.headers.get('accept') ?? '')
    .split(',')
    .some((entry) => {
      const [mediaType, ...parameters] = entry.split(';');
      if (mediaType.trim().toLowerCase() !== 'text/event-stream') {
        return false;
      }
      const quality = parameters
        .map((parameter) => parameter.trim().toLowerCase())
        .find((parameter) => parameter.startsWith('q='));
      return quality !== 'q=0' && quality !== 'q=0.0' && quality !== 'q=0.00';
    });
}

async function readJsonObject(
  request: Request,
  options: { allowEmpty?: boolean } = {}
) {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > MAX_REQUEST_BODY_LENGTH
    ) {
      cancelBodyQuietly(request.body, 'Request body is too large.');
      throw new ValidationError('Request body is too large.');
    }
  }

  const raw = await readBoundedBody(request, MAX_REQUEST_BODY_LENGTH);
  if (!raw.trim()) {
    if (options.allowEmpty) return {};
    throw new ValidationError('Request body must be a JSON object.');
  }
  if (raw.length > MAX_REQUEST_BODY_LENGTH) {
    throw new ValidationError('Request body is too large.');
  }

  const parsed = safeJsonParse<unknown | typeof INVALID_JSON>(raw, INVALID_JSON);
  if (parsed === INVALID_JSON || !isRecord(parsed)) {
    throw new ValidationError('Request body must be a valid JSON object.');
  }
  return parsed;
}

async function readBoundedBody(request: Request, maxBytes: number) {
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        cancelReaderQuietly(reader, 'Request body is too large.');
        throw new ValidationError('Request body is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ValidationError('Request body must be valid UTF-8.');
  }
}

function assertAllowedFields(
  body: Record<string, unknown>,
  allowedFields: ReadonlySet<string>
) {
  const unexpectedField = Object.keys(body).find(
    (field) => !allowedFields.has(field)
  );
  if (unexpectedField) {
    throw new ValidationError(`${unexpectedField} is not an accepted field.`);
  }
}

function assertSchemaVersion(value: unknown) {
  if (value !== undefined && value !== 1) {
    throw new ValidationError('schemaVersion must be 1.');
  }
}

function readMentions(
  value: unknown,
  text: string
): RoomAgentMentionV1[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ValidationError('mentions must be an array.');
  }
  if (value.length > MAX_COLLECTION_LENGTH) {
    throw new ValidationError(
      `mentions must contain no more than ${MAX_COLLECTION_LENGTH} entries.`
    );
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new ValidationError(`mentions[${index}] must be an object.`);
    }
    assertAllowedFields(entry, ROOM_MENTION_FIELDS);
    if (entry.type !== 'agent') {
      throw new ValidationError(`mentions[${index}].type must be agent.`);
    }
    if (!isRecord(entry.range)) {
      throw new ValidationError(`mentions[${index}].range must be an object.`);
    }
    assertAllowedFields(entry.range, ROOM_MENTION_RANGE_FIELDS);

    const start = readNonNegativeIntegerValue(
      entry.range.start,
      `mentions[${index}].range.start`
    );
    const end = readNonNegativeIntegerValue(
      entry.range.end,
      `mentions[${index}].range.end`
    );
    if (end <= start || end > text.length) {
      throw new ValidationError(
        `mentions[${index}].range must be a non-empty range within text.`
      );
    }

    return {
      type: 'agent',
      agentId: readRequiredText(
        entry.agentId,
        `mentions[${index}].agentId`,
        MAX_ID_LENGTH
      ),
      handle: readRequiredText(
        entry.handle,
        `mentions[${index}].handle`,
        MAX_NAME_LENGTH
      ),
      range: { start, end },
    };
  });
}

function readAttachments(value: unknown): RoomAttachmentRefV1[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ValidationError('attachments must be an array.');
  }
  if (value.length > MAX_COLLECTION_LENGTH) {
    throw new ValidationError(
      `attachments must contain no more than ${MAX_COLLECTION_LENGTH} entries.`
    );
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new ValidationError(`attachments[${index}] must be an object.`);
    }
    assertAllowedFields(entry, ROOM_ATTACHMENT_FIELDS);

    return omitUndefined({
      attachmentId: readRequiredText(
        entry.attachmentId,
        `attachments[${index}].attachmentId`,
        MAX_ID_LENGTH
      ),
      mediaType: readRequiredText(
        entry.mediaType,
        `attachments[${index}].mediaType`,
        MAX_NAME_LENGTH
      ),
      name: readOptionalText(
        entry.name,
        `attachments[${index}].name`,
        MAX_NAME_LENGTH
      ),
      uri: readOptionalText(
        entry.uri,
        `attachments[${index}].uri`,
        4_096
      ),
    });
  });
}

function readOptionalJsonValue(
  value: unknown,
  field: string
): RoomJsonValueV1 | undefined {
  if (value === undefined) return undefined;
  if (!isRoomJsonValueV1(value)) {
    throw new ValidationError(
      `${field} must be finite JSON with at most 32 nesting levels.`
    );
  }
  return value;
}

function readOptionalQueryText(
  params: URLSearchParams,
  name: string,
  maxLength: number
) {
  const value = params.get(name);
  if (value === null) return undefined;
  return readRequiredText(value, name, maxLength);
}

function readOptionalNullableText(
  value: unknown,
  field: string,
  maxLength: number
) {
  if (value === undefined || value === null) return value;
  return readRequiredText(value, field, maxLength);
}

function readOptionalText(
  value: unknown,
  field: string,
  maxLength: number
) {
  if (value === undefined || value === null) return undefined;
  return readRequiredText(value, field, maxLength);
}

function readRequiredText(
  value: unknown,
  field: string,
  maxLength: number,
  trimResult = true
) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} must be a non-empty string.`);
  }
  if (value.length > maxLength) {
    throw new ValidationError(
      `${field} must be no longer than ${maxLength} characters.`
    );
  }
  return trimResult ? value.trim() : value;
}

function readNonNegativeInteger(
  value: string | null,
  field: string,
  fallback: number
) {
  if (value === null || !value.trim()) return fallback;
  const normalized = value.trim();
  if (!/^(0|[1-9]\d*)$/.test(normalized)) {
    throw new ValidationError(`${field} must be a non-negative integer.`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new ValidationError(`${field} is too large.`);
  }
  return parsed;
}

function readPositiveInteger(
  value: string | null,
  field: string,
  fallback: number
) {
  if (value === null || !value.trim()) return fallback;
  const parsed = readNonNegativeInteger(value, field, fallback);
  if (parsed < 1) {
    throw new ValidationError(`${field} must be a positive integer.`);
  }
  return parsed;
}

function readNonNegativeIntegerValue(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ValidationError(`${field} must be a non-negative integer.`);
  }
  return value as number;
}

function omitUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as { [K in keyof T]: Exclude<T[K], undefined> };
}

function readRoomActorHeader(
  headers: Headers,
  name: string,
  fallback: string
) {
  const raw = headers.get(name);
  if (raw === null) return fallback;
  return readRequiredText(raw, name, MAX_ID_LENGTH);
}

async function isExistingRoomActorContext(actor: RoomActorContext) {
  const { prisma } = await import('@/lib/db/prisma');
  const [organization, user, membership, device] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: actor.organizationId },
      select: { id: true },
    }),
    prisma.user.findUnique({
      where: { id: actor.userId },
      select: { id: true },
    }),
    prisma.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: actor.organizationId,
          userId: actor.userId,
        },
      },
      select: { id: true },
    }),
    prisma.device.findFirst({
      where: {
        id: actor.deviceId,
        organizationId: actor.organizationId,
        userId: actor.userId,
      },
      select: { id: true },
    }),
  ]);

  return Boolean(organization && user && membership && device);
}

function cancelBodyQuietly(
  body: ReadableStream<Uint8Array> | null,
  reason: string
) {
  if (!body) return;
  try {
    void body.cancel(reason).catch(() => undefined);
  } catch {
    // Preserve the stable validation error even for a hostile body source.
  }
}

function cancelReaderQuietly(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: string
) {
  try {
    void reader.cancel(reason).catch(() => undefined);
  } catch {
    // Preserve the stable validation error even for a hostile body source.
  }
}
