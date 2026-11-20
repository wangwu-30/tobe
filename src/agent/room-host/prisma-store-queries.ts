import type {
  RoomAgentRefV1,
  RoomMessageEnvelopeV1,
  RoomRuntimeEventEnvelopeV1,
  RoomRuntimeOutputDraftV1,
  RoomSessionCursorV1,
  RoomSessionRefV1,
} from '@/agent/room-runtime/contracts';
import {
  isRoomAgentRefV1,
  mapRoomDeliveryEnvelopeV1,
  mapRoomMessageV1,
  parseRoomPolicyJsonV1,
  type RoomInboxDeliveryRecord,
  type RoomMentionRecord,
} from '@/objects/room/schema';
import { retrySqliteBusyV1 } from '@/lib/db/sqlite-busy-retry';

import type { RoomHostClaimV1, RoomHostLeaseV1 } from './store';
import {
  assertCheckpointIdentity,
  failStored,
  FENCED,
  nextId,
  nullableDate,
  parseStoredCheckpoint,
  parseStoredJson,
  parseStoredRuntimeEvent,
  publicRuntimeEventType,
  readNonNegativeInteger,
  readPositiveInteger,
  requireDate,
  requireText,
  runtimeEventId,
  runtimeEventPrefix,
  stableJson,
  toIso,
  validateOutput,
  type ClaimControlRow,
  type ClaimRow,
  type CursorRow,
  type EventRow,
  type PrismaRoomHostClientV1,
  type PrismaRoomHostIdKindV1,
  type RawRoomHostDbV1,
  type RoomCounterRow,
  type StoredRuntimeEventV1,
} from './prisma-store-codec';

export async function fencedTransaction<T>(
  client: PrismaRoomHostClientV1,
  action: (db: RawRoomHostDbV1) => Promise<T>
): Promise<T | 'fenced'> {
  try {
    return await client.$transaction(action);
  } catch (error) {
    if (error === FENCED) return 'fenced';
    throw error;
  }
}

export async function retryRoomHostSqliteBusyV1<T>(
  _client: PrismaRoomHostClientV1,
  operation: () => Promise<T>
): Promise<T> {
  return retrySqliteBusyV1(operation);
}

export async function loadOldestDelivery(
  db: RawRoomHostDbV1,
  organizationId: string,
  roomSessionId: string
): Promise<ClaimControlRow[]> {
  return db.$queryRaw<ClaimControlRow[]>`
    SELECT
      session."id" AS "sessionId",
      session."organizationId" AS "sessionOrganizationId",
      session."roomId" AS "sessionRoomId",
      session."agentId", session."agentHandle",
      session."agentDisplayName",
      session."agentConfigVersion",
      session."lastRoomSequence",
      delivery."deliverySequence" - 1 AS "lastDeliverySequence",
      session."lastEventSequence", session."generation",
      session."leaseOwnerId", session."leaseExpiresAt",
      session."runtimeId", session."runtimeSessionId",
      session."checkpointJson", session."currentDeliveryId",
      delivery."id" AS "deliveryId",
      delivery."organizationId" AS "deliveryOrganizationId",
      delivery."roomId" AS "deliveryRoomId",
      delivery."roomSessionId" AS "deliveryRoomSessionId",
      delivery."messageId" AS "deliveryMessageId",
      delivery."deliverySequence",
      delivery."intent" AS "deliveryIntent",
      delivery."causeJson" AS "deliveryCauseJson",
      delivery."attempt" AS "deliveryAttempt",
      delivery."status" AS "deliveryStatus",
      delivery."availableAt" AS "deliveryAvailableAt",
      delivery."claimedAt" AS "deliveryClaimedAt",
      delivery."completedAt" AS "deliveryCompletedAt",
      delivery."lastError" AS "deliveryLastError",
      delivery."createdAt" AS "deliveryCreatedAt",
      delivery."updatedAt" AS "deliveryUpdatedAt",
      message."id" AS "messageId",
      message."organizationId" AS "messageOrganizationId",
      message."roomId" AS "messageRoomId",
      message."sequence" AS "messageSequence",
      message."actorType" AS "messageActorType",
      message."actorId" AS "messageActorId",
      message."actorDisplayName" AS "messageActorDisplayName",
      profile."handle" AS "messageActorHandle",
      message."text" AS "messageText",
      message."attachmentsJson" AS "messageAttachmentsJson",
      message."replyToMessageId" AS "messageReplyToMessageId",
      message."correlationId" AS "messageCorrelationId",
      message."metadataJson" AS "messageMetadataJson",
      message."createdAt" AS "messageCreatedAt",
      room."policyJson"
    FROM "RoomAgentSession" AS session
    INNER JOIN "Room" AS room
      ON room."id" = session."roomId"
      AND room."organizationId" = session."organizationId"
    INNER JOIN "RoomInboxDelivery" AS delivery
      ON delivery."roomSessionId" = session."id"
      AND delivery."organizationId" = session."organizationId"
      AND delivery."roomId" = session."roomId"
    INNER JOIN "RoomMessage" AS message
      ON message."id" = delivery."messageId"
      AND message."organizationId" = delivery."organizationId"
      AND message."roomId" = delivery."roomId"
    LEFT JOIN "AgentProfile" AS profile
      ON profile."id" = message."actorId"
      AND profile."organizationId" = message."organizationId"
      AND message."actorType" = 'agent'
    WHERE session."id" = ${roomSessionId}
      AND session."organizationId" = ${organizationId}
      AND session."status" = 'active'
      AND delivery."status" IN ('pending', 'claimed')
    ORDER BY delivery."deliverySequence" ASC
    LIMIT 1
  `;
}

