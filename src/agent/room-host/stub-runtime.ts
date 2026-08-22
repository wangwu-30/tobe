import {
  ROOM_RUNTIME_CONTRACT_VERSION_V1,
  type CheckpointRoomSessionInputV1,
  type CheckpointRoomSessionResultV1,
  type HandleRoomDeliveryInputV1,
  type OpenRoomSessionInputV1,
  type OpenRoomSessionResultV1,
  type ResumeRoomSessionInputV1,
  type ResumeRoomSessionResultV1,
  type RoomJsonValueV1,
  type RoomRuntimeEventEnvelopeV1,
  type RoomRuntimeEventPayloadV1,
  type RoomRuntimeOutputDraftV1,
  type RoomSessionRefV1,
  type RoomSessionRuntimeDescriptorV1,
  type RoomSessionRuntimeHandleV1,
  type RoomSessionRuntimePortV1,
} from '@/agent/room-runtime/contracts';

export type StubRoomSessionRuntimeIdKindV1 =
  | 'runtime-session'
  | 'event'
  | 'response'
  | 'checkpoint';

export type StubRoomSessionRuntimeIdFactoryV1 = (
  kind: StubRoomSessionRuntimeIdKindV1,
  sequence: number
) => string;

export interface StubRoomSessionRuntimeClockV1 {
  now(): Date;
}

export type StubRoomSessionRuntimeFailureV1 = Omit<
  Extract<RoomRuntimeEventPayloadV1, { type: 'error' }>,
  'type'
>;

export type StubRoomSessionRuntimeCallsV1 = {
  readonly opens: readonly OpenRoomSessionInputV1[];
  readonly resumes: readonly ResumeRoomSessionInputV1[];
  readonly handles: readonly HandleRoomDeliveryInputV1[];
  readonly checkpoints: readonly CheckpointRoomSessionInputV1[];
};

export type StubRoomSessionRuntimeOptionsV1 = {
  runtimeId?: string;
  displayName?: string;
  runtimeVersion?: string;
  clock?: StubRoomSessionRuntimeClockV1;
  idFactory?: StubRoomSessionRuntimeIdFactoryV1;
  response?:
    | RoomRuntimeOutputDraftV1
    | ((
        input: HandleRoomDeliveryInputV1
      ) => RoomRuntimeOutputDraftV1 | Promise<RoomRuntimeOutputDraftV1>);
  responseText?:
    | string
    | ((input: HandleRoomDeliveryInputV1) => string | Promise<string>);
  /** Awaiting this hook provides a deterministic in-flight delivery gate. */
  beforeHandle?: (input: HandleRoomDeliveryInputV1) => void | Promise<void>;
  /** Returning a failure emits one terminal typed error instead of a response. */
  handleFailure?:
    | StubRoomSessionRuntimeFailureV1
    | null
    | ((
        input: HandleRoomDeliveryInputV1
      ) =>
        | StubRoomSessionRuntimeFailureV1
        | null
        | Promise<StubRoomSessionRuntimeFailureV1 | null>);
};

type StubRuntimeSessionStateV1 = {
  handle: RoomSessionRuntimeHandleV1;
  nextEventSequence: number;
  sessionReadyPending: boolean;
  handledDeliveryIds: string[];
};

const DEFAULT_RUNTIME_ID = 'stub-room-runtime-v1';
const DEFAULT_RUNTIME_VERSION = '1.0.0';
const DEFAULT_NOW = new Date('2000-01-01T00:00:00.000Z');

/**
 * Deterministic, in-memory Room runtime used to exercise Session Host behavior.
 * It deliberately models a runtime session, not durable Room state.
 */
export class StubRoomSessionRuntimeV1 implements RoomSessionRuntimePortV1 {
  private readonly descriptor: RoomSessionRuntimeDescriptorV1;
  private readonly clock: StubRoomSessionRuntimeClockV1;
  private readonly idFactory: StubRoomSessionRuntimeIdFactoryV1;
  private readonly response: StubRoomSessionRuntimeOptionsV1['response'];
  private readonly responseText: StubRoomSessionRuntimeOptionsV1['responseText'];
  private readonly beforeHandle: StubRoomSessionRuntimeOptionsV1['beforeHandle'];
  private readonly handleFailure: StubRoomSessionRuntimeOptionsV1['handleFailure'];
  private readonly idSequences = new Map<StubRoomSessionRuntimeIdKindV1, number>();
  private readonly sessions = new Map<string, StubRuntimeSessionStateV1>();
  private readonly activeRuntimeSessionByRoomSession = new Map<string, string>();
  private readonly openCalls: OpenRoomSessionInputV1[] = [];
  private readonly resumeCalls: ResumeRoomSessionInputV1[] = [];
  private readonly handleCalls: HandleRoomDeliveryInputV1[] = [];
  private readonly checkpointCalls: CheckpointRoomSessionInputV1[] = [];

