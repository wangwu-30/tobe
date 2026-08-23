import {
  ROOM_RUNTIME_CONTRACT_VERSION_V1,
  type RoomContextReferenceV1,
  type RoomContextSnapshotV1,
  type RoomRuntimeEventEnvelopeV1,
  type RoomRuntimeOutputDraftV1,
  type RoomSessionCheckpointEnvelopeV1,
  type RoomSessionCursorV1,
  type RoomSessionRuntimeHandleV1,
  type RoomSessionRuntimePortV1,
} from '@/agent/room-runtime/contracts';
import type { RoomSessionRuntimeRegistryV1 } from '@/agent/room-runtime/registry';
import type {
  BuildRoomContextInputV1,
  RoomContextBuildResultV1,
  RoomContextPortV1,
} from '@/agent/context';
import type {
  RoomHostClaimV1,
  RoomHostFailureV1,
  RoomHostStoreV1,
  RoomHostTerminalRuntimeEventV1,
} from './store';

export const ROOM_HOST_DEFAULTS_V1 = {
  heartbeatIntervalMs: 10_000,
  leaseDurationMs: 30_000,
  maxConcurrentSessions: 8,
  maxDeliveryAttempts: 3,
  pollBatchSize: 32,
  pollIntervalMs: 1_000,
  retryBaseDelayMs: 250,
  retryMaxDelayMs: 30_000,
} as const;

export interface RoomHostClockV1 {
  now(): Date;
}

export type RoomHostWaitV1 = (
  durationMs: number,
  signal: AbortSignal
) => Promise<void>;

export interface RoomHostLoggerV1 {
  debug(message: string, context?: Readonly<Record<string, unknown>>): void;
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, context?: Readonly<Record<string, unknown>>): void;
}

export interface RoomHostContextSourceV1 {
  load(input: {
    schemaVersion: typeof ROOM_RUNTIME_CONTRACT_VERSION_V1;
    session: RoomHostClaimV1['session'];
    delivery: RoomHostClaimV1['delivery'];
    cursor: RoomHostClaimV1['cursor'];
    lease: RoomHostClaimV1['lease'];
  }): Promise<BuildRoomContextInputV1>;
}

/**
 * Compatibility bridge until the Room runtime wire contract natively carries
 * bounded provenance blocks. Runtimes may consume the richer fields through
 * structural typing while older adapters continue to see authoritative Room
 * message envelopes.
 */
export type RoomHostBuiltContextV1 =
  RoomContextSnapshotV1 & RoomContextBuildResultV1;

export type RoomSessionHostOptionsV1 = {
  workerId: string;
  store: RoomHostStoreV1;
  registry: Pick<RoomSessionRuntimeRegistryV1, 'runtimeIds' | 'lookup'>;
  contextSource: RoomHostContextSourceV1;
  contextBuilder: RoomContextPortV1;
  clock: RoomHostClockV1;
  wait: RoomHostWaitV1;
  logger: RoomHostLoggerV1;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  leaseDurationMs?: number;
  pollBatchSize?: number;
  maxConcurrentSessions?: number;
  maxDeliveryAttempts?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
};

type RoomHostStateV1 = 'idle' | 'running' | 'draining' | 'stopped';

type DeferredV1 = {
  promise: Promise<void>;
  resolve(): void;
};

type ActiveRoomSessionV1 = {
  claim: RoomHostClaimV1;
  runtime: RoomSessionRuntimePortV1;
  handle?: RoomSessionRuntimeHandleV1;
  iterator?: AsyncIterator<RoomRuntimeEventEnvelopeV1>;
  cursor: RoomSessionCursorV1;
  checkpoint: RoomSessionCheckpointEnvelopeV1 | null;
  output: RoomRuntimeOutputDraftV1 | null;
  lastRuntimeEventSequence: number;
  writable: boolean;
  settling: boolean;
  heartbeatController: AbortController;
  stop: DeferredV1;
  done: Promise<void>;
};

/**
 * Runtime-neutral host for durable RoomAgentSession deliveries. One delivery
 * per session is active locally, while unrelated sessions use independent
 * slots. The store is authoritative for FIFO and cross-process claim races.
 */
export class RoomSessionHostV1 {
  private readonly workerId: string;
  private readonly store: RoomHostStoreV1;
  private readonly registry: Pick<
    RoomSessionRuntimeRegistryV1,
    'runtimeIds' | 'lookup'
  >;
  private readonly contextSource: RoomHostContextSourceV1;
  private readonly contextBuilder: RoomContextPortV1;
  private readonly clock: RoomHostClockV1;
  private readonly wait: RoomHostWaitV1;
  private readonly logger: RoomHostLoggerV1;
  private readonly pollIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly leaseDurationMs: number;
  private readonly pollBatchSize: number;
  private readonly maxConcurrentSessions: number;
  private readonly maxDeliveryAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;

