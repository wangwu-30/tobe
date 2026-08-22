import { randomUUID } from 'node:crypto';

import type {
  AgentEvent,
  AgentMessage,
  AgentOptions,
  AgentState,
  AgentTool,
  StreamFn,
  ThinkingLevel,
} from '@mariozechner/pi-agent-core';
import type { Api, Model as PiModel } from '@mariozechner/pi-ai';
import type {
  AgentToolPendingConfirmationDescriptorV1,
  AgentToolPendingConfirmationSourceV1,
} from '@/agent/tool-policy';
import type {
  RoomContextBlockV1,
  RoomContextBuildResultV1,
} from '@/agent/context/contracts';

import {
  ROOM_RUNTIME_CONTRACT_VERSION_V1,
  type CheckpointRoomSessionInputV1,
  type CheckpointRoomSessionResultV1,
  type HandleRoomDeliveryInputV1,
  type OpenRoomSessionInputV1,
  type OpenRoomSessionResultV1,
  type ResumeRoomSessionInputV1,
  type ResumeRoomSessionResultV1,
  type RoomContextSnapshotV1,
  type RoomMessageEnvelopeV1,
  type RoomPolicyV1,
  type RoomRuntimeEventEnvelopeV1,
  type RoomRuntimeEventPayloadV1,
  type RoomSessionRefV1,
  type RoomSessionRuntimeDescriptorV1,
  type RoomSessionRuntimeHandleV1,
  type RoomSessionRuntimePortV1,
} from '../contracts';

export const PI_ROOM_RUNTIME_ID_V1 = 'pi-agent-core';
export const PI_ROOM_RUNTIME_VERSION_V1 = '0.57.1';

const PI_ROOM_CHECKPOINT_KIND_V1 = 'pi-agent-core.fresh-replay';
const PI_ROOM_CHECKPOINT_STATE_VERSION_V1 = 1;

type AnyPiModel = PiModel<Api>;

export type PiRoomAgentConfigV1 = {
  getApiKey?: AgentOptions['getApiKey'];
  model: AnyPiModel;
  streamFn?: StreamFn;
  systemPrompt: string;
  thinkingLevel?: ThinkingLevel;
  tools?: readonly AgentTool[];
};

export type PiRoomAgentConfigResolverInputV1 = {
  context: RoomContextSnapshotV1;
  generation: number;
  mode: 'open' | 'resume';
  policy: RoomPolicyV1;
  session: RoomSessionRefV1;
};

export type PiRoomAgentConfigResolverV1 = (
  input: PiRoomAgentConfigResolverInputV1
) => PiRoomAgentConfigV1 | Promise<PiRoomAgentConfigV1>;

export type PiRoomAgentV1 = {
  readonly state: Pick<
    AgentState,
    'error' | 'isStreaming' | 'messages' | 'streamMessage'
  >;
  abort(): void;
  appendMessage(message: AgentMessage): void;
  continue(): Promise<void>;
  prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
  waitForIdle(): Promise<void>;
};

export type PiRoomRuntimeIdKindV1 =
  | 'checkpoint'
  | 'event'
  | 'response'
  | 'runtime-session';

export type PiRoomSessionRuntimeConfigV1 = {
  /** True only when the composition installs a durable, governed delegation tool. */
  delegationRequests?: boolean;
  displayName?: string;
  resolveAgentConfig: PiRoomAgentConfigResolverV1;
  runtimeId?: string;
  runtimeVersion?: string;
};

export type PiRoomSessionRuntimeDependenciesV1 = {
  createAgent(
    options: AgentOptions
  ): PiRoomAgentV1 | Promise<PiRoomAgentV1>;
  createId(kind: PiRoomRuntimeIdKindV1): string;
  now(): Date;
};

type PiRoomSessionStateV1 = {
  activeDeliveryId?: string;
  agent: PiRoomAgentV1;
  completedDeliveryIds: Set<string>;
  contextMessageIds: Set<string>;
  contextThroughMessageSequence: number;
  eventSequence: number;
  handle: RoomSessionRuntimeHandleV1;
  model: AnyPiModel;
  tools: readonly AgentTool[];
};

type ActivePiToolCallV1 = {
  args: unknown;
  confirmationSource?: AgentToolPendingConfirmationSourceV1;
  toolName: string;
};

type RichRoomContextSnapshotV1 = RoomContextSnapshotV1 &
  Partial<RoomContextBuildResultV1>;

