import type { ExecutionSpecV1 } from './contracts';
import type {
  ExecutionRuntimeDriverV1,
  RuntimeHumanInputV1,
  RuntimeEventV1,
} from './driver';
import type { ExecutionRuntimeDriverRegistryV1 } from './registry';
import {
  parseWorkspaceLifecycleV1,
  type FrozenKnowledgeBindingV1,
  type WorkspaceLifecycleV1,
  type WorkspaceRuntimeCompletionV1,
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

type ExecutionDaemonStateV1 =
  | 'idle'
  | 'running'
  | 'draining'
  | 'stopped';

type RuntimeCompletionV1 = Pick<
  CompleteExecutionDaemonAttemptInputV1,
  'status' | 'result' | 'error'
> & { runtimeRunId?: string };

type DeferredV1 = {
  promise: Promise<void>;
  resolve(): void;
};

type ActiveExecutionAttemptV1 = {
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

/**
 * Runtime-neutral worker loop for durable ExecutionAttempts.
 *
 * The daemon deliberately knows nothing about Prisma or process lifecycle. A
 * composition root supplies an organization-scoped store and decides how to
 * map database conflicts to the explicit `fenced` results above.
 */
export class ExecutionDaemonV1 {
  private readonly workerId: string;
  private readonly store: ExecutionDaemonStoreV1;
  private readonly registry: ExecutionDaemonDriverRegistryV1;
  private readonly clock: ExecutionDaemonClockV1;
  private readonly wait: ExecutionDaemonWaitV1;
  private readonly logger: ExecutionDaemonLoggerV1;
  private readonly workspaceCoordinators: ReadonlyMap<
    string,
    ExecutionDaemonWorkspaceCoordinatorV1
  >;
  private readonly pollIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly leaseDurationMs: number;
  private readonly pollBatchSize: number;
  private readonly maxConcurrentAttempts: number;

  private state: ExecutionDaemonStateV1 = 'idle';
  private runPromise: Promise<void> | null = null;
  private pollWaitController: AbortController | null = null;
  private readonly activeAttempts = new Map<
    string,
    ActiveExecutionAttemptV1
  >();

  constructor(options: ExecutionDaemonOptionsV1) {
    this.workerId = requireNonEmptyText(options.workerId, 'workerId');
    this.store = options.store;
    this.registry = options.registry;
    this.clock = options.clock;
    this.wait = options.wait;
    this.logger = options.logger;
    this.workspaceCoordinators =
      options.workspaceCoordinators ?? new Map();
    this.pollIntervalMs = readPositiveInteger(
      options.pollIntervalMs ??
        EXECUTION_DAEMON_DEFAULTS_V1.pollIntervalMs,
      'pollIntervalMs'
    );
    this.heartbeatIntervalMs = readPositiveInteger(
      options.heartbeatIntervalMs ??
        EXECUTION_DAEMON_DEFAULTS_V1.heartbeatIntervalMs,
      'heartbeatIntervalMs'
    );
    this.leaseDurationMs = readPositiveInteger(
      options.leaseDurationMs ??
        EXECUTION_DAEMON_DEFAULTS_V1.leaseDurationMs,
      'leaseDurationMs'
    );
    this.pollBatchSize = readPositiveInteger(
      options.pollBatchSize ??
        EXECUTION_DAEMON_DEFAULTS_V1.pollBatchSize,
      'pollBatchSize'
    );
    this.maxConcurrentAttempts = readPositiveInteger(
      options.maxConcurrentAttempts ??
        EXECUTION_DAEMON_DEFAULTS_V1.maxConcurrentAttempts,
      'maxConcurrentAttempts'
    );

    if (this.heartbeatIntervalMs > this.leaseDurationMs / 3) {
      throw new Error(
        'heartbeatIntervalMs must not exceed one third of leaseDurationMs.'
      );
    }
  }

  get activeAttemptCount(): number {
    return this.activeAttempts.size;
  }

  get isDraining(): boolean {
    return this.state === 'draining';
  }

  /** Runs until drain() is requested. A daemon instance is single-use. */
  run(): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error('ExecutionDaemonV1 can only be run once.');
    }

    this.state = 'running';
    this.runPromise = this.runLoop().finally(() => {
      this.state = 'stopped';
      this.pollWaitController = null;
    });
    return this.runPromise;
  }

  /** Wakes an idle poll without changing daemon state. */
  wake(): void {
    this.pollWaitController?.abort();
  }

  /**
   * Stops new polls and claims, while active attempts retain their heartbeats
   * and may complete normally.
   */
  async drain(): Promise<void> {
    if (this.state === 'idle') {
      this.state = 'stopped';
      return;
    }
    if (this.state === 'stopped') {
      return;
    }

    this.state = 'draining';
    this.wake();
    await this.runPromise;
  }

  /**
   * Force-interrupts current drivers and abandons their leases. This never
   * completes the attempts; a later claim receives a higher generation.
   */
  async interruptActive(
    reason = 'execution-daemon-forced-shutdown'
  ): Promise<void> {
    if (this.state === 'running') {
      this.state = 'draining';
      this.wake();
    }
    const interrupts = Array.from(
      this.activeAttempts.values(),
      (active) => this.abandonAttempt(active, reason, 'forced')
    );
    await Promise.allSettled(interrupts);
  }

  private async runLoop(): Promise<void> {
    while (this.state === 'running') {
      await this.pollOnce();
      if (this.state !== 'running') {
        break;
      }
      await this.waitForNextPoll();
    }

    await this.waitForActiveAttempts();
  }

  private async pollOnce(): Promise<void> {
    const freeSlots =
      this.maxConcurrentAttempts - this.activeAttempts.size;
    if (freeSlots <= 0 || this.state !== 'running') {
      return;
    }

    const runtimeIds = await this.listRegisteredRuntimeIds();
    if (runtimeIds.length === 0 || this.state !== 'running') {
      return;
    }

    let candidates: readonly ExecutionDaemonCandidateV1[];
    try {
      candidates = await this.store.listCandidates({
        runtimeIds,
        limit: Math.min(freeSlots, this.pollBatchSize),
        now: this.clock.now(),
      });
    } catch (error) {
      this.logger.error('Execution daemon candidate poll failed.', {
        error: errorMessage(error),
        workerId: this.workerId,
      });
      return;
    }

    for (const candidate of candidates) {
      if (
        this.state !== 'running' ||
        this.activeAttempts.size >= this.maxConcurrentAttempts
      ) {
        break;
      }
      if (this.activeAttempts.has(candidate.attemptId)) {
        continue;
      }

      const driver = this.registry.lookup(candidate.runtimeId);
      if (!driver) {
        this.logger.warn(
          'Execution daemon skipped a candidate with no registered driver.',
          candidate
        );
        continue;
      }

      let claim: ExecutionDaemonClaimV1 | null;
      try {
        claim = await this.store.claim({
          attemptId: candidate.attemptId,
          runtimeId: candidate.runtimeId,
          workerId: this.workerId,
          leaseDurationMs: this.leaseDurationMs,
        });
      } catch (error) {
        this.logger.warn('Execution daemon claim failed.', {
          attemptId: candidate.attemptId,
          error: errorMessage(error),
          runtimeId: candidate.runtimeId,
          workerId: this.workerId,
        });
        continue;
      }

      if (!claim) {
        this.logger.debug('Execution daemon lost a claim race.', {
          attemptId: candidate.attemptId,
          runtimeId: candidate.runtimeId,
          workerId: this.workerId,
        });
        continue;
      }

      const claimedDriver = this.registry.lookup(claim.runtimeId);
      if (!claimedDriver) {
        await this.failClaimWithoutDriver(claim);
        continue;
      }
      this.launchAttempt(claim, claimedDriver);
    }
  }

  private async listRegisteredRuntimeIds(): Promise<readonly string[]> {
    const descriptions = await Promise.allSettled(
      this.registry.list().map(async (driver) => driver.describe())
    );
    const runtimeIds: string[] = [];
    for (const description of descriptions) {
      if (description.status === 'fulfilled') {
        runtimeIds.push(description.value.runtimeId);
      } else {
        this.logger.error(
          'Execution daemon could not describe a registered driver.',
          { error: errorMessage(description.reason) }
        );
      }
    }
    return runtimeIds;
  }

  private launchAttempt(
    claim: ExecutionDaemonClaimV1,
    driver: ExecutionRuntimeDriverV1
  ): void {
    const active: ActiveExecutionAttemptV1 = {
      claim,
      driver,
      runtimeRunId: undefined,
      checkpointRef: undefined,
      workspaceLifecycle: claim.workspaceLifecycle ?? null,
      runtimeCompletion:
        claim.workspaceLifecycle?.runtimeCompletion ?? undefined,
      runtimeFinished:
        claim.workspaceLifecycle?.runtimeCompletion !== undefined,
      cancelRequested: claim.cancelRequested,
      text: '',
      truncated: false,
      eventSequence: 0,
      allowComplete: true,
      completing: false,
      completed: false,
      suspensionPending: false,
      suspended: false,
      heartbeatController: new AbortController(),
      stop: createDeferred(),
      done: Promise.resolve(),
    };
    this.activeAttempts.set(claim.attemptId, active);

    active.done = this.executeAttempt(active)
      .catch((error) => {
        this.logger.error('Execution daemon attempt crashed.', {
          attemptId: claim.attemptId,
          error: errorMessage(error),
          generation: claim.generation,
          runtimeId: claim.runtimeId,
        });
      })
      .finally(() => {
        this.activeAttempts.delete(claim.attemptId);
        this.wake();
      });
  }

  private async executeAttempt(
    active: ActiveExecutionAttemptV1
  ): Promise<void> {
    // The first renewal is a handshake: no privileged prepare or runtime work
    // starts until ownership and cancellation intent have been re-observed.
    await this.heartbeatOnce(active);
    if (!active.allowComplete) return;

    const heartbeat = this.runHeartbeat(active);
    try {
      if (!(await this.applyRequestedRecoveryAction(active))) return;
      if (active.claim.knowledgeWorkspace) {
        await this.executeWorkspaceAttempt(active);
      } else {
        if (active.claim.workspaceLifecycle) {
          throw new Error(
            'A workspace lifecycle was claimed without its private knowledge workspace.'
          );
        }
        await this.executeNonWorkspaceAttempt(active);
      }
    } finally {
      // Heartbeats cover every lifecycle stage, including the final complete
      // write. Forced shutdown/fencing also reaches this outermost boundary.
      active.heartbeatController.abort();
      await heartbeat;
    }
  }

  private async executeNonWorkspaceAttempt(
    active: ActiveExecutionAttemptV1
  ): Promise<void> {
    let completion: RuntimeCompletionV1 | null = null;
    if (active.cancelRequested) {
      await this.requestCancellation(active);
      completion = await this.persistSyntheticCancellation(active, false);
    } else {
      try {
        completion = await this.consumeRuntime(
          active,
          active.claim.workspace,
          false
        );
      } catch (error) {
        if (active.allowComplete && !active.cancelRequested) {
          this.logRuntimeFailure(active, error);
          await this.interruptDriver(active, 'runtime-attempt-failed');
          completion = runtimeDriverFailure(error);
        }
      }
      if (active.cancelRequested && !active.runtimeCompletion) {
        await active.cancellationPromise;
        completion = await this.persistSyntheticCancellation(active, false);
      }
    }

    if (!active.allowComplete || !completion) return;
    await this.completeAttempt(
      active,
      active.cancelRequested ? cancellationCompletion() : completion
    );
  }

  private async executeWorkspaceAttempt(
    active: ActiveExecutionAttemptV1
  ): Promise<void> {
    const { claim } = active;
    const knowledgeWorkspace = claim.knowledgeWorkspace;
    if (!knowledgeWorkspace) return;
    const coordinator = this.workspaceCoordinators.get(claim.runtimeId);
    const persistLifecycle = this.store.persistWorkspaceLifecycle;
    const persistTerminal = this.store.persistTerminalEvent;
    if (!coordinator || !persistLifecycle || !persistTerminal) {
      throw new Error(
        `Runtime ${claim.runtimeId} claimed a knowledge workspace without a complete lifecycle coordinator/store.`
      );
    }

    // Always prepare/recover, including cancellation and terminal recovery. It
    // revalidates prepared-only state, derives the sanitized runtime location,
    // and allows hidden prepare side effects to be recovered and persisted.
    let prepared = active.recoveredWorkspace;
    active.recoveredWorkspace = undefined;
    if (!prepared) {
      try {
        prepared = await coordinator.prepareOrRecover({
          jobId: claim.jobId,
          attemptId: claim.attemptId,
          attemptNumber: claim.attemptNumber,
          binding: knowledgeWorkspace.binding,
          repositoryPath: knowledgeWorkspace.repositoryPath,
          existingLifecycle: active.workspaceLifecycle,
        });
      } catch (error) {
        if (
          await this.quarantineWorkspaceFailure(
            active,
            coordinator,
            'prepare',
            active.workspaceLifecycle,
            error
          )
        ) {
          return;
        }
        throw error;
      }
    }
    if (!active.allowComplete) return;
    if (active.pendingRecoveryResolution) {
      const pending = active.pendingRecoveryResolution;
      if (
        !(await this.resolveRecoveryAction(active, {
          incidentId: pending.incidentId,
          resolution: 'retried',
        }))
      ) {
        return;
      }
      active.pendingRecoveryResolution = undefined;
    }
    if (!(await this.persistWorkspaceLifecycle(active, prepared.lifecycle))) {
      return;
    }
    active.workspaceLifecycle = prepared.lifecycle;
    active.runtimeCompletion = prepared.lifecycle.runtimeCompletion;
    active.runtimeFinished = active.runtimeCompletion !== undefined;

    if (!active.runtimeCompletion) {
      let completion: RuntimeCompletionV1 | null = null;
      if (active.cancelRequested) {
        await this.requestCancellation(active);
      } else {
        try {
          completion = await this.consumeRuntime(
            active,
            prepared.workspace,
            true
          );
        } catch (error) {
          if (active.allowComplete && !active.cancelRequested) {
            this.logRuntimeFailure(active, error);
            await this.interruptDriver(active, 'runtime-attempt-failed');
            completion = runtimeDriverFailure(error);
          }
        }
      }

      if (!active.allowComplete) return;
      if (active.cancelRequested && !active.runtimeCompletion) {
        await active.cancellationPromise;
        completion = await this.persistSyntheticCancellation(active, true);
      } else if (completion && !active.runtimeCompletion) {
        completion = await this.persistSyntheticTerminal(
          active,
          completion,
          terminalEventForCompletion(completion),
          true
        );
      }
      if (!active.allowComplete || !completion) return;
    }

    let lifecycle = active.workspaceLifecycle;
    if (!lifecycle?.runtimeCompletion) {
      throw new Error('Workspace runtime completion was not persisted.');
    }

    // The durable completion receipt is authoritative even if cancellation is
    // observed later. Complete its monotonic lifecycle without replacing it.
    if (lifecycle.runtimeCompletion.status === 'succeeded') {
      if (!lifecycle.finalized) {
        let finalized: WorkspaceLifecycleV1;
        try {
          finalized = await coordinator.finalizeOrRecover(lifecycle);
        } catch (error) {
          if (
            await this.quarantineWorkspaceFailure(
              active,
              coordinator,
              'finalize',
              lifecycle,
              error
            )
          ) {
            return;
          }
          throw error;
        }
        if (!active.allowComplete) return;
        if (!(await this.persistWorkspaceLifecycle(active, finalized))) {
          return;
        }
        lifecycle = finalized;
        active.workspaceLifecycle = finalized;
      }

      if (lifecycle.finalized?.changed && !lifecycle.changeRequestId) {
        const createChangeRequest =
          this.store.createKnowledgeChangeRequest;
        if (!createChangeRequest) {
          throw new Error(
            'A changed knowledge workspace requires change-request persistence.'
          );
        }
        let created:
          | CreateExecutionDaemonKnowledgeChangeRequestResultV1
          | 'fenced';
        try {
          created = await createChangeRequest.call(this.store, {
            attemptId: claim.attemptId,
            workerId: this.workerId,
            generation: claim.generation,
            binding: lifecycle.binding,
            prepared: lifecycle.prepared,
            finalized: lifecycle.finalized,
          });
        } catch (error) {
          await this.persistenceError(
            active,
            'change-request-persistence-error',
            error
          );
          return;
        }
        if (!active.allowComplete) return;
        if (created === 'fenced') {
          await this.abandonAttempt(
            active,
            'change-request-fenced',
            'fenced'
          );
          return;
        }
        lifecycle = parseWorkspaceLifecycleV1({
          ...lifecycle,
          changeRequestId: created.changeRequest.id,
        });
        active.workspaceLifecycle = lifecycle;
      }
    }

    if (!lifecycle.cleanedAt) {
      let cleaned: WorkspaceLifecycleV1;
      try {
        cleaned = await coordinator.cleanupOrRecover({
          lifecycle,
          cleanedAt: this.clock.now().toISOString(),
        });
      } catch (error) {
        if (
          await this.quarantineWorkspaceFailure(
            active,
            coordinator,
            'cleanup',
            lifecycle,
            error
          )
        ) {
          return;
        }
        throw error;
      }
      if (!active.allowComplete) return;
      if (!(await this.persistWorkspaceLifecycle(active, cleaned))) {
        return;
      }
      lifecycle = cleaned;
      active.workspaceLifecycle = cleaned;
    }

    if (!active.allowComplete) return;
    const durableCompletion = lifecycle.runtimeCompletion;
    if (!durableCompletion) {
      throw new Error('Workspace runtime completion was lost before complete.');
    }
    await this.completeAttempt(
      active,
      active.cancelRequested
        ? cancellationCompletion()
        : durableCompletion
    );
  }

  private async applyRequestedRecoveryAction(
    active: ActiveExecutionAttemptV1
  ): Promise<boolean> {
    const readAction = this.store.getRequestedRecoveryAction;
    if (!readAction) return true;

    let requested: RequestedExecutionDaemonRecoveryActionV1 | null | 'fenced';
    try {
      requested = await readAction.call(this.store, {
        attemptId: active.claim.attemptId,
        workerId: this.workerId,
        generation: active.claim.generation,
      });
    } catch (error) {
      await this.persistenceError(active, 'recovery-action-read-error', error);
      return false;
    }
    if (requested === 'fenced') {
      await this.abandonAttempt(active, 'recovery-action-read-fenced', 'fenced');
      return false;
    }
    if (!requested) return true;

    active.cancelRequested ||= requested.cancelRequested;
    const coordinator = this.workspaceCoordinators.get(active.claim.runtimeId);
    if (!active.claim.knowledgeWorkspace || !coordinator) {
      await this.persistenceError(
        active,
        'recovery-workspace-unavailable',
        new Error('A requested workspace recovery has no configured workspace.')
      );
      return false;
    }

    if (requested.action === 'discard') {
      if (!active.workspaceLifecycle || !coordinator.discardQuarantined) {
        await this.persistenceError(
          active,
          'recovery-discard-receipt-missing',
          new Error('A quarantined workspace receipt is required for discard.')
        );
        return false;
      }
      try {
        await coordinator.discardQuarantined(active.workspaceLifecycle);
      } catch (error) {
        this.logger.error('Execution workspace discard failed.', {
          attemptId: active.claim.attemptId,
          error: errorMessage(error),
          generation: active.claim.generation,
        });
        await this.abandonAttempt(active, 'recovery-discard-failed', 'fenced');
        return false;
      }
      if (
        !(await this.resolveRecoveryAction(active, {
          incidentId: requested.incidentId,
          resolution: 'discarded',
        }))
      ) {
        return false;
      }
      active.workspaceLifecycle = null;
      active.claim.workspaceLifecycle = null;
      active.claim.runtimeRunId = null;
      active.claim.checkpointRef = null;
      active.claim.humanInput = null;
      active.runtimeRunId = undefined;
      active.checkpointRef = undefined;
      active.runtimeCompletion = undefined;
      active.runtimeFinished = false;
      return true;
    }

    if (!active.workspaceLifecycle) {
      active.pendingRecoveryResolution = {
        incidentId: requested.incidentId,
      };
      return true;
    }

    if (!coordinator.recoverSuspended) {
      await this.persistenceError(
        active,
        'recovery-port-unavailable',
        new Error('Workspace recovery port is not configured.')
      );
      return false;
    }
    let recovered: ExecutionDaemonWorkspacePrepareResultV1;
    try {
      recovered = await coordinator.recoverSuspended(
        active.workspaceLifecycle
      );
    } catch (error) {
      if (
        await this.quarantineWorkspaceFailure(
          active,
          coordinator,
          'prepare',
          active.workspaceLifecycle,
          error
        )
      ) {
        return false;
      }
      this.logger.error('Execution workspace retry recovery failed.', {
        attemptId: active.claim.attemptId,
        error: errorMessage(error),
        generation: active.claim.generation,
      });
      await this.abandonAttempt(active, 'recovery-retry-failed', 'fenced');
      return false;
    }
    if (
      !(await this.resolveRecoveryAction(active, {
        incidentId: requested.incidentId,
        resolution: 'retried',
      }))
    ) {
      return false;
    }
    active.recoveredWorkspace = recovered;
    return true;
  }

  private async resolveRecoveryAction(
    active: ActiveExecutionAttemptV1,
    input: { incidentId: string; resolution: 'retried' | 'discarded' }
  ): Promise<boolean> {
    const resolve = this.store.resolveRecoveryAction;
    if (!resolve) {
      await this.persistenceError(
        active,
        'recovery-resolution-unavailable',
        new Error('Execution recovery resolution is not configured.')
      );
      return false;
    }
    try {
      const result = await resolve.call(this.store, {
        ...input,
        attemptId: active.claim.attemptId,
        workerId: this.workerId,
        generation: active.claim.generation,
      });
      if (result === 'fenced') {
        await this.abandonAttempt(active, 'recovery-resolution-fenced', 'fenced');
        return false;
      }
      return true;
    } catch (error) {
      await this.persistenceError(active, 'recovery-resolution-error', error);
      return false;
    }
  }

  private async quarantineWorkspaceFailure(
    active: ActiveExecutionAttemptV1,
    coordinator: ExecutionDaemonWorkspaceCoordinatorV1,
    stage: ExecutionDaemonRecoveryStageV1,
    lifecycle: WorkspaceLifecycleV1 | null,
    error: unknown
  ): Promise<boolean> {
    let classification: ExecutionDaemonRecoveryClassificationV1;
    let discardable = false;
    if (!lifecycle) {
      classification = partialPrepareFailure(error) ? 'partial' : 'unknown';
    } else {
      const inspect = coordinator.inspectRecoveryState;
      if (!inspect) return false;
      let inspected: {
        schemaVersion: 1;
        state:
          | 'absent'
          | 'prepared-clean'
          | 'prepared-dirty'
          | 'finalized-clean'
          | 'drifted';
      };
      try {
        inspected = await inspect.call(coordinator, lifecycle);
      } catch {
        return false;
      }
      if (inspected.state !== 'prepared-dirty' && inspected.state !== 'drifted') {
        return false;
      }
      classification = inspected.state;
      discardable = inspected.state === 'prepared-dirty';
    }

    const quarantine = this.store.quarantineWorkspaceRecovery;
    if (!quarantine) return false;
    try {
      const result = await quarantine.call(this.store, {
        attemptId: active.claim.attemptId,
        workerId: this.workerId,
        generation: active.claim.generation,
        stage,
        reasonCode: recoveryReasonCode(error, stage),
        classification,
        discardable,
      });
      if (result === 'fenced') {
        await this.abandonAttempt(active, 'workspace-quarantine-fenced', 'fenced');
        return true;
      }
      active.allowComplete = false;
      active.heartbeatController.abort();
      active.stop.resolve();
      await this.interruptDriver(active, 'workspace-recovery-quarantined');
      this.logger.warn('Execution workspace was quarantined.', {
        attemptId: active.claim.attemptId,
        classification,
        generation: active.claim.generation,
        stage,
      });
      return true;
    } catch (quarantineError) {
      await this.persistenceError(
        active,
        'workspace-quarantine-error',
        quarantineError
      );
      return true;
    }
  }

  private async consumeRuntime(
    active: ActiveExecutionAttemptV1,
    workspace: ExecutionDaemonClaimV1['workspace'],
    atomicTerminal: boolean
  ): Promise<RuntimeCompletionV1 | null> {
    const { claim, driver } = active;
    const descriptor = await driver.describe();
    if (descriptor.runtimeId !== claim.runtimeId) {
      throw new Error(
        `Claimed runtime ${claim.runtimeId} does not match driver ${descriptor.runtimeId}.`
      );
    }
    if (!active.allowComplete) {
      return null;
    }

    let events: AsyncIterable<RuntimeEventV1>;
    if (claim.humanInput) {
      if (
        !claim.runtimeRunId ||
        !descriptor.capabilities.nativeResume ||
        !descriptor.capabilities.waitingForHuman ||
        !driver.resume
      ) {
        throw new Error(
          `Runtime ${claim.runtimeId} cannot deliver the pending human input through native resume.`
        );
      }
      active.runtimeRunId = claim.runtimeRunId;
      active.checkpointRef = claim.checkpointRef ?? undefined;
      events = driver.resume({
        jobId: claim.jobId,
        attemptId: claim.attemptId,
        generation: claim.generation,
        runtimeAttemptId: claim.runtimeRunId,
        humanInput: claim.humanInput,
        ...(claim.checkpointRef
          ? { checkpointRef: claim.checkpointRef }
          : {}),
      });
    } else if (claim.runtimeRunId && descriptor.capabilities.nativeResume) {
      if (!driver.resume) {
        throw new Error(
          `Runtime ${claim.runtimeId} declares native resume but does not implement resume().`
        );
      }
      active.runtimeRunId = claim.runtimeRunId;
      active.checkpointRef = claim.checkpointRef ?? undefined;
      events = driver.resume({
        jobId: claim.jobId,
        attemptId: claim.attemptId,
        generation: claim.generation,
        runtimeAttemptId: claim.runtimeRunId,
        ...(claim.checkpointRef
          ? { checkpointRef: claim.checkpointRef }
          : {}),
      });
    } else {
      // A non-resumable runtime is intentionally restarted after reclaim.
      // Generation fencing provides at-least-once, not exactly-once, semantics.
      active.runtimeRunId = undefined;
      active.checkpointRef = undefined;
      events = driver.start({
        jobId: claim.jobId,
        attemptId: claim.attemptId,
        generation: claim.generation,
        executionSpec: claim.executionSpec,
        contextManifest: claim.contextManifest,
        ...(workspace ? { workspace } : {}),
      });
    }

    const iterator = events[Symbol.asyncIterator]();
    active.iterator = iterator;

    while (active.allowComplete) {
      const next = iterator.next().then(
        (result) => ({ kind: 'event' as const, result }),
        (error: unknown) => ({ kind: 'error' as const, error })
      );
      const stopped = active.stop.promise.then(() => ({
        kind: 'stopped' as const,
      }));
      const item = await Promise.race([next, stopped]);

      if (item.kind === 'stopped') {
        this.closeIterator(active);
        return null;
      }
      if (item.kind === 'error') {
        throw item.error;
      }
      if (item.result.done) {
        return {
          status: 'failed',
          error: {
            code: 'runtime-stream-ended',
            message:
              'Runtime event stream ended without an attempt-completed event.',
          },
        };
      }

      active.eventSequence += 1;
      const event = item.result.value;
      if (event.type === 'attempt-completed') {
        active.runtimeFinished = true;
      }
      let appendResult: 'appended' | 'suspended' | 'fenced';
      active.suspensionPending = event.type === 'waiting-for-human';
      try {
        if (atomicTerminal && event.type === 'attempt-completed') {
          const completion = withRuntimeRunId(
            completionFromEvent(
              event,
              active.runtimeRunId,
              active.text,
              active.truncated
            ),
            active.runtimeRunId
          );
          appendResult = await this.requirePersistTerminalEvent()({
            attemptId: claim.attemptId,
            workerId: this.workerId,
            generation: claim.generation,
            runtimeEventId: runtimeEventId(
              claim.generation,
              active.eventSequence
            ),
            event,
            runtimeCompletion: completion,
            occurredAt: this.clock.now(),
          });
          if (appendResult === 'appended') {
            this.rememberWorkspaceRuntimeCompletion(active, completion);
          }
        } else {
          appendResult = await this.store.appendEvent({
            attemptId: claim.attemptId,
            workerId: this.workerId,
            generation: claim.generation,
            runtimeEventId: runtimeEventId(
              claim.generation,
              active.eventSequence
            ),
            event,
            occurredAt: this.clock.now(),
          });
        }
      } catch (error) {
        active.suspensionPending = false;
        rememberInterruptAddress(active, event);
        this.logger.error(
          'Execution daemon could not persist a runtime event; ownership is no longer trusted.',
          {
            attemptId: claim.attemptId,
            error: errorMessage(error),
            generation: claim.generation,
          }
        );
        await this.abandonAttempt(
          active,
          'event-persistence-error',
          'fenced'
        );
        return null;
      }
      if (appendResult === 'suspended') {
        if (event.type !== 'waiting-for-human') {
          active.suspensionPending = false;
          throw new Error(
            'Execution store returned suspended for a non-waiting event.'
          );
        }
        await this.suspendAttempt(active);
        return null;
      }
      active.suspensionPending = false;
      if (appendResult === 'fenced') {
        rememberInterruptAddress(active, event);
        if (event.type === 'attempt-completed') {
          // A success/failure terminal event is deliberately rejected once
          // cancellation wins. Probe the lease before deciding this is a
          // generation fence; a live cancelled owner must instead persist
          // one synthetic interrupted terminal fact and clean up.
          const probe = await this.heartbeatOnce(active);
          if (probe === 'cancel-requested' && active.allowComplete) {
            return null;
          }
          if (!active.allowComplete) return null;
        }
        await this.abandonAttempt(active, 'event-fenced', 'fenced');
        return null;
      }
      if (!active.allowComplete) {
        return null;
      }

      if (event.type === 'attempt-started') {
        active.runtimeRunId = event.runtimeAttemptId;
      } else if (event.type === 'checkpoint') {
        active.checkpointRef = event.checkpointRef;
      } else if (event.type === 'text-delta') {
        active.text += event.text;
      } else if (
        event.type === 'progress' &&
        (event.message === 'generic-cli/stdout-truncated' ||
          event.message === 'generic-cli/stderr-truncated')
      ) {
        active.truncated = true;
      } else if (event.type === 'attempt-completed') {
        const completion = withRuntimeRunId(completionFromEvent(
          event,
          active.runtimeRunId,
          active.text,
          active.truncated
        ), active.runtimeRunId);
        active.runtimeCompletion = completion;
        return completion;
      }
    }

    return null;
  }

  private async runHeartbeat(
    active: ActiveExecutionAttemptV1
  ): Promise<void> {
    while (
      active.allowComplete &&
      !active.heartbeatController.signal.aborted
    ) {
      try {
        await this.wait(
          this.heartbeatIntervalMs,
          active.heartbeatController.signal
        );
      } catch (error) {
        if (!active.heartbeatController.signal.aborted) {
          this.logger.warn('Execution daemon heartbeat wait failed.', {
            attemptId: active.claim.attemptId,
            error: errorMessage(error),
          });
        }
      }
      if (active.heartbeatController.signal.aborted) return;
      await this.heartbeatOnce(active);
    }
  }

  private async heartbeatOnce(
    active: ActiveExecutionAttemptV1
  ): Promise<'renewed' | 'cancel-requested' | 'fenced'> {
    if (!active.allowComplete) return 'fenced';
    try {
      const result = await this.store.heartbeat({
        attemptId: active.claim.attemptId,
        workerId: this.workerId,
        generation: active.claim.generation,
        leaseDurationMs: this.leaseDurationMs,
        ...(active.checkpointRef
          ? { checkpointRef: active.checkpointRef }
          : {}),
        ...(active.runtimeRunId
          ? { runtimeRunId: active.runtimeRunId }
          : {}),
      });
      if (result === 'fenced') {
        if (active.suspensionPending || active.suspended) {
          return result;
        }
        if (!active.completing && !active.completed) {
          await this.abandonAttempt(active, 'heartbeat-fenced', 'fenced');
        }
      } else if (result === 'cancel-requested') {
        active.cancelRequested = true;
        await this.requestCancellation(active);
      }
      return result;
    } catch (error) {
      this.logger.error(
        'Execution daemon heartbeat failed; ownership is no longer trusted.',
        {
          attemptId: active.claim.attemptId,
          error: errorMessage(error),
          generation: active.claim.generation,
        }
      );
      // The waiting append owns the suspension decision. A concurrent
      // heartbeat can observe its committed lease release (or transient write
      // contention); it must not turn a successful suspension into an
      // interrupt. If the append itself fails, its error path still abandons.
      if (active.suspensionPending || active.suspended) {
        return 'fenced';
      }
      await this.abandonAttempt(active, 'heartbeat-error', 'fenced');
      return 'fenced';
    }
  }

  private requestCancellation(
    active: ActiveExecutionAttemptV1
  ): Promise<void> {
    if (active.cancellationPromise) return active.cancellationPromise;
    active.cancelRequested = true;
    active.stop.resolve();
    if (!active.runtimeFinished && !active.runtimeRunId) {
      active.runtimeRunId = active.claim.runtimeRunId ?? undefined;
    }
    active.cancellationPromise = active.runtimeFinished
      ? Promise.resolve()
      : this.interruptDriver(active, 'cancel-requested');
    return active.cancellationPromise;
  }

  private async suspendAttempt(
    active: ActiveExecutionAttemptV1
  ): Promise<void> {
    active.suspensionPending = false;
    active.suspended = true;
    active.allowComplete = false;
    active.heartbeatController.abort();
    active.stop.resolve();
    const close = active.iterator?.return?.();
    if (close) {
      try {
        await close;
      } catch (error) {
        this.logger.warn('Execution runtime iterator suspension failed.', {
          attemptId: active.claim.attemptId,
          error: errorMessage(error),
          generation: active.claim.generation,
        });
      }
    }
  }

  private async persistWorkspaceLifecycle(
    active: ActiveExecutionAttemptV1,
    lifecycle: WorkspaceLifecycleV1
  ): Promise<boolean> {
    const persist = this.store.persistWorkspaceLifecycle;
    if (!persist) {
      throw new Error('Workspace lifecycle persistence is not configured.');
    }
    try {
      const result = await persist.call(this.store, {
        attemptId: active.claim.attemptId,
        workerId: this.workerId,
        generation: active.claim.generation,
        lifecycle,
      });
      if (result === 'fenced') {
        await this.abandonAttempt(
          active,
          'workspace-lifecycle-fenced',
          'fenced'
        );
        return false;
      }
      return true;
    } catch (error) {
      await this.persistenceError(
        active,
        'workspace-lifecycle-persistence-error',
        error
      );
      return false;
    }
  }

  private requirePersistTerminalEvent(): NonNullable<
    ExecutionDaemonStoreV1['persistTerminalEvent']
  > {
    const persist = this.store.persistTerminalEvent;
    if (!persist) {
      throw new Error('Atomic terminal event persistence is not configured.');
    }
    return persist.bind(this.store);
  }

  private rememberWorkspaceRuntimeCompletion(
    active: ActiveExecutionAttemptV1,
    completion: RuntimeCompletionV1
  ): void {
    if (!active.workspaceLifecycle) {
      throw new Error('Workspace lifecycle was not prepared.');
    }
    active.runtimeCompletion = completion;
    active.workspaceLifecycle = parseWorkspaceLifecycleV1({
      ...active.workspaceLifecycle,
      runtimeCompletion: completion,
    });
  }

  private async persistSyntheticTerminal(
    active: ActiveExecutionAttemptV1,
    completion: RuntimeCompletionV1,
    event: Extract<RuntimeEventV1, { type: 'attempt-completed' }>,
    atomicTerminal: boolean
  ): Promise<RuntimeCompletionV1 | null> {
    active.eventSequence += 1;
    const input = {
      attemptId: active.claim.attemptId,
      workerId: this.workerId,
      generation: active.claim.generation,
      runtimeEventId: runtimeEventId(
        active.claim.generation,
        active.eventSequence
      ),
      event,
      occurredAt: this.clock.now(),
    };
    try {
      const result = atomicTerminal
        ? await this.requirePersistTerminalEvent()({
            ...input,
            runtimeCompletion: completion,
          })
        : await this.store.appendEvent(input);
      if (result === 'fenced') {
        await this.abandonAttempt(
          active,
          'terminal-event-fenced',
          'fenced'
        );
        return null;
      }
      active.runtimeFinished = true;
      active.runtimeCompletion = completion;
      if (atomicTerminal) {
        this.rememberWorkspaceRuntimeCompletion(active, completion);
      }
      return completion;
    } catch (error) {
      await this.persistenceError(
        active,
        'terminal-event-persistence-error',
        error
      );
      return null;
    }
  }

  private persistSyntheticCancellation(
    active: ActiveExecutionAttemptV1,
    atomicTerminal: boolean
  ): Promise<RuntimeCompletionV1 | null> {
    const completion = cancellationCompletion(active.runtimeRunId);
    return this.persistSyntheticTerminal(
      active,
      completion,
      {
        type: 'attempt-completed',
        status: 'interrupted',
        message: 'Execution cancelled.',
      },
      atomicTerminal
    );
  }

  private async completeAttempt(
    active: ActiveExecutionAttemptV1,
    completion: RuntimeCompletionV1
  ): Promise<void> {
    if (!active.allowComplete) return;
    active.completing = true;
    try {
      const result = await this.store.complete({
        attemptId: active.claim.attemptId,
        workerId: this.workerId,
        generation: active.claim.generation,
        status: completion.status,
        ...(completion.result === undefined
          ? {}
          : { result: completion.result }),
        ...(completion.error === undefined
          ? {}
          : { error: completion.error }),
        ...(completion.runtimeRunId || active.runtimeRunId
          ? { runtimeRunId: completion.runtimeRunId ?? active.runtimeRunId }
          : {}),
      });
      if (result === 'fenced') {
        await this.abandonAttempt(active, 'completion-fenced', 'fenced');
      } else {
        active.completed = true;
      }
    } catch (error) {
      await this.persistenceError(active, 'completion-error', error);
    } finally {
      active.completing = false;
    }
  }

  private async persistenceError(
    active: ActiveExecutionAttemptV1,
    reason: string,
    error: unknown
  ): Promise<void> {
    this.logger.error(
      'Execution daemon persistence failed; ownership is no longer trusted.',
      {
        attemptId: active.claim.attemptId,
        error: errorMessage(error),
        generation: active.claim.generation,
        reason,
      }
    );
    await this.abandonAttempt(active, reason, 'fenced');
  }

  private logRuntimeFailure(
    active: ActiveExecutionAttemptV1,
    error: unknown
  ): void {
    this.logger.error('Execution runtime attempt failed.', {
      attemptId: active.claim.attemptId,
      error: errorMessage(error),
      generation: active.claim.generation,
      runtimeId: active.claim.runtimeId,
    });
  }

  private async abandonAttempt(
    active: ActiveExecutionAttemptV1,
    reason: string,
    cause: 'fenced' | 'forced'
  ): Promise<void> {
    if (active.allowComplete) {
      active.allowComplete = false;
      active.heartbeatController.abort();
      active.stop.resolve();
      this.logger.warn(
        cause === 'fenced'
          ? 'Execution daemon attempt was fenced.'
          : 'Execution daemon attempt was force-interrupted.',
        {
          attemptId: active.claim.attemptId,
          generation: active.claim.generation,
          reason,
          runtimeId: active.claim.runtimeId,
        }
      );
    }
    await this.interruptDriver(active, reason);
  }

  private interruptDriver(
    active: ActiveExecutionAttemptV1,
    reason: string
  ): Promise<void> {
    if (active.interruptPromise) {
      return active.interruptPromise;
    }

    active.interruptPromise = (async () => {
      if (!active.runtimeRunId) {
        this.logger.warn(
          'Execution daemon could not address driver interrupt before attempt-started.',
          {
            attemptId: active.claim.attemptId,
            generation: active.claim.generation,
            reason,
          }
        );
        this.closeIterator(active);
        return;
      }

      try {
        await active.driver.interrupt({
          jobId: active.claim.jobId,
          attemptId: active.claim.attemptId,
          generation: active.claim.generation,
          runtimeAttemptId: active.runtimeRunId,
          reason,
        });
      } catch (error) {
        this.logger.error('Execution runtime interrupt failed.', {
          attemptId: active.claim.attemptId,
          error: errorMessage(error),
          generation: active.claim.generation,
          reason,
        });
      } finally {
        this.closeIterator(active);
      }
    })();

    return active.interruptPromise;
  }

  private closeIterator(active: ActiveExecutionAttemptV1): void {
    const close = active.iterator?.return?.();
    if (close) {
      void Promise.resolve(close).catch((error) => {
        this.logger.warn('Execution runtime iterator cleanup failed.', {
          attemptId: active.claim.attemptId,
          error: errorMessage(error),
        });
      });
    }
  }

  private async failClaimWithoutDriver(
    claim: ExecutionDaemonClaimV1
  ): Promise<void> {
    this.logger.error(
      'Execution daemon claimed an attempt whose driver is not registered.',
      {
        attemptId: claim.attemptId,
        runtimeId: claim.runtimeId,
      }
    );
    try {
      await this.store.complete({
        attemptId: claim.attemptId,
        workerId: this.workerId,
        generation: claim.generation,
        status: 'failed',
        error: {
          code: 'runtime-driver-not-registered',
          message: `Runtime driver ${claim.runtimeId} is not registered.`,
        },
        ...(claim.runtimeRunId
          ? { runtimeRunId: claim.runtimeRunId }
          : {}),
      });
    } catch (error) {
      this.logger.error('Execution daemon could not fail an invalid claim.', {
        attemptId: claim.attemptId,
        error: errorMessage(error),
      });
    }
  }

  private async waitForNextPoll(): Promise<void> {
    const controller = new AbortController();
    this.pollWaitController = controller;
    if (this.state !== 'running') {
      controller.abort();
    }

    try {
      await this.wait(this.pollIntervalMs, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        this.logger.warn('Execution daemon poll wait failed.', {
          error: errorMessage(error),
        });
      }
    } finally {
      if (this.pollWaitController === controller) {
        this.pollWaitController = null;
      }
    }
  }

  private async waitForActiveAttempts(): Promise<void> {
    while (this.activeAttempts.size > 0) {
      await Promise.allSettled(
        Array.from(this.activeAttempts.values(), ({ done }) => done)
      );
    }
  }
}

