import { randomUUID } from 'node:crypto';

import type { RoomMessageEnvelopeV1 } from '@/agent/room-runtime/contracts';
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
  RoomHostStoreV1,
} from './store';
import {
  addDuration,
  assertOutput,
  assertRuntimeEvent,
  assertRuntimeIdentity,
  assertTerminal,
  createClock,
  FENCED,
  hashJson,
  isSuccessfulCompletion,
  nextId,
  operationNow,
  optionalText,
  parseStoredTerminal,
  readCandidateLimit,
  readNonNegativeInteger,
  readRuntimeIds,
  requireDate,
  requireText,
  retryEventId,
  serializeCurrentCheckpoint,
  terminalError,
  terminalEventId,
  validHandleForLease,
  type CandidateRow,
  type PrismaRoomHostClientV1,
  type PrismaRoomHostClockV1,
  type PrismaRoomHostIdKindV1,
  type PrismaRoomHostStoreOptionsV1,
  type StoredRetryEventV1,
  type StoredTerminalEventV1,
} from './prisma-store-codec';
import {
  allocateEventSequence,
  allocateRoomSequences,
  appendRuntimeEvent,
  fencedTransaction,
  findEventById,
  insertOutbox,
  insertPublicEvent,
  isClaimable,
  loadCursor,
  loadDeliveryById,
  loadMessageMentions,
  loadOldestDelivery,
  loadPendingOutput,
  lockOwnedSession,
  mapClaim,
  persistOutputMessage,
  retryRoomHostSqliteBusyV1,
  sessionRefFromRow,
} from './prisma-store-queries';

export type {
  PrismaRoomHostClientV1,
  PrismaRoomHostClockV1,
  PrismaRoomHostIdKindV1,
  PrismaRoomHostStoreOptionsV1,
};

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
