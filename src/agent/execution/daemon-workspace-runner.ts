import type { RuntimeEventV1 } from './driver';
import {
  parseWorkspaceLifecycleV1,
  type WorkspaceLifecycleV1,
} from './workspace-lifecycle';
import type {
  ActiveExecutionAttemptV1,
  CreateExecutionDaemonKnowledgeChangeRequestResultV1,
  ExecutionDaemonClaimV1,
  ExecutionDaemonClockV1,
  ExecutionDaemonLoggerV1,
  ExecutionDaemonRecoveryClassificationV1,
  ExecutionDaemonRecoveryStageV1,
  ExecutionDaemonStoreV1,
  ExecutionDaemonWorkspaceCoordinatorV1,
  ExecutionDaemonWorkspacePrepareResultV1,
  RequestedExecutionDaemonRecoveryActionV1,
  RuntimeCompletionV1,
} from './daemon-types';
import {
  cancellationCompletion,
  errorMessage,
  partialPrepareFailure,
  recoveryReasonCode,
  runtimeDriverFailure,
  terminalEventForCompletion,
} from './daemon-helpers';

export interface ExecutionDaemonWorkspaceHostV1 {
  readonly workerId: string;
  readonly store: ExecutionDaemonStoreV1;
  readonly clock: ExecutionDaemonClockV1;
  readonly logger: ExecutionDaemonLoggerV1;
  readonly workspaceCoordinators: ReadonlyMap<
    string,
    ExecutionDaemonWorkspaceCoordinatorV1
  >;
  consumeRuntime(
    active: ActiveExecutionAttemptV1,
    workspace: ExecutionDaemonClaimV1['workspace'],
    atomicTerminal: boolean
  ): Promise<RuntimeCompletionV1 | null>;
  requestCancellation(active: ActiveExecutionAttemptV1): Promise<void>;
  persistSyntheticCancellation(
    active: ActiveExecutionAttemptV1,
    atomicTerminal: boolean
  ): Promise<RuntimeCompletionV1 | null>;
  persistSyntheticTerminal(
    active: ActiveExecutionAttemptV1,
    completion: RuntimeCompletionV1,
    event: Extract<RuntimeEventV1, { type: 'attempt-completed' }>,
    atomicTerminal: boolean
  ): Promise<RuntimeCompletionV1 | null>;
  persistWorkspaceLifecycle(
    active: ActiveExecutionAttemptV1,
    lifecycle: WorkspaceLifecycleV1
  ): Promise<boolean>;
  completeAttempt(
    active: ActiveExecutionAttemptV1,
    completion: RuntimeCompletionV1
  ): Promise<void>;
  abandonAttempt(
    active: ActiveExecutionAttemptV1,
    reason: string,
    cause: 'fenced' | 'forced'
  ): Promise<void>;
  persistenceError(
    active: ActiveExecutionAttemptV1,
    reason: string,
    error: unknown
  ): Promise<void>;
  logRuntimeFailure(active: ActiveExecutionAttemptV1, error: unknown): void;
  interruptDriver(
    active: ActiveExecutionAttemptV1,
    reason: string
  ): Promise<void>;
}