type PiRoomCheckpointStateV1 = {
  checkpointStateVersion: number;
  contextThroughMessageSequence: number;
  kind: string;
  replay: string;
};

const DEFAULT_DEPENDENCIES: PiRoomSessionRuntimeDependenciesV1 = {
  createAgent: async (options) => {
    const { Agent: PiAgent } = await import('@mariozechner/pi-agent-core');
    return new PiAgent(options);
  },
  createId: (kind) => `${kind}-${randomUUID()}`,
  now: () => new Date(),
};

/**
 * Creates a resolver for a fixed, already-authorized Pi configuration. The
 * configuration stays behind the adapter boundary and is never copied into a
 * Room handle, event, or checkpoint.
 */
export function createStaticPiRoomAgentConfigResolverV1(
  config: PiRoomAgentConfigV1
): PiRoomAgentConfigResolverV1 {
  return () => config;
}

/**
 * Stateful Pi adapter for low-latency Room sessions. Room persistence and
 * fencing remain control-plane responsibilities; this class performs no I/O
 * other than the injected model stream.
 */
export class PiRoomSessionRuntimeAdapterV1
  implements RoomSessionRuntimePortV1
{
  private readonly dependencies: PiRoomSessionRuntimeDependenciesV1;
  private readonly descriptor: RoomSessionRuntimeDescriptorV1;
  private readonly resolveAgentConfig: PiRoomAgentConfigResolverV1;
  private readonly sessions = new Map<string, PiRoomSessionStateV1>();
  private readonly currentRuntimeSessionByRoomSession = new Map<string, string>();

  constructor(
    config: PiRoomSessionRuntimeConfigV1,
    dependencies: Partial<PiRoomSessionRuntimeDependenciesV1> = {}
  ) {
    this.dependencies = {
      ...DEFAULT_DEPENDENCIES,
      ...dependencies,
    };
    this.resolveAgentConfig = config.resolveAgentConfig;
    this.descriptor = {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      runtimeId: config.runtimeId ?? PI_ROOM_RUNTIME_ID_V1,
      displayName: config.displayName ?? 'Pi Agent Core',
      runtimeVersion: config.runtimeVersion ?? PI_ROOM_RUNTIME_VERSION_V1,
      capabilities: {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        streaming: 'typed-events',
        resume: 'checkpoint',
        checkpoint: 'opaque-json',
        typedMentionOutput: false,
        delegationRequests: config.delegationRequests === true,
      },
    };
  }

  async describe(): Promise<RoomSessionRuntimeDescriptorV1> {
    return this.descriptor;
  }

  async open(
    input: OpenRoomSessionInputV1
  ): Promise<OpenRoomSessionResultV1> {
    const state = await this.createSession({
      context: input.context,
      eventSequence: 0,
      generation: input.generation,
      mode: 'open',
      policy: input.policy,
      session: input.session,
    });

    return {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      handle: state.handle,
    };
  }

  async resume(
    input: ResumeRoomSessionInputV1
  ): Promise<ResumeRoomSessionResultV1> {
    const incompatibility = this.validateCheckpoint(input);
    if (incompatibility) {
      return {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        status: 'unsupported',
        reason: incompatibility,
      };
    }

    const state = await this.createSession({
      context: input.context,
      eventSequence: input.checkpoint.cursor.eventSequence,
      generation: input.generation,
      mode: 'resume',
      policy: input.policy,
      session: input.session,
    });

    return {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      status: 'resumed',
      handle: state.handle,
    };
  }

  handle(input: HandleRoomDeliveryInputV1): AsyncIterable<RoomRuntimeEventEnvelopeV1> {
    const state = this.sessions.get(input.handle.runtimeSessionId);
    const validationError =
      !state &&
      this.currentRuntimeSessionByRoomSession.has(
        input.handle.session.roomSessionId
      )
        ? {
            code: 'stale-runtime-handle',
            message: 'The Room runtime handle is stale or does not match this session.',
          }
        : this.validateDelivery(input, state);

    if (!state || validationError) {
      return singleEvent(
        this.createDetachedErrorEvent(
          input,
          validationError ?? {
            code: 'session-not-open',
            message: 'The Room runtime session is not open in this adapter.',
          }
        )
      );
    }

    if (input.delivery.intent === 'observe') {
      return singleEvent(this.observeDelivery(state, input));
    }

    state.activeDeliveryId = input.delivery.deliveryId;
    return this.respondToDelivery(state, input);
  }

  async checkpoint(
    input: CheckpointRoomSessionInputV1
  ): Promise<CheckpointRoomSessionResultV1> {
    const state = this.sessions.get(input.handle.runtimeSessionId);
    if (!state || !this.isCurrentHandle(input.handle, state)) {
      return {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        status: 'unsupported',
        reason: 'Cannot checkpoint an unknown or stale Room runtime handle.',
      };
    }

    if (state.activeDeliveryId || state.agent.state.isStreaming) {
      return {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        status: 'unsupported',
        reason: 'Cannot checkpoint a Room runtime session during an active delivery.',
      };
    }

    state.eventSequence = Math.max(
      state.eventSequence,
      input.cursor.eventSequence
    );
    const checkpointCursor = {
      messageSequence: Math.max(
        input.cursor.messageSequence,
        state.contextThroughMessageSequence
      ),
      deliverySequence: input.cursor.deliverySequence,
      eventSequence: state.eventSequence,
    };

    return {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      status: 'created',
      checkpoint: {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        envelopeType: 'room.checkpoint',
        checkpointId: this.dependencies.createId('checkpoint'),
        createdAt: this.dependencies.now().toISOString(),
        session: state.handle.session,
        runtimeId: this.descriptor.runtimeId,
        runtimeVersion: this.descriptor.runtimeVersion,
        runtimeSessionId: state.handle.runtimeSessionId,
        generation: state.handle.generation,
        cursor: checkpointCursor,
        runtimeState: {
          kind: PI_ROOM_CHECKPOINT_KIND_V1,
          checkpointStateVersion: PI_ROOM_CHECKPOINT_STATE_VERSION_V1,
          replay: 'authoritative-context',
          contextThroughMessageSequence: state.contextThroughMessageSequence,
        },
      },
    };
  }

  private async createSession(input: {
    context: RoomContextSnapshotV1;
    eventSequence: number;
    generation: number;
    mode: 'open' | 'resume';
    policy: RoomPolicyV1;
    session: RoomSessionRefV1;
  }): Promise<PiRoomSessionStateV1> {
    const config = await this.resolveAgentConfig({
      context: input.context,
      generation: input.generation,
      mode: input.mode,
      policy: input.policy,
      session: input.session,
    });
    const runtimeSessionId = this.dependencies.createId('runtime-session');
    const handle: RoomSessionRuntimeHandleV1 = {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      session: input.session,
      runtimeId: this.descriptor.runtimeId,
      runtimeSessionId,
      generation: input.generation,
      openedAt: this.dependencies.now().toISOString(),
    };
    const replayContext = buildPiReplayContext(
      input.context,
      input.session,
      config.model
    );
    const agent = await this.dependencies.createAgent({
      initialState: {
        systemPrompt: appendTrustedControlContext(
          config.systemPrompt,
          replayContext.trustedControlBlocks
        ),
        model: config.model,
        messages: replayContext.usesBlocks
          ? replayContext.messages
          : input.context.messages.map((message) =>
              toPiMessage(message, input.session, config.model)
            ),
        tools: [...(config.tools ?? [])],
        thinkingLevel: config.thinkingLevel ?? 'low',
      },
      getApiKey: config.getApiKey,
      sessionId: [
        this.descriptor.runtimeId,
        input.session.roomSessionId,
        input.generation,
        runtimeSessionId,
      ].join(':'),
      streamFn: config.streamFn,
    });
    const state: PiRoomSessionStateV1 = {
      agent,
      completedDeliveryIds: new Set(),
      contextMessageIds: new Set(
        [
          ...input.context.messages.map((message) => message.messageId),
          ...roomContextMessageIds(input.context, input.session),
        ]
      ),
      contextThroughMessageSequence: input.context.throughMessageSequence,
      eventSequence: input.eventSequence,
      handle,
      model: config.model,
      tools: config.tools ?? [],
    };

    await this.retireCurrentSession(input.session.roomSessionId);
    this.sessions.set(runtimeSessionId, state);
    this.currentRuntimeSessionByRoomSession.set(
      input.session.roomSessionId,
      runtimeSessionId
    );
    return state;
  }

  private async retireCurrentSession(roomSessionId: string) {
    const runtimeSessionId =
      this.currentRuntimeSessionByRoomSession.get(roomSessionId);
    if (!runtimeSessionId) {
      return;
    }

    const state = this.sessions.get(runtimeSessionId);
    if (!state) {
      return;
    }

    state.agent.abort();
    await state.agent.waitForIdle();
    this.sessions.delete(runtimeSessionId);
  }

  private observeDelivery(
    state: PiRoomSessionStateV1,
    input: HandleRoomDeliveryInputV1
  ): RoomRuntimeEventEnvelopeV1 {
    if (!state.contextMessageIds.has(input.delivery.message.messageId)) {
      state.agent.appendMessage(
        toPiMessage(
          input.delivery.message,
          state.handle.session,
          state.model
        )
      );
      state.contextMessageIds.add(input.delivery.message.messageId);
    }
    state.contextThroughMessageSequence = Math.max(
      state.contextThroughMessageSequence,
      input.delivery.message.sequence
    );
    state.completedDeliveryIds.add(input.delivery.deliveryId);

    return this.createEvent(state, input.delivery.deliveryId, {
      type: 'delivery-completed',
      disposition: 'observed',
    });
  }

  private respondToDelivery(
    state: PiRoomSessionStateV1,
    input: HandleRoomDeliveryInputV1
  ): AsyncIterable<RoomRuntimeEventEnvelopeV1> {
    const queue = new AsyncEventQueue<RoomRuntimeEventEnvelopeV1>();
    const responseId = this.dependencies.createId('response');
    let cancelled = false;
    let responseStarted = false;
    let streamedText = '';
    let pendingConfirmation:
      | AgentToolPendingConfirmationDescriptorV1
      | undefined;
    const activeToolCalls = new Map<string, ActivePiToolCallV1>();

    const startResponse = () => {
      if (responseStarted || cancelled) {
        return;
      }
      responseStarted = true;
      queue.push(() =>
        this.createEvent(state, input.delivery.deliveryId, {
          type: 'response-started',
          responseId,
        })
      );
    };

    const unsubscribe = state.agent.subscribe((event) => {
      if (cancelled) {
        return;
      }

      if (event.type === 'tool_execution_start') {
        const tool = state.tools.find(
          (candidate) => candidate.name === event.toolName
        ) as (AgentTool & Partial<AgentToolPendingConfirmationSourceV1>) | undefined;
        activeToolCalls.set(event.toolCallId, {
          args: event.args,
          ...(tool?.getPendingConfirmation
            ? { confirmationSource: tool as AgentToolPendingConfirmationSourceV1 }
            : {}),
          toolName: event.toolName,
        });
        return;
      }

      if (event.type === 'agent_start') {
        startResponse();
        return;
      }

      if (event.type === 'tool_execution_end') {
        const started = activeToolCalls.get(event.toolCallId);
        activeToolCalls.delete(event.toolCallId);
        if (
          !event.isError ||
          !started ||
          started.toolName !== event.toolName
        ) {
          return;
        }
        const descriptor =
          started.confirmationSource?.getPendingConfirmation(event.toolCallId);
        if (
          !descriptor ||
          descriptor.request.toolName !== event.toolName ||
          !isRoomJsonValue(descriptor.request.parameters)
        ) {
          return;
        }
        const parameters = descriptor.request.parameters as import('../contracts').RoomJsonValueV1;
        pendingConfirmation = descriptor;
        queue.push(() =>
          this.createEvent(state, input.delivery.deliveryId, {
            type: 'room.tool_confirmation.requested',
            request: {
              schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
              requestType: 'room.tool-confirmation',
              requestId: descriptor.requestId,
              expiresAt: descriptor.expiresAt,
              toolCallId: descriptor.request.toolCallId,
              toolName: descriptor.request.toolName,
              parameters,
              safetyLevel: descriptor.request.safetyLevel,
              writePolicy: descriptor.request.writePolicy,
            },
          })
        );
        // Pi converts tool exceptions into tool-result messages and would ask
        // the model to continue. Stop that continuation once the governed
        // boundary has positively identified a pending human confirmation.
        state.agent.abort();
        return;
      }

      if (
        event.type === 'message_update' &&
        event.assistantMessageEvent.type === 'text_delta'
      ) {
        startResponse();
        const text = event.assistantMessageEvent.delta;
        streamedText += text;
        queue.push(() =>
          this.createEvent(state, input.delivery.deliveryId, {
            type: 'text-delta',
            responseId,
            text,
          })
        );
      }
    });

    const run = (async () => {
      try {
        const messageAlreadyInContext = state.contextMessageIds.has(
          input.delivery.message.messageId
        );
        if (messageAlreadyInContext) {
          await state.agent.continue();
        } else {
          await state.agent.prompt(
            toPiMessage(
              input.delivery.message,
              state.handle.session,
              undefined
            )
          );
          state.contextMessageIds.add(input.delivery.message.messageId);
        }

        if (cancelled) {
          return;
        }

        if (pendingConfirmation) {
          queue.push(() =>
            this.createEvent(state, input.delivery.deliveryId, {
              type: 'delivery-completed',
              disposition: 'ignored',
            })
          );
          state.contextThroughMessageSequence = Math.max(
            state.contextThroughMessageSequence,
            input.delivery.message.sequence
          );
          state.completedDeliveryIds.add(input.delivery.deliveryId);
          return;
        }

        const finalMessage = findLastAssistantMessage(state.agent.state.messages);
        const failed =
          state.agent.state.error ||
          finalMessage?.stopReason === 'error' ||
          finalMessage?.stopReason === 'aborted';

        if (failed) {
          queue.push(() =>
            this.createEvent(state, input.delivery.deliveryId, {
              type: 'error',
              code:
                finalMessage?.stopReason === 'aborted'
                  ? 'pi-request-aborted'
                  : 'pi-request-failed',
              message:
                finalMessage?.errorMessage ||
                state.agent.state.error ||
                'Pi agent request failed.',
              retryable: finalMessage?.stopReason !== 'aborted',
            })
          );
          return;
        }

        startResponse();
        const finalText = extractPiAssistantText(finalMessage);
        if (!streamedText && finalText) {
          streamedText = finalText;
          queue.push(() =>
            this.createEvent(state, input.delivery.deliveryId, {
              type: 'text-delta',
              responseId,
              text: finalText,
            })
          );
        }
        queue.push(() =>
          this.createEvent(state, input.delivery.deliveryId, {
            type: 'message-ready',
            responseId,
            message: {
              text: streamedText || finalText,
              mentions: [],
              attachments: [],
            },
          })
        );
        queue.push(() =>
          this.createEvent(state, input.delivery.deliveryId, {
            type: 'delivery-completed',
            disposition: 'responded',
          })
        );
        state.contextThroughMessageSequence = Math.max(
          state.contextThroughMessageSequence,
          input.delivery.message.sequence
        );
        state.completedDeliveryIds.add(input.delivery.deliveryId);
      } catch (error) {
        if (!cancelled) {
          queue.push(() =>
            this.createEvent(state, input.delivery.deliveryId, {
              type: 'error',
              code: 'pi-request-failed',
              message: describeError(error),
              retryable: true,
            })
          );
        }
      } finally {
        unsubscribe();
        state.activeDeliveryId = undefined;
        queue.close();
      }
    })();

    return new PiRoomDeliveryEventIteratorV1(queue, async () => {
      if (cancelled) {
        return;
      }
      cancelled = true;
      unsubscribe();
      queue.close();
      state.agent.abort();
      await run;
      await state.agent.waitForIdle();
      state.activeDeliveryId = undefined;
    });
  }

  private validateDelivery(
    input: HandleRoomDeliveryInputV1,
    state: PiRoomSessionStateV1 | undefined
  ): { code: string; message: string } | undefined {
    if (!state) {
      return {
        code: 'session-not-open',
        message: 'The Room runtime session is not open in this adapter.',
      };
    }
    if (!this.isCurrentHandle(input.handle, state)) {
      return {
        code: 'stale-runtime-handle',
        message: 'The Room runtime handle is stale or does not match this session.',
      };
    }
    if (input.delivery.roomSessionId !== state.handle.session.roomSessionId) {
      return {
        code: 'delivery-session-mismatch',
        message: 'The delivery does not belong to the open Room session.',
      };
    }
    if (
      input.delivery.target.agentId !== state.handle.session.agent.agentId ||
      input.delivery.message.organizationId !==
        state.handle.session.organizationId ||
      input.delivery.message.roomId !== state.handle.session.roomId
    ) {
      return {
        code: 'delivery-target-mismatch',
        message: 'The delivery target or Room identity does not match the session.',
      };
    }
    if (state.activeDeliveryId) {
      return {
        code: 'delivery-already-active',
        message: 'The Room runtime session is already handling a delivery.',
      };
    }
    if (state.completedDeliveryIds.has(input.delivery.deliveryId)) {
      return {
        code: 'delivery-already-completed',
        message: 'The delivery has already completed in this runtime session.',
      };
    }
    return undefined;
  }

  private isCurrentHandle(
    handle: RoomSessionRuntimeHandleV1,
    state: PiRoomSessionStateV1
  ) {
    return (
      handle.runtimeId === this.descriptor.runtimeId &&
      handle.runtimeSessionId === state.handle.runtimeSessionId &&
      handle.generation === state.handle.generation &&
      sameSession(handle.session, state.handle.session) &&
      this.currentRuntimeSessionByRoomSession.get(handle.session.roomSessionId) ===
        handle.runtimeSessionId
    );
  }

  private validateCheckpoint(input: ResumeRoomSessionInputV1): string | undefined {
    const checkpoint = input.checkpoint;
    if (
      checkpoint.runtimeId !== this.descriptor.runtimeId ||
      checkpoint.runtimeVersion !== this.descriptor.runtimeVersion
    ) {
      return 'The checkpoint was created by a different runtime or runtime version.';
    }
    if (!sameSession(checkpoint.session, input.session)) {
      return 'The checkpoint belongs to a different Room session.';
    }
    if (input.generation < checkpoint.generation) {
      return 'The requested generation is older than the checkpoint generation.';
    }
    const runtimeState = readCheckpointState(checkpoint.runtimeState);
    if (!runtimeState) {
      return 'The checkpoint runtime state is invalid or unsupported.';
    }
    if (
      input.context.throughMessageSequence < checkpoint.cursor.messageSequence ||
      input.context.throughMessageSequence <
        runtimeState.contextThroughMessageSequence
    ) {
      return 'Fresh replay context is older than the checkpoint cursor.';
    }
    return undefined;
  }

  private createEvent(
    state: PiRoomSessionStateV1,
    deliveryId: string | undefined,
    event: RoomRuntimeEventPayloadV1
  ): RoomRuntimeEventEnvelopeV1 {
    state.eventSequence += 1;
    return {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      envelopeType: 'room.runtime-event',
      eventId: this.dependencies.createId('event'),
      eventSequence: state.eventSequence,
      occurredAt: this.dependencies.now().toISOString(),
      roomSessionId: state.handle.session.roomSessionId,
      runtimeSessionId: state.handle.runtimeSessionId,
      ...(deliveryId ? { deliveryId } : {}),
      event,
    };
  }

  private createDetachedErrorEvent(
    input: HandleRoomDeliveryInputV1,
    error: { code: string; message: string }
  ): RoomRuntimeEventEnvelopeV1 {
    const state = this.sessions.get(input.handle.runtimeSessionId);
    if (state) {
      return this.createEvent(state, input.delivery.deliveryId, {
        type: 'error',
        code: error.code,
        message: error.message,
        retryable: false,
      });
    }

    return {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      envelopeType: 'room.runtime-event',
      eventId: this.dependencies.createId('event'),
      eventSequence: 1,
      occurredAt: this.dependencies.now().toISOString(),
      roomSessionId: input.handle.session.roomSessionId,
      runtimeSessionId: input.handle.runtimeSessionId,
      deliveryId: input.delivery.deliveryId,
      event: {
        type: 'error',
        code: error.code,
        message: error.message,
        retryable: false,
      },
    };
  }
}