export async function loadDeliveryById(
  db: RawRoomHostDbV1,
  organizationId: string,
  roomSessionId: string,
  deliveryId: string
): Promise<ClaimControlRow[]> {
  return db.$queryRaw<ClaimControlRow[]>`
    SELECT
      session."id" AS "sessionId",
      session."organizationId" AS "sessionOrganizationId",
      session."roomId" AS "sessionRoomId",
      session."agentId", session."agentHandle",
      session."agentDisplayName",
      session."agentConfigVersion",
      session."lastRoomSequence",
      delivery."deliverySequence" - 1 AS "lastDeliverySequence",
      session."lastEventSequence", session."generation",
      session."leaseOwnerId", session."leaseExpiresAt",
      session."runtimeId", session."runtimeSessionId",
      session."checkpointJson", session."currentDeliveryId",
      delivery."id" AS "deliveryId",
      delivery."organizationId" AS "deliveryOrganizationId",
      delivery."roomId" AS "deliveryRoomId",
      delivery."roomSessionId" AS "deliveryRoomSessionId",
      delivery."messageId" AS "deliveryMessageId",
      delivery."deliverySequence",
      delivery."intent" AS "deliveryIntent",
      delivery."causeJson" AS "deliveryCauseJson",
      delivery."attempt" AS "deliveryAttempt",
      delivery."status" AS "deliveryStatus",
      delivery."availableAt" AS "deliveryAvailableAt",
      delivery."claimedAt" AS "deliveryClaimedAt",
      delivery."completedAt" AS "deliveryCompletedAt",
      delivery."lastError" AS "deliveryLastError",
      delivery."createdAt" AS "deliveryCreatedAt",
      delivery."updatedAt" AS "deliveryUpdatedAt",
      message."id" AS "messageId",
      message."organizationId" AS "messageOrganizationId",
      message."roomId" AS "messageRoomId",
      message."sequence" AS "messageSequence",
      message."actorType" AS "messageActorType",
      message."actorId" AS "messageActorId",
      message."actorDisplayName" AS "messageActorDisplayName",
      profile."handle" AS "messageActorHandle",
      message."text" AS "messageText",
      message."attachmentsJson" AS "messageAttachmentsJson",
      message."replyToMessageId" AS "messageReplyToMessageId",
      message."correlationId" AS "messageCorrelationId",
      message."metadataJson" AS "messageMetadataJson",
      message."createdAt" AS "messageCreatedAt",
      room."policyJson"
    FROM "RoomAgentSession" AS session
    INNER JOIN "Room" AS room
      ON room."id" = session."roomId"
      AND room."organizationId" = session."organizationId"
    INNER JOIN "RoomInboxDelivery" AS delivery
      ON delivery."roomSessionId" = session."id"
      AND delivery."organizationId" = session."organizationId"
      AND delivery."roomId" = session."roomId"
    INNER JOIN "RoomMessage" AS message
      ON message."id" = delivery."messageId"
      AND message."organizationId" = delivery."organizationId"
      AND message."roomId" = delivery."roomId"
    LEFT JOIN "AgentProfile" AS profile
      ON profile."id" = message."actorId"
      AND profile."organizationId" = message."organizationId"
      AND message."actorType" = 'agent'
    WHERE session."id" = ${roomSessionId}
      AND session."organizationId" = ${organizationId}
      AND session."status" = 'active'
      AND delivery."id" = ${deliveryId}
    LIMIT 1
  `;
}

