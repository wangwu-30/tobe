import { isRecord } from '@/framework/resilience/safe-data';
import {
  createNodeHttpProxyTransportV1,
  HTTP_PROXY_DEFAULT_TIMEOUT_MS_V1,
  HttpProxyTransportError,
  validateHttpProxyEndpointV1,
  type HttpProxyTransportV1,
} from '@/agent/runtime-proxy/http-transport';

import {
  RUNTIME_CONTRACT_VERSION_V1,
  type RuntimeCapabilitiesV1,
  type RuntimeDescriptorV1,
} from '../contracts';
import type {
  ExecutionRuntimeDriverV1,
  RuntimeArchiveAttemptV1,
  RuntimeArtifactRefV1,
  RuntimeAttemptStatusV1,
  RuntimeEventV1,
  RuntimeInterruptAttemptV1,
  RuntimeReconcileAttemptV1,
  RuntimeResumeAttemptV1,
  RuntimeSnapshotV1,
  RuntimeStartAttemptV1,
} from '../driver';

export type HttpProxyExecutionRuntimeDriverConfigV1 = {
  enabled: boolean;
  endpoint: string | null;
  token?: string | null;
  allowRemoteEndpoint?: boolean;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  runtimeId: string;
  displayName?: string;
  runtimeVersion: string;
  capabilities: Omit<RuntimeCapabilitiesV1, 'schemaVersion'>;
  selectionPriority?: number;
  /** Optional transport override for deterministic testing. */
  transport?: HttpProxyTransportV1;
};

export type HttpProxyRuntimeConfigurationIssueCodeV1 =
  | 'missing-endpoint'
  | 'invalid-endpoint'
  | 'remote-endpoint-disallowed'
  | 'remote-endpoint-requires-https'
  | 'remote-endpoint-requires-token'
  | 'invalid-timeout'
  | 'invalid-runtime-id';

export type HttpProxyRuntimeConfigurationIssueV1 = {
  code: HttpProxyRuntimeConfigurationIssueCodeV1;
  field?: 'endpoint' | 'token' | 'requestTimeoutMs' | 'runtimeId';
  message: string;
};

export type HttpProxyRuntimeConfigurationStateV1 =
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
      issues: readonly HttpProxyRuntimeConfigurationIssueV1[];
    };

export type HttpProxyExecutionOperationV1 =
  | 'start'
  | 'resume'
  | 'interrupt'
  | 'reconcile'
  | 'archive';

export class HttpProxyRuntimeUnavailableError extends Error {
  readonly code = 'http-proxy-runtime-unavailable' as const;
  readonly operation: HttpProxyExecutionOperationV1;
  readonly configurationState: HttpProxyRuntimeConfigurationStateV1;

  constructor(
    operation: HttpProxyExecutionOperationV1,
    configurationState: HttpProxyRuntimeConfigurationStateV1
  ) {
    super(
      `HTTP proxy runtime operation "${operation}" is ${configurationState.state}: ${configurationState.message}`
    );
    this.name = 'HttpProxyRuntimeUnavailableError';
    this.operation = operation;
    this.configurationState = configurationState;
  }
}

export class HttpProxyProtocolError extends Error {
  readonly code = 'http-proxy-protocol-error' as const;

  constructor(message: string) {
    super(message);
    this.name = 'HttpProxyProtocolError';
  }
}

/**
 * Opt-in, fail-closed ExecutionRuntimeDriverV1 adapter targeting an external
 * unified runtime proxy (e.g. a local loopback HTTP/NDJSON sidecar).
 *
 * The proxy only reports runtime events, snapshots, and artifact refs. Durable
 * job/attempt state, generation fencing, and knowledge workspace isolation
 * remain strictly inside the tobe control plane.
 */