  readonly calls: StubRoomSessionRuntimeCallsV1 = {
    opens: this.openCalls,
    resumes: this.resumeCalls,
    handles: this.handleCalls,
    checkpoints: this.checkpointCalls,
  };

  get opens(): readonly OpenRoomSessionInputV1[] {
    return this.openCalls;
  }

  get resumes(): readonly ResumeRoomSessionInputV1[] {
    return this.resumeCalls;
  }

  get handles(): readonly HandleRoomDeliveryInputV1[] {
    return this.handleCalls;
  }

  get checkpoints(): readonly CheckpointRoomSessionInputV1[] {
    return this.checkpointCalls;
  }

  constructor(options: StubRoomSessionRuntimeOptionsV1 = {}) {
    const runtimeId = requireText(options.runtimeId ?? DEFAULT_RUNTIME_ID, 'runtimeId');
    const runtimeVersion = requireText(
      options.runtimeVersion ?? DEFAULT_RUNTIME_VERSION,
      'runtimeVersion'
    );

    this.descriptor = {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      runtimeId,
      displayName: requireText(
        options.displayName ?? 'Deterministic stub Room runtime',
        'displayName'
      ),
      runtimeVersion,
      capabilities: {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        streaming: 'typed-events',
        resume: 'checkpoint',
        checkpoint: 'opaque-json',
        typedMentionOutput: false,
        delegationRequests: false,
      },
    };
    this.clock = options.clock ?? { now: () => new Date(DEFAULT_NOW) };
    this.idFactory =
      options.idFactory ??
      ((kind, sequence) => `stub-${kind}-${sequence}`);
    this.response = options.response;
    this.responseText = options.responseText;
    this.beforeHandle = options.beforeHandle;
    this.handleFailure = options.handleFailure;
  }

  async describe(): Promise<RoomSessionRuntimeDescriptorV1> {
    return {
      ...this.descriptor,
      capabilities: { ...this.descriptor.capabilities },
    };
  }

  async open(input: OpenRoomSessionInputV1): Promise<OpenRoomSessionResultV1> {
    this.openCalls.push(input);
    requireGeneration(input.generation);

    const handle = this.createHandle(input.session, input.generation);
    this.activate(handle, []);
    return {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      handle,
    };
  }

  async resume(
    input: ResumeRoomSessionInputV1
  ): Promise<ResumeRoomSessionResultV1> {
    this.resumeCalls.push(input);
    requireGeneration(input.generation);
    this.validateCheckpointForResume(input);
    const handledDeliveryIds = readHandledDeliveryIds(
      input.checkpoint.runtimeState
    );

    const handle = this.createHandle(input.session, input.generation);
    this.activate(handle, handledDeliveryIds);
    return {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      status: 'resumed',
      handle,
    };
  }

  async *handle(
    input: HandleRoomDeliveryInputV1
  ): AsyncIterable<RoomRuntimeEventEnvelopeV1> {
    this.handleCalls.push(input);
    const state = this.requireActiveState(input.handle);
    this.validateDelivery(input);
    await this.beforeHandle?.(input);
    if (state.handledDeliveryIds.includes(input.delivery.deliveryId)) {
      throw new Error(
        `Delivery ${input.delivery.deliveryId} has already been handled by this runtime session.`
      );
    }

    if (state.sessionReadyPending) {
      state.sessionReadyPending = false;
      yield this.event(state, input.delivery.deliveryId, {
        type: 'session-ready',
      });
    }

    const failure = await this.resolveHandleFailure(input);
    if (failure) {
      state.handledDeliveryIds.push(input.delivery.deliveryId);
      yield this.event(state, input.delivery.deliveryId, {
        type: 'error',
        ...failure,
      });
      return;
    }

    if (input.delivery.intent === 'observe') {
      state.handledDeliveryIds.push(input.delivery.deliveryId);
      yield this.event(state, input.delivery.deliveryId, {
        type: 'delivery-completed',
        disposition: 'observed',
      });
      return;
    }

    const responseId = this.nextId('response');
    const output = await this.resolveResponse(input);
    yield this.event(state, input.delivery.deliveryId, {
      type: 'response-started',
      responseId,
    });
    yield this.event(state, input.delivery.deliveryId, {
      type: 'text-delta',
      responseId,
      text: output.text,
    });
    yield this.event(state, input.delivery.deliveryId, {
      type: 'message-ready',
      responseId,
      message: output,
    });
    state.handledDeliveryIds.push(input.delivery.deliveryId);
    yield this.event(state, input.delivery.deliveryId, {
      type: 'delivery-completed',
      disposition: 'responded',
    });
  }