  private state: RoomHostStateV1 = 'idle';
  private runPromise: Promise<void> | null = null;
  private pollWaitController: AbortController | null = null;
  private readonly activeSessions = new Map<string, ActiveRoomSessionV1>();

  constructor(options: RoomSessionHostOptionsV1) {
    this.workerId = requireText(options.workerId, 'workerId');
    this.store = options.store;
    this.registry = options.registry;
    this.contextSource = options.contextSource;
    this.contextBuilder = options.contextBuilder;
    this.clock = options.clock;
    this.wait = options.wait;
    this.logger = options.logger;
    this.pollIntervalMs = positiveInteger(
      options.pollIntervalMs ?? ROOM_HOST_DEFAULTS_V1.pollIntervalMs,
      'pollIntervalMs'
    );
    this.heartbeatIntervalMs = positiveInteger(
      options.heartbeatIntervalMs ??
        ROOM_HOST_DEFAULTS_V1.heartbeatIntervalMs,
      'heartbeatIntervalMs'
    );
    this.leaseDurationMs = positiveInteger(
      options.leaseDurationMs ?? ROOM_HOST_DEFAULTS_V1.leaseDurationMs,
      'leaseDurationMs'
    );
    this.pollBatchSize = positiveInteger(
      options.pollBatchSize ?? ROOM_HOST_DEFAULTS_V1.pollBatchSize,
      'pollBatchSize'
    );
    this.maxConcurrentSessions = positiveInteger(
      options.maxConcurrentSessions ??
        ROOM_HOST_DEFAULTS_V1.maxConcurrentSessions,
      'maxConcurrentSessions'
    );
    this.maxDeliveryAttempts = positiveInteger(
      options.maxDeliveryAttempts ??
        ROOM_HOST_DEFAULTS_V1.maxDeliveryAttempts,
      'maxDeliveryAttempts'
    );
    this.retryBaseDelayMs = positiveInteger(
      options.retryBaseDelayMs ?? ROOM_HOST_DEFAULTS_V1.retryBaseDelayMs,
      'retryBaseDelayMs'
    );
    this.retryMaxDelayMs = positiveInteger(
      options.retryMaxDelayMs ?? ROOM_HOST_DEFAULTS_V1.retryMaxDelayMs,
      'retryMaxDelayMs'
    );

    if (this.heartbeatIntervalMs > this.leaseDurationMs / 3) {
      throw new Error(
        'heartbeatIntervalMs must not exceed one third of leaseDurationMs.'
      );
    }
    if (this.retryBaseDelayMs > this.retryMaxDelayMs) {
      throw new Error('retryBaseDelayMs must not exceed retryMaxDelayMs.');
    }
  }

  get activeSessionCount(): number {
    return this.activeSessions.size;
  }

  get isDraining(): boolean {
    return this.state === 'draining';
  }