function completionFromEvent(
  event: Extract<RuntimeEventV1, { type: 'attempt-completed' }>,
  runtimeRunId: string | undefined,
  text: string,
  truncated: boolean
): RuntimeCompletionV1 {
  const runtime: Record<string, ExecutionDaemonJsonValueV1> = {};
  if (runtimeRunId) {
    runtime.runtimeRunId = runtimeRunId;
  }
  if (event.status === 'succeeded') {
    return {
      status: 'succeeded',
      result: {
        ...runtime,
        text,
        truncated,
        ...(event.message ? { message: event.message } : {}),
      },
    };
  }
  if (event.status === 'interrupted') {
    return {
      status: 'cancelled',
      ...(event.message
        ? { error: { ...runtime, message: event.message } }
        : {}),
    };
  }
  return {
    status: 'failed',
    error: {
      code: 'runtime-attempt-failed',
      ...runtime,
      message: event.message || 'Runtime attempt failed.',
    },
  };
}

function partialPrepareFailure(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'branch-already-exists' ||
      error.code === 'worktree-path-conflict' ||
      error.code === 'worktree-state-changed')
  );
}

function recoveryReasonCode(
  error: unknown,
  stage: ExecutionDaemonRecoveryStageV1
): string {
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[a-z0-9][a-z0-9-]{0,79}$/.test(error.code)
  ) {
    return error.code;
  }
  return `workspace-${stage}-failed`;
}

