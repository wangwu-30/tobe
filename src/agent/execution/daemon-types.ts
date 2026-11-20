import type { ExecutionSpecV1 } from './contracts';
import type {
  ExecutionRuntimeDriverV1,
  RuntimeEventV1,
  RuntimeHumanInputV1,
} from './driver';
import type { ExecutionRuntimeDriverRegistryV1 } from './registry';
import type {
  FrozenKnowledgeBindingV1,
  WorkspaceLifecycleV1,
  WorkspaceRuntimeCompletionV1,
} from './workspace-lifecycle';

export const EXECUTION_DAEMON_DEFAULTS_V1 = {
  heartbeatIntervalMs: 10_000,
  leaseDurationMs: 30_000,
  maxConcurrentAttempts: 1,
  pollBatchSize: 10,
  pollIntervalMs: 1_000,
} as const;

export type ExecutionDaemonJsonValueV1 =
  | boolean
  | number
  | string
  | null
  | readonly ExecutionDaemonJsonValueV1[]
  | { readonly [key: string]: ExecutionDaemonJsonValueV1 };

export type ExecutionDaemonCandidateV1 = {
  attemptId: string;
  runtimeId: string;
};

/**
 * The durable input returned after a successful claim. The store adapter is
 * responsible for loading the frozen Job spec and context in the same
 * organization scope as the claim.
 */
export type ExecutionDaemonClaimV1 = {
  jobId: string;
  attemptId: string;
  attemptNumber: number;
  runtimeId: string;
  generation: number;
  cancelRequested: boolean;
  executionSpec: ExecutionSpecV1;
  contextManifest: unknown;
  /** Private control-plane input. It must never cross the runtime boundary. */
  knowledgeWorkspace?: {
    binding: FrozenKnowledgeBindingV1;
    repositoryPath: string;
  } | null;
  /** Private durable receipt. It must never cross the runtime boundary. */
  workspaceLifecycle?: WorkspaceLifecycleV1 | null;
  workspace?: {
    uri: string;
    revision?: string;
  };
  runtimeRunId?: string | null;
  checkpointRef?: string | null;
  humanInput?: RuntimeHumanInputV1 | null;
};

export type ListExecutionDaemonCandidatesInputV1 = {
  runtimeIds: readonly string[];
  limit: number;
  now: Date;
};

export type ClaimExecutionDaemonCandidateInputV1 = {
  attemptId: string;
  runtimeId: string;
  workerId: string;
  leaseDurationMs: number;
};

export type HeartbeatExecutionDaemonAttemptInputV1 = {
  attemptId: string;
  workerId: string;
  generation: number;
  leaseDurationMs: number;
  checkpointRef?: string;
  runtimeRunId?: string;
};

export type AppendExecutionDaemonEventInputV1 = {
  attemptId: string;
  workerId: string;
  generation: number;
  runtimeEventId: string;
  event: RuntimeEventV1;
  occurredAt: Date;
};

export type PersistExecutionDaemonWorkspaceLifecycleInputV1 = {
  attemptId: string;
  workerId: string;
  generation: number;
  lifecycle: WorkspaceLifecycleV1;
};

export type PersistExecutionDaemonTerminalEventInputV1 = {
  attemptId: string;
  workerId: string;
  generation: number;
  runtimeEventId: string;
  event: Extract<RuntimeEventV1, { type: 'attempt-completed' }>;
  runtimeCompletion: WorkspaceRuntimeCompletionV1;
  occurredAt: Date;
};

export type CreateExecutionDaemonKnowledgeChangeRequestInputV1 = {
  attemptId: string;
  workerId: string;
  generation: number;
  binding: FrozenKnowledgeBindingV1;
  prepared: WorkspaceLifecycleV1['prepared'];
  finalized: NonNullable<WorkspaceLifecycleV1['finalized']>;
};

export type CreateExecutionDaemonKnowledgeChangeRequestResultV1 = {
  changeRequest: { id: string };
};

