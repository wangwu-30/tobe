import {
  RUNTIME_CONTRACT_VERSION_V1,
  type RuntimeDescriptorV1,
  type RuntimeSandboxV1,
  type RuntimeWorkspaceV1,
} from '../contracts';
import type {
  ExecutionRuntimeDriverV1,
  RuntimeArchiveAttemptV1,
  RuntimeArtifactRefV1,
  RuntimeEventV1,
  RuntimeInterruptAttemptV1,
  RuntimeReconcileAttemptV1,
  RuntimeSnapshotV1,
  RuntimeStartAttemptV1,
} from '../driver';

export const OPENHANDS_RUNTIME_ID_V1 = 'openhands';
export const OPENHANDS_DEFAULT_REQUEST_TIMEOUT_MS_V1 = 30_000;

export type OpenHandsRuntimeSandboxV1 = Extract<
  RuntimeSandboxV1,
  'container' | 'remote'
>;

/**
 * Deployment facts must be provided by the caller. In particular, this
 * adapter never reads a process-global endpoint or token and never falls back
 * to request-scoped Pi execution.
 */
export type OpenHandsExecutionRuntimeDriverConfigV1 = {
  enabled: boolean;
  endpoint: string | null;
  token: string | null;
  requestTimeoutMs?: number;
  runtimeId?: string;
  runtimeVersion: string;
  workspace: RuntimeWorkspaceV1;
  sandbox: OpenHandsRuntimeSandboxV1;
  supportedModels?: readonly string[];
  features?: readonly string[];
  selectionPriority?: number;
};

export type OpenHandsRuntimeConfigurationIssueCodeV1 =
  | 'missing-endpoint'
  | 'invalid-endpoint'
  | 'missing-token'
  | 'invalid-timeout'
  | 'unverified-api-contract';

export type OpenHandsRuntimeConfigurationIssueV1 = {
  code: OpenHandsRuntimeConfigurationIssueCodeV1;
  field?: 'endpoint' | 'token' | 'requestTimeoutMs';
  message: string;
};

/**
 * Configuration state is intentionally separate from RuntimeHealthV1. A
 * caller must not turn either state below into a healthy scheduler candidate.
 */
export type OpenHandsRuntimeConfigurationStateV1 = {
  state: 'disabled' | 'unavailable';
  executable: false;
  message: string;
  issues: readonly OpenHandsRuntimeConfigurationIssueV1[];
};

export type OpenHandsRuntimeOperationV1 =
  | 'start'
  | 'interrupt'
  | 'reconcile'
  | 'archive';

/**
 * Raised before any HTTP request when the safe adapter skeleton cannot run an
 * operation. The error never includes the configured token.
 */
export class OpenHandsRuntimeUnavailableError extends Error {
  readonly code = 'openhands-runtime-unavailable' as const;
  readonly operation: OpenHandsRuntimeOperationV1;
  readonly configurationState: OpenHandsRuntimeConfigurationStateV1;

  constructor(
    operation: OpenHandsRuntimeOperationV1,
    configurationState: OpenHandsRuntimeConfigurationStateV1
  ) {
    super(
      `OpenHands runtime operation "${operation}" is ${configurationState.state}: ${configurationState.message} No HTTP request was sent.`
    );
    this.name = 'OpenHandsRuntimeUnavailableError';
    this.operation = operation;
    this.configurationState = configurationState;
  }
}

/**
 * Safe OpenHands adapter boundary.
 *
 * This repository does not currently define one verified OpenHands HTTP API
 * contract: Cloud, Enterprise, and self-hosted Agent Server APIs use different
 * paths and payloads. Consequently, valid endpoint/token configuration is
 * necessary but not sufficient, and this driver remains unavailable until a
 * concrete protocol implementation is added. It must not fabricate attempt
 * ids, events, snapshots, artifacts, or successful HTTP responses.
 */