  run(): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error('RoomSessionHostV1 can only be run once.');
    }
    this.state = 'running';
    this.runPromise = this.runLoop().finally(() => {
      this.state = 'stopped';
      this.pollWaitController = null;
    });
    return this.runPromise;
  }

  /** Wakes polling. Duplicate/coalesced wakeups are intentionally harmless. */
  wake(): void {
    this.pollWaitController?.abort();
  }

  /** Stops new claims but lets active deliveries finish with heartbeats. */
  async drain(): Promise<void> {
    if (this.state === 'idle') {
      this.state = 'stopped';
      return;
    }
    if (this.state === 'stopped') return;
    this.state = 'draining';
    this.wake();
    await this.runPromise;
  }

  /**
   * Checkpoints and atomically requeues active deliveries. A crashed process
   * cannot call this; those deliveries recover after lease expiry instead.
   */
  async interruptActive(reason = 'room-host-forced-shutdown'): Promise<void> {
    if (this.state === 'running') {
      this.state = 'draining';
      this.wake();
    }
    await Promise.allSettled(
      [...this.activeSessions.values()].map((active) =>
        this.interruptAndRetry(active, reason)
      )
    );
  }

  private async runLoop(): Promise<void> {
    while (this.state === 'running') {
      await this.pollOnce();
      if (this.state !== 'running') break;
      await this.waitForNextPoll();
    }
    await Promise.allSettled(
      [...this.activeSessions.values()].map(({ done }) => done)
    );
  }

  private async pollOnce(): Promise<void> {
    const freeSlots =
      this.maxConcurrentSessions - this.activeSessions.size;
    if (freeSlots <= 0 || this.state !== 'running') return;
    const runtimeIds = this.registry.runtimeIds();
    if (runtimeIds.length === 0) return;

    let candidates;
    try {
      candidates = await this.store.listCandidates({
        runtimeIds,
        limit: Math.min(freeSlots, this.pollBatchSize),
        now: this.clock.now(),
      });
    } catch (error) {
      this.logger.error('Room host candidate poll failed.', {
        error: errorMessage(error),
        workerId: this.workerId,
      });
      return;
    }

    for (const candidate of candidates) {
      if (
        this.state !== 'running' ||
        this.activeSessions.size >= this.maxConcurrentSessions
      ) {
        break;
      }
      if (this.activeSessions.has(candidate.roomSessionId)) continue;
      const runtime = this.registry.lookup(candidate.runtimeId);
      if (!runtime) {
        this.logger.warn('Room host skipped an unregistered runtime.', candidate);
        continue;
      }

      let claim: RoomHostClaimV1 | null;
      try {
        claim = await this.store.claim({
          roomSessionId: candidate.roomSessionId,
          runtimeId: candidate.runtimeId,
          workerId: this.workerId,
          leaseDurationMs: this.leaseDurationMs,
          now: this.clock.now(),
        });
      } catch (error) {
        this.logger.warn('Room host claim failed.', {
          ...candidate,
          error: errorMessage(error),
          workerId: this.workerId,
        });
        continue;
      }
      if (!claim) continue;
      const claimedRuntime = this.registry.lookup(claim.runtimeId);
      if (!claimedRuntime) {
        await this.failWithoutRuntime(claim);
        continue;
      }
      this.launch(claim, claimedRuntime);
    }
  }

  private launch(
    claim: RoomHostClaimV1,
    runtime: RoomSessionRuntimePortV1
  ): void {
    const active: ActiveRoomSessionV1 = {
      claim,
      runtime,
      cursor: claim.cursor,
      checkpoint: claim.checkpoint,
      output: claim.pendingOutput,
      lastRuntimeEventSequence: 0,
      writable: true,
      settling: false,
      heartbeatController: new AbortController(),
      stop: deferred(),
      done: Promise.resolve(),
    };
    this.activeSessions.set(claim.session.roomSessionId, active);
    active.done = this.execute(active)
      .catch((error) => {
        this.logger.error('Room host session crashed.', {
          deliveryId: claim.delivery.deliveryId,
          error: errorMessage(error),
          generation: claim.lease.generation,
          roomSessionId: claim.session.roomSessionId,
        });
      })
      .finally(() => {
        active.heartbeatController.abort();
        this.activeSessions.delete(claim.session.roomSessionId);
        this.wake();
      });
  }

  private async execute(active: ActiveRoomSessionV1): Promise<void> {
    const handshake = await this.heartbeatOnce(active);
    if (handshake === 'fenced' || !active.writable) return;
    const heartbeat = this.runHeartbeat(active);
    try {
      let context: RoomHostBuiltContextV1;
      try {
        context = await this.loadContext(active);
      } catch (error) {
        await this.retryRuntimeFailure(active, 'context-build-failed', error);
        return;
      }
      if (!active.writable) return;
      let handle: RoomSessionRuntimeHandleV1;
      try {
        handle = await this.openOrResume(active, context);
      } catch (error) {
        await this.retryRuntimeFailure(active, 'runtime-open-failed', error);
        return;
      }
      if (!active.writable) return;
      active.handle = handle;
      try {
        const bound = await this.store.bindRuntime({
          lease: active.claim.lease,
          handle,
          now: this.clock.now(),
        });
        if (bound === 'fenced') {
          await this.abandon(active, 'runtime-bind-fenced');
          return;
        }
      } catch (error) {
        this.logger.error('Room host runtime binding persistence failed.', {
          error: errorMessage(error),
          roomSessionId: active.claim.session.roomSessionId,
        });
        await this.abandon(active, 'runtime-bind-persistence-error');
        return;
      }

      try {
        await this.consume(active);
      } catch (error) {
        await this.retryRuntimeFailure(active, 'runtime-handle-failed', error);
      }
    } finally {
      active.heartbeatController.abort();
      await heartbeat;
    }
  }

  private async openOrResume(
    active: ActiveRoomSessionV1,
    context: RoomHostBuiltContextV1
  ): Promise<RoomSessionRuntimeHandleV1> {
    const descriptor = await active.runtime.describe();
    if (descriptor.runtimeId !== active.claim.runtimeId) {
      throw protocolError(
        'runtime-id-mismatch',
        `Claimed runtime ${active.claim.runtimeId} described itself as ${descriptor.runtimeId}.`,
        false
      );
    }

    const operationRequestId = roomHostRequestId(active.claim);
    let handle: RoomSessionRuntimeHandleV1 | null = null;
    if (
      active.claim.checkpoint &&
      descriptor.capabilities.resume !== 'none'
    ) {
      const resumed = await active.runtime.resume({
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        requestId: `${operationRequestId}:resume`,
        session: active.claim.session,
        generation: active.claim.lease.generation,
        checkpoint: active.claim.checkpoint,
        context,
        policy: active.claim.policy,
      });
      if (resumed.status === 'resumed') handle = resumed.handle;
    }
    if (!handle) {
      const opened = await active.runtime.open({
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        requestId: `${operationRequestId}:open`,
        session: active.claim.session,
        generation: active.claim.lease.generation,
        context,
        policy: active.claim.policy,
      });
      handle = opened.handle;
    }
    validateHandle(active.claim, handle);
    return handle;
  }

  private async loadContext(
    active: ActiveRoomSessionV1
  ): Promise<RoomHostBuiltContextV1> {
    const source = await this.contextSource.load({
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      session: active.claim.session,
      delivery: active.claim.delivery,
      cursor: active.claim.cursor,
      lease: active.claim.lease,
    });
    validateContextSource(active.claim, source);
    let built: RoomContextBuildResultV1;
    try {
      built = this.contextBuilder.build(source);
    } catch (error) {
      throw protocolError(
        'invalid-built-context',
        `Room context could not be built safely: ${errorMessage(error)}`,
        false
      );
    }
    validateBuiltContext(active.claim, built);

    const messagesById = new Map(
      [
        source.currentMessage,
        ...(source.replyChain ?? []),
        ...(source.relevantRoomDelta ?? []),
      ].map(({ message }) => [message.messageId, message] as const)
    );
    const selectedMessages = built.blocks.flatMap((block) => {
      if (block.source.sourceType !== 'room-message') return [];
      const message = messagesById.get(block.source.sourceId);
      if (!message || message.sequence !== block.source.sequence) {
        throw protocolError(
          'context-source-missing',
          'Built Room context references a message outside its authoritative source input.',
          false
        );
      }
      return [message];
    });

    const summary = selectedSummary(source, built);
    return {
      ...built,
      throughMessageSequence: built.throughMessageSequence,
      messages: selectedMessages,
      ...(summary ? { summary } : {}),
      ...selectedReferences(built),
    };
  }

  private async consume(active: ActiveRoomSessionV1): Promise<void> {
    const handle = active.handle;
    if (!handle) throw new Error('Room runtime handle was not initialized.');
    const iterable = active.runtime.handle({
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      handle,
      delivery: active.claim.delivery,
      policy: active.claim.policy,
    });
    const iterator = iterable[Symbol.asyncIterator]();
    active.iterator = iterator;

    while (active.writable && !active.settling) {
      const item = await Promise.race([
        iterator.next().then(
          (result) => ({ kind: 'event' as const, result }),
          (error: unknown) => ({ kind: 'error' as const, error })
        ),
        active.stop.promise.then(() => ({ kind: 'stopped' as const })),
      ]);
      if (item.kind === 'stopped') {
        closeIterator(active);
        return;
      }
      if (item.kind === 'error') throw item.error;
      if (item.result.done) {
        await this.settleFailure(active, {
          kind: 'protocol',
          code: 'runtime-stream-ended',
          message: 'Runtime stream ended without a terminal delivery event.',
          retryable: true,
        });
        return;
      }

      const event = item.result.value;
      const issue = validateRuntimeEvent(active, event);
      if (issue) {
        await this.settleFailure(active, issue);
        return;
      }
      active.lastRuntimeEventSequence = event.eventSequence;

      if (event.event.type === 'delivery-completed') {
        const checkpoint = await this.createCheckpoint(active, 'idle');
        await this.finish(active, asTerminalEvent(event), checkpoint);
        return;
      }
      if (event.event.type === 'error') {
        const terminal = asTerminalEvent(event);
        if (
          event.event.retryable &&
          active.claim.delivery.attempt < this.maxDeliveryAttempts
        ) {
          await this.retry(active, {
            kind: 'runtime',
            code: event.event.code,
            message: event.event.message,
            retryable: true,
          }, terminal);
        } else {
          await this.finish(active, terminal, active.checkpoint ?? undefined);
        }
        return;
      }

      if (!(await this.appendEvent(active, event))) return;
      if (event.event.type === 'message-ready') {
        active.output = event.event.message;
      } else if (event.event.type === 'checkpoint-ready') {
        active.checkpoint = event.event.checkpoint;
      }
    }
  }

  private async appendEvent(
    active: ActiveRoomSessionV1,
    event: RoomRuntimeEventEnvelopeV1
  ): Promise<boolean> {
    try {
      const result = await this.store.appendEvent({
        lease: active.claim.lease,
        event,
        now: this.clock.now(),
      });
      if (result === 'fenced') {
        await this.abandon(active, 'event-fenced');
        return false;
      }
      active.cursor = result.cursor;
      return true;
    } catch (error) {
      this.logger.error(
        'Room host event persistence failed; ownership is no longer trusted.',
        {
          deliveryId: active.claim.delivery.deliveryId,
          error: errorMessage(error),
          eventId: event.eventId,
        }
      );
      await this.abandon(active, 'event-persistence-error');
      return false;
    }
  }

  private async finish(
    active: ActiveRoomSessionV1,
    terminal: RoomHostTerminalRuntimeEventV1,
    checkpoint?: RoomSessionCheckpointEnvelopeV1
  ): Promise<void> {
    if (!beginSettlement(active)) return;
    try {
      const result = await this.store.finishDelivery({
        lease: active.claim.lease,
        terminal: { kind: 'runtime-event', event: terminal },
        ...(active.output ? { output: active.output } : {}),
        ...(checkpoint ? { checkpoint } : {}),
        now: this.clock.now(),
      });
      if (result === 'fenced') {
        await this.abandon(active, 'delivery-finish-fenced');
        return;
      }
      active.cursor = result.cursor;
      active.writable = false;
      active.stop.resolve();
    } catch (error) {
      this.logger.error(
        'Room host terminal persistence failed; ownership is no longer trusted.',
        {
          deliveryId: active.claim.delivery.deliveryId,
          error: errorMessage(error),
        }
      );
      await this.abandon(active, 'delivery-finish-persistence-error');
    }
  }

  private async settleFailure(
    active: ActiveRoomSessionV1,
    failure: RoomHostFailureV1
  ): Promise<void> {
    if (
      failure.retryable &&
      active.claim.delivery.attempt < this.maxDeliveryAttempts
    ) {
      await this.retry(active, failure);
      return;
    }
    if (!beginSettlement(active)) return;
    try {
      const result = await this.store.finishDelivery({
        lease: active.claim.lease,
        terminal: { kind: 'host-failure', failure },
        ...(active.checkpoint ? { checkpoint: active.checkpoint } : {}),
        now: this.clock.now(),
      });
      if (result === 'fenced') {
        await this.abandon(active, 'failure-finish-fenced');
        return;
      }
      active.writable = false;
      active.stop.resolve();
    } catch (error) {
      this.logger.error('Room host failure persistence failed.', {
        deliveryId: active.claim.delivery.deliveryId,
        error: errorMessage(error),
      });
      await this.abandon(active, 'failure-persistence-error');
    }
  }

  private async retryRuntimeFailure(
    active: ActiveRoomSessionV1,
    code: string,
    error: unknown
  ): Promise<void> {
    const protocol = asProtocolFailure(error);
    await this.settleFailure(
      active,
      protocol ?? {
        kind: 'runtime',
        code,
        message: errorMessage(error),
        retryable: true,
      }
    );
  }

  private async retry(
    active: ActiveRoomSessionV1,
    failure: RoomHostFailureV1,
    event?: RoomHostTerminalRuntimeEventV1,
    checkpoint = active.checkpoint ?? undefined
  ): Promise<void> {
    if (!beginSettlement(active)) return;
    const now = this.clock.now();
    try {
      const result = await this.store.retryDelivery({
        lease: active.claim.lease,
        failure,
        ...(event ? { event } : {}),
        ...(checkpoint ? { checkpoint } : {}),
        availableAt: new Date(
          now.getTime() + this.retryDelay(active.claim.delivery.attempt)
        ),
        now,
      });
      if (result === 'fenced') {
        await this.abandon(active, 'delivery-retry-fenced');
        return;
      }
      active.writable = false;
      active.stop.resolve();
      closeIterator(active);
    } catch (error) {
      this.logger.error(
        'Room host retry persistence failed; ownership is no longer trusted.',
        {
          deliveryId: active.claim.delivery.deliveryId,
          error: errorMessage(error),
        }
      );
      await this.abandon(active, 'delivery-retry-persistence-error');
    }
  }

  private async interruptAndRetry(
    active: ActiveRoomSessionV1,
    reason: string
  ): Promise<void> {
    if (!active.writable || active.settling) return;
    active.stop.resolve();
    closeIterator(active);
    const checkpoint = await this.createCheckpoint(active, 'shutdown');
    await this.retry(
      active,
      {
        kind: 'interrupted',
        code: 'host-interrupted',
        message: reason,
        retryable: true,
      },
      undefined,
      checkpoint
    );
  }

  private async createCheckpoint(
    active: ActiveRoomSessionV1,
    reason: 'idle' | 'shutdown'
  ): Promise<RoomSessionCheckpointEnvelopeV1 | undefined> {
    if (!active.handle || !active.writable || active.settling) {
      return active.checkpoint ?? undefined;
    }
    try {
      const result = await active.runtime.checkpoint({
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        requestId: `${roomHostRequestId(active.claim)}:checkpoint:${reason}`,
        handle: active.handle,
        cursor: {
          messageSequence: Math.max(
            active.cursor.messageSequence,
            active.claim.delivery.message.sequence
          ),
          deliverySequence: active.claim.delivery.deliverySequence,
          eventSequence: active.cursor.eventSequence,
        },
        reason,
      });
      if (result.status === 'unsupported') {
        return active.checkpoint ?? undefined;
      }
      const issue = validateCheckpoint(active, result.checkpoint);
      if (issue) {
        this.logger.warn('Room runtime returned an invalid checkpoint.', {
          code: issue.code,
          deliveryId: active.claim.delivery.deliveryId,
        });
        return active.checkpoint ?? undefined;
      }
      return result.checkpoint;
    } catch (error) {
      this.logger.warn('Room runtime checkpoint failed.', {
        deliveryId: active.claim.delivery.deliveryId,
        error: errorMessage(error),
        reason,
      });
      return active.checkpoint ?? undefined;
    }
  }

  private async runHeartbeat(active: ActiveRoomSessionV1): Promise<void> {
    while (
      active.writable &&
      !active.heartbeatController.signal.aborted
    ) {
      try {
        await this.wait(
          this.heartbeatIntervalMs,
          active.heartbeatController.signal
        );
      } catch (error) {
        if (!active.heartbeatController.signal.aborted) {
          this.logger.warn('Room host heartbeat wait failed.', {
            error: errorMessage(error),
            roomSessionId: active.claim.session.roomSessionId,
          });
        }
      }
      if (active.heartbeatController.signal.aborted) return;
      await this.heartbeatOnce(active);
    }
  }

  private async heartbeatOnce(
    active: ActiveRoomSessionV1
  ): Promise<'renewed' | 'fenced'> {
    if (!active.writable) return 'fenced';
    try {
      const result = await this.store.heartbeat({
        lease: active.claim.lease,
        leaseDurationMs: this.leaseDurationMs,
        now: this.clock.now(),
      });
      if (result === 'fenced') {
        await this.abandon(active, 'heartbeat-fenced');
      }
      return result;
    } catch (error) {
      this.logger.error(
        'Room host heartbeat failed; ownership is no longer trusted.',
        {
          error: errorMessage(error),
          roomSessionId: active.claim.session.roomSessionId,
        }
      );
      await this.abandon(active, 'heartbeat-persistence-error');
      return 'fenced';
    }
  }

  private async abandon(
    active: ActiveRoomSessionV1,
    reason: string
  ): Promise<void> {
    if (!active.writable) return;
    active.writable = false;
    active.stop.resolve();
    active.heartbeatController.abort();
    closeIterator(active);
    this.logger.debug('Room host abandoned a fenced delivery.', {
      deliveryId: active.claim.delivery.deliveryId,
      generation: active.claim.lease.generation,
      reason,
    });
  }

  private async failWithoutRuntime(claim: RoomHostClaimV1): Promise<void> {
    try {
      await this.store.finishDelivery({
        lease: claim.lease,
        terminal: {
          kind: 'host-failure',
          failure: {
            kind: 'protocol',
            code: 'runtime-not-registered',
            message: `Room runtime ${claim.runtimeId} is not registered.`,
            retryable: false,
          },
        },
        now: this.clock.now(),
      });
    } catch (error) {
      this.logger.error('Room host could not fail an unserviceable claim.', {
        error: errorMessage(error),
        roomSessionId: claim.session.roomSessionId,
      });
    }
  }

  private retryDelay(attempt: number): number {
    const exponent = Math.min(Math.max(attempt - 1, 0), 30);
    return Math.min(
      this.retryMaxDelayMs,
      this.retryBaseDelayMs * 2 ** exponent
    );
  }

  private async waitForNextPoll(): Promise<void> {
    const controller = new AbortController();
    this.pollWaitController = controller;
    try {
      await this.wait(this.pollIntervalMs, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        this.logger.warn('Room host poll wait failed.', {
          error: errorMessage(error),
        });
      }
    } finally {
      if (this.pollWaitController === controller) {
        this.pollWaitController = null;
      }
    }
  }
}

