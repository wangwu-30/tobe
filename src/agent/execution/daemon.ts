import type { ExecutionRuntimeDriverV1, RuntimeEventV1 } from './driver';
import {
  parseWorkspaceLifecycleV1,
  type WorkspaceLifecycleV1,
} from './workspace-lifecycle';
import {
  EXECUTION_DAEMON_DEFAULTS_V1,
  type ActiveExecutionAttemptV1,
  type ExecutionDaemonCandidateV1,
  type ExecutionDaemonClaimV1,
  type ExecutionDaemonClockV1,
  type ExecutionDaemonDriverRegistryV1,
  type ExecutionDaemonLoggerV1,
  type ExecutionDaemonOptionsV1,
  type ExecutionDaemonStateV1,
  type ExecutionDaemonStoreV1,
  type ExecutionDaemonWaitV1,
  type ExecutionDaemonWorkspaceCoordinatorV1,
  type RuntimeCompletionV1,
} from './daemon-types';
import {
  cancellationCompletion,
  completionFromEvent,
  createDeferred,
  errorMessage,
  readPositiveInteger,
  rememberInterruptAddress,
  requireNonEmptyText,
  runtimeDriverFailure,
  runtimeEventId,
  withRuntimeRunId,
} from './daemon-helpers';
import {
  applyRequestedRecoveryActionV1,
  executeWorkspaceAttemptV1,
  type ExecutionDaemonWorkspaceHostV1,
} from './daemon-workspace-runner';

export { EXECUTION_DAEMON_DEFAULTS_V1 };
export type {
  AppendExecutionDaemonEventInputV1,
  ClaimExecutionDaemonCandidateInputV1,
  CompleteExecutionDaemonAttemptInputV1,
  CreateExecutionDaemonKnowledgeChangeRequestInputV1,
  CreateExecutionDaemonKnowledgeChangeRequestResultV1,
  ExecutionDaemonCandidateV1,
  ExecutionDaemonClaimV1,
  ExecutionDaemonClockV1,
  ExecutionDaemonDriverRegistryV1,
  ExecutionDaemonJsonValueV1,
  ExecutionDaemonLogContextV1,
  ExecutionDaemonLoggerV1,
  ExecutionDaemonOptionsV1,
  ExecutionDaemonRecoveryClassificationV1,
  ExecutionDaemonRecoveryStageV1,
  ExecutionDaemonStoreV1,
  ExecutionDaemonWaitV1,
  ExecutionDaemonWorkspaceCoordinatorV1,
  ExecutionDaemonWorkspacePrepareInputV1,
  ExecutionDaemonWorkspacePrepareResultV1,
  HeartbeatExecutionDaemonAttemptInputV1,
  ListExecutionDaemonCandidatesInputV1,
  PersistExecutionDaemonTerminalEventInputV1,
  PersistExecutionDaemonWorkspaceLifecycleInputV1,
  QuarantineExecutionDaemonRecoveryInputV1,
  RequestedExecutionDaemonRecoveryActionV1,
  ResolveExecutionDaemonRecoveryInputV1,
} from './daemon-types';

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

  private createWorkspaceHost(): ExecutionDaemonWorkspaceHostV1 {
    return {
      workerId: this.workerId,
      store: this.store,
      clock: this.clock,
      logger: this.logger,
      workspaceCoordinators: this.workspaceCoordinators,
      consumeRuntime: (active, workspace, atomicTerminal) =>
        this.consumeRuntime(active, workspace, atomicTerminal),
      requestCancellation: (active) => this.requestCancellation(active),
      persistSyntheticCancellation: (active, atomicTerminal) =>
        this.persistSyntheticCancellation(active, atomicTerminal),
      persistSyntheticTerminal: (active, completion, event, atomicTerminal) =>
        this.persistSyntheticTerminal(active, completion, event, atomicTerminal),
      persistWorkspaceLifecycle: (active, lifecycle) =>
        this.persistWorkspaceLifecycle(active, lifecycle),
      completeAttempt: (active, completion) =>
        this.completeAttempt(active, completion),
      abandonAttempt: (active, reason, cause) =>
        this.abandonAttempt(active, reason, cause),
      persistenceError: (active, reason, error) =>
        this.persistenceError(active, reason, error),
      logRuntimeFailure: (active, error) =>
        this.logRuntimeFailure(active, error),
      interruptDriver: (active, reason) => this.interruptDriver(active, reason),
    };
  }

  private executeWorkspaceAttempt(
    active: ActiveExecutionAttemptV1
  ): Promise<void> {
    return executeWorkspaceAttemptV1(this.createWorkspaceHost(), active);
  }

  private applyRequestedRecoveryAction(
    active: ActiveExecutionAttemptV1
  ): Promise<boolean> {
    return applyRequestedRecoveryActionV1(this.createWorkspaceHost(), active);
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
