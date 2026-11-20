import { randomUUID } from 'node:crypto';

import { isRecord } from '@/framework/resilience/safe-data';
import {
  isRoomAgentMentionV1,
  isRoomAttachmentRefV1,
  isRoomDelegationInvocationV1,
  isRoomJsonValueV1,
} from '@/objects/room/schema';
import {
  createNodeHttpProxyTransportV1,
  HTTP_PROXY_DEFAULT_TIMEOUT_MS_V1,
  HttpProxyTransportError,
  validateHttpProxyEndpointV1,
  type HttpProxyTransportV1,
} from '@/agent/runtime-proxy/http-transport';

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
  type RoomSessionRuntimeCapabilitiesV1,
  type RoomSessionRuntimeDescriptorV1,
  type RoomSessionRuntimeHandleV1,
  type RoomSessionRuntimePortV1,
} from '../contracts';

export const HTTP_PROXY_ROOM_RUNTIME_ID_V1 = 'http-proxy';
export const HTTP_PROXY_ROOM_RUNTIME_VERSION_V1 = '1.0.0';

export type HttpProxyRoomRuntimeIdKindV1 =
  | 'checkpoint'
  | 'event'
  | 'runtime-session';

export type HttpProxyRoomSessionRuntimeConfigV1 = {
  enabled: boolean;
  endpoint: string | null;
  token?: string | null;
  allowRemoteEndpoint?: boolean;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  runtimeId?: string;
  displayName?: string;
  runtimeVersion?: string;
  capabilities?: Partial<
    Omit<RoomSessionRuntimeCapabilitiesV1, 'schemaVersion'>
  >;
  transport?: HttpProxyTransportV1;
  now?: () => Date;
  createId?: (kind: HttpProxyRoomRuntimeIdKindV1) => string;
};

export type HttpProxyRoomRuntimeConfigurationIssueCodeV1 =
  | 'missing-endpoint'
  | 'invalid-endpoint'
  | 'remote-endpoint-disallowed'
  | 'remote-endpoint-requires-https'
  | 'remote-endpoint-requires-token'
  | 'invalid-timeout';

export type HttpProxyRoomRuntimeConfigurationIssueV1 = {
  code: HttpProxyRoomRuntimeConfigurationIssueCodeV1;
  field?: 'endpoint' | 'token' | 'requestTimeoutMs';
  message: string;
};

export type HttpProxyRoomRuntimeConfigurationStateV1 =
  | {
      state: 'ready';
      executable: true;
      message: string;
      issues: readonly [];
    }
  | {
      state: 'disabled' | 'unavailable';
      executable: false;
      message: string;
      issues: readonly HttpProxyRoomRuntimeConfigurationIssueV1[];
    };

export type HttpProxyRoomOperationV1 =
  | 'open'
  | 'resume'
  | 'handle'
  | 'checkpoint';

export class HttpProxyRoomRuntimeUnavailableError extends Error {
  readonly code = 'http-proxy-room-runtime-unavailable' as const;
  readonly operation: HttpProxyRoomOperationV1;
  readonly configurationState: HttpProxyRoomRuntimeConfigurationStateV1;

  constructor(
    operation: HttpProxyRoomOperationV1,
    configurationState: HttpProxyRoomRuntimeConfigurationStateV1
  ) {
    super(
      `HTTP proxy Room runtime operation "${operation}" is ${configurationState.state}: ${configurationState.message}`
    );
    this.name = 'HttpProxyRoomRuntimeUnavailableError';
    this.operation = operation;
    this.configurationState = configurationState;
  }
}

type ActiveProxySessionStateV1 = {
  runtimeSessionId: string;
  generation: number;
  eventSequence: number;
  handle: RoomSessionRuntimeHandleV1;
};

/**
 * Opt-in, fail-closed RoomSessionRuntimePortV1 adapter targeting an external
 * unified runtime proxy sidecar.
 *
 * Keeps generation fencing, Quiet Host observation, opaque JSON checkpoint
 * validation, and cancellation settlement strictly enforced at the local
 * adapter boundary.
 */
