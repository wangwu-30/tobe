import { pathToFileURL } from 'node:url';

import type {
  GitWorktreePortV1,
  GitWorktreeRecoveryPortV1,
  GitWorktreeRecoveryStateV1,
} from '@/agent/knowledge/contracts';

import {
  WORKSPACE_LIFECYCLE_SCHEMA_VERSION_V1,
  WorkspaceLifecycleErrorV1,
  assertWorkspaceLifecycleAdvanceV1,
  parseWorkspaceLifecycleV1,
  serializeWorkspaceLifecycleV1,
  type FrozenKnowledgeBindingV1,
  type WorkspaceLifecycleV1,
  type WorkspaceRuntimeCompletionV1,
} from './workspace-lifecycle';

export type GitWorktreeCoordinatorPrepareInputV1 = {
  readonly jobId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly binding: FrozenKnowledgeBindingV1;
  /** Trusted, private control-plane value. It is never copied to `workspace`. */
  readonly repositoryPath: string;
  readonly existingLifecycle: WorkspaceLifecycleV1 | null;
};

export type GitWorktreeRuntimeWorkspaceV1 = {
  readonly uri: string;
  readonly revision: string;
};

export type GitWorktreeCoordinatorPrepareResultV1 = {
  /** Private durable receipt; callers must not include it in a runtime envelope. */
  readonly lifecycle: WorkspaceLifecycleV1;
  /** The only workspace information that may cross the runtime boundary. */
  readonly workspace: GitWorktreeRuntimeWorkspaceV1;
};

export type GitWorktreeCoordinatorCleanupInputV1 = {
  readonly lifecycle: WorkspaceLifecycleV1;
  /** The trusted control-plane timestamp for the durable cleanup stage. */
  readonly cleanedAt: string;
};

/**
 * Adds the runtime terminal fact as exactly one canonical lifecycle stage.
 * Exact replay is accepted; replacement or skipping a stage is rejected.
 */
export function addWorkspaceRuntimeCompletionV1(
  lifecycle: WorkspaceLifecycleV1,
  runtimeCompletion: WorkspaceRuntimeCompletionV1
): WorkspaceLifecycleV1 {
  const previous = parseWorkspaceLifecycleV1(lifecycle);
  const next = parseWorkspaceLifecycleV1({
    ...previous,
    runtimeCompletion,
  });
  assertWorkspaceLifecycleAdvanceV1(previous, next);
  return next;
}

/**
 * Bounded adapter between trusted execution state and the privileged Git port.
 * Persistence and fencing remain the caller's responsibility at every returned
 * stage boundary.
 */
export class GitWorktreeLifecycleCoordinatorV1 {
  constructor(
    private readonly gitWorktrees:
      GitWorktreePortV1 & GitWorktreeRecoveryPortV1
  ) {}

  async prepareOrRecover(
    input: GitWorktreeCoordinatorPrepareInputV1
  ): Promise<GitWorktreeCoordinatorPrepareResultV1> {
    if (input.existingLifecycle !== null) {
      const lifecycle = parseWorkspaceLifecycleV1(input.existingLifecycle);
      assertTrustedPrepareIdentity(lifecycle, input);
      if (lifecycle.runtimeCompletion || lifecycle.cleanedAt) {
        return preparedResult(lifecycle);
      }

      const recovered = await this.gitWorktrees.prepareOrRecover(
        preparePortInput(input)
      );
      const recoveredLifecycle = parseWorkspaceLifecycleV1({
        schemaVersion: WORKSPACE_LIFECYCLE_SCHEMA_VERSION_V1,
        kind: 'git-worktree',
        binding: input.binding,
        prepared: recovered,
      });
      assertTrustedPrepareIdentity(recoveredLifecycle, input);
      if (
        canonicalPreparedJson(lifecycle) !==
        canonicalPreparedJson(recoveredLifecycle)
      ) {
        invalidIdentity(
          'lifecycle.prepared',
          'Recovered workspace receipt does not match stored prepare state.'
        );
      }
      return preparedResult(lifecycle);
    }

    const prepared = await this.gitWorktrees.prepareOrRecover(
      preparePortInput(input)
    );
    const lifecycle = parseWorkspaceLifecycleV1({
      schemaVersion: WORKSPACE_LIFECYCLE_SCHEMA_VERSION_V1,
      kind: 'git-worktree',
      binding: input.binding,
      prepared,
    });
    assertTrustedPrepareIdentity(lifecycle, input);
    assertWorkspaceLifecycleAdvanceV1(null, lifecycle);
    return preparedResult(lifecycle);
  }

  async finalizeOrRecover(
    lifecycle: WorkspaceLifecycleV1
  ): Promise<WorkspaceLifecycleV1> {
    const previous = parseWorkspaceLifecycleV1(lifecycle);
    if (previous.runtimeCompletion?.status !== 'succeeded') {
      invalidAdvance(
        'A workspace may be finalized only after a succeeded runtime completion.'
      );
    }
    if (previous.finalized) return previous;

    // Validate that finalized is the next stage before invoking the mutating
    // port. A placeholder cannot satisfy the canonical receipt schema, so use
    // the lifecycle shape to reject every known non-finalize next stage here.
    if (previous.cleanedAt || previous.changeRequestId) {
      invalidAdvance('Finalized is not the next workspace lifecycle stage.');
    }

    const finalized = await this.gitWorktrees.finalizeOrRecover(
      previous.prepared
    );
    const next = parseWorkspaceLifecycleV1({ ...previous, finalized });
    assertWorkspaceLifecycleAdvanceV1(previous, next);
    return next;
  }