function beginSettlement(active: ActiveRoomSessionV1): boolean {
  if (!active.writable || active.settling) return false;
  active.settling = true;
  return true;
}

function validateContextSource(
  claim: RoomHostClaimV1,
  source: BuildRoomContextInputV1
): void {
  const { session, delivery } = claim;
  const current = source.currentMessage.message;
  if (
    source.session.organizationId !== session.organizationId ||
    source.session.roomId !== session.roomId ||
    source.session.roomSessionId !== session.roomSessionId ||
    source.session.agent.agentId !== session.agent.agentId ||
    current.organizationId !== session.organizationId ||
    current.roomId !== session.roomId ||
    current.messageId !== delivery.message.messageId ||
    current.sequence !== delivery.message.sequence ||
    JSON.stringify(current) !== JSON.stringify(delivery.message)
  ) {
    throw protocolError(
      'context-source-mismatch',
      'Room context source does not match the claimed session and delivery.',
      false
    );
  }
}

function validateBuiltContext(
  claim: RoomHostClaimV1,
  built: RoomContextBuildResultV1
): void {
  const currentBlocks = built.blocks.filter(
    (block) =>
      block.category === 'current-message' &&
      block.source.sourceType === 'room-message' &&
      block.source.sourceId === claim.delivery.message.messageId &&
      block.source.sequence === claim.delivery.message.sequence
  );
  if (
    built.organizationId !== claim.session.organizationId ||
    built.roomId !== claim.session.roomId ||
    built.roomSessionId !== claim.session.roomSessionId ||
    built.agentId !== claim.session.agent.agentId ||
    built.throughMessageSequence !== claim.delivery.message.sequence ||
    currentBlocks.length !== 1
  ) {
    throw protocolError(
      'built-context-mismatch',
      'Built Room context is not bound to the claimed current message.',
      false
    );
  }
}