export async function loadMessageMentions(
  db: RawRoomHostDbV1,
  organizationId: string,
  roomId: string,
  messageId: string
): Promise<RoomMentionRecord[]> {
  return db.$queryRaw<RoomMentionRecord[]>`
    SELECT
      "id", "organizationId", "roomId", "messageId",
      "mentionIndex", "agentId", "handle",
      "rangeStart", "rangeEnd", "createdAt"
    FROM "RoomMention"
    WHERE "organizationId" = ${organizationId}
      AND "roomId" = ${roomId}
      AND "messageId" = ${messageId}
    ORDER BY "mentionIndex" ASC
  `;
}

export function mapClaim(
  row: ClaimControlRow,
  mentions: readonly RoomMentionRecord[],
  pendingOutput: RoomRuntimeOutputDraftV1 | null
): RoomHostClaimV1 {
  assertClaimIdentity(row);
  const session = sessionRefFromRow(row);
  const message = mapRoomMessageV1({
    id: row.messageId,
    organizationId: row.messageOrganizationId,
    roomId: row.messageRoomId,
    sequence: row.messageSequence,
    actorType: row.messageActorType,
    actorId: row.messageActorId,
    actorDisplayName: row.messageActorDisplayName,
    actorHandle: row.messageActorHandle,
    text: row.messageText,
    attachmentsJson: row.messageAttachmentsJson,
    replyToMessageId: row.messageReplyToMessageId,
    correlationId: row.messageCorrelationId,
    metadataJson: row.messageMetadataJson,
    createdAt: row.messageCreatedAt,
    mentions,
  });
  const deliveryRecord: RoomInboxDeliveryRecord = {
    id: row.deliveryId,
    organizationId: row.deliveryOrganizationId,
    roomId: row.deliveryRoomId,
    roomSessionId: row.deliveryRoomSessionId,
    messageId: row.deliveryMessageId,
    deliverySequence: row.deliverySequence,
    intent: row.deliveryIntent,
    causeJson: row.deliveryCauseJson,
    attempt: row.deliveryAttempt,
    status: row.deliveryStatus,
    availableAt: row.deliveryAvailableAt,
    claimedAt: row.deliveryClaimedAt,
    completedAt: row.deliveryCompletedAt,
    lastError: row.deliveryLastError,
    createdAt: row.deliveryCreatedAt,
    updatedAt: row.deliveryUpdatedAt,
  };
  const runtimeId = requireText(row.runtimeId, 'stored runtimeId');
  const checkpoint = parseStoredCheckpoint(row.checkpointJson);
  if (checkpoint) {
    assertCheckpointIdentity(
      checkpoint,
      row,
      {
        roomSessionId: row.sessionId,
        deliveryId: row.deliveryId,
        workerId: row.leaseOwnerId ?? '',
        generation: row.generation,
      },
      { allowOlderGeneration: true }
    );
  }
  return {
    lease: {
      roomSessionId: row.sessionId,
      deliveryId: row.deliveryId,
      workerId: requireText(row.leaseOwnerId, 'stored lease owner'),
      generation: readPositiveInteger(row.generation, 'generation'),
    },
    session,
    runtimeId,
    runtimeSessionId: row.runtimeSessionId,
    checkpoint,
    cursor: cursorFromRow(row),
    delivery: mapRoomDeliveryEnvelopeV1(deliveryRecord, message, session.agent),
    pendingOutput,
    policy: parseRoomPolicyJsonV1(row.policyJson),
  };
}

export function assertClaimIdentity(row: ClaimControlRow): void {
  if (
    row.sessionOrganizationId !== row.deliveryOrganizationId ||
    row.sessionOrganizationId !== row.messageOrganizationId ||
    row.sessionRoomId !== row.deliveryRoomId ||
    row.sessionRoomId !== row.messageRoomId ||
    row.sessionId !== row.deliveryRoomSessionId ||
    row.deliveryMessageId !== row.messageId ||
    row.currentDeliveryId !== row.deliveryId ||
    row.deliveryStatus !== 'claimed'
  ) {
    throw new Error('Stored Room claim identities are inconsistent.');
  }
}