export class HttpProxyRoomSessionRuntimeAdapterV1
  implements RoomSessionRuntimePortV1
{
  private readonly descriptor: RoomSessionRuntimeDescriptorV1;
  private readonly configurationState: HttpProxyRoomRuntimeConfigurationStateV1;
  private readonly transport: HttpProxyTransportV1 | null;
  private readonly token: string | null;
  private readonly now: () => Date;
  private readonly createId: (kind: HttpProxyRoomRuntimeIdKindV1) => string;
  private readonly sessions = new Map<string, ActiveProxySessionStateV1>();

  constructor(config: HttpProxyRoomSessionRuntimeConfigV1) {
    this.descriptor = buildDescriptor(config);
    this.token = config.token?.trim() || null;
    this.now = config.now ?? (() => new Date());
    this.createId = config.createId ?? ((kind) => `${kind}-${randomUUID()}`);

    const evaluated = evaluateConfig(config);
    this.configurationState = evaluated.state;
    if (evaluated.state.executable) {
      this.transport =
        config.transport ??
        createNodeHttpProxyTransportV1({
          baseUrl: evaluated.normalizedBaseUrl,
          token: config.token,
          requestTimeoutMs: config.requestTimeoutMs,
          maxResponseBytes: config.maxResponseBytes,
          allowRemoteEndpoint: config.allowRemoteEndpoint,
        });
    } else {
      this.transport = null;
    }
  }

  async describe(): Promise<RoomSessionRuntimeDescriptorV1> {
    return this.descriptor;
  }

  getConfigurationState(): HttpProxyRoomRuntimeConfigurationStateV1 {
    return this.configurationState;
  }

  async open(input: OpenRoomSessionInputV1): Promise<OpenRoomSessionResultV1> {
    const transport = this.requireTransport('open');
    const response = await transport.requestJson({
      path: '/v1/room/sessions/open',
      body: {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        runtimeId: this.descriptor.runtimeId,
        requestId: input.requestId,
        session: input.session,
        generation: input.generation,
        context: input.context,
        policy: input.policy,
      },
    });
    const runtimeSessionId = readRuntimeSessionId(response.body);
    const handle: RoomSessionRuntimeHandleV1 = {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      session: input.session,
      runtimeId: this.descriptor.runtimeId,
      runtimeSessionId,
      generation: input.generation,
      openedAt: this.now().toISOString(),
    };
    this.sessions.set(input.session.roomSessionId, {
      runtimeSessionId,
      generation: input.generation,
      eventSequence: 0,
      handle,
    });
    return {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      handle,
    };
  }

  async resume(
    input: ResumeRoomSessionInputV1
  ): Promise<ResumeRoomSessionResultV1> {
    const transport = this.requireTransport('resume');
    if (
      input.checkpoint.schemaVersion !== ROOM_RUNTIME_CONTRACT_VERSION_V1 ||
      input.checkpoint.runtimeId !== this.descriptor.runtimeId ||
      input.checkpoint.session.roomSessionId !== input.session.roomSessionId ||
      !isRoomJsonValueV1(input.checkpoint.runtimeState)
    ) {
      return {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        status: 'unsupported',
        reason: 'Checkpoint is incompatible with this HTTP runtime proxy session.',
      };
    }

    const response = await transport.requestJson({
      path: '/v1/room/sessions/resume',
      body: {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        runtimeId: this.descriptor.runtimeId,
        requestId: input.requestId,
        session: input.session,
        generation: input.generation,
        checkpoint: input.checkpoint,
        context: input.context,
        policy: input.policy,
      },
    });
    if (isRecord(response.body) && response.body.status === 'unsupported') {
      return {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        status: 'unsupported',
        reason:
          typeof response.body.reason === 'string' && response.body.reason.trim()
            ? response.body.reason.trim()
            : 'Runtime proxy declined to resume this checkpoint.',
      };
    }

    const runtimeSessionId = readRuntimeSessionId(response.body);
    const previous = this.sessions.get(input.session.roomSessionId);
    const nextSequence = Math.max(
      previous?.eventSequence ?? 0,
      input.checkpoint.cursor.eventSequence
    );
    const handle: RoomSessionRuntimeHandleV1 = {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      session: input.session,
      runtimeId: this.descriptor.runtimeId,
      runtimeSessionId,
      generation: input.generation,
      openedAt: this.now().toISOString(),
    };
    this.sessions.set(input.session.roomSessionId, {
      runtimeSessionId,
      generation: input.generation,
      eventSequence: nextSequence,
      handle,
    });
    return {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      status: 'resumed',
      handle,
    };
  }

  async checkpoint(
    input: CheckpointRoomSessionInputV1
  ): Promise<CheckpointRoomSessionResultV1> {
    const transport = this.requireTransport('checkpoint');
    const active = this.sessions.get(input.handle.session.roomSessionId);
    if (
      !active ||
      active.runtimeSessionId !== input.handle.runtimeSessionId ||
      active.generation !== input.handle.generation
    ) {
      return {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        status: 'unsupported',
        reason: 'Runtime handle is stale or closed.',
      };
    }

    const response = await transport.requestJson({
      path: '/v1/room/sessions/checkpoint',
      body: {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        runtimeId: this.descriptor.runtimeId,
        requestId: input.requestId,
        handle: input.handle,
        cursor: input.cursor,
        reason: input.reason,
      },
    });
    if (isRecord(response.body) && response.body.status === 'unsupported') {
      return {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        status: 'unsupported',
        reason:
          typeof response.body.reason === 'string' && response.body.reason.trim()
            ? response.body.reason.trim()
            : 'Runtime proxy does not support checkpointing this session.',
      };
    }

    const runtimeState = readCheckpointState(response.body, this.token);
    active.eventSequence = Math.max(
      active.eventSequence,
      input.cursor.eventSequence
    );

    return {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      status: 'created',
      checkpoint: {
        schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
        envelopeType: 'room.checkpoint',
        checkpointId: this.createId('checkpoint'),
        createdAt: this.now().toISOString(),
        session: input.handle.session,
        runtimeId: this.descriptor.runtimeId,
        runtimeVersion: this.descriptor.runtimeVersion,
        runtimeSessionId: input.handle.runtimeSessionId,
        generation: input.handle.generation,
        cursor: input.cursor,
        runtimeState,
      },
    };
  }

  handle(
    input: HandleRoomDeliveryInputV1
  ): AsyncIterable<RoomRuntimeEventEnvelopeV1> {
    const transport = this.requireTransport('handle');
    return this.streamDelivery(transport, input);
  }

  private async *streamDelivery(
    transport: HttpProxyTransportV1,
    input: HandleRoomDeliveryInputV1
  ): AsyncIterable<RoomRuntimeEventEnvelopeV1> {
    const active = this.sessions.get(input.handle.session.roomSessionId);
    if (
      !active ||
      active.runtimeSessionId !== input.handle.runtimeSessionId ||
      active.generation !== input.handle.generation
    ) {
      yield this.envelope(
        input.handle,
        input.delivery.deliveryId,
        (active?.eventSequence ?? 0) + 1,
        {
          type: 'error',
          code: 'stale-runtime-handle',
          message: 'Room runtime handle does not match the active session generation.',
          retryable: false,
        }
      );
      return;
    }

    if (input.delivery.intent === 'observe') {
      active.eventSequence += 1;
      yield this.envelope(
        input.handle,
        input.delivery.deliveryId,
        active.eventSequence,
        {
          type: 'delivery-completed',
          disposition: 'observed',
        }
      );
      return;
    }

    const controller = new AbortController();
    let terminalEmitted = false;
    let completedNormally = false;
    try {
      for await (const raw of transport.streamNdjson({
        path: '/v1/room/sessions/handle',
        body: {
          schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
          runtimeId: this.descriptor.runtimeId,
          handle: input.handle,
          delivery: input.delivery,
          policy: input.policy,
        },
        signal: controller.signal,
      })) {
        if (terminalEmitted) {
          throw new Error(
            'Runtime proxy emitted an event after a terminal Room event.'
          );
        }
        const payload = parseRoomEventPayloadV1(raw);
        active.eventSequence += 1;
        if (payload.type === 'delivery-completed' || payload.type === 'error') {
          terminalEmitted = true;
          completedNormally = true;
        }
        yield this.envelope(
          input.handle,
          input.delivery.deliveryId,
          active.eventSequence,
          payload
        );
        if (terminalEmitted) {
          break;
        }
      }

      if (!terminalEmitted && !controller.signal.aborted) {
        completedNormally = true;
        active.eventSequence += 1;
        yield this.envelope(
          input.handle,
          input.delivery.deliveryId,
          active.eventSequence,
          {
            type: 'error',
            code: 'proxy-stream-incomplete',
            message: 'Runtime proxy stream ended without a terminal event.',
            retryable: true,
          }
        );
      }
    } catch (error) {
      completedNormally = true;
      if (!terminalEmitted && !controller.signal.aborted) {
        const retryable =
          error instanceof HttpProxyTransportError
            ? error.code === 'proxy-network-error' ||
              error.code === 'proxy-request-timeout' ||
              (error.status !== undefined && error.status >= 500)
            : false;
        active.eventSequence += 1;
        yield this.envelope(
          input.handle,
          input.delivery.deliveryId,
          active.eventSequence,
          {
            type: 'error',
            code:
              error instanceof HttpProxyTransportError
                ? error.code
                : 'proxy-protocol-error',
            message: sanitizeErrorMessage(error, this.token),
            retryable,
          }
        );
      }
    } finally {
      if (!completedNormally) {
        controller.abort();
        await this.cancelRemoteDelivery(
          transport,
          input.handle,
          input.delivery.deliveryId
        );
      }
    }
  }

  private async cancelRemoteDelivery(
    transport: HttpProxyTransportV1,
    handle: RoomSessionRuntimeHandleV1,
    deliveryId: string
  ): Promise<void> {
    try {
      await transport.requestJson({
        path: '/v1/room/sessions/cancel',
        body: {
          schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
          runtimeId: this.descriptor.runtimeId,
          handle,
          deliveryId,
        },
      });
    } catch {
      // Cancellation settlement is best-effort once local iteration ends.
    }
  }

  private envelope(
    handle: RoomSessionRuntimeHandleV1,
    deliveryId: string,
    eventSequence: number,
    event: RoomRuntimeEventPayloadV1
  ): RoomRuntimeEventEnvelopeV1 {
    return {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      envelopeType: 'room.runtime-event',
      eventId: this.createId('event'),
      eventSequence,
      occurredAt: this.now().toISOString(),
      roomSessionId: handle.session.roomSessionId,
      runtimeSessionId: handle.runtimeSessionId,
      deliveryId,
      event,
    };
  }

  private requireTransport(
    operation: HttpProxyRoomOperationV1
  ): HttpProxyTransportV1 {
    if (!this.transport || !this.configurationState.executable) {
      throw new HttpProxyRoomRuntimeUnavailableError(
        operation,
        this.configurationState
      );
    }
    return this.transport;
  }
}