  async checkpoint(
    input: CheckpointRoomSessionInputV1
  ): Promise<CheckpointRoomSessionResultV1> {
    this.checkpointCalls.push(input);
    const state = this.requireActiveState(input.handle);
    const runtimeState: RoomJsonValueV1 = {
      kind: 'stub-room-session',
      handledDeliveryIds: [...state.handledDeliveryIds],
      lastEventSequence: state.nextEventSequence - 1,
    };

    return {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      status: 'created',
      checkpoint: {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        envelopeType: 'room.checkpoint',
        checkpointId: this.nextId('checkpoint'),
        createdAt: this.nowIso(),
        session: cloneSession(input.handle.session),
        runtimeId: this.descriptor.runtimeId,
        runtimeVersion: this.descriptor.runtimeVersion,
        runtimeSessionId: input.handle.runtimeSessionId,
        generation: input.handle.generation,
        cursor: { ...input.cursor },
        runtimeState,
      },
    };
  }

  private createHandle(
    session: RoomSessionRefV1,
    generation: number
  ): RoomSessionRuntimeHandleV1 {
    return {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      session: cloneSession(session),
      runtimeId: this.descriptor.runtimeId,
      runtimeSessionId: this.nextId('runtime-session'),
      generation,
      openedAt: this.nowIso(),
    };
  }

  private activate(
    handle: RoomSessionRuntimeHandleV1,
    handledDeliveryIds: readonly string[]
  ): void {
    const activeRuntimeSessionId =
      this.activeRuntimeSessionByRoomSession.get(handle.session.roomSessionId);
    const active = activeRuntimeSessionId
      ? this.sessions.get(activeRuntimeSessionId)
      : undefined;
    if (active && handle.generation < active.handle.generation) {
      throw new Error(
        `Cannot activate stale generation ${handle.generation} for Room session ${handle.session.roomSessionId}.`
      );
    }

    this.sessions.set(handle.runtimeSessionId, {
      handle,
      nextEventSequence: 1,
      sessionReadyPending: true,
      handledDeliveryIds: [...handledDeliveryIds],
    });
    this.activeRuntimeSessionByRoomSession.set(
      handle.session.roomSessionId,
      handle.runtimeSessionId
    );
  }

  private requireActiveState(
    handle: RoomSessionRuntimeHandleV1
  ): StubRuntimeSessionStateV1 {
    if (handle.runtimeId !== this.descriptor.runtimeId) {
      throw new Error(`Unknown Room runtime ${handle.runtimeId}.`);
    }

    const state = this.sessions.get(handle.runtimeSessionId);
    if (!state || !sameHandle(state.handle, handle)) {
      throw new Error(`Unknown Room runtime session ${handle.runtimeSessionId}.`);
    }

    if (
      this.activeRuntimeSessionByRoomSession.get(handle.session.roomSessionId) !==
      handle.runtimeSessionId
    ) {
      throw new Error(
        `Room runtime session ${handle.runtimeSessionId} is no longer active for generation ${handle.generation}.`
      );
    }
    return state;
  }

  private validateDelivery(input: HandleRoomDeliveryInputV1): void {
    const { delivery, handle } = input;
    if (delivery.roomSessionId !== handle.session.roomSessionId) {
      throw new Error('Delivery and runtime handle use different Room sessions.');
    }
    if (delivery.message.roomId !== handle.session.roomId) {
      throw new Error('Delivery message and runtime handle use different Rooms.');
    }
    if (delivery.message.organizationId !== handle.session.organizationId) {
      throw new Error(
        'Delivery message and runtime handle use different organizations.'
      );
    }
    if (delivery.target.agentId !== handle.session.agent.agentId) {
      throw new Error('Delivery target does not match the runtime session agent.');
    }
  }

