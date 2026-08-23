import { expect, test } from '@playwright/test';

import { ConflictError } from '@/framework/resilience/app-error';
import type {
  ExecutionAttemptDtoV1,
  ExecutionJobDtoV1,
} from '@/objects/execution-job/schema';
import type { ExecutionRecoveryIncidentDtoV1 } from '@/objects/execution-recovery/schema';

import type { RuntimeEventV1 } from './driver';
import type { WorkspaceLifecycleV1 } from './workspace-lifecycle';
import {
  createPrismaExecutionDaemonStore,
  type PrismaExecutionDaemonCommandsV1,
} from './prisma-daemon-store';

test('maps durable worker reads and a successful claim into the daemon contract', async () => {
  const calls: Array<{ operation: string; organizationId: string }> = [];
  const commands = commandsWith({
    async listClaimableExecutionAttempts(actor) {
      calls.push({ operation: 'list', organizationId: actor.organizationId });
      return [attempt()];
    },
    async claimExecutionAttempt(actor) {
      calls.push({ operation: 'claim', organizationId: actor.organizationId });
      return attempt();
    },
    async getExecutionJob(actor) {
      calls.push({ operation: 'get', organizationId: actor.organizationId });
      return job();
    },
  });
  const store = createPrismaExecutionDaemonStore(
    { organizationId: ' test-org ' },
    commands
  );

  await expect(
    store.listCandidates({
      runtimeIds: ['runtime-1'],
      limit: 4,
      now: new Date('2026-08-21T00:00:00.000Z'),
    })
  ).resolves.toEqual([{ attemptId: 'attempt-1', runtimeId: 'runtime-1' }]);
  await expect(
    store.claim({
      attemptId: 'attempt-1',
      runtimeId: 'runtime-1',
      workerId: 'worker-1',
      leaseDurationMs: 30_000,
    })
  ).resolves.toMatchObject({
    jobId: 'job-1',
    attemptId: 'attempt-1',
    runtimeId: 'runtime-1',
    generation: 2,
    attemptNumber: 1,
    cancelRequested: false,
    executionSpec: { schemaVersion: 1, goal: 'test goal' },
    checkpointRef: 'checkpoint-1',
    knowledgeWorkspace: null,
    workspaceLifecycle: null,
  });
  expect(calls).toEqual([
    { operation: 'list', organizationId: 'test-org' },
    { operation: 'claim', organizationId: 'test-org' },
    { operation: 'get', organizationId: 'test-org' },
  ]);
});

test('maps claimed resume input to the exact daemon human input', async () => {
  const humanInput = {
    requestId: 'request-1',
    responseId: 'response-1',
    response: { approved: true, note: 'Continue', choices: [1, 'two'] },
  } as const;
  const store = createPrismaExecutionDaemonStore(
    { organizationId: 'test-org' },
    commandsWith({
      async claimExecutionAttempt() {
        return {
          ...attempt(),
          resumeInput: { schemaVersion: 1, ...humanInput },
        };
      },
    })
  );

  const claimed = await store.claim(claimInput());

  expect(claimed?.humanInput).toEqual({
    requestId: 'request-1',
    responseId: 'response-1',
    response: { approved: true, note: 'Continue', choices: [1, 'two'] },
  });
});

test('maps only ConflictError to claim loss and fencing', async () => {
  const conflict = new ConflictError(
    'Execution attempt lease is stale, expired, or owned by another worker.'
  );
  const store = createPrismaExecutionDaemonStore(
    { organizationId: 'test-org' },
    commandsWith({
      async claimExecutionAttempt() {
        throw conflict;
      },
      async heartbeatExecutionAttempt() {
        throw conflict;
      },
      async appendExecutionEvent() {
        throw conflict;
      },
      async completeExecutionAttempt() {
        throw conflict;
      },
    })
  );

  await expect(
    store.claim({
      attemptId: 'attempt-1',
      runtimeId: 'runtime-1',
      workerId: 'worker-1',
      leaseDurationMs: 30_000,
    })
  ).resolves.toBeNull();
  await expect(store.heartbeat(heartbeatInput())).resolves.toBe('fenced');
  await expect(store.appendEvent(eventInput())).resolves.toBe('fenced');
  await expect(store.complete(completionInput())).resolves.toBe('fenced');
});