export type CompleteExecutionDaemonAttemptInputV1 = {
  attemptId: string;
  workerId: string;
  generation: number;
  status: 'succeeded' | 'failed' | 'cancelled';
  result?: ExecutionDaemonJsonValueV1;
  error?: ExecutionDaemonJsonValueV1;
  runtimeRunId?: string;
};

export type ExecutionDaemonRecoveryStageV1 =
  | 'prepare'
  | 'finalize'
  | 'cleanup';

export type ExecutionDaemonRecoveryClassificationV1 =
  | 'absent'
  | 'prepared-clean'
  | 'prepared-dirty'
  | 'finalized-clean'
  | 'drifted'
  | 'partial'
  | 'unknown';

export type RequestedExecutionDaemonRecoveryActionV1 = {
  incidentId: string;
  action: 'retry' | 'discard';
  cancelRequested: boolean;
};

export type QuarantineExecutionDaemonRecoveryInputV1 = {
  attemptId: string;
  workerId: string;
  generation: number;
  stage: ExecutionDaemonRecoveryStageV1;
  reasonCode: string;
  classification: ExecutionDaemonRecoveryClassificationV1;
  discardable: boolean;
};

export type ResolveExecutionDaemonRecoveryInputV1 = {
  incidentId: string;
  attemptId: string;
  workerId: string;
  generation: number;
  resolution: 'retried' | 'discarded';
};

export interface ExecutionDaemonStoreV1 {
  listCandidates(
    input: ListExecutionDaemonCandidatesInputV1
  ): Promise<readonly ExecutionDaemonCandidateV1[]>;

  /** Returns null when another worker won the claim race. */
  claim(
    input: ClaimExecutionDaemonCandidateInputV1
  ): Promise<ExecutionDaemonClaimV1 | null>;

  heartbeat(
    input: HeartbeatExecutionDaemonAttemptInputV1
  ): Promise<'renewed' | 'cancel-requested' | 'fenced'>;

  /**
   * Persists every driver event before the daemon acts on it. In particular,
   * implementations should checkpoint atomically with a checkpoint event.
   */
  appendEvent(
    input: AppendExecutionDaemonEventInputV1
  ): Promise<'appended' | 'suspended' | 'fenced'>;

  /** Required only for claims with a private knowledge workspace. */
  persistWorkspaceLifecycle?(
    input: PersistExecutionDaemonWorkspaceLifecycleInputV1
  ): Promise<'persisted' | 'fenced'>;

  /** Required only for claims with a private knowledge workspace. */
  persistTerminalEvent?(
    input: PersistExecutionDaemonTerminalEventInputV1
  ): Promise<'appended' | 'fenced'>;

  /** Required only when a finalized knowledge workspace contains changes. */
  createKnowledgeChangeRequest?(
    input: CreateExecutionDaemonKnowledgeChangeRequestInputV1
  ): Promise<
    CreateExecutionDaemonKnowledgeChangeRequestResultV1 | 'fenced'
  >;

  quarantineWorkspaceRecovery?(
    input: QuarantineExecutionDaemonRecoveryInputV1
  ): Promise<'quarantined' | 'fenced'>;

  getRequestedRecoveryAction?(input: {
    attemptId: string;
    workerId: string;
    generation: number;
  }): Promise<RequestedExecutionDaemonRecoveryActionV1 | null | 'fenced'>;

  resolveRecoveryAction?(
    input: ResolveExecutionDaemonRecoveryInputV1
  ): Promise<'resolved' | 'fenced'>;

  complete(
    input: CompleteExecutionDaemonAttemptInputV1
  ): Promise<'completed' | 'fenced'>;
}

export type ExecutionDaemonDriverRegistryV1 = Pick<
  ExecutionRuntimeDriverRegistryV1,
  'list' | 'lookup'
>;

export type ExecutionDaemonWorkspacePrepareInputV1 = {
  jobId: string;
  attemptId: string;
  attemptNumber: number;
  binding: FrozenKnowledgeBindingV1;
  repositoryPath: string;
  existingLifecycle: WorkspaceLifecycleV1 | null;
};