function withRuntimeRunId(
  completion: RuntimeCompletionV1,
  runtimeRunId: string | undefined
): RuntimeCompletionV1 {
  return runtimeRunId ? { ...completion, runtimeRunId } : completion;
}

function runtimeDriverFailure(error: unknown): RuntimeCompletionV1 {
  return {
    status: 'failed',
    error: {
      code: 'runtime-driver-error',
      message: errorMessage(error),
    },
  };
}

function cancellationCompletion(
  runtimeRunId?: string
): RuntimeCompletionV1 {
  return {
    status: 'cancelled',
    error: {
      ...(runtimeRunId ? { runtimeRunId } : {}),
      message: 'Execution cancelled.',
    },
    ...(runtimeRunId ? { runtimeRunId } : {}),
  };
}

function terminalEventForCompletion(
  completion: RuntimeCompletionV1
): Extract<RuntimeEventV1, { type: 'attempt-completed' }> {
  return {
    type: 'attempt-completed',
    status:
      completion.status === 'cancelled'
        ? 'interrupted'
        : completion.status,
    ...(completion.status === 'succeeded'
      ? {}
      : { message: terminalCompletionMessage(completion) }),
  };
}

function terminalCompletionMessage(completion: RuntimeCompletionV1): string {
  const error = completion.error;
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return completion.status === 'cancelled'
    ? 'Execution cancelled.'
    : 'Runtime attempt failed.';
}

function runtimeEventId(generation: number, sequence: number): string {
  return `generation:${generation}:event:${sequence}`;
}

function rememberInterruptAddress(
  active: ActiveExecutionAttemptV1,
  event: RuntimeEventV1
): void {
  if (event.type === 'attempt-started') {
    // A rejected write must not advance durable state, but this id is still
    // required to stop the orphaned runtime work.
    active.runtimeRunId = event.runtimeAttemptId;
  }
}

function createDeferred(): DeferredV1 {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve() {
      resolvePromise?.();
      resolvePromise = undefined;
    },
  };
}

function requireNonEmptyText(value: string, field: string): string {
  if (!value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function readPositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