export class OpenHandsExecutionRuntimeDriverV1
  implements ExecutionRuntimeDriverV1
{
  private readonly descriptor: RuntimeDescriptorV1;
  private readonly configurationState: OpenHandsRuntimeConfigurationStateV1;

  constructor(config: OpenHandsExecutionRuntimeDriverConfigV1) {
    this.descriptor = buildDescriptor(config);
    this.configurationState = buildConfigurationState(config);
  }

  async describe(): Promise<RuntimeDescriptorV1> {
    return this.descriptor;
  }

  getConfigurationState(): OpenHandsRuntimeConfigurationStateV1 {
    return this.configurationState;
  }

  start(input: RuntimeStartAttemptV1): AsyncIterable<RuntimeEventV1> {
    void input;
    throw this.unavailable('start');
  }

  async interrupt(input: RuntimeInterruptAttemptV1): Promise<void> {
    void input;
    throw this.unavailable('interrupt');
  }

  async reconcile(
    input: RuntimeReconcileAttemptV1
  ): Promise<RuntimeSnapshotV1> {
    void input;
    throw this.unavailable('reconcile');
  }

  async archive(
    input: RuntimeArchiveAttemptV1
  ): Promise<readonly RuntimeArtifactRefV1[]> {
    void input;
    throw this.unavailable('archive');
  }

  private unavailable(
    operation: OpenHandsRuntimeOperationV1
  ): OpenHandsRuntimeUnavailableError {
    return new OpenHandsRuntimeUnavailableError(
      operation,
      this.configurationState
    );
  }
}

function buildDescriptor(
  config: OpenHandsExecutionRuntimeDriverConfigV1
): RuntimeDescriptorV1 {
  return {
    schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
    runtimeId: config.runtimeId ?? OPENHANDS_RUNTIME_ID_V1,
    displayName: 'OpenHands',
    runtimeVersion: config.runtimeVersion,
    selectionPriority: config.selectionPriority,
    capabilities: {
      schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
      kinds: ['coding'],
      nativeResume: false,
      checkpoint: false,
      streaming: 'none',
      interrupt: 'none',
      workspace: config.workspace,
      sandbox: config.sandbox,
      structuredArtifacts: false,
      waitingForHuman: false,
      supportedModels: config.supportedModels ?? [],
      features: config.features,
    },
  };
}

function buildConfigurationState(
  config: OpenHandsExecutionRuntimeDriverConfigV1
): OpenHandsRuntimeConfigurationStateV1 {
  if (!config.enabled) {
    return {
      state: 'disabled',
      executable: false,
      message: 'The OpenHands adapter is explicitly disabled.',
      issues: [],
    };
  }

  const issues: OpenHandsRuntimeConfigurationIssueV1[] = [];
  const endpoint = config.endpoint?.trim() ?? '';
  const token = config.token?.trim() ?? '';
  const requestTimeoutMs =
    config.requestTimeoutMs ?? OPENHANDS_DEFAULT_REQUEST_TIMEOUT_MS_V1;

  if (!endpoint) {
    issues.push({
      code: 'missing-endpoint',
      field: 'endpoint',
      message: 'An explicit OpenHands HTTP endpoint is required.',
    });
  } else if (!isSafeHttpEndpoint(endpoint)) {
    issues.push({
      code: 'invalid-endpoint',
      field: 'endpoint',
      message:
        'The OpenHands endpoint must be an absolute HTTP(S) URL without embedded credentials.',
    });
  }

  if (!token) {
    issues.push({
      code: 'missing-token',
      field: 'token',
      message: 'An explicit OpenHands bearer token is required.',
    });
  }

  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    issues.push({
      code: 'invalid-timeout',
      field: 'requestTimeoutMs',
      message: 'OpenHands requestTimeoutMs must be a positive integer.',
    });
  }

  issues.push({
    code: 'unverified-api-contract',
    message:
      'No compatible OpenHands HTTP API contract is implemented; authentication, timeout, HTTP, network, and response errors cannot yet be mapped safely.',
  });

  return {
    state: 'unavailable',
    executable: false,
    message:
      issues.length === 1
        ? issues[0].message
        : 'The OpenHands adapter configuration cannot be executed safely.',
    issues,
  };
}

function isSafeHttpEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}