export async function executeWorkspaceAttemptV1(
  host: ExecutionDaemonWorkspaceHostV1,
  active: ActiveExecutionAttemptV1
): Promise<void> {
  const { claim } = active;
  const knowledgeWorkspace = claim.knowledgeWorkspace;
  if (!knowledgeWorkspace) return;
  const coordinator = host.workspaceCoordinators.get(claim.runtimeId);
  const persistLifecycle = host.store.persistWorkspaceLifecycle;
  const persistTerminal = host.store.persistTerminalEvent;
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
        await quarantineWorkspaceFailureV1(
          host,
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
      !(await resolveRecoveryActionV1(host, active, {
        incidentId: pending.incidentId,
        resolution: 'retried',
      }))
    ) {
      return;
    }
    active.pendingRecoveryResolution = undefined;
  }
  if (!(await host.persistWorkspaceLifecycle(active, prepared.lifecycle))) {
    return;
  }
  active.workspaceLifecycle = prepared.lifecycle;
  active.runtimeCompletion = prepared.lifecycle.runtimeCompletion;
  active.runtimeFinished = active.runtimeCompletion !== undefined;

  if (!active.runtimeCompletion) {
    let completion: RuntimeCompletionV1 | null = null;
    if (active.cancelRequested) {
      await host.requestCancellation(active);
    } else {
      try {
        completion = await host.consumeRuntime(
          active,
          prepared.workspace,
          true
        );
      } catch (error) {
        if (active.allowComplete && !active.cancelRequested) {
          host.logRuntimeFailure(active, error);
          await host.interruptDriver(active, 'runtime-attempt-failed');
          completion = runtimeDriverFailure(error);
        }
      }
    }

    if (!active.allowComplete) return;
    if (active.cancelRequested && !active.runtimeCompletion) {
      await active.cancellationPromise;
      completion = await host.persistSyntheticCancellation(active, true);
    } else if (completion && !active.runtimeCompletion) {
      completion = await host.persistSyntheticTerminal(
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
          await quarantineWorkspaceFailureV1(
            host,
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
      if (!(await host.persistWorkspaceLifecycle(active, finalized))) {
        return;
      }
      lifecycle = finalized;
      active.workspaceLifecycle = finalized;
    }

    if (lifecycle.finalized?.changed && !lifecycle.changeRequestId) {
      const createChangeRequest = host.store.createKnowledgeChangeRequest;
      if (!createChangeRequest) {
        throw new Error(
          'A changed knowledge workspace requires change-request persistence.'
        );
      }
      let created:
        | CreateExecutionDaemonKnowledgeChangeRequestResultV1
        | 'fenced';
      try {
        created = await createChangeRequest.call(host.store, {
          attemptId: claim.attemptId,
          workerId: host.workerId,
          generation: claim.generation,
          binding: lifecycle.binding,
          prepared: lifecycle.prepared,
          finalized: lifecycle.finalized,
        });
      } catch (error) {
        await host.persistenceError(
          active,
          'change-request-persistence-error',
          error
        );
        return;
      }
      if (!active.allowComplete) return;
      if (created === 'fenced') {
        await host.abandonAttempt(active, 'change-request-fenced', 'fenced');
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
        cleanedAt: host.clock.now().toISOString(),
      });
    } catch (error) {
      if (
        await quarantineWorkspaceFailureV1(
          host,
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
    if (!(await host.persistWorkspaceLifecycle(active, cleaned))) {
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
  await host.completeAttempt(
    active,
    active.cancelRequested ? cancellationCompletion() : durableCompletion
  );
}

export async function applyRequestedRecoveryActionV1(
  host: ExecutionDaemonWorkspaceHostV1,
  active: ActiveExecutionAttemptV1
): Promise<boolean> {
  const readAction = host.store.getRequestedRecoveryAction;
  if (!readAction) return true;

  let requested: RequestedExecutionDaemonRecoveryActionV1 | null | 'fenced';
  try {
    requested = await readAction.call(host.store, {
      attemptId: active.claim.attemptId,
      workerId: host.workerId,
      generation: active.claim.generation,
    });
  } catch (error) {
    await host.persistenceError(active, 'recovery-action-read-error', error);
    return false;
  }
  if (requested === 'fenced') {
    await host.abandonAttempt(active, 'recovery-action-read-fenced', 'fenced');
    return false;
  }
  if (!requested) return true;

  active.cancelRequested ||= requested.cancelRequested;
  const coordinator = host.workspaceCoordinators.get(active.claim.runtimeId);
  if (!active.claim.knowledgeWorkspace || !coordinator) {
    await host.persistenceError(
      active,
      'recovery-workspace-unavailable',
      new Error('A requested workspace recovery has no configured workspace.')
    );
    return false;
  }

  if (requested.action === 'discard') {
    if (!active.workspaceLifecycle || !coordinator.discardQuarantined) {
      await host.persistenceError(
        active,
        'recovery-discard-receipt-missing',
        new Error('A quarantined workspace receipt is required for discard.')
      );
      return false;
    }
    try {
      await coordinator.discardQuarantined(active.workspaceLifecycle);
    } catch (error) {
      host.logger.error('Execution workspace discard failed.', {
        attemptId: active.claim.attemptId,
        error: errorMessage(error),
        generation: active.claim.generation,
      });
      await host.abandonAttempt(active, 'recovery-discard-failed', 'fenced');
      return false;
    }
    if (
      !(await resolveRecoveryActionV1(host, active, {
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
    await host.persistenceError(
      active,
      'recovery-port-unavailable',
      new Error('Workspace recovery port is not configured.')
    );
    return false;
  }
  let recovered: ExecutionDaemonWorkspacePrepareResultV1;
  try {
    recovered = await coordinator.recoverSuspended(active.workspaceLifecycle);
  } catch (error) {
    if (
      await quarantineWorkspaceFailureV1(
        host,
        active,
        coordinator,
        'prepare',
        active.workspaceLifecycle,
        error
      )
    ) {
      return false;
    }
    host.logger.error('Execution workspace retry recovery failed.', {
      attemptId: active.claim.attemptId,
      error: errorMessage(error),
      generation: active.claim.generation,
    });
    await host.abandonAttempt(active, 'recovery-retry-failed', 'fenced');
    return false;
  }
  if (
    !(await resolveRecoveryActionV1(host, active, {
      incidentId: requested.incidentId,
      resolution: 'retried',
    }))
  ) {
    return false;
  }
  active.recoveredWorkspace = recovered;
  return true;
}

export async function resolveRecoveryActionV1(
  host: ExecutionDaemonWorkspaceHostV1,
  active: ActiveExecutionAttemptV1,
  input: { incidentId: string; resolution: 'retried' | 'discarded' }
): Promise<boolean> {
  const resolve = host.store.resolveRecoveryAction;
  if (!resolve) {
    await host.persistenceError(
      active,
      'recovery-resolution-unavailable',
      new Error('Execution recovery resolution is not configured.')
    );
    return false;
  }
  try {
    const result = await resolve.call(host.store, {
      ...input,
      attemptId: active.claim.attemptId,
      workerId: host.workerId,
      generation: active.claim.generation,
    });
    if (result === 'fenced') {
      await host.abandonAttempt(active, 'recovery-resolution-fenced', 'fenced');
      return false;
    }
    return true;
  } catch (error) {
    await host.persistenceError(active, 'recovery-resolution-error', error);
    return false;
  }
}

export async function quarantineWorkspaceFailureV1(
  host: ExecutionDaemonWorkspaceHostV1,
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

  const quarantine = host.store.quarantineWorkspaceRecovery;
  if (!quarantine) return false;
  try {
    const result = await quarantine.call(host.store, {
      attemptId: active.claim.attemptId,
      workerId: host.workerId,
      generation: active.claim.generation,
      stage,
      reasonCode: recoveryReasonCode(error, stage),
      classification,
      discardable,
    });
    if (result === 'fenced') {
      await host.abandonAttempt(
        active,
        'workspace-quarantine-fenced',
        'fenced'
      );
      return true;
    }
    active.allowComplete = false;
    active.heartbeatController.abort();
    active.stop.resolve();
    await host.interruptDriver(active, 'workspace-recovery-quarantined');
    host.logger.warn('Execution workspace was quarantined.', {
      attemptId: active.claim.attemptId,
      classification,
      generation: active.claim.generation,
      stage,
    });
    return true;
  } catch (quarantineError) {
    await host.persistenceError(
      active,
      'workspace-quarantine-error',
      quarantineError
    );
    return true;
  }
}