test('passes successful heartbeat, event, and completion writes through', async () => {
  const commands = commandsWith();
  const store = createPrismaExecutionDaemonStore(
    { organizationId: 'test-org' },
    commands
  );

  await expect(store.heartbeat(heartbeatInput())).resolves.toBe('renewed');
  await expect(store.appendEvent(eventInput())).resolves.toBe('appended');
  await expect(store.complete(completionInput())).resolves.toBe('completed');
});

test('retries exact daemon commands after raw and Prisma-wrapped SQLite busy errors', async () => {
  const calls = new Map<string, string[]>();
  const remember = (operation: string, input: unknown) => {
    const inputs = calls.get(operation) ?? [];
    inputs.push(JSON.stringify(input));
    calls.set(operation, inputs);
    return inputs.length;
  };
  const commands = commandsWith({
    async listClaimableExecutionAttempts(_actor, input) {
      if (remember('list', input) === 1) throw rawSqliteBusy();
      return [attempt()];
    },
    async claimExecutionAttempt(_actor, input) {
      if (remember('claim', input) === 1) throw prismaSqliteBusy();
      return attempt();
    },
    async heartbeatExecutionAttempt(_actor, input) {
      if (remember('heartbeat', input) === 1) throw rawSqliteBusy();
      return attempt();
    },
    async appendExecutionEvent(_actor, input) {
      if (remember('event', input) === 1) throw prismaSqliteBusy();
      return {
        schemaVersion: 1,
        state: 'appended',
        event: {} as never,
        artifact: null,
        replayed: false,
      };
    },
    async persistExecutionWorkspaceLifecycle(_actor, input) {
      if (remember('lifecycle', input) === 1) throw rawSqliteBusy();
      return { schemaVersion: 1, lifecycle: input.lifecycle, replayed: false };
    },
    async persistExecutionTerminalEvent(_actor, input) {
      if (remember('terminal', input) === 1) throw prismaSqliteBusy();
      return {
        schemaVersion: 1,
        event: {} as never,
        lifecycle: {
          ...preparedLifecycle(),
          runtimeCompletion: input.runtimeCompletion,
        },
        replayed: false,
      };
    },
    async createKnowledgeChangeRequestForAttempt(_actor, input) {
      if (remember('change-request', input) === 1) throw rawSqliteBusy();
      return {
        schemaVersion: 1,
        changeRequest: {} as never,
        replayed: false,
      };
    },
    async completeExecutionAttempt(_actor, input) {
      if (remember('complete', input) === 1) throw prismaSqliteBusy();
      return { schemaVersion: 1, attempt: attempt(), job: job() };
    },
    async resolveExecutionRecovery(_actor, input) {
      if (remember('recovery-resolution', input) === 1) throw rawSqliteBusy();
      return 'resolved';
    },
  });
  const store = createPrismaExecutionDaemonStore(
    { organizationId: 'test-org' },
    commands,
    { delaysMs: [0], wait: async () => undefined }
  );

  await expect(
    store.listCandidates({
      runtimeIds: ['runtime-1'],
      limit: 1,
      now: new Date('2026-08-21T00:00:00.000Z'),
    })
  ).resolves.toEqual([{ attemptId: 'attempt-1', runtimeId: 'runtime-1' }]);
  await expect(store.claim(claimInput())).resolves.toMatchObject({
    attemptId: 'attempt-1',
    generation: 2,
  });
  await expect(store.heartbeat(heartbeatInput())).resolves.toBe('renewed');
  await expect(store.appendEvent(eventInput())).resolves.toBe('appended');
  await expect(
    store.persistWorkspaceLifecycle({
      attemptId: 'attempt-1',
      workerId: 'worker-1',
      generation: 2,
      lifecycle: preparedLifecycle(),
    })
  ).resolves.toBe('persisted');
  await expect(store.persistTerminalEvent(terminalInput())).resolves.toBe(
    'appended'
  );
  await expect(
    store.createKnowledgeChangeRequest(changeRequestInput())
  ).resolves.not.toBe('fenced');
  await expect(
    store.resolveRecoveryAction?.({
      incidentId: 'recovery-1',
      attemptId: 'attempt-1',
      workerId: 'worker-1',
      generation: 2,
      resolution: 'retried',
    })
  ).resolves.toBe('resolved');
  await expect(store.complete(completionInput())).resolves.toBe('completed');

  for (const [operation, inputs] of calls) {
    expect(inputs, `${operation} retry count`).toHaveLength(2);
    expect(inputs[1], `${operation} retry identity`).toBe(inputs[0]);
  }
});