  private validateCheckpointForResume(input: ResumeRoomSessionInputV1): void {
    const { checkpoint } = input;
    if (
      checkpoint.runtimeId !== this.descriptor.runtimeId ||
      checkpoint.runtimeVersion !== this.descriptor.runtimeVersion
    ) {
      throw new Error('Checkpoint belongs to a different Room runtime.');
    }
    if (!sameSession(checkpoint.session, input.session)) {
      throw new Error('Checkpoint belongs to a different Room session.');
    }
    if (input.generation < checkpoint.generation) {
      throw new Error(
        `Cannot resume checkpoint generation ${checkpoint.generation} as stale generation ${input.generation}.`
      );
    }
  }

  private async resolveHandleFailure(
    input: HandleRoomDeliveryInputV1
  ): Promise<StubRoomSessionRuntimeFailureV1 | null> {
    if (typeof this.handleFailure === 'function') {
      return (await this.handleFailure(input)) ?? null;
    }
    return this.handleFailure ?? null;
  }

  private async resolveResponse(
    input: HandleRoomDeliveryInputV1
  ): Promise<RoomRuntimeOutputDraftV1> {
    if (typeof this.response === 'function') {
      return this.response(input);
    }
    if (this.response) {
      return this.response;
    }

    const text =
      typeof this.responseText === 'function'
        ? await this.responseText(input)
        : (this.responseText ??
          `Stub response for delivery ${input.delivery.deliveryId}.`);
    return { text, mentions: [] };
  }

  private event(
    state: StubRuntimeSessionStateV1,
    deliveryId: string,
    event: RoomRuntimeEventPayloadV1
  ): RoomRuntimeEventEnvelopeV1 {
    return {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      envelopeType: 'room.runtime-event',
      eventId: this.nextId('event'),
      eventSequence: state.nextEventSequence++,
      occurredAt: this.nowIso(),
      roomSessionId: state.handle.session.roomSessionId,
      runtimeSessionId: state.handle.runtimeSessionId,
      deliveryId,
      event,
    };
  }

  private nextId(kind: StubRoomSessionRuntimeIdKindV1): string {
    const sequence = (this.idSequences.get(kind) ?? 0) + 1;
    this.idSequences.set(kind, sequence);
    return requireText(this.idFactory(kind, sequence), `${kind} id`);
  }

  private nowIso(): string {
    const now = this.clock.now();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new Error('Stub Room runtime clock returned an invalid Date.');
    }
    return now.toISOString();
  }
}

export function createStubRoomSessionRuntimeV1(
  options: StubRoomSessionRuntimeOptionsV1 = {}
): StubRoomSessionRuntimeV1 {
  return new StubRoomSessionRuntimeV1(options);
}

function cloneSession(session: RoomSessionRefV1): RoomSessionRefV1 {
  return {
    ...session,
    agent: { ...session.agent },
  };
}

function sameSession(left: RoomSessionRefV1, right: RoomSessionRefV1): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.roomId === right.roomId &&
    left.roomSessionId === right.roomSessionId &&
    left.agent.agentId === right.agent.agentId &&
    left.agent.handle === right.agent.handle &&
    left.agent.displayName === right.agent.displayName
  );
}

function sameHandle(
  left: RoomSessionRuntimeHandleV1,
  right: RoomSessionRuntimeHandleV1
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.runtimeId === right.runtimeId &&
    left.runtimeSessionId === right.runtimeSessionId &&
    left.generation === right.generation &&
    left.openedAt === right.openedAt &&
    sameSession(left.session, right.session)
  );
}

function requireGeneration(generation: number): void {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error('Room runtime generation must be a non-negative safe integer.');
  }
}

function readHandledDeliveryIds(runtimeState: RoomJsonValueV1): string[] {
  if (!isJsonRecord(runtimeState)) {
    throw new Error('Checkpoint contains invalid stub Room runtime state.');
  }
  const handledDeliveryIds = runtimeState.handledDeliveryIds;
  if (
    runtimeState.kind !== 'stub-room-session' ||
    !Array.isArray(handledDeliveryIds) ||
    handledDeliveryIds.some((value) => typeof value !== 'string')
  ) {
    throw new Error('Checkpoint contains invalid stub Room runtime state.');
  }
  return [...handledDeliveryIds] as string[];
}

function isJsonRecord(
  value: RoomJsonValueV1
): value is { readonly [key: string]: RoomJsonValueV1 } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireText(value: string, field: string): string {
  if (!value.trim()) {
    throw new Error(`${field} must be non-empty.`);
  }
  return value;
}