export function sessionRefFromRow(
  row: Pick<
    ClaimControlRow,
    | 'sessionOrganizationId'
    | 'sessionRoomId'
    | 'sessionId'
    | 'agentId'
    | 'agentHandle'
    | 'agentDisplayName'
    | 'agentConfigVersion'
  >
): RoomSessionRefV1 {
  const agent: RoomAgentRefV1 = {
    agentId: row.agentId,
    handle: row.agentHandle,
    ...(row.agentDisplayName
      ? { displayName: row.agentDisplayName }
      : {}),
  };
  if (!isRoomAgentRefV1(agent)) {
    throw new Error('Stored Room session agent is invalid.');
  }
  return {
    organizationId: row.sessionOrganizationId,
    roomId: row.sessionRoomId,
    roomSessionId: row.sessionId,
    agentConfigVersion: requireText(
      row.agentConfigVersion,
      'stored agentConfigVersion'
    ),
    agent,
  };
}

export function cursorFromRow(
  row: Pick<
    ClaimRow,
    'lastRoomSequence' | 'lastDeliverySequence' | 'lastEventSequence'
  >
): RoomSessionCursorV1 {
  return {
    messageSequence: readNonNegativeInteger(
      row.lastRoomSequence,
      'lastRoomSequence'
    ),
    deliverySequence: readNonNegativeInteger(
      row.lastDeliverySequence,
      'deliverySequence'
    ),
    eventSequence: readNonNegativeInteger(
      row.lastEventSequence,
      'lastEventSequence'
    ),
  };
}

export async function loadPendingOutput(
  db: RawRoomHostDbV1,
  row: ClaimControlRow,
  eventGeneration: number
): Promise<RoomRuntimeOutputDraftV1 | null> {
  const events = await db.$queryRaw<EventRow[]>`
    SELECT "id", "organizationId", "roomId", "sequence",
      "type", "dataJson", "createdAt"
    FROM "RoomEvent"
    WHERE "organizationId" = ${row.sessionOrganizationId}
      AND "roomId" = ${row.sessionRoomId}
      AND "type" = 'room.runtime.message-ready'
      AND "id" LIKE ${runtimeEventPrefix(
        row.sessionOrganizationId,
        row.sessionId,
        eventGeneration
      ) + '%'}
    ORDER BY "sequence" DESC
  `;
  for (const eventRow of events) {
    const stored = parseStoredRuntimeEvent(eventRow);
    if (
      stored.roomSessionId === row.sessionId &&
      stored.deliveryId === row.deliveryId &&
      stored.generation === eventGeneration &&
      stored.event.event.type === 'message-ready'
    ) {
      return validateOutput(stored.event.event.message)
        ? stored.event.event.message
        : failStored('runtime message-ready output');
    }
  }
  return null;
}

export async function lockOwnedSession(
  db: RawRoomHostDbV1,
  organizationId: string,
  lease: RoomHostLeaseV1,
  now: Date
): Promise<ClaimControlRow | null> {
  await db.$executeRaw`
    UPDATE "RoomAgentSession"
    SET "updatedAt" = "updatedAt"
    WHERE "id" = ${lease.roomSessionId}
      AND "organizationId" = ${organizationId}
  `;
  const rows = await loadDeliveryById(
    db,
    organizationId,
    lease.roomSessionId,
    lease.deliveryId
  );
  const row = rows[0];
  return row && owns(row, lease, now) ? row : null;
}

export function owns(
  row: ClaimControlRow,
  lease: RoomHostLeaseV1,
  now: Date
): boolean {
  const expiresAt = nullableDate(row.leaseExpiresAt, 'leaseExpiresAt');
  return (
    row.generation === lease.generation &&
    row.leaseOwnerId === lease.workerId &&
    row.currentDeliveryId === lease.deliveryId &&
    row.deliveryStatus === 'claimed' &&
    expiresAt !== null &&
    expiresAt.valueOf() > now.valueOf()
  );
}

export function isClaimable(row: ClaimControlRow, now: Date): boolean {
  if (row.deliveryStatus === 'pending') {
    const availableAt = requireDate(row.deliveryAvailableAt, 'availableAt');
    const expiresAt = nullableDate(row.leaseExpiresAt, 'leaseExpiresAt');
    return (
      availableAt.valueOf() <= now.valueOf() &&
      (row.currentDeliveryId === null ||
        expiresAt === null ||
        expiresAt.valueOf() <= now.valueOf())
    );
  }
  if (row.deliveryStatus !== 'claimed') return false;
  const expiresAt = nullableDate(row.leaseExpiresAt, 'leaseExpiresAt');
  return (
    row.currentDeliveryId === row.deliveryId &&
    (expiresAt === null || expiresAt.valueOf() <= now.valueOf())
  );
}