export class HttpProxyExecutionRuntimeDriverV1
  implements ExecutionRuntimeDriverV1
{
  private readonly descriptor: RuntimeDescriptorV1;
  private readonly configurationState: HttpProxyRuntimeConfigurationStateV1;
  private readonly transport: HttpProxyTransportV1 | null;

  constructor(config: HttpProxyExecutionRuntimeDriverConfigV1) {
    this.descriptor = buildDescriptor(config);
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

  async describe(): Promise<RuntimeDescriptorV1> {
    return this.descriptor;
  }

  getConfigurationState(): HttpProxyRuntimeConfigurationStateV1 {
    return this.configurationState;
  }

  start(input: RuntimeStartAttemptV1): AsyncIterable<RuntimeEventV1> {
    const transport = this.requireTransport('start');
    if (input.workspace !== undefined) {
      assertHostlessFileUri(input.workspace.uri);
    }
    return this.streamValidatedEvents(
      transport,
      '/v1/execution/attempts/start',
      {
        schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
        runtimeId: this.descriptor.runtimeId,
        ...input,
      }
    );
  }

  resume(input: RuntimeResumeAttemptV1): AsyncIterable<RuntimeEventV1> {
    const transport = this.requireTransport('resume');
    if (!this.descriptor.capabilities.nativeResume) {
      throw new HttpProxyProtocolError(
        `HTTP proxy runtime ${this.descriptor.runtimeId} does not advertise nativeResume.`
      );
    }
    return this.streamValidatedEvents(
      transport,
      '/v1/execution/attempts/resume',
      {
        schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
        runtimeId: this.descriptor.runtimeId,
        ...input,
      }
    );
  }

  async interrupt(input: RuntimeInterruptAttemptV1): Promise<void> {
    const transport = this.requireTransport('interrupt');
    await transport.requestJson({
      path: '/v1/execution/attempts/interrupt',
      body: {
        schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
        runtimeId: this.descriptor.runtimeId,
        ...input,
      },
    });
  }

  async reconcile(
    input: RuntimeReconcileAttemptV1
  ): Promise<RuntimeSnapshotV1> {
    const transport = this.requireTransport('reconcile');
    const response = await transport.requestJson({
      path: '/v1/execution/attempts/reconcile',
      body: {
        schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
        runtimeId: this.descriptor.runtimeId,
        ...input,
      },
    });
    return parseRuntimeSnapshotV1(response.body);
  }

  async archive(
    input: RuntimeArchiveAttemptV1
  ): Promise<readonly RuntimeArtifactRefV1[]> {
    const transport = this.requireTransport('archive');
    const response = await transport.requestJson({
      path: '/v1/execution/attempts/archive',
      body: {
        schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
        runtimeId: this.descriptor.runtimeId,
        ...input,
      },
    });
    return parseRuntimeArtifactsV1(response.body);
  }

  private requireTransport(
    operation: HttpProxyExecutionOperationV1
  ): HttpProxyTransportV1 {
    if (!this.transport || !this.configurationState.executable) {
      throw new HttpProxyRuntimeUnavailableError(
        operation,
        this.configurationState
      );
    }
    return this.transport;
  }

  private async *streamValidatedEvents(
    transport: HttpProxyTransportV1,
    path: string,
    body: unknown
  ): AsyncIterable<RuntimeEventV1> {
    const controller = new AbortController();
    let terminalSeen = false;
    try {
      for await (const raw of transport.streamNdjson({
        path,
        body,
        signal: controller.signal,
      })) {
        if (terminalSeen) {
          throw new HttpProxyProtocolError(
            'Runtime proxy emitted an event after attempt-completed.'
          );
        }
        const event = parseRuntimeEventV1(raw);
        if (event.type === 'attempt-completed') {
          terminalSeen = true;
        }
        yield event;
      }
    } catch (error) {
      if (
        controller.signal.aborted &&
        error instanceof HttpProxyTransportError &&
        error.code === 'proxy-request-aborted'
      ) {
        return;
      }
      throw error;
    } finally {
      controller.abort();
    }
  }
}

function buildDescriptor(
  config: HttpProxyExecutionRuntimeDriverConfigV1
): RuntimeDescriptorV1 {
  return {
    schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
    runtimeId: config.runtimeId.trim() || 'http-proxy',
    displayName: config.displayName?.trim() || 'HTTP Runtime Proxy',
    runtimeVersion: config.runtimeVersion,
    selectionPriority: config.selectionPriority,
    capabilities: {
      schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
      ...config.capabilities,
      kinds: [...config.capabilities.kinds],
      supportedModels: [...config.capabilities.supportedModels],
      ...(config.capabilities.features
        ? { features: [...config.capabilities.features] }
        : {}),
    },
  };
}

function evaluateConfig(config: HttpProxyExecutionRuntimeDriverConfigV1): {
  state: HttpProxyRuntimeConfigurationStateV1;
  normalizedBaseUrl: string;
} {
  if (!config.enabled) {
    return {
      normalizedBaseUrl: '',
      state: {
        state: 'disabled',
        executable: false,
        message: 'The HTTP runtime proxy adapter is explicitly disabled.',
        issues: [],
      },
    };
  }

  const issues: HttpProxyRuntimeConfigurationIssueV1[] = [];
  if (!config.runtimeId.trim()) {
    issues.push({
      code: 'invalid-runtime-id',
      field: 'runtimeId',
      message: 'A non-empty runtimeId is required.',
    });
  }

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

  const requestTimeoutMs =
    config.requestTimeoutMs ?? HTTP_PROXY_DEFAULT_TIMEOUT_MS_V1;
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
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
            : 'The HTTP runtime proxy adapter configuration cannot be executed safely.',
        issues,
      },
    };
  }

  return {
    normalizedBaseUrl,
    state: {
      state: 'ready',
      executable: true,
      message: 'The HTTP runtime proxy adapter is configured and ready.',
      issues: [],
    },
  };
}

