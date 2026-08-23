import { expect, test } from '@playwright/test';

import type {
  FinalizedGitWorktreeV1,
  GitWorktreePortV1,
  GitWorktreePrepareInputV1,
  GitWorktreeRecoveryPortV1,
  GitWorktreeRecoveryStateV1,
  PreparedGitWorktreeV1,
} from '@/agent/knowledge/contracts';

import {
  GitWorktreeLifecycleCoordinatorV1,
  addWorkspaceRuntimeCompletionV1,
} from './git-worktree-coordinator';
import {
  WorkspaceLifecycleErrorV1,
  type FrozenKnowledgeBindingV1,
  type WorkspaceLifecycleV1,
  type WorkspaceRuntimeCompletionV1,
} from './workspace-lifecycle';

const BASE = '1'.repeat(40);
const HEAD = '2'.repeat(40);
const PATCH = '3'.repeat(64);
const CLEANED_AT = '2026-08-21T05:06:07.000Z';

const binding: FrozenKnowledgeBindingV1 = {
  schemaVersion: 1,
  bindingId: 'binding-1',
  spaceId: 'space-1',
  workspaceId: 'workspace-1',
  agentId: 'agent-1',
  mountPath: '/',
  defaultBranch: 'main',
  baseCommit: BASE,
};

const prepared: PreparedGitWorktreeV1 = {
  schemaVersion: 1,
  spaceId: binding.spaceId,
  mountPath: '/',
  repositoryPath: '/trusted/repos/knowledge',
  worktreePath: '/trusted/worktrees/attempt one',
  defaultBranch: binding.defaultBranch,
  branch: 'agent/agent-1/job/job-1/attempt/1',
  baseCommit: binding.baseCommit,
  jobId: 'job-1',
  attemptId: 'attempt-1',
  attemptNumber: 1,
  agentId: 'agent-1',
};

const changedFinalized: FinalizedGitWorktreeV1 = {
  schemaVersion: 1,
  spaceId: binding.spaceId,
  jobId: prepared.jobId,
  attemptId: prepared.attemptId,
  agentId: binding.agentId ?? undefined,
  changed: true,
  baseCommit: BASE,
  headCommit: HEAD,
  branch: prepared.branch,
  files: ['README.md'],
  diffSummary: {
    filesChanged: 1,
    insertions: 1,
    deletions: 0,
    shortStat: '1 file changed, 1 insertion(+)',
  },
  patchSha256: PATCH,
};

const unchangedFinalized: FinalizedGitWorktreeV1 = {
  ...changedFinalized,
  changed: false,
  headCommit: BASE,
  files: [],
  diffSummary: {
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    shortStat: '',
  },
  patchSha256: '0'.repeat(64),
};

const succeeded: WorkspaceRuntimeCompletionV1 = {
  status: 'succeeded',
  result: { z: true, a: 'canonical' },
  runtimeRunId: 'runtime-run-1',
};

function preparedLifecycle(): WorkspaceLifecycleV1 {
  return {
    schemaVersion: 1,
    kind: 'git-worktree',
    binding,
    prepared,
  };
}

function coordinatorInput(
  existingLifecycle: WorkspaceLifecycleV1 | null = null
) {
  return {
    jobId: prepared.jobId,
    attemptId: prepared.attemptId,
    attemptNumber: prepared.attemptNumber,
    binding,
    repositoryPath: prepared.repositoryPath,
    existingLifecycle,
  };
}

class FakeGitWorktreePort
  implements GitWorktreePortV1, GitWorktreeRecoveryPortV1
{
  readonly prepareInputs: GitWorktreePrepareInputV1[] = [];
  readonly finalizeInputs: PreparedGitWorktreeV1[] = [];
  readonly cleanupInputs: PreparedGitWorktreeV1[] = [];
  readonly inspectRecoveryInputs: PreparedGitWorktreeV1[] = [];
  readonly recoverSuspendedInputs: PreparedGitWorktreeV1[] = [];
  readonly discardQuarantinedInputs: PreparedGitWorktreeV1[] = [];

  preparedResult: PreparedGitWorktreeV1 = prepared;
  finalizedResult: FinalizedGitWorktreeV1 = changedFinalized;
  recoveryStateResult: GitWorktreeRecoveryStateV1 = {
    schemaVersion: 1,
    state: 'prepared-clean',
  };
  recoveredResult: PreparedGitWorktreeV1 = prepared;

  async prepare(
    input: GitWorktreePrepareInputV1
  ): Promise<PreparedGitWorktreeV1> {
    return this.prepareOrRecover(input);
  }

  async prepareOrRecover(
    input: GitWorktreePrepareInputV1
  ): Promise<PreparedGitWorktreeV1> {
    this.prepareInputs.push(input);
    return this.preparedResult;
  }

  async finalize(
    receipt: PreparedGitWorktreeV1
  ): Promise<FinalizedGitWorktreeV1> {
    return this.finalizeOrRecover(receipt);
  }

  async finalizeOrRecover(
    receipt: PreparedGitWorktreeV1
  ): Promise<FinalizedGitWorktreeV1> {
    this.finalizeInputs.push(receipt);
    return this.finalizedResult;
  }

  async cleanup(receipt: PreparedGitWorktreeV1): Promise<void> {
    await this.cleanupOrRecover(receipt);
  }

  async cleanupOrRecover(receipt: PreparedGitWorktreeV1): Promise<void> {
    this.cleanupInputs.push(receipt);
  }

  async inspectRecoveryState(
    receipt: PreparedGitWorktreeV1
  ): Promise<GitWorktreeRecoveryStateV1> {
    this.inspectRecoveryInputs.push(receipt);
    return this.recoveryStateResult;
  }

  async recoverSuspended(
    receipt: PreparedGitWorktreeV1
  ): Promise<PreparedGitWorktreeV1> {
    this.recoverSuspendedInputs.push(receipt);
    return this.recoveredResult;
  }

  async discardQuarantined(
    receipt: PreparedGitWorktreeV1
  ): Promise<void> {
    this.discardQuarantinedInputs.push(receipt);
  }
}