export async function appendRuntimeEvent(
  db: RawRoomHostDbV1,
  createId: (kind: PrismaRoomHostIdKindV1) => string,
  organizationId: string,
  roomId: string,
  lease: RoomHostLeaseV1,
  event: RoomRuntimeEventEnvelopeV1,
  now: Date
): Promise<{ status: 'appended' | 'duplicate'; sequence: number }> {
  const id = runtimeEventId(organizationId, lease, event.eventId);
  const stored: StoredRuntimeEventV1 = {
    schemaVersion: 1,
    kind: 'room-host.runtime-event',
    roomSessionId: lease.roomSessionId,
    deliveryId: lease.deliveryId,
    generation: lease.generation,
    event,
  };
  const dataJson = stableJson(stored);
  const existing = await findEventById(db, id);
  if (existing) {
    if (
      existing.organizationId !== organizationId ||
      existing.roomId !== roomId ||
      existing.type !== publicRuntimeEventType(event.event) ||
      stableJson(parseStoredRuntimeEvent(existing)) !== dataJson
    ) {
      throw new Error(`Room runtime event ${event.eventId} changed on replay.`);
    }
    return { status: 'duplicate', sequence: existing.sequence };
  }
  const sequence = await allocateEventSequence(
    db,
    organizationId,
    roomId,
    now
  );
  const publicEvent = await insertPublicEvent(db, {
    id,
    organizationId,
    roomId,
    sequence,
    type: publicRuntimeEventType(event.event),
    data: stored,
    createdAt: now,
  });
  await insertOutbox(db, createId, publicEvent, now);
  return { status: 'appended', sequence };
}

export async function allocateEventSequence(
  db: RawRoomHostDbV1,
  organizationId: string,
  roomId: string,
  now: Date
): Promise<number> {
  const row = await allocateRoomSequences(
    db,
    organizationId,
    roomId,
    0,
    1,
    now
  );
  return row.eventSequence;
}

export async function allocateRoomSequences(
  db: RawRoomHostDbV1,
  organizationId: string,
  roomId: string,
  messageIncrement: number,
  eventIncrement: number,
  now: Date
): Promise<RoomCounterRow> {
  const updated = await db.$executeRaw`
    UPDATE "Room"
    SET
      "messageSequence" = "messageSequence" + ${messageIncrement},
      "eventSequence" = "eventSequence" + ${eventIncrement},
      "updatedAt" = ${now}
    WHERE "id" = ${roomId}
      AND "organizationId" = ${organizationId}
  `;
  if (updated !== 1) {
    throw new Error(`Room ${roomId} was not found in the store scope.`);
  }
  const rows = await db.$queryRaw<RoomCounterRow[]>`
    SELECT "messageSequence", "eventSequence"
    FROM "Room"
    WHERE "id" = ${roomId}
      AND "organizationId" = ${organizationId}
    LIMIT 1
  `;
  if (!rows[0]) throw new Error(`Room ${roomId} counters could not be loaded.`);
  return {
    messageSequence: readNonNegativeInteger(
      rows[0].messageSequence,
      'room messageSequence'
    ),
    eventSequence: readNonNegativeInteger(
      rows[0].eventSequence,
      'room eventSequence'
    ),
  };
}

export async function insertPublicEvent(
  db: RawRoomHostDbV1,
  input: {
    id: string;
    organizationId: string;
    roomId: string;
    sequence: number;
    type: string;
    data: unknown;
    createdAt: Date;
  }
): Promise<EventRow> {
  await db.$executeRaw`
    INSERT INTO "RoomEvent" (
      "id", "organizationId", "roomId", "sequence",
      "type", "dataJson", "createdAt"
    ) VALUES (
      ${input.id}, ${input.organizationId}, ${input.roomId}, ${input.sequence},
      ${input.type}, ${stableJson(input.data)}, ${input.createdAt}
    )
  `;
  return {
    id: input.id,
    organizationId: input.organizationId,
    roomId: input.roomId,
    sequence: input.sequence,
    type: input.type,
    dataJson: stableJson(input.data),
    createdAt: input.createdAt,
  };
}