test('passes a suspended append result through to the daemon', async () => {
  const store = createPrismaExecutionDaemonStore(
    { organizationId: 'test-org' },
    commandsWith({
      async appendExecutionEvent() {
        return {
          schemaVersion: 1,
          state: 'suspended',
          event: {} as never,
          artifact: null,
          replayed: false,
        };
      },
    })
  );

  await expect(
    store.appendEvent({
      ...eventInput(),
      event: {
        type: 'waiting-for-human',
        requestId: 'request-1',
        prompt: 'Approve the proposed change?',
      },
    })
  ).resolves.toBe('suspended');
});

test('returns the private frozen workspace, parsed lifecycle, and cancellation state', async () => {
  const lifecycle = preparedLifecycle();
  const commands = commandsWith({
    async claimExecutionAttempt() {
      return { ...attempt(), cancelRequested: true };
    },
    async getExecutionJob() {
      return job({ knowledgeCommit: frozenBinding() });
    },
    async loadExecutionAttemptWorkspace() {
      return {
        schemaVersion: 1,
        hasKnowledgeWorkspace: true,
        knowledgeWorkspace: {
          binding: frozenBinding(),
          repositoryPath: '/trusted/repository',
        },
        workspaceLifecycleJson: JSON.stringify(lifecycle),
      };
    },
  });
  const store = createPrismaExecutionDaemonStore(
    { organizationId: 'test-org' },
    commands
  );

  await expect(store.claim(claimInput())).resolves.toMatchObject({
    attemptNumber: 1,
    cancelRequested: true,
    knowledgeWorkspace: {
      binding: frozenBinding(),
      repositoryPath: '/trusted/repository',
    },
    workspaceLifecycle: lifecycle,
  });
  const claim = await store.claim(claimInput());
  expect(claim?.knowledgeWorkspace).not.toHaveProperty('credentialRef');
});

test('fails a claim closed when the live binding differs from the frozen manifest', async () => {
  const commands = commandsWith({
    async getExecutionJob() {
      return job({ knowledgeCommit: frozenBinding() });
    },
    async loadExecutionAttemptWorkspace() {
      return {
        schemaVersion: 1,
        hasKnowledgeWorkspace: true,
        knowledgeWorkspace: {
          binding: { ...frozenBinding(), defaultBranch: 'other' },
          repositoryPath: '/trusted/repository',
        },
        workspaceLifecycleJson: null,
      };
    },
  });
  const store = createPrismaExecutionDaemonStore(
    { organizationId: 'test-org' },
    commands
  );

  await expect(store.claim(claimInput())).resolves.toBeNull();
});

test('propagates heartbeat cancellation and adapts fenced lifecycle commands', async () => {
  const calls: string[] = [];
  const conflict = new ConflictError(
    'Execution attempt lease is stale, expired, or owned by another worker.'
  );
  const store = createPrismaExecutionDaemonStore(
    { organizationId: 'test-org' },
    commandsWith({
      async heartbeatExecutionAttempt() {
        return { ...attempt(), cancelRequested: true };
      },
      async persistExecutionWorkspaceLifecycle() {
        calls.push('lifecycle');
        throw conflict;
      },
      async persistExecutionTerminalEvent() {
        calls.push('terminal');
        throw conflict;
      },
      async createKnowledgeChangeRequestForAttempt() {
        calls.push('change-request');
        throw conflict;
      },
    })
  );

  await expect(store.heartbeat(heartbeatInput())).resolves.toBe(
    'cancel-requested'
  );
  await expect(
    store.persistWorkspaceLifecycle({
      attemptId: 'attempt-1',
      workerId: 'worker-1',
      generation: 2,
      lifecycle: preparedLifecycle(),
    })
  ).resolves.toBe('fenced');
  await expect(
    store.persistTerminalEvent(terminalInput())
  ).resolves.toBe('fenced');
  await expect(
    store.createKnowledgeChangeRequest(changeRequestInput())
  ).resolves.toBe('fenced');
  expect(calls).toEqual(['lifecycle', 'terminal', 'change-request']);
});