  async cleanupOrRecover(
    input: GitWorktreeCoordinatorCleanupInputV1
  ): Promise<WorkspaceLifecycleV1> {
    const previous = parseWorkspaceLifecycleV1(input.lifecycle);
    const next = parseWorkspaceLifecycleV1({
      ...previous,
      cleanedAt: input.cleanedAt,
    });
    assertWorkspaceLifecycleAdvanceV1(previous, next);
    if (previous.cleanedAt) return next;

    await this.gitWorktrees.cleanupOrRecover(previous.prepared);
    return next;
  }

  async inspectRecoveryState(
    lifecycle: WorkspaceLifecycleV1
  ): Promise<GitWorktreeRecoveryStateV1> {
    const parsed = parseWorkspaceLifecycleV1(lifecycle);
    return this.gitWorktrees.inspectRecoveryState(parsed.prepared);
  }

  async recoverSuspended(
    lifecycle: WorkspaceLifecycleV1
  ): Promise<GitWorktreeCoordinatorPrepareResultV1> {
    const parsed = parseWorkspaceLifecycleV1(lifecycle);
    const recovered = await this.gitWorktrees.recoverSuspended(
      parsed.prepared
    );
    if (
      canonicalPreparedJson(parsed) !==
      canonicalPreparedJson(
        parseWorkspaceLifecycleV1({
          schemaVersion: WORKSPACE_LIFECYCLE_SCHEMA_VERSION_V1,
          kind: 'git-worktree',
          binding: parsed.binding,
          prepared: recovered,
        })
      )
    ) {
      invalidIdentity(
        'lifecycle.prepared',
        'Recovered suspended workspace receipt does not match stored state.'
      );
    }
    return preparedResult(parsed);
  }

  async discardQuarantined(
    lifecycle: WorkspaceLifecycleV1
  ): Promise<void> {
    const parsed = parseWorkspaceLifecycleV1(lifecycle);
    await this.gitWorktrees.discardQuarantined(parsed.prepared);
  }
}

/** Short name retained for composition roots that do not need the distinction. */
export { GitWorktreeLifecycleCoordinatorV1 as GitWorktreeCoordinatorV1 };

function preparePortInput(input: GitWorktreeCoordinatorPrepareInputV1) {
  return {
    spaceId: input.binding.spaceId,
    mountPath: input.binding.mountPath,
    repoPath: input.repositoryPath,
    defaultBranch: input.binding.defaultBranch,
    jobId: input.jobId,
    attemptId: input.attemptId,
    attemptNumber: input.attemptNumber,
    ...(input.binding.agentId === null
      ? {}
      : { agentId: input.binding.agentId }),
    baseCommit: input.binding.baseCommit,
  };
}

function preparedResult(
  lifecycle: WorkspaceLifecycleV1
): GitWorktreeCoordinatorPrepareResultV1 {
  return {
    lifecycle,
    workspace: {
      uri: pathToFileURL(lifecycle.prepared.worktreePath).href,
      revision: lifecycle.prepared.baseCommit,
    },
  };
}

function assertTrustedPrepareIdentity(
  lifecycle: WorkspaceLifecycleV1,
  input: GitWorktreeCoordinatorPrepareInputV1
): void {
  const bindingKeys = [
    'schemaVersion',
    'bindingId',
    'spaceId',
    'workspaceId',
    'agentId',
    'mountPath',
    'defaultBranch',
    'baseCommit',
  ] as const;
  for (const key of bindingKeys) {
    if (lifecycle.binding[key] !== input.binding[key]) {
      invalidIdentity(
        `lifecycle.binding.${key}`,
        `Stored workspace binding ${key} does not match trusted input.`
      );
    }
  }

  const expectedPreparedIdentity = {
    repositoryPath: input.repositoryPath,
    jobId: input.jobId,
    attemptId: input.attemptId,
    attemptNumber: input.attemptNumber,
  };
  for (const key of Object.keys(
    expectedPreparedIdentity
  ) as Array<keyof typeof expectedPreparedIdentity>) {
    if (lifecycle.prepared[key] !== expectedPreparedIdentity[key]) {
      invalidIdentity(
        `lifecycle.prepared.${key}`,
        `Prepared workspace ${key} does not match trusted input.`
      );
    }
  }
}

function invalidIdentity(path: string, message: string): never {
  throw new WorkspaceLifecycleErrorV1('invalid-lifecycle', message, path);
}

function invalidAdvance(message: string): never {
  throw new WorkspaceLifecycleErrorV1('invalid-advance', message);
}

function canonicalPreparedJson(lifecycle: WorkspaceLifecycleV1): string {
  return serializeWorkspaceLifecycleV1({
    schemaVersion: WORKSPACE_LIFECYCLE_SCHEMA_VERSION_V1,
    kind: 'git-worktree',
    binding: lifecycle.binding,
    prepared: lifecycle.prepared,
  });
}