function selectedSummary(
  source: BuildRoomContextInputV1,
  built: RoomContextBuildResultV1
): string | undefined {
  if (!source.summary) return undefined;
  const selected = built.blocks.some(
    (block) =>
      block.category === 'summary' &&
      block.source.sourceType === 'room-summary' &&
      block.source.sourceId === source.summary?.summary.summaryId &&
      !block.truncation.truncated
  );
  return selected ? source.summary.summary.content : undefined;
}

function selectedReferences(
  built: RoomContextBuildResultV1
): Pick<RoomContextSnapshotV1, 'references'> {
  const references: RoomContextReferenceV1[] = [];
  for (const block of built.blocks) {
    const source = block.source;
    if (source.sourceType === 'document-slice') {
      references.push({
        type: 'document',
        id: source.documentId,
        revision: source.revision,
        ...(source.title ? { title: source.title } : {}),
      });
    }
    if (source.sourceType === 'retrieval-hit') {
      references.push({
        type: source.referencedSource.type,
        id: source.referencedSource.id,
        ...(source.referencedSource.revision
          ? { revision: source.referencedSource.revision }
          : {}),
        ...(source.referencedSource.title
          ? { title: source.referencedSource.title }
          : {}),
      });
    }
  }
  return references.length > 0 ? { references } : {};
}