test('requires cleaned lifecycle before completing a worktree attempt', async () => {
  let completed = false;
  const commands = commandsWith({
    async loadExecutionAttemptWorkspace() {
      return {
        schemaVersion: 1,
        hasKnowledgeWorkspace: true,
        knowledgeWorkspace: null,
        workspaceLifecycleJson: JSON.stringify(preparedLifecycle()),
      };
    },
    async completeExecutionAttempt() {
      completed = true;
      return { schemaVersion: 1, attempt: attempt(), job: job() };
    },
  });
  const store = createPrismaExecutionDaemonStore(
    { organizationId: 'test-org' },
    commands
  );

  await expect(store.complete(completionInput())).resolves.toBe('fenced');
  expect(completed).toBe(false);
});

test('allows cancellation when a worktree was authorized but never prepared', async () => {
  let completed = false;
  const commands = commandsWith({
    async loadExecutionAttemptWorkspace() {
      return {
        schemaVersion: 1,
        hasKnowledgeWorkspace: true,
        knowledgeWorkspace: null,
        workspaceLifecycleJson: null,
      };
    },
    async completeExecutionAttempt() {
      completed = true;
      return { schemaVersion: 1, attempt: attempt(), job: job() };
    },
  });
  const store = createPrismaExecutionDaemonStore(
    { organizationId: 'test-org' },
    commands
  );

  await expect(
    store.complete({ ...completionInput(), status: 'cancelled' })
  ).resolves.toBe('completed');
  expect(completed).toBe(true);
});

test('allows cleanup-stage persistence after cancellation is requested', async () => {
  let persisted: WorkspaceLifecycleV1 | undefined;
  const commands = commandsWith({
    async persistExecutionWorkspaceLifecycle(_actor, input) {
      persisted = input.lifecycle;
      return {
        schemaVersion: 1,
        lifecycle: input.lifecycle,
        replayed: false,
      };
    },
  });
  const store = createPrismaExecutionDaemonStore(
    { organizationId: 'test-org' },
    commands
  );
  const lifecycle: WorkspaceLifecycleV1 = {
    ...preparedLifecycle(),
    runtimeCompletion: { status: 'cancelled' },
    cleanedAt: '2026-08-21T00:01:00.000Z',
  };

  await expect(
    store.persistWorkspaceLifecycle({
      attemptId: 'attempt-1',
      workerId: 'worker-1',
      generation: 2,
      lifecycle,
    })
  ).resolves.toBe('persisted');
  expect(persisted).toEqual(lifecycle);
});

test('propagates non-conflict worker failures', async () => {
  const failure = new Error('database unavailable');
  const store = createPrismaExecutionDaemonStore(
    { organizationId: 'test-org' },
    commandsWith({
      async heartbeatExecutionAttempt() {
        throw failure;
      },
    })
  );

  await expect(store.heartbeat(heartbeatInput())).rejects.toBe(failure);
});

test('does not misclassify an event identity conflict as lease fencing', async () => {
  const conflict = new ConflictError(
    'runtimeEventId was already used with different event content.'
  );
  const store = createPrismaExecutionDaemonStore(
    { organizationId: 'test-org' },
    commandsWith({
      async appendExecutionEvent() {
        throw conflict;
      },
    })
  );

  await expect(store.appendEvent(eventInput())).rejects.toBe(conflict);
});