class AsyncEventQueue<T> {
  private closed = false;
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];

  push(createValue: () => T) {
    if (this.closed) {
      return;
    }
    const value = createValue();
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      return;
    }
    this.values.push(value);
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value !== undefined) {
      return Promise.resolve({ value, done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

class PiRoomDeliveryEventIteratorV1
  implements AsyncIterableIterator<RoomRuntimeEventEnvelopeV1>
{
  private returned = false;

  constructor(
    private readonly queue: AsyncEventQueue<RoomRuntimeEventEnvelopeV1>,
    private readonly cancel: () => Promise<void>
  ) {}

  [Symbol.asyncIterator]() {
    return this;
  }

  next() {
    if (this.returned) {
      return Promise.resolve({
        value: undefined,
        done: true as const,
      });
    }
    return this.queue.next();
  }

  async return() {
    if (!this.returned) {
      this.returned = true;
      await this.cancel();
    }
    return { value: undefined, done: true as const };
  }
}

function singleEvent(
  event: RoomRuntimeEventEnvelopeV1
): AsyncIterable<RoomRuntimeEventEnvelopeV1> {
  return {
    async *[Symbol.asyncIterator]() {
      yield event;
    },
  };
}

function toPiMessage(
  message: RoomMessageEnvelopeV1,
  session: RoomSessionRefV1,
  modelOrAssistant?: AnyPiModel | Extract<AgentMessage, { role: 'assistant' }>
): AgentMessage {
  const timestamp = parseTimestamp(message.createdAt);
  if (message.actor.type === 'agent' && message.actor.agentId === session.agent.agentId) {
    const model =
      modelOrAssistant && 'api' in modelOrAssistant
        ? modelOrAssistant
        : modelOrAssistant;
    if (model) {
      return 'usage' in model
        ? { ...model, content: [{ type: 'text', text: message.text }], timestamp }
        : toPiAssistantMessage(message.text, model, timestamp);
    }
  }

  return {
    role: 'user',
    content: message.text,
    timestamp,
  };
}

function toPiAssistantMessage(
  text: string,
  model: AnyPiModel,
  timestamp: number
): Extract<AgentMessage, { role: 'assistant' }> {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp,
  };
}

function parseTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function findLastAssistantMessage(messages: AgentMessage[]) {
  return [...messages]
    .reverse()
    .find(
      (message): message is Extract<AgentMessage, { role: 'assistant' }> =>
        message.role === 'assistant'
    );
}

function extractPiAssistantText(
  message: Extract<AgentMessage, { role: 'assistant' }> | undefined
) {
  return (
    message?.content
      .filter((content) => content.type === 'text')
      .map((content) => content.text)
      .join('') ?? ''
  );
}

function sameSession(left: RoomSessionRefV1, right: RoomSessionRefV1) {
  return (
    left.organizationId === right.organizationId &&
    left.roomId === right.roomId &&
    left.roomSessionId === right.roomSessionId &&
    left.agent.agentId === right.agent.agentId &&
    left.agent.handle === right.agent.handle
  );
}

function readCheckpointState(value: unknown): PiRoomCheckpointStateV1 | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.kind !== PI_ROOM_CHECKPOINT_KIND_V1 ||
    record.checkpointStateVersion !== PI_ROOM_CHECKPOINT_STATE_VERSION_V1 ||
    record.replay !== 'authoritative-context' ||
    typeof record.contextThroughMessageSequence !== 'number' ||
    !Number.isInteger(record.contextThroughMessageSequence) ||
    record.contextThroughMessageSequence < 0
  ) {
    return undefined;
  }
  return {
    kind: record.kind,
    checkpointStateVersion: record.checkpointStateVersion,
    replay: record.replay,
    contextThroughMessageSequence: record.contextThroughMessageSequence,
  };
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRoomJsonValue(value: unknown, depth = 0): value is import('../contracts').RoomJsonValueV1 {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.every((entry) => isRoomJsonValue(entry, depth + 1));
  }
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).every((entry) =>
    isRoomJsonValue(entry, depth + 1)
  );
}

