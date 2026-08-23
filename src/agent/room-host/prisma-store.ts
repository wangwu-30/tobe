import { createHash, randomUUID } from 'node:crypto';

import type {
  RoomAgentRefV1,
  RoomJsonValueV1,
  RoomMessageEnvelopeV1,
  RoomRuntimeEventEnvelopeV1,
  RoomRuntimeOutputDraftV1,
  RoomSessionCheckpointEnvelopeV1,
  RoomSessionCursorV1,
  RoomSessionRefV1,
} from '@/agent/room-runtime/contracts';
import {
  isRoomAgentMentionV1,
  isRoomAgentRefV1,
  isRoomAttachmentRefV1,
  isRoomDelegationInvocationV1,
  isRoomJsonValueV1,
  mapRoomDeliveryEnvelopeV1,
  mapRoomMessageV1,
  parseRoomPolicyJsonV1,
  type RoomInboxDeliveryRecord,
  type RoomMentionRecord,
} from '@/objects/room/schema';
import { isRecord, safeJsonParse } from '@/framework/resilience/safe-data';
import { retrySqliteBusyV1 } from '@/lib/db/sqlite-busy-retry';
import { prisma as defaultPrisma } from '@/lib/db/prisma';

import type {
  AppendRoomHostEventInputV1,
  AppendRoomHostEventResultV1,
  BindRoomHostRuntimeInputV1,
  ClaimRoomHostCandidateInputV1,
  FinishRoomHostDeliveryInputV1,
  FinishRoomHostDeliveryResultV1,
  HeartbeatRoomHostLeaseInputV1,
  ListRoomHostCandidatesInputV1,
  PersistRoomHostCheckpointInputV1,
  RetryRoomHostDeliveryInputV1,
  RoomHostClaimV1,
  RoomHostLeaseV1,
  RoomHostStoreV1,
  RoomHostTerminalV1,
} from './store';

