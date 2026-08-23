import {
  ROOM_RUNTIME_CONTRACT_VERSION_V1,
  type RoomContextSnapshotV1,
  type RoomDeliveryEnvelopeV1,
  type RoomJsonValueV1,
  type RoomMessageEnvelopeV1,
  type RoomPolicyV1,
  type RoomRuntimeEventEnvelopeV1,
  type RoomRuntimeOutputDraftV1,
  type RoomSessionCheckpointEnvelopeV1,
  type RoomSessionCursorV1,
  type RoomSessionRefV1,
} from '@/agent/room-runtime/contracts';
import { ROOM_CONTEXT_CONTRACT_VERSION_V1 } from '@/agent/context';
import type {
  BuildRoomContextInputV1,
  RoomContextAclDecisionV1,
  RoomContextMessageInputV1,
} from '@/agent/context';

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
  RoomHostCandidateV1,
  RoomHostClaimV1,
  RoomHostFailureV1,
  RoomHostLeaseV1,
  RoomHostStoreV1,
  RoomHostTerminalV1,
} from './store';
import type { RoomHostContextSourceV1 } from './host';

export type InMemoryRoomHostDeliveryStatusV1 =
  | 'pending'
  | 'claimed'
  | 'completed'
  | 'failed';

export type InMemoryRoomHostSessionSeedV1 = {
  session: RoomSessionRefV1;
  runtimeId: string;
  runtimeSessionId?: string | null;
  checkpoint?: RoomSessionCheckpointEnvelopeV1 | null;
  cursor?: RoomSessionCursorV1;
  context: RoomContextSnapshotV1;
  policy: RoomPolicyV1;
  generation?: number;
  deliveries: readonly RoomDeliveryEnvelopeV1[];
};

export type InMemoryRoomHostPublicEventV1 = {
  eventId: string;
  roomId: string;
  sequence: number;
  type: string;
  data: RoomJsonValueV1;
  createdAt: string;
};

export type InMemoryRoomHostOutboxRecordV1 = {
  id: string;
  roomId: string;
  topic: string;
  dedupeKey: string;
  payload: RoomJsonValueV1;
};

export type InMemoryRoomHostStoreOptionsV1 = {
  idFactory?: (kind: 'message' | 'event' | 'outbox') => string;
};

type DeliveryStateV1 = {
  envelope: RoomDeliveryEnvelopeV1;
  status: InMemoryRoomHostDeliveryStatusV1;
  availableAt: Date;
  completedAt: Date | null;
  lastError: string | null;
  terminal: RoomHostTerminalV1 | null;
};

type PersistedRuntimeEventV1 = {
  event: RoomRuntimeEventEnvelopeV1;
  durableSequence: number;
};

type SessionStateV1 = {
  seed: InMemoryRoomHostSessionSeedV1;
  generation: number;
  runtimeSessionId: string | null;
  checkpoint: RoomSessionCheckpointEnvelopeV1 | null;
  cursor: RoomSessionCursorV1;
  leaseOwnerId: string | null;
  leaseExpiresAt: Date | null;
  currentDeliveryId: string | null;
  pendingOutput: RoomRuntimeOutputDraftV1 | null;
  deliveries: DeliveryStateV1[];
  runtimeEvents: Map<string, PersistedRuntimeEventV1>;
};

/**
 * Deterministic process-local adapter used for contract tests and standalone
 * smoke configurations. It mirrors store transaction boundaries; it is not a
 * replacement for durable production persistence.
 */