export async function findEventById(
  db: RawRoomHostDbV1,
  id: string
): Promise<EventRow | null> {
  const rows = await db.$queryRaw<EventRow[]>`
    SELECT "id", "organizationId", "roomId", "sequence",
      "type", "dataJson", "createdAt"
    FROM "RoomEvent"
    WHERE "id" = ${id}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function loadCursor(
  db: RawRoomHostDbV1,
  organizationId: string,
  roomSessionId: string
): Promise<RoomSessionCursorV1> {
  const rows = await db.$queryRaw<CursorRow[]>`
    SELECT
      session."lastRoomSequence",
      COALESCE(
        MIN(CASE
          WHEN delivery."status" IN ('pending', 'claimed')
            THEN delivery."deliverySequence" - 1
        END),
        session."deliverySequence"
      ) AS "lastDeliverySequence",
      session."lastEventSequence"
    FROM "RoomAgentSession" AS session
    LEFT JOIN "RoomInboxDelivery" AS delivery
      ON delivery."roomSessionId" = session."id"
      AND delivery."organizationId" = session."organizationId"
    WHERE session."id" = ${roomSessionId}
      AND session."organizationId" = ${organizationId}
    GROUP BY session."id", session."lastRoomSequence",
      session."deliverySequence", session."lastEventSequence"
    LIMIT 1
  `;
  if (!rows[0]) throw new Error(`Room session ${roomSessionId} was not found.`);
  return cursorFromRow(rows[0]);
}

export async function persistOutputMessage(
  db: RawRoomHostDbV1,
  input: {
    createId: (kind: PrismaRoomHostIdKindV1) => string;
    now: Date;
    organizationId: string;
    roomId: string;
    sequence: number;
    session: RoomSessionRefV1;
    deliveryId: string;
  },
  output: RoomRuntimeOutputDraftV1
): Promise<RoomMessageEnvelopeV1> {
  const messageId = nextId(input.createId, 'message');
  const attachments = output.attachments ?? [];
  await db.$executeRaw`
    INSERT INTO "RoomMessage" (
      "id", "organizationId", "roomId", "sequence",
      "actorType", "actorId", "actorDisplayName", "text",
      "attachmentsJson", "replyToMessageId", "correlationId",
      "metadataJson", "createdAt"
    ) VALUES (
      ${messageId}, ${input.organizationId}, ${input.roomId}, ${input.sequence},
      'agent', ${input.session.agent.agentId},
      ${input.session.agent.displayName ?? null}, ${output.text},
      ${stableJson(attachments)}, NULL, ${input.deliveryId}, NULL, ${input.now}
    )
  `;
  for (let index = 0; index < output.mentions.length; index += 1) {
    const mention = output.mentions[index];
    await db.$executeRaw`
      INSERT INTO "RoomMention" (
        "id", "organizationId", "roomId", "messageId",
        "mentionIndex", "agentId", "handle",
        "rangeStart", "rangeEnd", "createdAt"
      ) VALUES (
        ${nextId(input.createId, 'mention')}, ${input.organizationId},
        ${input.roomId}, ${messageId}, ${index}, ${mention.agentId},
        ${mention.handle}, ${mention.range.start}, ${mention.range.end},
        ${input.now}
      )
    `;
  }
  return {
    schemaVersion: 1,
    envelopeType: 'room.message',
    messageId,
    organizationId: input.organizationId,
    roomId: input.roomId,
    sequence: input.sequence,
    createdAt: input.now.toISOString(),
    actor: { type: 'agent', ...input.session.agent },
    text: output.text,
    mentions: [...output.mentions],
    attachments: [...attachments],
    correlationId: input.deliveryId,
  };
}

export async function insertOutbox(
  db: RawRoomHostDbV1,
  createId: (kind: PrismaRoomHostIdKindV1) => string,
  event: EventRow,
  now: Date
): Promise<void> {
  const payload = {
    schemaVersion: 1,
    eventId: event.id,
    organizationId: event.organizationId,
    roomId: event.roomId,
    sequence: event.sequence,
    type: event.type,
    createdAt: toIso(event.createdAt, 'event createdAt'),
    data: parseStoredJson(event.dataJson, 'event data'),
  };
  await db.$executeRaw`
    INSERT INTO "RoomOutbox" (
      "id", "organizationId", "roomId", "topic",
      "dedupeKey", "payloadJson", "status", "attempts",
      "availableAt", "publishedAt", "lastError",
      "createdAt", "updatedAt"
    ) VALUES (
      ${nextId(createId, 'outbox')}, ${event.organizationId}, ${event.roomId},
      'room.event.created', ${event.id}, ${stableJson(payload)},
      'pending', 0, ${now}, NULL, NULL, ${now}, ${now}
    )
  `;
}