test('prepares from trusted identity and exposes only a file URI to the runtime', async () => {
  const port = new FakeGitWorktreePort();
  const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);

  const result = await coordinator.prepareOrRecover(coordinatorInput());

  expect(port.prepareInputs).toEqual([
    {
      spaceId: binding.spaceId,
      mountPath: '/',
      repoPath: prepared.repositoryPath,
      defaultBranch: binding.defaultBranch,
      jobId: prepared.jobId,
      attemptId: prepared.attemptId,
      attemptNumber: prepared.attemptNumber,
      agentId: binding.agentId,
      baseCommit: binding.baseCommit,
    },
  ]);
  expect(result.lifecycle).toEqual(preparedLifecycle());
  expect(result.workspace).toEqual({
    uri: 'file:///trusted/worktrees/attempt%20one',
    revision: BASE,
  });
  expect(result.workspace).not.toHaveProperty('repositoryPath');
  expect(JSON.stringify(result.workspace)).not.toContain(
    prepared.repositoryPath
  );
});

test('reclaims prepare-only state by revalidating Git', async () => {
  const port = new FakeGitWorktreePort();
  const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);
  const lifecycle = preparedLifecycle();

  const result = await coordinator.prepareOrRecover(
    coordinatorInput(lifecycle)
  );

  expect(port.prepareInputs).toHaveLength(1);
  expect(result.lifecycle).toEqual(lifecycle);
});

test('preserves completed state without applying prepare-phase Git validation', async () => {
  const port = new FakeGitWorktreePort();
  const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);
  const lifecycle = addWorkspaceRuntimeCompletionV1(
    preparedLifecycle(),
    succeeded
  );

  const result = await coordinator.prepareOrRecover(
    coordinatorInput(lifecycle)
  );

  expect(port.prepareInputs).toEqual([]);
  expect(result.lifecycle).toEqual(lifecycle);
  expect(result.workspace.uri).toBe(
    'file:///trusted/worktrees/attempt%20one'
  );
});

test('preserves finalized state without applying prepare-phase Git validation', async () => {
  const port = new FakeGitWorktreePort();
  const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);
  const lifecycle: WorkspaceLifecycleV1 = {
    ...addWorkspaceRuntimeCompletionV1(preparedLifecycle(), succeeded),
    finalized: changedFinalized,
  };

  const result = await coordinator.prepareOrRecover(
    coordinatorInput(lifecycle)
  );

  expect(result.lifecycle).toEqual(lifecycle);
  expect(port.prepareInputs).toEqual([]);
});

test('does not recreate a cleaned lifecycle during reclaim', async () => {
  const port = new FakeGitWorktreePort();
  const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);
  const completed = addWorkspaceRuntimeCompletionV1(preparedLifecycle(), {
    status: 'failed',
    error: { message: 'runtime failed' },
  });
  const cleaned = await coordinator.cleanupOrRecover({
    lifecycle: completed,
    cleanedAt: CLEANED_AT,
  });
  port.cleanupInputs.length = 0;

  const replay = await coordinator.prepareOrRecover(
    coordinatorInput(cleaned)
  );

  expect(replay.lifecycle).toEqual(cleaned);
  expect(port.prepareInputs).toEqual([]);
  expect(port.cleanupInputs).toEqual([]);
});

