import type {
  RoomDeliveryEnvelopeV1,
  RoomPolicyV1,
  RoomRuntimeEventEnvelopeV1,
  RoomRuntimeEventPayloadV1,
  RoomRuntimeOutputDraftV1,
  RoomSessionCheckpointEnvelopeV1,
  RoomSessionCursorV1,
  RoomSessionRefV1,
  RoomSessionRuntimeHandleV1,
} from '@/agent/room-runtime/contracts';

export type RoomHostCandidateV1 = {
  roomSessionId: string;
  runtimeId: string;
};

/**
 * An opaque ownership epoch carried on every state-changing store call. A
 * store must match all four fields and an unexpired lease before writing.
 */
export type RoomHostLeaseV1 = {
  roomSessionId: string;
  deliveryId: string;
  workerId: string;
  generation: number;
};

export type RoomHostClaimV1 = {
  lease: RoomHostLeaseV1;
  session: RoomSessionRefV1;
  runtimeId: string;
  runtimeSessionId: string | null;
  checkpoint: RoomSessionCheckpointEnvelopeV1 | null;
  cursor: RoomSessionCursorV1;
  delivery: RoomDeliveryEnvelopeV1;
  /** Last durable message-ready draft for this delivery, if it was persisted. */
  pendingOutput: RoomRuntimeOutputDraftV1 | null;
  policy: RoomPolicyV1;
};

export type ListRoomHostCandidatesInputV1 = {
  runtimeIds: readonly string[];
  limit: number;
  now: Date;
};

export type ClaimRoomHostCandidateInputV1 = {
  roomSessionId: string;
  runtimeId: string;
  workerId: string;
  leaseDurationMs: number;
  now: Date;
};

export type HeartbeatRoomHostLeaseInputV1 = {
  lease: RoomHostLeaseV1;
  leaseDurationMs: number;
  now: Date;
};

export type BindRoomHostRuntimeInputV1 = {
  lease: RoomHostLeaseV1;
  handle: RoomSessionRuntimeHandleV1;
  now: Date;
};

export type RoomHostTerminalRuntimeEventV1 = Omit<
  RoomRuntimeEventEnvelopeV1,
  'event'
> & {
  event: Extract<
    RoomRuntimeEventPayloadV1,
    { type: 'delivery-completed' | 'error' }
  >;
};

export type RoomHostFailureV1 = {
  kind: 'runtime' | 'protocol' | 'interrupted';
  code: string;
  message: string;
  retryable: boolean;
};

export type RoomHostTerminalV1 =
  | { kind: 'runtime-event'; event: RoomHostTerminalRuntimeEventV1 }
  | { kind: 'host-failure'; failure: RoomHostFailureV1 };

export type AppendRoomHostEventInputV1 = {
  lease: RoomHostLeaseV1;
  event: RoomRuntimeEventEnvelopeV1;
  now: Date;
};

export type AppendRoomHostEventResultV1 =
  | 'fenced'
  | {
      status: 'appended' | 'duplicate';
      cursor: RoomSessionCursorV1;
    };

export type PersistRoomHostCheckpointInputV1 = {
  lease: RoomHostLeaseV1;
  checkpoint: RoomSessionCheckpointEnvelopeV1;
  now: Date;
};

export type FinishRoomHostDeliveryInputV1 = {
  lease: RoomHostLeaseV1;
  terminal: RoomHostTerminalV1;
  /**
   * The last durable message-ready draft, if any. A successful store commit
   * turns this into the authoritative agent RoomMessage and public RoomEvent.
   */
  output?: RoomRuntimeOutputDraftV1;
  checkpoint?: RoomSessionCheckpointEnvelopeV1;
  now: Date;
};

export type FinishRoomHostDeliveryResultV1 =
  | 'fenced'
  | { status: 'finished' | 'duplicate'; cursor: RoomSessionCursorV1 };

export type RetryRoomHostDeliveryInputV1 = {
  lease: RoomHostLeaseV1;
  failure: RoomHostFailureV1;
  event?: RoomHostTerminalRuntimeEventV1;
  checkpoint?: RoomSessionCheckpointEnvelopeV1;
  availableAt: Date;
  now: Date;
};

/**
 * Prisma-free durable boundary for a Room Session Host. Candidate reads are
 * hints. `claim` must settle races atomically and enforce the oldest
 * nonterminal delivery for a session. Every mutating method is generation,
 * owner, current-delivery, and lease-expiry fenced.
 */
export interface RoomHostStoreV1 {
  listCandidates(
    input: ListRoomHostCandidatesInputV1
  ): Promise<readonly RoomHostCandidateV1[]>;

  claim(
    input: ClaimRoomHostCandidateInputV1
  ): Promise<RoomHostClaimV1 | null>;

  heartbeat(
    input: HeartbeatRoomHostLeaseInputV1
  ): Promise<'renewed' | 'fenced'>;

  bindRuntime(
    input: BindRoomHostRuntimeInputV1
  ): Promise<'bound' | 'fenced'>;

  /**
   * Persists an event before the Host acts on it. A checkpoint-ready event
   * must update the checkpoint in the same fenced transaction. The returned
   * cursor, not the adapter eventSequence, is authoritative.
   */
  appendEvent(
    input: AppendRoomHostEventInputV1
  ): Promise<AppendRoomHostEventResultV1>;

  persistCheckpoint(
    input: PersistRoomHostCheckpointInputV1
  ): Promise<'persisted' | 'fenced'>;

  /**
   * Atomically persists the terminal fact/outbox, optional checkpoint,
   * advances the cursor, terminalizes the delivery, and clears the lease.
   */
  finishDelivery(
    input: FinishRoomHostDeliveryInputV1
  ): Promise<FinishRoomHostDeliveryResultV1>;

  /**
   * Atomically records an interrupted/retryable attempt, increments attempt,
   * requeues the same deliveryId, and clears the lease.
   */
  retryDelivery(
    input: RetryRoomHostDeliveryInputV1
  ): Promise<'retried' | 'fenced'>;
}