function validateHandle(
  claim: RoomHostClaimV1,
  handle: RoomSessionRuntimeHandleV1
): void {
  if (
    handle.schemaVersion !== ROOM_RUNTIME_CONTRACT_VERSION_V1 ||
    handle.session.organizationId !== claim.session.organizationId ||
    handle.session.roomId !== claim.session.roomId ||
    handle.session.roomSessionId !== claim.session.roomSessionId ||
    handle.session.agent.agentId !== claim.session.agent.agentId ||
    handle.session.agent.handle !== claim.session.agent.handle ||
    handle.session.agentConfigVersion !==
      claim.session.agentConfigVersion ||
    handle.runtimeId !== claim.runtimeId ||
    handle.generation !== claim.lease.generation ||
    !handle.runtimeSessionId.trim()
  ) {
    throw protocolError(
      'invalid-runtime-handle',
      'Room runtime returned a handle outside the claimed session generation.',
      false
    );
  }
}

function validateRuntimeEvent(
  active: ActiveRoomSessionV1,
  event: RoomRuntimeEventEnvelopeV1
): RoomHostFailureV1 | null {
  const handle = active.handle;
  const expectedDeliveryId = active.claim.delivery.deliveryId;
  if (
    !handle ||
    event.schemaVersion !== ROOM_RUNTIME_CONTRACT_VERSION_V1 ||
    event.envelopeType !== 'room.runtime-event' ||
    event.roomSessionId !== active.claim.session.roomSessionId ||
    event.runtimeSessionId !== handle.runtimeSessionId ||
    event.deliveryId !== expectedDeliveryId ||
    !event.eventId.trim() ||
    !Number.isSafeInteger(event.eventSequence) ||
    event.eventSequence <= active.lastRuntimeEventSequence
  ) {
    return {
      kind: 'protocol',
      code: 'invalid-runtime-event',
      message: 'Runtime event identity or sequence did not match the active delivery.',
      retryable: false,
    };
  }
  if (event.event.type === 'checkpoint-ready') {
    return validateCheckpoint(active, event.event.checkpoint);
  }
  return null;
}