test('fails closed when recovered Git prepare state differs from the durable receipt', async () => {
  const port = new FakeGitWorktreePort();
  port.preparedResult = {
    ...prepared,
    worktreePath: '/trusted/worktrees/lookalike',
  };
  const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);

  await expect(
    coordinator.prepareOrRecover(coordinatorInput(preparedLifecycle()))
  ).rejects.toMatchObject({
    code: 'invalid-lifecycle',
    path: 'lifecycle.prepared',
  });
  expect(port.prepareInputs).toHaveLength(1);
});

test('accepts a recovered receipt with different property insertion order', async () => {
  const port = new FakeGitWorktreePort();
  port.preparedResult = {
    attemptId: prepared.attemptId,
    worktreePath: prepared.worktreePath,
    schemaVersion: 1,
    branch: prepared.branch,
    repositoryPath: prepared.repositoryPath,
    baseCommit: prepared.baseCommit,
    spaceId: prepared.spaceId,
    attemptNumber: prepared.attemptNumber,
    defaultBranch: prepared.defaultBranch,
    jobId: prepared.jobId,
    agentId: prepared.agentId,
    mountPath: '/',
  };
  const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);

  await expect(
    coordinator.prepareOrRecover(coordinatorInput(preparedLifecycle()))
  ).resolves.toMatchObject({ lifecycle: preparedLifecycle() });
  expect(port.prepareInputs).toHaveLength(1);
});

test('rejects trusted identity mismatches before touching Git', async () => {
  const variants = [
    { field: 'jobId', value: 'other-job' },
    { field: 'attemptId', value: 'other-attempt' },
    { field: 'attemptNumber', value: 2 },
    { field: 'repositoryPath', value: '/trusted/repos/other' },
  ] as const;

  for (const variant of variants) {
    const port = new FakeGitWorktreePort();
    const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);
    await expect(
      coordinator.prepareOrRecover({
        ...coordinatorInput(preparedLifecycle()),
        [variant.field]: variant.value,
      })
    ).rejects.toBeInstanceOf(WorkspaceLifecycleErrorV1);
    expect(port.prepareInputs, variant.field).toEqual([]);
  }

  const port = new FakeGitWorktreePort();
  const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);
  await expect(
    coordinator.prepareOrRecover({
      ...coordinatorInput(preparedLifecycle()),
      binding: { ...binding, bindingId: 'other-binding' },
    })
  ).rejects.toMatchObject({
    code: 'invalid-lifecycle',
    path: 'lifecycle.binding.bindingId',
  });
  expect(port.prepareInputs).toEqual([]);
});

test('adds runtime completion as one immutable, canonical stage', () => {
  const preparedState = preparedLifecycle();
  const completed = addWorkspaceRuntimeCompletionV1(
    preparedState,
    succeeded
  );

  expect(completed.runtimeCompletion).toEqual({
    status: 'succeeded',
    result: { a: 'canonical', z: true },
    runtimeRunId: 'runtime-run-1',
  });
  expect(addWorkspaceRuntimeCompletionV1(completed, succeeded)).toEqual(
    completed
  );
  expect(() =>
    addWorkspaceRuntimeCompletionV1(completed, { status: 'cancelled' })
  ).toThrow(WorkspaceLifecycleErrorV1);
});

test('finalizes changed and unchanged successful workspaces one stage at a time', async () => {
  for (const finalized of [changedFinalized, unchangedFinalized]) {
    const port = new FakeGitWorktreePort();
    port.finalizedResult = finalized;
    const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);
    const completed = addWorkspaceRuntimeCompletionV1(
      preparedLifecycle(),
      succeeded
    );

    const result = await coordinator.finalizeOrRecover(completed);
    const replay = await coordinator.finalizeOrRecover(result);

    expect(result.finalized).toEqual(finalized);
    expect(replay).toEqual(result);
    expect(port.finalizeInputs).toEqual([prepared]);
  }
});

test('rejects finalization for missing, failed, and cancelled runtime completion', async () => {
  const states = [
    preparedLifecycle(),
    addWorkspaceRuntimeCompletionV1(preparedLifecycle(), {
      status: 'failed',
      error: 'failed',
    }),
    addWorkspaceRuntimeCompletionV1(preparedLifecycle(), {
      status: 'cancelled',
    }),
  ];

  for (const lifecycle of states) {
    const port = new FakeGitWorktreePort();
    const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);
    await expect(
      coordinator.finalizeOrRecover(lifecycle)
    ).rejects.toMatchObject({ code: 'invalid-advance' });
    expect(port.finalizeInputs).toEqual([]);
  }
});