function buildPiReplayContext(
  context: RoomContextSnapshotV1,
  session: RoomSessionRefV1,
  model?: AnyPiModel
): {
  messages: AgentMessage[];
  trustedControlBlocks: readonly RoomContextBlockV1[];
  usesBlocks: boolean;
} {
  const richContext = context as RichRoomContextSnapshotV1;
  if (
    !isRichRoomContext(richContext, session) ||
    richContext.blocks.length === 0
  ) {
    return { messages: [], trustedControlBlocks: [], usesBlocks: false };
  }

  const trustedControlBlocks: RoomContextBlockV1[] = [];
  const messages: AgentMessage[] = [];
  for (const block of richContext.blocks) {
    if (!isRoomContextBlock(block)) {
      continue;
    }
    if (
      block.trust.level === 'trusted' &&
      block.trust.usage === 'control-instruction'
    ) {
      trustedControlBlocks.push(block);
      continue;
    }

    const content = formatContextBlock(block);
    if (
      model &&
      block.source.sourceType === 'room-message' &&
      block.source.actor.type === 'agent' &&
      block.source.actor.agentId === session.agent.agentId
    ) {
      messages.push(toPiAssistantMessage(content, model, contextBlockTimestamp(block)));
    } else {
      messages.push({
        role: 'user',
        content,
        timestamp: contextBlockTimestamp(block),
      });
    }
  }

  // The host guarantees the current delivery is represented by the bounded
  // context. If a future builder emits only trusted control blocks, fall back
  // to the legacy snapshot rather than calling Pi with no conversational data.
  if (messages.length === 0 && trustedControlBlocks.length > 0) {
    return { messages: [], trustedControlBlocks, usesBlocks: true };
  }

  return { messages, trustedControlBlocks, usesBlocks: true };
}