function buildDescriptor(
  config: HttpProxyRoomSessionRuntimeConfigV1
): RoomSessionRuntimeDescriptorV1 {
  return {
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    runtimeId: config.runtimeId?.trim() || HTTP_PROXY_ROOM_RUNTIME_ID_V1,
    displayName: config.displayName?.trim() || 'HTTP Runtime Proxy',
    runtimeVersion:
      config.runtimeVersion?.trim() || HTTP_PROXY_ROOM_RUNTIME_VERSION_V1,
    capabilities: {
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      streaming: config.capabilities?.streaming ?? 'text-delta',
      resume: config.capabilities?.resume ?? 'checkpoint',
      checkpoint: config.capabilities?.checkpoint ?? 'opaque-json',
      typedMentionOutput: config.capabilities?.typedMentionOutput ?? true,
      delegationRequests: config.capabilities?.delegationRequests ?? false,
    },
  };
}

function evaluateConfig(config: HttpProxyRoomSessionRuntimeConfigV1): {
  state: HttpProxyRoomRuntimeConfigurationStateV1;
  normalizedBaseUrl: string;
} {
  if (!config.enabled) {
    return {
      normalizedBaseUrl: '',
      state: {
        state: 'disabled',
        executable: false,
        message: 'The HTTP proxy Room runtime adapter is explicitly disabled.',
        issues: [],
      },
    };
  }

  const issues: HttpProxyRoomRuntimeConfigurationIssueV1[] = [];
  const endpointCheck = validateHttpProxyEndpointV1(config.endpoint, {
    allowRemoteEndpoint: config.allowRemoteEndpoint,
  });
  let normalizedBaseUrl = '';
  if (!endpointCheck.valid) {
    issues.push({
      code: endpointCheck.code,
      field: 'endpoint',
      message: endpointCheck.message,
    });
  } else {
    normalizedBaseUrl = endpointCheck.normalizedBaseUrl;
    if (!endpointCheck.isLoopback && !(config.token?.trim() ?? '')) {
      issues.push({
        code: 'remote-endpoint-requires-token',
        field: 'token',
        message:
          'Non-loopback runtime proxy endpoints require an explicit bearer token.',
      });
    }
  }

  const timeoutMs = config.requestTimeoutMs ?? HTTP_PROXY_DEFAULT_TIMEOUT_MS_V1;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    issues.push({
      code: 'invalid-timeout',
      field: 'requestTimeoutMs',
      message: 'requestTimeoutMs must be a positive integer.',
    });
  }

  if (issues.length > 0) {
    return {
      normalizedBaseUrl: '',
      state: {
        state: 'unavailable',
        executable: false,
        message:
          issues.length === 1
            ? issues[0].message
            : 'The HTTP proxy Room runtime adapter configuration cannot be executed safely.',
        issues,
      },
    };
  }

  return {
    normalizedBaseUrl,
    state: {
      state: 'ready',
      executable: true,
      message: 'The HTTP proxy Room runtime adapter is configured and ready.',
      issues: [],
    },
  };
}