test('cleans failed, cancelled, and successful unchanged workspaces at their valid next stage', async () => {
  const failed = addWorkspaceRuntimeCompletionV1(preparedLifecycle(), {
    status: 'failed',
  });
  const cancelled = addWorkspaceRuntimeCompletionV1(preparedLifecycle(), {
    status: 'cancelled',
  });

  for (const lifecycle of [failed, cancelled]) {
    const port = new FakeGitWorktreePort();
    const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);
    const result = await coordinator.cleanupOrRecover({
      lifecycle,
      cleanedAt: '2026-08-21T05:06:07Z',
    });
    expect(result.cleanedAt).toBe(CLEANED_AT);
    expect(port.cleanupInputs).toEqual([prepared]);
  }

  const port = new FakeGitWorktreePort();
  port.finalizedResult = unchangedFinalized;
  const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);
  const finalized = await coordinator.finalizeOrRecover(
    addWorkspaceRuntimeCompletionV1(preparedLifecycle(), succeeded)
  );
  const result = await coordinator.cleanupOrRecover({
    lifecycle: finalized,
    cleanedAt: CLEANED_AT,
  });
  expect(result.cleanedAt).toBe(CLEANED_AT);
  expect(port.cleanupInputs).toEqual([prepared]);
});

test('requires a change request before cleaning a changed workspace', async () => {
  const port = new FakeGitWorktreePort();
  const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);
  const finalized = await coordinator.finalizeOrRecover(
    addWorkspaceRuntimeCompletionV1(preparedLifecycle(), succeeded)
  );

  await expect(
    coordinator.cleanupOrRecover({ lifecycle: finalized, cleanedAt: CLEANED_AT })
  ).rejects.toMatchObject({ code: 'invalid-advance' });
  expect(port.cleanupInputs).toEqual([]);

  const proposed: WorkspaceLifecycleV1 = {
    ...finalized,
    changeRequestId: 'change-1',
  };
  const cleaned = await coordinator.cleanupOrRecover({
    lifecycle: proposed,
    cleanedAt: CLEANED_AT,
  });
  expect(cleaned.cleanedAt).toBe(CLEANED_AT);
  expect(port.cleanupInputs).toEqual([prepared]);
});

test('cleanup replay is exact and never calls Git again', async () => {
  const port = new FakeGitWorktreePort();
  const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);
  const failed = addWorkspaceRuntimeCompletionV1(preparedLifecycle(), {
    status: 'failed',
  });
  const cleaned = await coordinator.cleanupOrRecover({
    lifecycle: failed,
    cleanedAt: CLEANED_AT,
  });

  const replay = await coordinator.cleanupOrRecover({
    lifecycle: cleaned,
    cleanedAt: '2026-08-21T05:06:07Z',
  });
  expect(replay).toEqual(cleaned);
  expect(port.cleanupInputs).toEqual([prepared]);

  await expect(
    coordinator.cleanupOrRecover({
      lifecycle: cleaned,
      cleanedAt: '2026-08-21T05:06:08Z',
    })
  ).rejects.toMatchObject({ code: 'invalid-advance' });
  expect(port.cleanupInputs).toEqual([prepared]);
});

test('cleanup rejects a skipped stage before invoking Git', async () => {
  const port = new FakeGitWorktreePort();
  const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);

  await expect(
    coordinator.cleanupOrRecover({
      lifecycle: preparedLifecycle(),
      cleanedAt: CLEANED_AT,
    })
  ).rejects.toMatchObject({ code: 'invalid-advance' });
  expect(port.cleanupInputs).toEqual([]);
});

test('forwards recovery inspection using the durable prepared receipt', async () => {
  const port = new FakeGitWorktreePort();
  port.recoveryStateResult = { schemaVersion: 1, state: 'prepared-dirty' };
  const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);

  await expect(
    coordinator.inspectRecoveryState(preparedLifecycle())
  ).resolves.toEqual({ schemaVersion: 1, state: 'prepared-dirty' });
  expect(port.inspectRecoveryInputs).toEqual([prepared]);
});

test('recovers a suspended workspace only when the receipt matches exactly', async () => {
  const port = new FakeGitWorktreePort();
  const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);

  await expect(
    coordinator.recoverSuspended(preparedLifecycle())
  ).resolves.toEqual({
    lifecycle: preparedLifecycle(),
    workspace: {
      uri: 'file:///trusted/worktrees/attempt%20one',
      revision: BASE,
    },
  });
  expect(port.recoverSuspendedInputs).toEqual([prepared]);

  port.recoveredResult = {
    ...prepared,
    worktreePath: '/trusted/worktrees/lookalike',
  };
  await expect(
    coordinator.recoverSuspended(preparedLifecycle())
  ).rejects.toMatchObject({
    code: 'invalid-lifecycle',
    path: 'lifecycle.prepared',
  });
  expect(port.recoverSuspendedInputs).toEqual([prepared, prepared]);
});

test('forwards quarantined discard using the durable prepared receipt', async () => {
  const port = new FakeGitWorktreePort();
  const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);

  await coordinator.discardQuarantined(preparedLifecycle());

  expect(port.discardQuarantinedInputs).toEqual([prepared]);
});