export class InMemoryRoomHostStoreV1
  implements RoomHostStoreV1, RoomHostContextSourceV1
{
  private readonly sessions = new Map<string, SessionStateV1>();
  private readonly roomMessageSequences = new Map<string, number>();
  private readonly roomEventSequences = new Map<string, number>();
  private readonly idFactory: NonNullable<
    InMemoryRoomHostStoreOptionsV1['idFactory']
  >;
  private idSequence = 0;

  readonly messages: RoomMessageEnvelopeV1[] = [];
  readonly publicEvents: InMemoryRoomHostPublicEventV1[] = [];
  readonly outbox: InMemoryRoomHostOutboxRecordV1[] = [];

  constructor(
    seeds: readonly InMemoryRoomHostSessionSeedV1[] = [],
    options: InMemoryRoomHostStoreOptionsV1 = {}
  ) {
    this.idFactory =
      options.idFactory ??
      ((kind) => `${kind}-${String(++this.idSequence).padStart(4, '0')}`);
    for (const seed of seeds) this.addSession(seed);
  }

  addSession(seed: InMemoryRoomHostSessionSeedV1): void {
    const sessionId = seed.session.roomSessionId;
    if (this.sessions.has(sessionId)) {
      throw new Error(`Room session ${sessionId} already exists.`);
    }
    const cursor = seed.cursor ?? {
      messageSequence: 0,
      deliverySequence: 0,
      eventSequence: 0,
    };
    const deliveries = [...seed.deliveries]
      .sort((left, right) => left.deliverySequence - right.deliverySequence)
      .map((envelope) => ({
        envelope: cloneDelivery(envelope),
        status: 'pending' as const,
        availableAt: new Date(envelope.createdAt),
        completedAt: null,
        lastError: null,
        terminal: null,
      }));
    this.sessions.set(sessionId, {
      seed,
      generation: seed.generation ?? 0,
      runtimeSessionId: seed.runtimeSessionId ?? null,
      checkpoint: seed.checkpoint ?? null,
      cursor: { ...cursor },
      leaseOwnerId: null,
      leaseExpiresAt: null,
      currentDeliveryId: null,
      pendingOutput: null,
      deliveries,
      runtimeEvents: new Map(),
    });
    this.roomMessageSequences.set(
      seed.session.roomId,
      Math.max(
        this.roomMessageSequences.get(seed.session.roomId) ?? 0,
        seed.context.throughMessageSequence,
        ...seed.context.messages.map(({ sequence }) => sequence)
      )
    );
    this.roomEventSequences.set(
      seed.session.roomId,
      Math.max(
        this.roomEventSequences.get(seed.session.roomId) ?? 0,
        cursor.eventSequence
      )
    );
  }

  async listCandidates(
    input: ListRoomHostCandidatesInputV1
  ): Promise<readonly RoomHostCandidateV1[]> {
    const allowed = new Set(input.runtimeIds);
    const candidates: Array<RoomHostCandidateV1 & { sequence: number }> = [];
    for (const [roomSessionId, session] of this.sessions) {
      if (!allowed.has(session.seed.runtimeId)) continue;
      const delivery = firstNonterminal(session);
      if (!delivery || !claimable(session, delivery, input.now)) continue;
      candidates.push({
        roomSessionId,
        runtimeId: session.seed.runtimeId,
        sequence: delivery.envelope.deliverySequence,
      });
    }
    return candidates
      .sort(
        (left, right) =>
          left.sequence - right.sequence ||
          left.roomSessionId.localeCompare(right.roomSessionId)
      )
      .slice(0, input.limit)
      .map(({ roomSessionId, runtimeId }) => ({ roomSessionId, runtimeId }));
  }

  async load(
    input: Parameters<RoomHostContextSourceV1['load']>[0]
  ): Promise<BuildRoomContextInputV1> {
    const session = this.sessions.get(input.session.roomSessionId);
    if (
      !session ||
      session.generation !== input.lease.generation ||
      session.leaseOwnerId !== input.lease.workerId ||
      session.currentDeliveryId !== input.lease.deliveryId
    ) {
      throw new Error('In-memory Room context load was fenced.');
    }
    const delivery = session.deliveries.find(
      ({ envelope }) => envelope.deliveryId === input.delivery.deliveryId
    );
    if (!delivery || delivery.status !== 'claimed') {
      throw new Error('Claimed in-memory Room delivery was not found.');
    }
    const acl: RoomContextAclDecisionV1 = {
      schemaVersion: ROOM_CONTEXT_CONTRACT_VERSION_V1,
      decision: 'allow',
      organizationId: input.session.organizationId,
      principal: {
        type: 'room-agent-session',
        agentId: input.session.agent.agentId,
        roomSessionId: input.session.roomSessionId,
      },
      resource: { type: 'room', roomId: input.session.roomId },
      permission: 'context.read',
      policyVersion: 'in-memory-room-context-v1',
    };
    const wrap = (
      message: RoomMessageEnvelopeV1
    ): RoomContextMessageInputV1 => ({ message: clone(message), acl });
    const messages = [
      ...session.seed.context.messages,
      ...this.messages.filter(
        ({ roomId, sequence }) =>
          roomId === input.session.roomId &&
          sequence < input.delivery.message.sequence
      ),
    ].filter(
      ({ messageId }) => messageId !== input.delivery.message.messageId
    );
    const messagesById = new Map(
      messages.map((message) => [message.messageId, message] as const)
    );
    const replyChain: RoomContextMessageInputV1[] = [];
    const visited = new Set<string>();
    let replyToMessageId = input.delivery.message.replyToMessageId;
    while (replyToMessageId && replyChain.length < 8) {
      if (visited.has(replyToMessageId)) break;
      visited.add(replyToMessageId);
      const message = messagesById.get(replyToMessageId);
      if (!message) break;
      replyChain.push(wrap(message));
      replyToMessageId = message.replyToMessageId;
    }
    return {
      session: clone(input.session),
      currentMessage: wrap(input.delivery.message),
      relevantRoomDelta: messages
        .filter(({ sequence }) => sequence < input.delivery.message.sequence)
        .sort((left, right) => right.sequence - left.sequence)
        .slice(0, 12)
        .map(wrap),
      replyChain,
      documentSlices: [],
      retrievalHits: [],
    };
  }

  async claim(
    input: ClaimRoomHostCandidateInputV1
  ): Promise<RoomHostClaimV1 | null> {
    const session = this.sessions.get(input.roomSessionId);
    if (!session || session.seed.runtimeId !== input.runtimeId) return null;
    const delivery = firstNonterminal(session);
    if (!delivery || !claimable(session, delivery, input.now)) return null;
    if (delivery.status === 'claimed') {
      delivery.envelope = {
        ...delivery.envelope,
        attempt: delivery.envelope.attempt + 1,
      };
    }
    session.generation += 1;
    session.leaseOwnerId = input.workerId;
    session.leaseExpiresAt = new Date(
      input.now.getTime() + input.leaseDurationMs
    );
    session.currentDeliveryId = delivery.envelope.deliveryId;
    delivery.status = 'claimed';

    return {
      lease: {
        roomSessionId: session.seed.session.roomSessionId,
        deliveryId: delivery.envelope.deliveryId,
        workerId: input.workerId,
        generation: session.generation,
      },
      session: clone(session.seed.session),
      runtimeId: session.seed.runtimeId,
      runtimeSessionId: session.runtimeSessionId,
      checkpoint: clone(session.checkpoint),
      cursor: { ...session.cursor },
      delivery: cloneDelivery(delivery.envelope),
      pendingOutput: clone(session.pendingOutput),
      policy: clone(session.seed.policy),
    };
  }

  async heartbeat(
    input: HeartbeatRoomHostLeaseInputV1
  ): Promise<'renewed' | 'fenced'> {
    const session = this.ownedSession(input.lease, input.now);
    if (!session) return 'fenced';
    session.leaseExpiresAt = new Date(
      input.now.getTime() + input.leaseDurationMs
    );
    return 'renewed';
  }

  async bindRuntime(
    input: BindRoomHostRuntimeInputV1
  ): Promise<'bound' | 'fenced'> {
    const session = this.ownedSession(input.lease, input.now);
    if (
      !session ||
      input.handle.session.roomSessionId !== input.lease.roomSessionId ||
      input.handle.generation !== input.lease.generation ||
      input.handle.runtimeId !== session.seed.runtimeId
    ) {
      return 'fenced';
    }
    session.runtimeSessionId = input.handle.runtimeSessionId;
    return 'bound';
  }

  async appendEvent(
    input: AppendRoomHostEventInputV1
  ): Promise<AppendRoomHostEventResultV1> {
    const session = this.ownedSession(input.lease, input.now);
    if (!session) return 'fenced';
    const durableEventId = runtimeEventId(
      session.seed.session.organizationId,
      input.lease,
      input.event.eventId
    );
    const previous = session.runtimeEvents.get(durableEventId);
    if (previous) {
      if (serialize(previous.event) !== serialize(input.event)) {
        throw new Error(`Runtime event ${input.event.eventId} changed on replay.`);
      }
      return { status: 'duplicate', cursor: { ...session.cursor } };
    }

    const durableSequence = this.appendPublicEvent(
      session.seed.session.roomId,
      `room.runtime.${input.event.event.type}`,
      input.event as unknown as RoomJsonValueV1,
      input.now,
      durableEventId
    );
    session.runtimeEvents.set(durableEventId, {
      event: clone(input.event),
      durableSequence,
    });
    session.cursor.eventSequence = durableSequence;
    if (input.event.event.type === 'message-ready') {
      session.pendingOutput = clone(input.event.event.message);
    } else if (input.event.event.type === 'checkpoint-ready') {
      session.checkpoint = clone(input.event.event.checkpoint);
    }
    return { status: 'appended', cursor: { ...session.cursor } };
  }

  async persistCheckpoint(
    input: PersistRoomHostCheckpointInputV1
  ): Promise<'persisted' | 'fenced'> {
    const session = this.ownedSession(input.lease, input.now);
    if (!session) return 'fenced';
    session.checkpoint = clone(input.checkpoint);
    return 'persisted';
  }

  async finishDelivery(
    input: FinishRoomHostDeliveryInputV1
  ): Promise<FinishRoomHostDeliveryResultV1> {
    const session = this.sessions.get(input.lease.roomSessionId);
    const delivery = session?.deliveries.find(
      ({ envelope }) => envelope.deliveryId === input.lease.deliveryId
    );
    if (
      session &&
      delivery &&
      (delivery.status === 'completed' || delivery.status === 'failed') &&
      delivery.terminal &&
      serialize(delivery.terminal) === serialize(input.terminal)
    ) {
      return { status: 'duplicate', cursor: { ...session.cursor } };
    }
    const owned = this.ownedSession(input.lease, input.now);
    if (!owned || !delivery) return 'fenced';

    if (input.checkpoint) owned.checkpoint = clone(input.checkpoint);
    let outputMessage: RoomMessageEnvelopeV1 | null = null;
    if (isSuccessfulCompletion(input.terminal) && input.output) {
      outputMessage = this.appendAgentMessage(owned, input.output, input.now);
      this.appendPublicEvent(
        owned.seed.session.roomId,
        'room.message.created',
        { message: outputMessage } as unknown as RoomJsonValueV1,
        input.now,
        terminalArtifactId(
          owned.seed.session.organizationId,
          input.lease,
          'message'
        )
      );
    }
    const terminalSequence = this.appendPublicEvent(
      owned.seed.session.roomId,
      isSuccessfulCompletion(input.terminal)
        ? 'room.delivery.completed'
        : 'room.delivery.failed',
      {
        deliveryId: delivery.envelope.deliveryId,
        roomSessionId: owned.seed.session.roomSessionId,
        terminal: input.terminal as unknown as RoomJsonValueV1,
        outputMessageId: outputMessage?.messageId ?? null,
      },
      input.now,
      terminalArtifactId(
        owned.seed.session.organizationId,
        input.lease,
        'terminal'
      )
    );

    delivery.status = isSuccessfulCompletion(input.terminal)
      ? 'completed'
      : 'failed';
    delivery.completedAt = new Date(input.now);
    delivery.lastError = terminalError(input.terminal);
    delivery.terminal = clone(input.terminal);
    owned.cursor = {
      messageSequence: Math.max(
        owned.cursor.messageSequence,
        delivery.envelope.message.sequence,
        outputMessage?.sequence ?? 0
      ),
      deliverySequence: delivery.envelope.deliverySequence,
      eventSequence: terminalSequence,
    };
    owned.pendingOutput = null;
    clearLease(owned);
    return { status: 'finished', cursor: { ...owned.cursor } };
  }

  async retryDelivery(
    input: RetryRoomHostDeliveryInputV1
  ): Promise<'retried' | 'fenced'> {
    const session = this.ownedSession(input.lease, input.now);
    const delivery = session?.deliveries.find(
      ({ envelope }) => envelope.deliveryId === input.lease.deliveryId
    );
    if (!session || !delivery) return 'fenced';
    if (input.event) {
      const result = await this.appendEvent({
        lease: input.lease,
        event: input.event,
        now: input.now,
      });
      if (result === 'fenced') return 'fenced';
    }
    if (input.checkpoint) session.checkpoint = clone(input.checkpoint);
    this.appendPublicEvent(
      session.seed.session.roomId,
      'room.delivery.retrying',
      {
        deliveryId: delivery.envelope.deliveryId,
        generation: input.lease.generation,
        nextAttempt: delivery.envelope.attempt + 1,
        failure: input.failure as unknown as RoomJsonValueV1,
      },
      input.now,
      terminalArtifactId(
        session.seed.session.organizationId,
        input.lease,
        'retry'
      )
    );
    delivery.envelope = {
      ...delivery.envelope,
      attempt: delivery.envelope.attempt + 1,
    };
    delivery.status = 'pending';
    delivery.availableAt = new Date(input.availableAt);
    delivery.lastError = input.failure.message;
    session.pendingOutput = null;
    clearLease(session);
    return 'retried';
  }

  snapshot(roomSessionId: string) {
    const session = this.sessions.get(roomSessionId);
    if (!session) return null;
    return clone({
      generation: session.generation,
      runtimeSessionId: session.runtimeSessionId,
      checkpoint: session.checkpoint,
      cursor: session.cursor,
      leaseOwnerId: session.leaseOwnerId,
      leaseExpiresAt: session.leaseExpiresAt?.toISOString() ?? null,
      currentDeliveryId: session.currentDeliveryId,
      pendingOutput: session.pendingOutput,
      deliveries: session.deliveries.map((delivery) => ({
        envelope: delivery.envelope,
        status: delivery.status,
        availableAt: delivery.availableAt.toISOString(),
        completedAt: delivery.completedAt?.toISOString() ?? null,
        lastError: delivery.lastError,
        terminal: delivery.terminal,
      })),
    });
  }

  private ownedSession(
    lease: RoomHostLeaseV1,
    now: Date
  ): SessionStateV1 | null {
    const session = this.sessions.get(lease.roomSessionId);
    if (
      !session ||
      session.generation !== lease.generation ||
      session.leaseOwnerId !== lease.workerId ||
      session.currentDeliveryId !== lease.deliveryId ||
      !session.leaseExpiresAt ||
      session.leaseExpiresAt.getTime() <= now.getTime()
    ) {
      return null;
    }
    return session;
  }

  private appendAgentMessage(
    session: SessionStateV1,
    output: RoomRuntimeOutputDraftV1,
    now: Date
  ): RoomMessageEnvelopeV1 {
    const roomId = session.seed.session.roomId;
    const sequence = (this.roomMessageSequences.get(roomId) ?? 0) + 1;
    this.roomMessageSequences.set(roomId, sequence);
    const message: RoomMessageEnvelopeV1 = {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      envelopeType: 'room.message',
      messageId: this.idFactory('message'),
      organizationId: session.seed.session.organizationId,
      roomId,
      sequence,
      createdAt: now.toISOString(),
      actor: { type: 'agent', ...session.seed.session.agent },
      text: output.text,
      mentions: clone(output.mentions),
      attachments: clone(output.attachments ?? []),
      correlationId: session.currentDeliveryId ?? undefined,
    };
    this.messages.push(message);
    return message;
  }

  private appendPublicEvent(
    roomId: string,
    type: string,
    data: RoomJsonValueV1,
    now: Date,
    preferredId?: string
  ): number {
    const sequence = (this.roomEventSequences.get(roomId) ?? 0) + 1;
    this.roomEventSequences.set(roomId, sequence);
    this.publicEvents.push({
      eventId: preferredId || this.idFactory('event'),
      roomId,
      sequence,
      type,
      data: clone(data),
      createdAt: now.toISOString(),
    });
    this.outbox.push({
      id: this.idFactory('outbox'),
      roomId,
      topic: 'room.event.created',
      dedupeKey: `room-event:${roomId}:${sequence}`,
      payload: { roomId, eventSequence: sequence },
    });
    return sequence;
  }
}