function readRuntimeSessionId(body: unknown): string {
  if (isRecord(body)) {
    if (
      typeof body.runtimeSessionId === 'string' &&
      body.runtimeSessionId.trim().length > 0
    ) {
      return body.runtimeSessionId.trim();
    }
    if (
      isRecord(body.handle) &&
      typeof body.handle.runtimeSessionId === 'string' &&
      body.handle.runtimeSessionId.trim().length > 0
    ) {
      return body.handle.runtimeSessionId.trim();
    }
  }
  throw new Error(
    'Runtime proxy session response must include a non-empty runtimeSessionId.'
  );
}

function readCheckpointState(
  body: unknown,
  token: string | null
): RoomJsonValueV1 {
  const candidate = isRecord(body) ? body.runtimeState : undefined;
  if (candidate === undefined || !isRoomJsonValueV1(candidate)) {
    throw new Error(
      'Runtime proxy checkpoint response must include a valid JSON runtimeState.'
    );
  }
  if (token && JSON.stringify(candidate).includes(token)) {
    throw new Error(
      'Runtime proxy checkpoint state must not embed authentication credentials.'
    );
  }
  return candidate;
}

export function parseRoomEventPayloadV1(
  raw: unknown
): RoomRuntimeEventPayloadV1 {
  const candidate = isRecord(raw) && isRecord(raw.event) ? raw.event : raw;
  if (!isRecord(candidate) || typeof candidate.type !== 'string') {
    throw new Error('Runtime proxy Room event must include a string type.');
  }

  switch (candidate.type) {
    case 'session-ready':
      return { type: 'session-ready' };
    case 'response-started':
      return {
        type: 'response-started',
        responseId: requireNonEmptyString(
          candidate.responseId,
          'response-started.responseId'
        ),
      };
    case 'text-delta':
      if (typeof candidate.text !== 'string') {
        throw new Error('text-delta.text must be a string.');
      }
      return {
        type: 'text-delta',
        responseId: requireNonEmptyString(
          candidate.responseId,
          'text-delta.responseId'
        ),
        text: candidate.text,
      };
    case 'message-ready':
      return {
        type: 'message-ready',
        responseId: requireNonEmptyString(
          candidate.responseId,
          'message-ready.responseId'
        ),
        message: parseOutputDraftV1(candidate.message),
      };
    case 'delegation-requested':
      if (!isRoomDelegationInvocationV1(candidate.invocation)) {
        throw new Error('delegation-requested.invocation is invalid.');
      }
      if (
        candidate.instruction !== undefined &&
        typeof candidate.instruction !== 'string'
      ) {
        throw new Error(
          'delegation-requested.instruction must be a string when present.'
        );
      }
      return {
        type: 'delegation-requested',
        invocation: candidate.invocation,
        ...(candidate.instruction === undefined
          ? {}
          : { instruction: candidate.instruction }),
      };
    case 'delivery-completed':
      if (
        candidate.disposition !== 'responded' &&
        candidate.disposition !== 'observed' &&
        candidate.disposition !== 'ignored'
      ) {
        throw new Error('delivery-completed.disposition is invalid.');
      }
      return {
        type: 'delivery-completed',
        disposition: candidate.disposition,
      };
    case 'error':
      return {
        type: 'error',
        code: requireNonEmptyString(candidate.code, 'error.code'),
        message: requireNonEmptyString(candidate.message, 'error.message'),
        retryable: Boolean(candidate.retryable),
      };
    default:
      throw new Error(
        `Unsupported runtime proxy Room event type: ${candidate.type}`
      );
  }
}

function parseOutputDraftV1(raw: unknown): RoomRuntimeOutputDraftV1 {
  if (!isRecord(raw) || typeof raw.text !== 'string') {
    throw new Error('message-ready.message must include string text.');
  }
  if (
    !Array.isArray(raw.mentions) ||
    !raw.mentions.every((mention) => isRoomAgentMentionV1(mention))
  ) {
    throw new Error('message-ready.message.mentions must be valid mentions.');
  }
  if (
    raw.attachments !== undefined &&
    (!Array.isArray(raw.attachments) ||
      !raw.attachments.every((attachment) => isRoomAttachmentRefV1(attachment)))
  ) {
    throw new Error(
      'message-ready.message.attachments must be valid attachment refs.'
    );
  }
  return {
    text: raw.text,
    mentions: raw.mentions,
    attachments: raw.attachments ?? [],
  };
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function sanitizeErrorMessage(error: unknown, token: string | null): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (token && raw.includes(token)) {
    return 'Runtime proxy request failed.';
  }
  return raw;
}