function commandsWith(
  overrides: Partial<PrismaExecutionDaemonCommandsV1> = {}
): PrismaExecutionDaemonCommandsV1 {
  return {
    async listClaimableExecutionAttempts() {
      return [];
    },
    async claimExecutionAttempt() {
      return attempt();
    },
    async getExecutionJob() {
      return job();
    },
    async heartbeatExecutionAttempt() {
      return attempt();
    },
    async appendExecutionEvent() {
      return {
        schemaVersion: 1,
        state: 'appended',
        event: {} as never,
        artifact: null,
        replayed: false,
      };
    },
    async completeExecutionAttempt() {
      return { schemaVersion: 1, attempt: attempt(), job: job() };
    },
    async loadExecutionAttemptWorkspace() {
      return {
        schemaVersion: 1,
        hasKnowledgeWorkspace: false,
        knowledgeWorkspace: null,
        workspaceLifecycleJson: null,
      };
    },
    async persistExecutionWorkspaceLifecycle(_actor, input) {
      return {
        schemaVersion: 1,
        lifecycle: input.lifecycle,
        replayed: false,
      };
    },
    async persistExecutionTerminalEvent(_actor, input) {
      return {
        schemaVersion: 1,
        event: {} as never,
        lifecycle: {
          ...preparedLifecycle(),
          runtimeCompletion: input.runtimeCompletion,
        } as WorkspaceLifecycleV1,
        replayed: false,
      };
    },
    async createKnowledgeChangeRequestForAttempt() {
      return {
        schemaVersion: 1,
        changeRequest: {} as never,
        replayed: false,
      };
    },
    async quarantineExecutionWorkspaceRecovery() {
      return recoveryIncident();
    },
    async getRequestedExecutionRecoveryAction() {
      return null;
    },
    async resolveExecutionRecovery() {
      return 'resolved' as const;
    },
    ...overrides,
  };
}