function firstNonterminal(session: SessionStateV1): DeliveryStateV1 | null {
  return (
    session.deliveries.find(
      ({ status }) => status !== 'completed' && status !== 'failed'
    ) ?? null
  );
}

function claimable(
  session: SessionStateV1,
  delivery: DeliveryStateV1,
  now: Date
): boolean {
  if (delivery.status === 'pending') {
    return delivery.availableAt.getTime() <= now.getTime();
  }
  return (
    delivery.status === 'claimed' &&
    session.currentDeliveryId === delivery.envelope.deliveryId &&
    (!session.leaseExpiresAt ||
      session.leaseExpiresAt.getTime() <= now.getTime())
  );
}

function clearLease(session: SessionStateV1): void {
  session.leaseOwnerId = null;
  session.leaseExpiresAt = null;
  session.currentDeliveryId = null;
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

function cloneDelivery(
  delivery: RoomDeliveryEnvelopeV1
): RoomDeliveryEnvelopeV1 {
  return clone(delivery);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function runtimeEventId(
  organizationId: string,
  lease: RoomHostLeaseV1,
  providerEventId: string
): string {
  return [
    'runtime-event',
    organizationId,
    lease.roomSessionId,
    lease.generation,
    providerEventId,
  ].join(':');
}

function terminalArtifactId(
  organizationId: string,
  lease: RoomHostLeaseV1,
  kind: 'message' | 'retry' | 'terminal'
): string {
  return [
    'room-host',
    kind,
    organizationId,
    lease.roomSessionId,
    lease.generation,
    lease.deliveryId,
  ].join(':');
}