function validateCheckpoint(
  active: ActiveRoomSessionV1,
  checkpoint: RoomSessionCheckpointEnvelopeV1
): RoomHostFailureV1 | null {
  const handle = active.handle;
  if (
    !handle ||
    checkpoint.schemaVersion !== ROOM_RUNTIME_CONTRACT_VERSION_V1 ||
    checkpoint.envelopeType !== 'room.checkpoint' ||
    checkpoint.session.organizationId !== active.claim.session.organizationId ||
    checkpoint.session.roomId !== active.claim.session.roomId ||
    checkpoint.session.roomSessionId !== active.claim.session.roomSessionId ||
    checkpoint.session.agent.agentId !== active.claim.session.agent.agentId ||
    checkpoint.session.agent.handle !== active.claim.session.agent.handle ||
    checkpoint.session.agentConfigVersion !==
      active.claim.session.agentConfigVersion ||
    checkpoint.runtimeId !== active.claim.runtimeId ||
    checkpoint.runtimeSessionId !== handle.runtimeSessionId ||
    checkpoint.generation !== active.claim.lease.generation
  ) {
    return {
      kind: 'protocol',
      code: 'invalid-runtime-checkpoint',
      message: 'Runtime checkpoint did not match the active session generation.',
      retryable: false,
    };
  }
  return null;
}