function recoveryIncident(): ExecutionRecoveryIncidentDtoV1 {
  return {
    schemaVersion: 1,
    id: 'recovery-1',
    jobId: 'job-1',
    attemptId: 'attempt-1',
    generation: 2,
    stage: 'prepare',
    reasonCode: 'workspace-state-changed',
    classification: 'prepared-dirty',
    discardable: true,
    status: 'open',
    requestedAction: null,
    resolution: null,
    actionRequestedAt: null,
    actionRequestedById: null,
    resolvedAt: null,
    revision: 1,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
}

function attempt(): ExecutionAttemptDtoV1 {
  return {
    schemaVersion: 1,
    id: 'attempt-1',
    jobId: 'job-1',
    runtimeId: 'runtime-1',
    number: 1,
    status: 'running',
    generation: 2,
    leaseOwnerId: 'worker-1',
    leaseExpiresAt: '2026-08-21T00:01:00.000Z',
    lastHeartbeatAt: '2026-08-21T00:00:30.000Z',
    runtimeRunId: 'runtime-run-1',
    checkpoint: 'checkpoint-1',
    result: null,
    error: null,
    startedAt: '2026-08-21T00:00:00.000Z',
    finishedAt: null,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:30.000Z',
  };
}

function job(
  overrides: Partial<ExecutionJobDtoV1['contextManifest']> = {}
): ExecutionJobDtoV1 {
  return {
    schemaVersion: 1,
    id: 'job-1',
    organizationId: 'test-org',
    teamTaskId: null,
    originRoomId: null,
    originRoomMessageId: null,
    kind: 'coding',
    status: 'running',
    priority: 0,
    spec: {
      schemaVersion: 1,
      goal: 'test goal',
      kind: 'coding',
      requirements: {},
    },
    requirements: {},
    contextManifest: {
      schemaVersion: 1,
      goal: 'test goal',
      frozenAt: '2026-08-21T00:00:00.000Z',
      source: {
        type: 'workspace-draft',
        workspaceId: 'workspace-1',
        conversationId: null,
        documentVersionId: null,
      },
      workspace: {
        id: 'workspace-1',
        projectId: null,
        title: 'Test',
        draftRevision: 1,
        revision: 1,
      },
      document: {
        id: 'workspace-1',
        title: 'Test',
        versionId: null,
        revision: 1,
        content: '',
        contentSha256: '0'.repeat(64),
      },
      files: [],
      roomWatermark: null,
      knowledgeCommit: null,
      ...overrides,
    },
    selection: {} as ExecutionJobDtoV1['selection'],
    requestedRuntimeId: null,
    selectedRuntimeId: 'runtime-1',
    selectionReason: null,
    selectedAt: '2026-08-21T00:00:00.000Z',
    maxAttempts: 1,
    deadlineAt: null,
    queuedAt: '2026-08-21T00:00:00.000Z',
    startedAt: '2026-08-21T00:00:00.000Z',
    finishedAt: null,
    cancelRequestedAt: null,
    result: null,
    error: null,
    revision: 1,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
    attempts: [attempt()],
  };
}

function heartbeatInput() {
  return {
    attemptId: 'attempt-1',
    workerId: 'worker-1',
    generation: 2,
    leaseDurationMs: 30_000,
    checkpointRef: 'checkpoint-2',
    runtimeRunId: 'runtime-run-1',
  };
}

function eventInput() {
  return {
    attemptId: 'attempt-1',
    workerId: 'worker-1',
    generation: 2,
    runtimeEventId: 'event-1',
    event: { type: 'text-delta', text: 'hello' } as RuntimeEventV1,
    occurredAt: new Date('2026-08-21T00:00:30.000Z'),
  };
}

function completionInput() {
  return {
    attemptId: 'attempt-1',
    workerId: 'worker-1',
    generation: 2,
    status: 'succeeded' as const,
  };
}

function claimInput() {
  return {
    attemptId: 'attempt-1',
    runtimeId: 'runtime-1',
    workerId: 'worker-1',
    leaseDurationMs: 30_000,
  };
}

function frozenBinding() {
  return {
    schemaVersion: 1 as const,
    bindingId: 'binding-1',
    spaceId: 'space-1',
    workspaceId: 'workspace-1',
    agentId: null,
    mountPath: '/' as const,
    defaultBranch: 'main',
    baseCommit: 'a'.repeat(40),
  };
}

function preparedLifecycle(): WorkspaceLifecycleV1 {
  return {
    schemaVersion: 1,
    kind: 'git-worktree',
    binding: frozenBinding(),
    prepared: {
      schemaVersion: 1,
      spaceId: 'space-1',
      mountPath: '/',
      repositoryPath: '/trusted/repository',
      worktreePath: '/trusted/worktree',
      defaultBranch: 'main',
      branch: 'agent/attempt-1',
      baseCommit: 'a'.repeat(40),
      jobId: 'job-1',
      attemptId: 'attempt-1',
      attemptNumber: 1,
    },
  };
}

function terminalInput() {
  return {
    attemptId: 'attempt-1',
    workerId: 'worker-1',
    generation: 2,
    runtimeEventId: 'terminal-1',
    event: { type: 'attempt-completed', status: 'succeeded' } as const,
    runtimeCompletion: { status: 'succeeded' } as const,
    occurredAt: new Date('2026-08-21T00:00:30.000Z'),
  };
}

function changeRequestInput() {
  const lifecycle = preparedLifecycle();
  return {
    attemptId: 'attempt-1',
    workerId: 'worker-1',
    generation: 2,
    binding: frozenBinding(),
    prepared: lifecycle.prepared,
    finalized: {
      schemaVersion: 1 as const,
      spaceId: 'space-1',
      jobId: 'job-1',
      attemptId: 'attempt-1',
      changed: true,
      baseCommit: 'a'.repeat(40),
      headCommit: 'b'.repeat(40),
      branch: 'agent/attempt-1',
      files: ['file.ts'],
      diffSummary: {
        filesChanged: 1,
        insertions: 1,
        deletions: 0,
        shortStat: '1 file changed, 1 insertion(+)',
      },
      patchSha256: 'c'.repeat(64),
    },
  };
}

function rawSqliteBusy(): Error {
  return Object.assign(new Error('database is locked'), {
    code: 'SQLITE_BUSY',
    rawCode: 5,
  });
}

function prismaSqliteBusy(): Error {
  return Object.assign(new Error('Socket timeout'), {
    code: 'P1008',
    meta: {
      driverAdapterError: {
        cause: {
          kind: 'SocketTimeout',
          originalCode: '5',
          originalMessage: 'database is locked',
        },
      },
    },
  });
}