function appendTrustedControlContext(
  systemPrompt: string,
  blocks: readonly RoomContextBlockV1[]
) {
  if (blocks.length === 0) {
    return systemPrompt;
  }
  return [
    systemPrompt,
    '',
    '<room-context-control>',
    ...blocks.map(formatContextBlock),
    '</room-context-control>',
  ].join('\n');
}

function formatContextBlock(block: RoomContextBlockV1) {
  const metadata = JSON.stringify({
    blockId: block.blockId,
    category: block.category,
    trust: block.trust,
    source: block.source,
    truncated: block.truncation.truncated,
  });
  return [
    `<room-context-block metadata=${metadata}>`,
    block.content,
    '</room-context-block>',
  ].join('\n');
}

function contextBlockTimestamp(block: RoomContextBlockV1) {
  return block.source.sourceType === 'room-message'
    ? parseTimestamp(block.source.createdAt)
    : 0;
}

function isRoomContextBlock(
  value: unknown,
  session?: RoomSessionRefV1
): value is RoomContextBlockV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const trust = record.trust;
  const source = record.source;
  const acl = record.acl;
  const trustRecord = trust as Record<string, unknown> | undefined;
  const aclRecord = acl as Record<string, unknown> | undefined;
  const principal = aclRecord?.principal as Record<string, unknown> | undefined;
  const validTrust =
    !!trustRecord &&
    (trustRecord.level === 'trusted' || trustRecord.level === 'untrusted') &&
    (trustRecord.origin === 'control-plane' ||
      trustRecord.origin === 'room-participant' ||
      trustRecord.origin === 'derived-summary' ||
      trustRecord.origin === 'workspace-document' ||
      trustRecord.origin === 'retrieval') &&
    (trustRecord.usage === 'control-instruction' ||
      trustRecord.usage === 'user-request' ||
      trustRecord.usage === 'data-only') &&
    (trustRecord.usage !== 'control-instruction' ||
      (trustRecord.level === 'trusted' &&
        trustRecord.origin === 'control-plane'));
  const validAcl =
    !session ||
    (!!aclRecord &&
      aclRecord.decision === 'allow' &&
      aclRecord.organizationId === session.organizationId &&
      principal?.agentId === session.agent.agentId &&
      principal.roomSessionId === session.roomSessionId);
  return (
    typeof record.blockId === 'string' &&
    typeof record.category === 'string' &&
    record.contentType === 'text/plain' &&
    typeof record.content === 'string' &&
    validTrust &&
    validAcl &&
    !!source &&
    typeof source === 'object' &&
    !Array.isArray(source) &&
    typeof (source as Record<string, unknown>).sourceType === 'string' &&
    typeof (source as Record<string, unknown>).sourceId === 'string'
  );
}

function isRichRoomContext(
  value: RichRoomContextSnapshotV1,
  session: RoomSessionRefV1
): value is RoomContextSnapshotV1 & RoomContextBuildResultV1 {
  return (
    value.contextType === 'room.context' &&
    value.organizationId === session.organizationId &&
    value.roomId === session.roomId &&
    value.roomSessionId === session.roomSessionId &&
    value.agentId === session.agent.agentId &&
    Array.isArray(value.blocks) &&
    value.blocks.every((block) => isRoomContextBlock(block, session))
  );
}

function roomContextMessageIds(
  context: RoomContextSnapshotV1,
  session: RoomSessionRefV1
) {
  const richContext = context as RichRoomContextSnapshotV1;
  if (!isRichRoomContext(richContext, session)) {
    return [];
  }
  return richContext.blocks.flatMap((block) =>
    block.source.sourceType === 'room-message'
      ? [block.source.sourceId]
      : []
  );
}