function asTerminalEvent(
  event: RoomRuntimeEventEnvelopeV1
): RoomHostTerminalRuntimeEventV1 {
  const terminalPayload = event.event;
  if (
    terminalPayload.type !== 'delivery-completed' &&
    terminalPayload.type !== 'error'
  ) {
    throw new Error('Expected a terminal Room runtime event.');
  }
  return { ...event, event: terminalPayload };
}

function closeIterator(active: ActiveRoomSessionV1): void {
  const iterator = active.iterator;
  active.iterator = undefined;
  if (iterator?.return) {
    void iterator.return().catch(() => undefined);
  }
}

function roomHostRequestId(claim: RoomHostClaimV1): string {
  return `room:${claim.session.roomSessionId}:${claim.lease.generation}:${claim.delivery.deliveryId}`;
}

type ProtocolErrorV1 = Error & {
  roomHostFailure: RoomHostFailureV1;
};

function protocolError(
  code: string,
  message: string,
  retryable: boolean
): ProtocolErrorV1 {
  const error = new Error(message) as ProtocolErrorV1;
  error.roomHostFailure = {
    kind: 'protocol',
    code,
    message,
    retryable,
  };
  return error;
}

function asProtocolFailure(error: unknown): RoomHostFailureV1 | null {
  if (
    error instanceof Error &&
    'roomHostFailure' in error &&
    typeof error.roomHostFailure === 'object' &&
    error.roomHostFailure !== null
  ) {
    return error.roomHostFailure as RoomHostFailureV1;
  }
  return null;
}

function deferred(): DeferredV1 {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer.`);
  }
  return value;
}

function requireText(value: string, field: string): string {
  if (!value.trim()) throw new Error(`${field} must be non-empty.`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