function assertHostlessFileUri(uri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new HttpProxyProtocolError(
      'Workspace URI must be a valid hostless file: URL.'
    );
  }
  if (parsed.protocol !== 'file:' || parsed.hostname !== '') {
    throw new HttpProxyProtocolError(
      'Workspace URI must use a hostless local file: scheme.'
    );
  }
}

const VALID_ATTEMPT_STATUSES = new Set<RuntimeAttemptStatusV1>([
  'starting',
  'running',
  'waiting-for-human',
  'succeeded',
  'failed',
  'interrupted',
  'unknown',
]);

export function parseRuntimeEventV1(raw: unknown): RuntimeEventV1 {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    throw new HttpProxyProtocolError(
      'Runtime proxy event must be an object with a string type.'
    );
  }

  switch (raw.type) {
    case 'attempt-started': {
      const runtimeAttemptId = requireNonEmptyString(
        raw.runtimeAttemptId,
        'attempt-started.runtimeAttemptId'
      );
      return { type: 'attempt-started', runtimeAttemptId };
    }
    case 'text-delta': {
      if (typeof raw.text !== 'string') {
        throw new HttpProxyProtocolError(
          'text-delta.text must be a string.'
        );
      }
      return { type: 'text-delta', text: raw.text };
    }
    case 'progress': {
      if (typeof raw.message !== 'string') {
        throw new HttpProxyProtocolError('progress.message must be a string.');
      }
      if (
        raw.percent !== undefined &&
        (typeof raw.percent !== 'number' ||
          !Number.isFinite(raw.percent) ||
          raw.percent < 0 ||
          raw.percent > 100)
      ) {
        throw new HttpProxyProtocolError(
          'progress.percent must be a finite number between 0 and 100.'
        );
      }
      return {
        type: 'progress',
        message: raw.message,
        ...(raw.percent === undefined ? {} : { percent: raw.percent }),
      };
    }
    case 'checkpoint': {
      const checkpointRef = requireNonEmptyString(
        raw.checkpointRef,
        'checkpoint.checkpointRef'
      );
      return { type: 'checkpoint', checkpointRef };
    }
    case 'artifact': {
      return {
        type: 'artifact',
        artifact: parseRuntimeArtifactRefV1(raw.artifact),
      };
    }
    case 'waiting-for-human': {
      const requestId = requireNonEmptyString(
        raw.requestId,
        'waiting-for-human.requestId'
      );
      const prompt = requireNonEmptyString(
        raw.prompt,
        'waiting-for-human.prompt'
      );
      return { type: 'waiting-for-human', requestId, prompt };
    }
    case 'attempt-completed': {
      if (
        raw.status !== 'succeeded' &&
        raw.status !== 'failed' &&
        raw.status !== 'interrupted'
      ) {
        throw new HttpProxyProtocolError(
          'attempt-completed.status must be succeeded, failed, or interrupted.'
        );
      }
      if (raw.message !== undefined && typeof raw.message !== 'string') {
        throw new HttpProxyProtocolError(
          'attempt-completed.message must be a string when present.'
        );
      }
      return {
        type: 'attempt-completed',
        status: raw.status,
        ...(raw.message === undefined ? {} : { message: raw.message }),
      };
    }
    default:
      throw new HttpProxyProtocolError(
        `Unsupported runtime proxy event type: ${raw.type}`
      );
  }
}