type RawRoomHostDbV1 = {
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

type CandidateRow = {
  roomSessionId: string;
  runtimeId: string;
};

type ClaimRow = {
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

type ClaimControlRow = ClaimRow & {
  leaseOwnerId: string | null;
  leaseExpiresAt: Date | string | null;
  currentDeliveryId: string | null;
};

type CursorRow = {
  lastRoomSequence: number;
  lastDeliverySequence: number;
  lastEventSequence: number;
};

type EventRow = {
  id: string;
  organizationId: string;
  roomId: string;
  sequence: number;
  type: string;
  dataJson: string;
  createdAt: Date | string;
};

type RoomCounterRow = {
  messageSequence: number;
  eventSequence: number;
};

type StoredRuntimeEventV1 = {
  schemaVersion: 1;
  kind: 'room-host.runtime-event';
  roomSessionId: string;
  deliveryId: string;
  generation: number;
  event: RoomRuntimeEventEnvelopeV1;
};

type StoredRetryEventV1 = {
  schemaVersion: 1;
  kind: 'room-host.delivery-retrying';
  roomSessionId: string;
  deliveryId: string;
  generation: number;
  nextAttempt: number;
  failure: RetryRoomHostDeliveryInputV1['failure'];
};

type StoredTerminalEventV1 = {
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

const DEFAULT_CANDIDATE_LIMIT = 32;
const MAX_CANDIDATE_LIMIT = 256;
const FENCED = Symbol('room-host-fenced');

/**
 * Durable, organization-scoped Room Host adapter. Candidate reads are only
 * hints; each mutation obtains a SQLite write lock and repeats the complete
 * generation/owner/delivery/expiry fence inside its transaction.
 */
export function createPrismaRoomHostStoreV1(
  options: PrismaRoomHostStoreOptionsV1
): RoomHostStoreV1 {
  const organizationId = requireText(
    options.organizationId,
    'organizationId'
  );
  const defaultRuntimeId = optionalText(options.defaultRuntimeId);
  const client =
    options.prisma ??
    (defaultPrisma as unknown as PrismaRoomHostClientV1);
  const fallbackNow = createClock(options.clock);
  const createId = options.id ?? (() => randomUUID());

  return {
    async listCandidates(input: ListRoomHostCandidatesInputV1) {
      return retryRoomHostSqliteBusyV1(client, async () => {
        const now = operationNow(input.now, fallbackNow);
        const runtimeIds = readRuntimeIds(input.runtimeIds);
        if (runtimeIds.length === 0) return [];
        const limit = readCandidateLimit(input.limit);
        const runtimeIdsJson = JSON.stringify(runtimeIds);
        const rows = await client.$queryRaw<CandidateRow[]>`
          SELECT
            session."id" AS "roomSessionId",
            COALESCE(session."runtimeId", ${defaultRuntimeId}) AS "runtimeId"
          FROM "RoomAgentSession" AS session
          INNER JOIN "RoomInboxDelivery" AS delivery
            ON delivery."roomSessionId" = session."id"
            AND delivery."organizationId" = session."organizationId"
            AND delivery."roomId" = session."roomId"
          WHERE session."organizationId" = ${organizationId}
            AND session."status" = 'active'
            AND COALESCE(session."runtimeId", ${defaultRuntimeId}) IN (
              SELECT CAST(value AS TEXT) FROM json_each(${runtimeIdsJson})
            )
            AND delivery."status" IN ('pending', 'claimed')
            AND NOT EXISTS (
              SELECT 1
              FROM "RoomInboxDelivery" AS earlier
              WHERE earlier."roomSessionId" = session."id"
                AND earlier."organizationId" = ${organizationId}
                AND earlier."status" IN ('pending', 'claimed')
                AND earlier."deliverySequence" < delivery."deliverySequence"
            )
            AND (
              (
                delivery."status" = 'pending'
                AND delivery."availableAt" <= ${now}
                AND (
                  session."currentDeliveryId" IS NULL
                  OR session."leaseExpiresAt" IS NULL
                  OR session."leaseExpiresAt" <= ${now}
                )
              )
              OR (
                delivery."status" = 'claimed'
                AND session."currentDeliveryId" = delivery."id"
                AND (
                  session."leaseExpiresAt" IS NULL
                  OR session."leaseExpiresAt" <= ${now}
                )
              )
            )
          ORDER BY
            delivery."createdAt" ASC,
            delivery."deliverySequence" ASC,
            session."id" ASC
          LIMIT ${limit}
        `;
        return rows.map((row) => ({
          roomSessionId: row.roomSessionId,
          runtimeId: row.runtimeId,
        }));
      });
    },

    async claim(input: ClaimRoomHostCandidateInputV1) {
      return retryRoomHostSqliteBusyV1(client, async () => {
        const roomSessionId = requireText(input.roomSessionId, 'roomSessionId');
        const runtimeId = requireText(input.runtimeId, 'runtimeId');
        const workerId = requireText(input.workerId, 'workerId');
        const now = operationNow(input.now, fallbackNow);
        const leaseExpiresAt = addDuration(
          now,
          input.leaseDurationMs,
          'leaseDurationMs'
        );

        const result = await fencedTransaction(client, async (db) => {
          // A no-op write intentionally obtains SQLite's write lock before the
          // read/compare/update sequence below.
          await db.$executeRaw`
            UPDATE "RoomAgentSession"
            SET "updatedAt" = "updatedAt"
            WHERE "id" = ${roomSessionId}
              AND "organizationId" = ${organizationId}
              AND "status" = 'active'
          `;
          const rows = await loadOldestDelivery(
            db,
            organizationId,
            roomSessionId
          );
          const current = rows[0];
          if (!current) return null;
          const selectedRuntimeId = current.runtimeId ?? defaultRuntimeId;
          if (selectedRuntimeId !== runtimeId) return null;
          if (!isClaimable(current, now)) return null;

          const reclaim = current.deliveryStatus === 'claimed';
          const sessionUpdated = await db.$executeRaw`
            UPDATE "RoomAgentSession"
            SET
              "generation" = "generation" + 1,
              "leaseOwnerId" = ${workerId},
              "leaseExpiresAt" = ${leaseExpiresAt},
              "lastHeartbeatAt" = ${now},
              "runtimeId" = COALESCE("runtimeId", ${runtimeId}),
              "currentDeliveryId" = ${current.deliveryId},
              "updatedAt" = ${now}
            WHERE "id" = ${roomSessionId}
              AND "organizationId" = ${organizationId}
              AND "status" = 'active'
              AND "generation" = ${current.generation}
              AND COALESCE("runtimeId", ${defaultRuntimeId}) = ${runtimeId}
              AND (
                "currentDeliveryId" IS NULL
                OR "leaseExpiresAt" IS NULL
                OR "leaseExpiresAt" <= ${now}
              )
              AND EXISTS (
                SELECT 1
                FROM "RoomInboxDelivery" AS delivery
                WHERE delivery."id" = ${current.deliveryId}
                  AND delivery."roomSessionId" = "RoomAgentSession"."id"
                  AND delivery."organizationId" = ${organizationId}
                  AND delivery."status" = ${current.deliveryStatus}
                  AND (
                    (delivery."status" = 'pending' AND delivery."availableAt" <= ${now})
                    OR delivery."status" = 'claimed'
                  )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM "RoomInboxDelivery" AS earlier
                    WHERE earlier."roomSessionId" = delivery."roomSessionId"
                      AND earlier."organizationId" = ${organizationId}
                      AND earlier."status" IN ('pending', 'claimed')
                      AND earlier."deliverySequence" < delivery."deliverySequence"
                  )
              )
          `;
          if (sessionUpdated !== 1) return null;

          const deliveryUpdated = await db.$executeRaw`
            UPDATE "RoomInboxDelivery"
            SET
              "status" = 'claimed',
              "attempt" = "attempt" + ${reclaim ? 1 : 0},
              "claimedAt" = ${now},
              "completedAt" = NULL,
              "updatedAt" = ${now}
            WHERE "id" = ${current.deliveryId}
              AND "organizationId" = ${organizationId}
              AND "roomSessionId" = ${roomSessionId}
              AND "status" = ${current.deliveryStatus}
          `;
          if (deliveryUpdated !== 1) throw FENCED;

          const claimedRows = await loadDeliveryById(
            db,
            organizationId,
            roomSessionId,
            current.deliveryId
          );
          const claimed = claimedRows[0];
          if (!claimed) {
            throw new Error('Claimed Room delivery could not be reloaded.');
          }
          const mentions = await loadMessageMentions(
            db,
            organizationId,
            claimed.sessionRoomId,
            claimed.messageId
          );
          return mapClaim(
            claimed,
            mentions,
            await loadPendingOutput(
              db,
              claimed,
              reclaim ? current.generation : claimed.generation
            )
          );
        });
        return result === 'fenced' ? null : result;
      });
    },

    async heartbeat(input: HeartbeatRoomHostLeaseInputV1) {
      return retryRoomHostSqliteBusyV1(client, async () => {
        const now = operationNow(input.now, fallbackNow);
        const leaseExpiresAt = addDuration(
          now,
          input.leaseDurationMs,
          'leaseDurationMs'
        );
        const updated = await client.$executeRaw`
          UPDATE "RoomAgentSession"
          SET
            "leaseExpiresAt" = ${leaseExpiresAt},
            "lastHeartbeatAt" = ${now},
            "updatedAt" = ${now}
          WHERE "id" = ${input.lease.roomSessionId}
            AND "organizationId" = ${organizationId}
            AND "status" = 'active'
            AND "generation" = ${input.lease.generation}
            AND "leaseOwnerId" = ${input.lease.workerId}
            AND "currentDeliveryId" = ${input.lease.deliveryId}
            AND "leaseExpiresAt" IS NOT NULL
            AND "leaseExpiresAt" > ${now}
            AND EXISTS (
              SELECT 1 FROM "RoomInboxDelivery" AS delivery
              WHERE delivery."id" = ${input.lease.deliveryId}
                AND delivery."roomSessionId" = "RoomAgentSession"."id"
                AND delivery."organizationId" = ${organizationId}
                AND delivery."status" = 'claimed'
            )
        `;
        return updated === 1 ? 'renewed' : 'fenced';
      });
    },

    async bindRuntime(input: BindRoomHostRuntimeInputV1) {
      return retryRoomHostSqliteBusyV1(client, async () => {
        const now = operationNow(input.now, fallbackNow);
        if (!validHandleForLease(input, organizationId)) return 'fenced';
        const updated = await client.$executeRaw`
          UPDATE "RoomAgentSession"
          SET
            "runtimeId" = ${input.handle.runtimeId},
            "runtimeSessionId" = ${input.handle.runtimeSessionId},
            "updatedAt" = ${now}
          WHERE "id" = ${input.lease.roomSessionId}
            AND "organizationId" = ${organizationId}
            AND "roomId" = ${input.handle.session.roomId}
            AND "agentId" = ${input.handle.session.agent.agentId}
            AND "agentHandle" = ${input.handle.session.agent.handle}
            AND "agentConfigVersion" = ${input.handle.session.agentConfigVersion}
            AND "status" = 'active'
            AND "runtimeId" = ${input.handle.runtimeId}
            AND "generation" = ${input.lease.generation}
            AND "leaseOwnerId" = ${input.lease.workerId}
            AND "currentDeliveryId" = ${input.lease.deliveryId}
            AND "leaseExpiresAt" IS NOT NULL
            AND "leaseExpiresAt" > ${now}
            AND EXISTS (
              SELECT 1 FROM "RoomInboxDelivery" AS delivery
              WHERE delivery."id" = ${input.lease.deliveryId}
                AND delivery."roomSessionId" = "RoomAgentSession"."id"
                AND delivery."organizationId" = ${organizationId}
                AND delivery."status" = 'claimed'
            )
        `;
        return updated === 1 ? 'bound' : 'fenced';
      });
    },

    async appendEvent(
      input: AppendRoomHostEventInputV1
    ): Promise<AppendRoomHostEventResultV1> {
      return retryRoomHostSqliteBusyV1(client, async () => {
        const now = operationNow(input.now, fallbackNow);
        assertRuntimeEvent(input.event, input.lease, false);
        return fencedTransaction(client, async (db) => {
          const session = await lockOwnedSession(
            db,
            organizationId,
            input.lease,
            now
          );
          if (!session) throw FENCED;
          assertRuntimeIdentity(session, input.event);
          const persisted = await appendRuntimeEvent(
            db,
            createId,
            organizationId,
            session.sessionRoomId,
            input.lease,
            input.event,
            now
          );
          if (persisted.status === 'appended') {
            const checkpoint =
              input.event.event.type === 'checkpoint-ready'
                ? serializeCurrentCheckpoint(
                    input.event.event.checkpoint,
                    session,
                    input.lease
                  )
                : undefined;
            const updated = await db.$executeRaw`
              UPDATE "RoomAgentSession"
              SET
                "lastEventSequence" = ${persisted.sequence},
                "checkpointJson" = CASE
                  WHEN ${checkpoint === undefined ? 0 : 1} = 1 THEN ${checkpoint ?? null}
                  ELSE "checkpointJson"
                END,
                "checkpointUpdatedAt" = CASE
                  WHEN ${checkpoint === undefined ? 0 : 1} = 1 THEN ${now}
                  ELSE "checkpointUpdatedAt"
                END,
                "updatedAt" = ${now}
              WHERE "id" = ${input.lease.roomSessionId}
                AND "organizationId" = ${organizationId}
                AND "generation" = ${input.lease.generation}
                AND "leaseOwnerId" = ${input.lease.workerId}
                AND "currentDeliveryId" = ${input.lease.deliveryId}
                AND "leaseExpiresAt" IS NOT NULL
                AND "leaseExpiresAt" > ${now}
            `;
            if (updated !== 1) throw FENCED;
          }
          return {
            status: persisted.status,
            cursor: {
              messageSequence: readNonNegativeInteger(
                session.lastRoomSequence,
                'lastRoomSequence'
              ),
              deliverySequence: readNonNegativeInteger(
                session.lastDeliverySequence,
                'deliverySequence'
              ),
              eventSequence:
                persisted.status === 'appended'
                  ? persisted.sequence
                  : Math.max(
                      readNonNegativeInteger(
                        session.lastEventSequence,
                        'lastEventSequence'
                      ),
                      persisted.sequence
                    ),
            },
          };
        });
      });
    },

    async persistCheckpoint(input: PersistRoomHostCheckpointInputV1) {
      return retryRoomHostSqliteBusyV1(client, async () => {
        const now = operationNow(input.now, fallbackNow);
        return fencedTransaction(client, async (db) => {
          const session = await lockOwnedSession(
            db,
            organizationId,
            input.lease,
            now
          );
          if (!session) throw FENCED;
          const checkpointJson = serializeCurrentCheckpoint(
            input.checkpoint,
            session,
            input.lease
          );
          const updated = await db.$executeRaw`
            UPDATE "RoomAgentSession"
            SET
              "checkpointJson" = ${checkpointJson},
              "checkpointUpdatedAt" = ${now},
              "updatedAt" = ${now}
            WHERE "id" = ${input.lease.roomSessionId}
              AND "organizationId" = ${organizationId}
              AND "generation" = ${input.lease.generation}
              AND "leaseOwnerId" = ${input.lease.workerId}
              AND "currentDeliveryId" = ${input.lease.deliveryId}
              AND "leaseExpiresAt" IS NOT NULL
              AND "leaseExpiresAt" > ${now}
          `;
          if (updated !== 1) throw FENCED;
          return 'persisted' as const;
        });
      });
    },

    async finishDelivery(
      input: FinishRoomHostDeliveryInputV1
    ): Promise<FinishRoomHostDeliveryResultV1> {
      return retryRoomHostSqliteBusyV1(client, async () => {
        const now = operationNow(input.now, fallbackNow);
        return fencedTransaction(client, async (db) => {
          const locked = await lockOwnedSession(
            db,
            organizationId,
            input.lease,
            now
          );
          const terminalId = terminalEventId(organizationId, input.lease);
          const effectiveOutput = isSuccessfulCompletion(input.terminal)
            ? input.output
            : undefined;
          if (effectiveOutput) assertOutput(effectiveOutput);
          const commitHash = hashJson({
            checkpoint: input.checkpoint ?? null,
            output: effectiveOutput ?? null,
            terminal: input.terminal,
          });
          const existing = await findEventById(db, terminalId);
          if (existing) {
            const terminal = parseStoredTerminal(existing);
            if (
              existing.organizationId !== organizationId ||
              (locked && existing.roomId !== locked.sessionRoomId) ||
              terminal.roomSessionId !== input.lease.roomSessionId ||
              terminal.deliveryId !== input.lease.deliveryId ||
              terminal.generation !== input.lease.generation ||
              terminal.commitHash !== commitHash
            ) {
              throw new Error(
                `Room delivery ${input.lease.deliveryId} terminal replay changed content.`
              );
            }
            return {
              status: 'duplicate' as const,
              cursor: await loadCursor(
                db,
                organizationId,
                input.lease.roomSessionId
              ),
            };
          }
          if (!locked) throw FENCED;
          assertTerminal(input.terminal, input.lease, locked);
          const checkpointJson = input.checkpoint
            ? serializeCurrentCheckpoint(
                input.checkpoint,
                locked,
                input.lease
              )
            : undefined;
          const completed = isSuccessfulCompletion(input.terminal);
          const allocation = await allocateRoomSequences(
            db,
            organizationId,
            locked.sessionRoomId,
            effectiveOutput ? 1 : 0,
            effectiveOutput ? 2 : 1,
            now
          );

          let outputMessage: RoomMessageEnvelopeV1 | null = null;
          let nextEventSequence =
            allocation.eventSequence - (effectiveOutput ? 1 : 0);
          if (effectiveOutput) {
            outputMessage = await persistOutputMessage(
              db,
              {
                createId,
                now,
                organizationId,
                roomId: locked.sessionRoomId,
                sequence: allocation.messageSequence,
                session: sessionRefFromRow(locked),
                deliveryId: input.lease.deliveryId,
              },
              effectiveOutput
            );
            const messageEvent = await insertPublicEvent(
              db,
              {
                id: nextId(createId, 'event'),
                organizationId,
                roomId: locked.sessionRoomId,
                sequence: nextEventSequence,
                type: 'room.message.created',
                data: { message: outputMessage },
                createdAt: now,
              }
            );
            await insertOutbox(db, createId, messageEvent, now);
            nextEventSequence += 1;
          }

          const status = completed ? 'completed' : 'failed';
          const terminalData: StoredTerminalEventV1 = {
            schemaVersion: 1,
            kind: 'room-host.delivery-terminal',
            roomSessionId: input.lease.roomSessionId,
            deliveryId: input.lease.deliveryId,
            generation: input.lease.generation,
            status,
            terminal: input.terminal,
            outputMessageId: outputMessage?.messageId ?? null,
            commitHash,
          };
          const terminalEvent = await insertPublicEvent(db, {
            id: terminalId,
            organizationId,
            roomId: locked.sessionRoomId,
            sequence: nextEventSequence,
            type: completed
              ? 'room.delivery.completed'
              : 'room.delivery.failed',
            data: terminalData,
            createdAt: now,
          });
          await insertOutbox(db, createId, terminalEvent, now);

          const deliveryUpdated = await db.$executeRaw`
            UPDATE "RoomInboxDelivery"
            SET
              "status" = ${status},
              "completedAt" = ${now},
              "lastError" = ${terminalError(input.terminal)},
              "updatedAt" = ${now}
            WHERE "id" = ${input.lease.deliveryId}
              AND "organizationId" = ${organizationId}
              AND "roomSessionId" = ${input.lease.roomSessionId}
              AND "status" = 'claimed'
          `;
          if (deliveryUpdated !== 1) throw FENCED;

          const lastRoomSequence = Math.max(
            readNonNegativeInteger(locked.lastRoomSequence, 'lastRoomSequence'),
            readNonNegativeInteger(locked.messageSequence, 'messageSequence'),
            outputMessage?.sequence ?? 0
          );
          const sessionUpdated = await db.$executeRaw`
            UPDATE "RoomAgentSession"
            SET
              "lastRoomSequence" = ${lastRoomSequence},
              "lastEventSequence" = ${nextEventSequence},
              "checkpointJson" = CASE
                WHEN ${checkpointJson === undefined ? 0 : 1} = 1 THEN ${checkpointJson ?? null}
                ELSE "checkpointJson"
              END,
              "checkpointUpdatedAt" = CASE
                WHEN ${checkpointJson === undefined ? 0 : 1} = 1 THEN ${now}
                ELSE "checkpointUpdatedAt"
              END,
              "leaseOwnerId" = NULL,
              "leaseExpiresAt" = NULL,
              "currentDeliveryId" = NULL,
              "updatedAt" = ${now}
            WHERE "id" = ${input.lease.roomSessionId}
              AND "organizationId" = ${organizationId}
              AND "generation" = ${input.lease.generation}
              AND "leaseOwnerId" = ${input.lease.workerId}
              AND "currentDeliveryId" = ${input.lease.deliveryId}
              AND "leaseExpiresAt" IS NOT NULL
              AND "leaseExpiresAt" > ${now}
          `;
          if (sessionUpdated !== 1) throw FENCED;
          return {
            status: 'finished' as const,
            cursor: {
              messageSequence: lastRoomSequence,
              deliverySequence: locked.deliverySequence,
              eventSequence: nextEventSequence,
            },
          };
        });
      });
    },

    async retryDelivery(input: RetryRoomHostDeliveryInputV1) {
      return retrySqliteBusyV1(async () => {
        const now = operationNow(input.now, fallbackNow);
        const availableAt = requireDate(input.availableAt, 'availableAt');
        return fencedTransaction(client, async (db) => {
          const session = await lockOwnedSession(
            db,
            organizationId,
            input.lease,
            now
          );
          if (!session) throw FENCED;
          const checkpointJson = input.checkpoint
            ? serializeCurrentCheckpoint(
                input.checkpoint,
                session,
                input.lease
              )
            : undefined;
          let lastEventSequence = readNonNegativeInteger(
            session.lastEventSequence,
            'lastEventSequence'
          );
          if (input.event) {
            assertRuntimeEvent(input.event, input.lease, true);
            assertRuntimeIdentity(session, input.event);
            const persisted = await appendRuntimeEvent(
              db,
              createId,
              organizationId,
              session.sessionRoomId,
              input.lease,
              input.event,
              now
            );
            if (persisted.status === 'appended') {
              lastEventSequence = persisted.sequence;
            }
          }

          const retrySequence = await allocateEventSequence(
            db,
            organizationId,
            session.sessionRoomId,
            now
          );
          const retryData: StoredRetryEventV1 = {
            schemaVersion: 1,
            kind: 'room-host.delivery-retrying',
            roomSessionId: input.lease.roomSessionId,
            deliveryId: input.lease.deliveryId,
            generation: input.lease.generation,
            nextAttempt: session.deliveryAttempt + 1,
            failure: input.failure,
          };
          const retryEvent = await insertPublicEvent(db, {
            id: retryEventId(organizationId, input.lease),
            organizationId,
            roomId: session.sessionRoomId,
            sequence: retrySequence,
            type: 'room.delivery.retrying',
            data: retryData,
            createdAt: now,
          });
          await insertOutbox(db, createId, retryEvent, now);
          lastEventSequence = retrySequence;

          const deliveryUpdated = await db.$executeRaw`
            UPDATE "RoomInboxDelivery"
            SET
              "attempt" = "attempt" + 1,
              "status" = 'pending',
              "availableAt" = ${availableAt},
              "claimedAt" = NULL,
              "completedAt" = NULL,
              "lastError" = ${input.failure.message},
              "updatedAt" = ${now}
            WHERE "id" = ${input.lease.deliveryId}
              AND "organizationId" = ${organizationId}
              AND "roomSessionId" = ${input.lease.roomSessionId}
              AND "status" = 'claimed'
          `;
          if (deliveryUpdated !== 1) throw FENCED;

          const sessionUpdated = await db.$executeRaw`
            UPDATE "RoomAgentSession"
            SET
              "lastEventSequence" = ${lastEventSequence},
              "checkpointJson" = CASE
                WHEN ${checkpointJson === undefined ? 0 : 1} = 1 THEN ${checkpointJson ?? null}
                ELSE "checkpointJson"
              END,
              "checkpointUpdatedAt" = CASE
                WHEN ${checkpointJson === undefined ? 0 : 1} = 1 THEN ${now}
                ELSE "checkpointUpdatedAt"
              END,
              "leaseOwnerId" = NULL,
              "leaseExpiresAt" = NULL,
              "currentDeliveryId" = NULL,
              "updatedAt" = ${now}
            WHERE "id" = ${input.lease.roomSessionId}
              AND "organizationId" = ${organizationId}
              AND "generation" = ${input.lease.generation}
              AND "leaseOwnerId" = ${input.lease.workerId}
              AND "currentDeliveryId" = ${input.lease.deliveryId}
              AND "leaseExpiresAt" IS NOT NULL
              AND "leaseExpiresAt" > ${now}
          `;
          if (sessionUpdated !== 1) throw FENCED;
          return 'retried' as const;
        });
      });
    },
  };
}
// Kept as a compatibility spelling for callers that omit the V1 suffix.
export const createPrismaRoomHostStore = createPrismaRoomHostStoreV1;

async function fencedTransaction<T>(
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

async function retryRoomHostSqliteBusyV1<T>(
  _client: PrismaRoomHostClientV1,
  operation: () => Promise<T>
): Promise<T> {
  return retrySqliteBusyV1(operation);
}

async function loadOldestDelivery(
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

async function loadDeliveryById(
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

async function loadMessageMentions(
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

function mapClaim(
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

function assertClaimIdentity(row: ClaimControlRow): void {
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

function sessionRefFromRow(
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

function cursorFromRow(
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

async function loadPendingOutput(
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

async function lockOwnedSession(
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

function owns(row: ClaimControlRow, lease: RoomHostLeaseV1, now: Date): boolean {
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

function isClaimable(row: ClaimControlRow, now: Date): boolean {
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

async function appendRuntimeEvent(
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

async function allocateEventSequence(
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

async function allocateRoomSequences(
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

async function insertPublicEvent(
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

async function findEventById(
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

async function loadCursor(
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

async function persistOutputMessage(
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

async function insertOutbox(
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

function validHandleForLease(
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

function assertRuntimeIdentity(
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

function assertRuntimeEvent(
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

function isRuntimePayload(
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

function publicRuntimeEventType(
  event: RoomRuntimeEventEnvelopeV1['event']
): string {
  return event.type === 'room.tool_confirmation.requested'
    ? event.type
    : `room.runtime.${event.type}`;
}

function assertOutput(output: RoomRuntimeOutputDraftV1): void {
  if (!validateOutput(output)) {
    throw new Error('Room runtime output is invalid.');
  }
}

function validateOutput(value: unknown): value is RoomRuntimeOutputDraftV1 {
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

function assertTerminal(
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

function serializeCurrentCheckpoint(
  checkpoint: RoomSessionCheckpointEnvelopeV1,
  session: ClaimControlRow,
  lease: RoomHostLeaseV1
): string {
  assertCheckpointIdentity(checkpoint, session, lease);
  return stableJson(checkpoint);
}

function assertCheckpointIdentity(
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

function isCheckpoint(
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

function isCursor(value: unknown): value is RoomSessionCursorV1 {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.messageSequence) &&
    isNonNegativeInteger(value.deliverySequence) &&
    isNonNegativeInteger(value.eventSequence)
  );
}

function parseStoredCheckpoint(
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

function parseStoredRuntimeEvent(row: EventRow): StoredRuntimeEventV1 {
  const parsed = safeJsonParse<StoredRuntimeEventV1 | null>(
    row.dataJson,
    null,
    isStoredRuntimeEvent
  );
  if (!parsed) return failStored('runtime event');
  return parsed;
}

function isStoredRuntimeEvent(value: unknown): value is StoredRuntimeEventV1 {
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

function parseStoredTerminal(row: EventRow): StoredTerminalEventV1 {
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

function parseStoredJson(raw: string, field: string): RoomJsonValueV1 {
  const parsed = safeJsonParse<RoomJsonValueV1 | undefined>(
    raw,
    undefined,
    (value): value is RoomJsonValueV1 | undefined =>
      isRoomJsonValueV1(value)
  );
  if (parsed === undefined) return failStored(field);
  return parsed;
}

function runtimeEventPrefix(
  organizationId: string,
  roomSessionId: string,
  generation: number
): string {
  return `rh:runtime:${shortHash(organizationId)}:${shortHash(
    roomSessionId
  )}:${generation}:`;
}

function runtimeEventId(
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

function terminalEventId(
  organizationId: string,
  lease: RoomHostLeaseV1
): string {
  return `rh:terminal:${shortHash(organizationId)}:${shortHash(
    lease.roomSessionId
  )}:${shortHash(lease.deliveryId)}`;
}

function retryEventId(
  organizationId: string,
  lease: RoomHostLeaseV1
): string {
  return `rh:retry:${shortHash(organizationId)}:${shortHash(
    lease.roomSessionId
  )}:${shortHash(lease.deliveryId)}:${lease.generation}`;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value, new WeakSet<object>()));
}

function normalizeJson(
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

function isSuccessfulCompletion(terminal: RoomHostTerminalV1): boolean {
  return (
    terminal.kind === 'runtime-event' &&
    terminal.event.event.type === 'delivery-completed'
  );
}

function terminalError(terminal: RoomHostTerminalV1): string | null {
  if (terminal.kind === 'host-failure') return terminal.failure.message;
  return terminal.event.event.type === 'error'
    ? terminal.event.event.message
    : null;
}

function createClock(clock: PrismaRoomHostClockV1 | undefined): () => Date {
  if (typeof clock === 'function') return clock;
  if (clock) return () => clock.now();
  return () => new Date();
}

function operationNow(value: Date | undefined, fallback: () => Date): Date {
  return requireDate(value ?? fallback(), 'now');
}

function addDuration(now: Date, value: number, field: string): Date {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer.`);
  }
  const expiresAt = new Date(now.valueOf() + value);
  if (Number.isNaN(expiresAt.valueOf())) {
    throw new Error(`${field} produced an invalid expiry.`);
  }
  return expiresAt;
}

function readRuntimeIds(value: readonly string[]): string[] {
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

function readCandidateLimit(value: number | undefined): number {
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

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be non-empty.`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireDate(value: Date | string, field: string): Date {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`${field} is invalid.`);
  return date;
}

function nullableDate(
  value: Date | string | null,
  field: string
): Date | null {
  return value === null ? null : requireDate(value, field);
}

function toIso(value: Date | string, field: string): string {
  return requireDate(value, field).toISOString();
}

function validIso(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !Number.isNaN(Date.parse(value))
  );
}

function isNonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function readNonNegativeInteger(value: unknown, field: string): number {
  if (!isNonNegativeInteger(value)) {
    throw new Error(`Stored Room ${field} is invalid.`);
  }
  return value as number;
}

function readPositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`Stored Room ${field} is invalid.`);
  }
  return value as number;
}

function nextId(
  createId: (kind: PrismaRoomHostIdKindV1) => string,
  kind: PrismaRoomHostIdKindV1
): string {
  return requireText(createId(kind), `${kind} id`);
}

function failStored(field: string): never {
  throw new Error(`Stored Room ${field} is invalid.`);
}