export type ExecutionDaemonWorkspacePrepareResultV1 = {
  lifecycle: WorkspaceLifecycleV1;
  workspace: { uri: string; revision: string };
};

/**
 * Privileged workspace operations are injected per runtime deployment. The
 * daemon depends on this structural contract, never a concrete Git adapter.
 */
export interface ExecutionDaemonWorkspaceCoordinatorV1 {
  prepareOrRecover(
    input: ExecutionDaemonWorkspacePrepareInputV1
  ): Promise<ExecutionDaemonWorkspacePrepareResultV1>;
  finalizeOrRecover(
    lifecycle: WorkspaceLifecycleV1
  ): Promise<WorkspaceLifecycleV1>;
  cleanupOrRecover(input: {
    lifecycle: WorkspaceLifecycleV1;
    cleanedAt: string;
  }): Promise<WorkspaceLifecycleV1>;
  inspectRecoveryState?(lifecycle: WorkspaceLifecycleV1): Promise<{
    schemaVersion: 1;
    state:
      | 'absent'
      | 'prepared-clean'
      | 'prepared-dirty'
      | 'finalized-clean'
      | 'drifted';
  }>;
  recoverSuspended?(
    lifecycle: WorkspaceLifecycleV1
  ): Promise<ExecutionDaemonWorkspacePrepareResultV1>;
  discardQuarantined?(lifecycle: WorkspaceLifecycleV1): Promise<void>;
}

export interface ExecutionDaemonClockV1 {
  now(): Date;
}

export type ExecutionDaemonWaitV1 = (
  durationMs: number,
  signal: AbortSignal
) => Promise<void>;

export type ExecutionDaemonLogContextV1 = Readonly<
  Record<string, unknown>
>;

export interface ExecutionDaemonLoggerV1 {
  debug(message: string, context?: ExecutionDaemonLogContextV1): void;
  info(message: string, context?: ExecutionDaemonLogContextV1): void;
  warn(message: string, context?: ExecutionDaemonLogContextV1): void;
  error(message: string, context?: ExecutionDaemonLogContextV1): void;
}

export type ExecutionDaemonOptionsV1 = {
  workerId: string;
  store: ExecutionDaemonStoreV1;
  registry: ExecutionDaemonDriverRegistryV1;
  clock: ExecutionDaemonClockV1;
  wait: ExecutionDaemonWaitV1;
  logger: ExecutionDaemonLoggerV1;
  workspaceCoordinators?: ReadonlyMap<
    string,
    ExecutionDaemonWorkspaceCoordinatorV1
  >;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  leaseDurationMs?: number;
  pollBatchSize?: number;
  maxConcurrentAttempts?: number;
};

export type ExecutionDaemonStateV1 =
  | 'idle'
  | 'running'
  | 'draining'
  | 'stopped';

export type RuntimeCompletionV1 = Pick<
  CompleteExecutionDaemonAttemptInputV1,
  'status' | 'result' | 'error'
> & { runtimeRunId?: string };

export type DeferredV1 = {
  promise: Promise<void>;
  resolve(): void;
};

export type ActiveExecutionAttemptV1 = {
  claim: ExecutionDaemonClaimV1;
  driver: ExecutionRuntimeDriverV1;
  runtimeRunId?: string;
  checkpointRef?: string;
  workspaceLifecycle: WorkspaceLifecycleV1 | null;
  recoveredWorkspace?: ExecutionDaemonWorkspacePrepareResultV1;
  pendingRecoveryResolution?: { incidentId: string };
  runtimeCompletion?: RuntimeCompletionV1;
  runtimeFinished: boolean;
  cancelRequested: boolean;
  text: string;
  truncated: boolean;
  eventSequence: number;
  allowComplete: boolean;
  completing: boolean;
  completed: boolean;
  suspensionPending: boolean;
  suspended: boolean;
  heartbeatController: AbortController;
  stop: DeferredV1;
  iterator?: AsyncIterator<RuntimeEventV1>;
  interruptPromise?: Promise<void>;
  cancellationPromise?: Promise<void>;
  done: Promise<void>;
};