export function parseRuntimeSnapshotV1(raw: unknown): RuntimeSnapshotV1 {
  if (!isRecord(raw)) {
    throw new HttpProxyProtocolError(
      'Runtime proxy reconcile snapshot must be an object.'
    );
  }
  const runtimeAttemptId = requireNonEmptyString(
    raw.runtimeAttemptId,
    'snapshot.runtimeAttemptId'
  );
  if (
    typeof raw.status !== 'string' ||
    !VALID_ATTEMPT_STATUSES.has(raw.status as RuntimeAttemptStatusV1)
  ) {
    throw new HttpProxyProtocolError('snapshot.status is invalid.');
  }
  if (raw.checkpointRef !== undefined && typeof raw.checkpointRef !== 'string') {
    throw new HttpProxyProtocolError(
      'snapshot.checkpointRef must be a string when present.'
    );
  }
  if (raw.message !== undefined && typeof raw.message !== 'string') {
    throw new HttpProxyProtocolError(
      'snapshot.message must be a string when present.'
    );
  }
  return {
    runtimeAttemptId,
    status: raw.status as RuntimeAttemptStatusV1,
    ...(raw.checkpointRef === undefined
      ? {}
      : { checkpointRef: raw.checkpointRef }),
    ...(raw.message === undefined ? {} : { message: raw.message }),
  };
}

export function parseRuntimeArtifactsV1(
  raw: unknown
): readonly RuntimeArtifactRefV1[] {
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.artifacts)
      ? raw.artifacts
      : null;
  if (!list) {
    throw new HttpProxyProtocolError(
      'Runtime proxy archive response must be an artifact array or { artifacts }.'
    );
  }
  return list.map((item) => parseRuntimeArtifactRefV1(item));
}

function parseRuntimeArtifactRefV1(raw: unknown): RuntimeArtifactRefV1 {
  if (!isRecord(raw)) {
    throw new HttpProxyProtocolError('Artifact reference must be an object.');
  }
  const artifactId = requireNonEmptyString(
    raw.artifactId,
    'artifact.artifactId'
  );
  const kind = requireNonEmptyString(raw.kind, 'artifact.kind');
  const uri = requireNonEmptyString(raw.uri, 'artifact.uri');
  if (raw.mediaType !== undefined && typeof raw.mediaType !== 'string') {
    throw new HttpProxyProtocolError(
      'artifact.mediaType must be a string when present.'
    );
  }
  return {
    artifactId,
    kind,
    uri,
    ...(raw.mediaType === undefined ? {} : { mediaType: raw.mediaType }),
  };
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpProxyProtocolError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
