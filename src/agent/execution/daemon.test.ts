import { expect, test } from '@playwright/test';

import { RUNTIME_CONTRACT_VERSION_V1 } from './contracts';
import {
  ExecutionDaemonV1,
  type AppendExecutionDaemonEventInputV1,
  type CompleteExecutionDaemonAttemptInputV1,
  type ExecutionDaemonClaimV1,
  type ExecutionDaemonLoggerV1,
  type ExecutionDaemonStoreV1,
  type ExecutionDaemonWaitV1,
  type ExecutionDaemonWorkspaceCoordinatorV1,
  type HeartbeatExecutionDaemonAttemptInputV1,
  type PersistExecutionDaemonTerminalEventInputV1,
  type PersistExecutionDaemonWorkspaceLifecycleInputV1,
} from './daemon';
import type {
  ExecutionRuntimeDriverV1,
  RuntimeEventV1,
  RuntimeResumeAttemptV1,
  RuntimeStartAttemptV1,
} from './driver';
import { ExecutionRuntimeDriverRegistryV1 } from './registry';
import type { WorkspaceLifecycleV1 } from './workspace-lifecycle';

const VERSION = RUNTIME_CONTRACT_VERSION_V1;
const TEST_NOW = new Date('2026-08-21T12:00:00.000Z');

test('persists every success event before completing with aggregated text', async () => {
  const order: string[] = [];
  const driver = testDriver({
    events: [
      { type: 'attempt-started', runtimeAttemptId: 'runtime-run-1' },
      { type: 'text-delta', text: 'hello ' },
      { type: 'progress', message: 'generic-cli/stdout-truncated' },
      { type: 'text-delta', text: 'world' },
      {
        type: 'attempt-completed',
        status: 'succeeded',
        message: 'generic-cli/succeeded',
      },
    ],
  });
  const store = testStore({
    appendEvent: async (input) => {
      order.push(`event:${input.event.type}`);
      return 'appended';
    },
    complete: async (input) => {
      order.push('complete');
      expect(input).toMatchObject({
        attemptId: 'attempt-1',
        generation: 1,
        runtimeRunId: 'runtime-run-1',
        status: 'succeeded',
        result: {
          message: 'generic-cli/succeeded',
          runtimeRunId: 'runtime-run-1',
          text: 'hello world',
          truncated: true,
        },
      });
      return 'completed';
    },
  });
  const daemon = await daemonWith(driver, store);

  const running = daemon.run();
  await eventually(() => order.includes('complete'));
  await daemon.drain();
  await running;

  expect(order).toEqual([
    'event:attempt-started',
    'event:text-delta',
    'event:progress',
    'event:text-delta',
    'event:attempt-completed',
    'complete',
  ]);
});

test('heartbeat fencing interrupts the runtime and never completes', async () => {
  const gate = deferred<void>();
  const interrupts: string[] = [];
  const completions: CompleteExecutionDaemonAttemptInputV1[] = [];
  const driver = testDriver({
    events: async function* () {
      yield {
        type: 'attempt-started',
        runtimeAttemptId: 'runtime-fenced',
      };
      await gate.promise;
      yield { type: 'attempt-completed', status: 'succeeded' };
    },
    interrupt: async (input) => {
      interrupts.push(input.reason || '');
      gate.resolve();
    },
  });
  let heartbeats = 0;
  const store = testStore({
    heartbeat: async () => {
      heartbeats += 1;
      return heartbeats === 1 ? 'renewed' : 'fenced';
    },
    complete: async (input) => {
      completions.push(input);
      return 'completed';
    },
  });
  const wait = controllableWait();
  const daemon = await daemonWith(driver, store, wait.wait);

  const running = daemon.run();
  await eventually(() => daemon.activeAttemptCount === 1);
  while (heartbeats < 2) {
    await eventually(() => wait.pendingCount > 0);
    wait.releaseOne();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  await eventually(() => daemon.activeAttemptCount === 0);
  await daemon.drain();
  await running;

  expect(interrupts).toEqual(['heartbeat-fenced']);
  expect(completions).toEqual([]);
});

test('waiting input suspends the attempt, closes the iterator, and stops lifecycle work', async () => {
  let iteratorCloses = 0;
  let workspaceCleanups = 0;
  const interrupts: string[] = [];
  const driver = testDriver({
    nativeResume: true,
    waitingForHuman: true,
    events: async function* () {
      try {
        yield {
          type: 'attempt-started',
          runtimeAttemptId: 'runtime-waiting',
        };
        yield {
          type: 'waiting-for-human',
          requestId: 'request-1',
          prompt: 'Approve the proposed change?',
        };
        yield { type: 'attempt-completed', status: 'succeeded' };
      } finally {
        iteratorCloses += 1;
      }
    },
    resume: () => events([]),
    interrupt: async (input) => {
      interrupts.push(input.reason || '');
    },
  });
  const coordinator = testWorkspaceCoordinator({
    async cleanupOrRecover({ lifecycle, cleanedAt }) {
      workspaceCleanups += 1;
      return { ...lifecycle, cleanedAt };
    },
  });
  const store = testStore({
    claim: async () => workspaceClaim(),
    async appendEvent(input) {
      store.events.push(input);
      return input.event.type === 'waiting-for-human'
        ? 'suspended'
        : 'appended';
    },
  });
  const wait = controllableWait();
  const daemon = await daemonWith(driver, store, wait.wait, coordinator);

  const running = daemon.run();
  await eventually(() => iteratorCloses === 1);
  await eventually(() => daemon.activeAttemptCount === 0);
  await daemon.drain();
  await running;

  expect(store.events.map(({ event }) => event)).toEqual([
    { type: 'attempt-started', runtimeAttemptId: 'runtime-waiting' },
    {
      type: 'waiting-for-human',
      requestId: 'request-1',
      prompt: 'Approve the proposed change?',
    },
  ]);
  expect(iteratorCloses).toBe(1);
  expect(store.heartbeats).toHaveLength(1);
  expect(interrupts).toEqual([]);
  expect(store.completions).toEqual([]);
  expect(workspaceCleanups).toBe(0);
});

test('native resume receives the exact pending human input for the same attempt', async () => {
  const starts: RuntimeStartAttemptV1[] = [];
  const resumes: RuntimeResumeAttemptV1[] = [];
  const humanInput = {
    requestId: 'request-1',
    responseId: 'response-1',
    response: { approved: true, note: 'Continue', choices: [1, 'two'] },
  } as const;
  const driver = testDriver({
    nativeResume: true,
    waitingForHuman: true,
    start(input) {
      starts.push(input);
      return events([]);
    },
    resume(input) {
      resumes.push(input);
      return events([
        { type: 'text-delta', text: 'resumed' },
        { type: 'attempt-completed', status: 'succeeded' },
      ]);
    },
  });
  const store = testStore({
    claim: async () =>
      claim({
        generation: 2,
        runtimeRunId: 'runtime-waiting',
        checkpointRef: 'checkpoint-before-input',
        humanInput,
      }),
  });
  const daemon = await daemonWith(driver, store);

  const running = daemon.run();
  await eventually(() => store.completions.length === 1);
  await daemon.drain();
  await running;

  expect(starts).toEqual([]);
  expect(resumes).toEqual([
    {
      jobId: 'job-1',
      attemptId: 'attempt-1',
      generation: 2,
      runtimeAttemptId: 'runtime-waiting',
      checkpointRef: 'checkpoint-before-input',
      humanInput: {
        requestId: 'request-1',
        responseId: 'response-1',
        response: { approved: true, note: 'Continue', choices: [1, 'two'] },
      },
    },
  ]);
});

test('restarts a reclaimed non-resumable attempt instead of calling resume', async () => {
  const starts: RuntimeStartAttemptV1[] = [];
  const resumes: RuntimeResumeAttemptV1[] = [];
  const driver = testDriver({
    nativeResume: false,
    start: (input) => {
      starts.push(input);
      return events([
        { type: 'attempt-started', runtimeAttemptId: 'fresh-run' },
        { type: 'attempt-completed', status: 'succeeded' },
      ]);
    },
    resume: (input) => {
      resumes.push(input);
      return events([]);
    },
  });
  const store = testStore({
    claim: async () =>
      claim({
        generation: 2,
        runtimeRunId: 'expired-runtime-run',
        checkpointRef: 'expired-checkpoint',
      }),
  });
  const daemon = await daemonWith(driver, store);

  const running = daemon.run();
  await eventually(() => starts.length === 1);
  await eventually(() => daemon.activeAttemptCount === 0);
  await daemon.drain();
  await running;

  expect(starts[0]).toMatchObject({
    attemptId: 'attempt-1',
    generation: 2,
    executionSpec: { goal: 'Run daemon test' },
  });
  expect(resumes).toEqual([]);
  expect(store.heartbeats.slice(1)).not.toContainEqual(
    expect.objectContaining({
      runtimeRunId: 'expired-runtime-run',
      checkpointRef: 'expired-checkpoint',
    })
  );
});

test('event fencing interrupts from the rejected started event and never completes', async () => {
  const gate = deferred<void>();
  const interrupts: string[] = [];
  const completions: CompleteExecutionDaemonAttemptInputV1[] = [];
  const driver = testDriver({
    events: async function* () {
      yield {
        type: 'attempt-started',
        runtimeAttemptId: 'runtime-event-fenced',
      };
      await gate.promise;
    },
    interrupt: async (input) => {
      interrupts.push(input.runtimeAttemptId);
      gate.resolve();
    },
  });
  const store = testStore({
    appendEvent: async () => 'fenced',
    complete: async (input) => {
      completions.push(input);
      return 'completed';
    },
  });
  const daemon = await daemonWith(driver, store);

  const running = daemon.run();
  await eventually(() => interrupts.length === 1);
  await daemon.drain();
  await running;

  expect(interrupts).toEqual(['runtime-event-fenced']);
  expect(completions).toEqual([]);
});

test('drain stops new claims, keeps heartbeats, and waits for active work', async () => {
  const gate = deferred<void>();
  let claims = 0;
  let heartbeats = 0;
  const driver = testDriver({
    events: async function* () {
      yield { type: 'attempt-started', runtimeAttemptId: 'runtime-drain' };
      await gate.promise;
      yield { type: 'attempt-completed', status: 'succeeded' };
    },
  });
  const store = testStore({
    listCandidates: async () => [
      { attemptId: `attempt-${claims + 1}`, runtimeId: 'test-runtime' },
    ],
    claim: async (input) => {
      claims += 1;
      return claim({ attemptId: input.attemptId });
    },
    heartbeat: async () => {
      heartbeats += 1;
      return 'renewed';
    },
  });
  const wait = controllableWait();
  const daemon = await daemonWith(driver, store, wait.wait);

  const running = daemon.run();
  await eventually(() => daemon.activeAttemptCount === 1);
  const draining = daemon.drain();
  await eventually(() => daemon.isDraining);
  expect(claims).toBe(1);

  while (heartbeats < 2) {
    await eventually(() => wait.pendingCount > 0);
    wait.releaseOne();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  await eventually(() => heartbeats >= 2);
  expect(claims).toBe(1);

  gate.resolve();
  await draining;
  await running;
  expect(claims).toBe(1);
});

test('interruptActive abandons the lease and never completes', async () => {
  const gate = deferred<void>();
  const interrupts: string[] = [];
  const completions: CompleteExecutionDaemonAttemptInputV1[] = [];
  const driver = testDriver({
    events: async function* () {
      yield { type: 'attempt-started', runtimeAttemptId: 'runtime-force' };
      await gate.promise;
      yield { type: 'attempt-completed', status: 'succeeded' };
    },
    interrupt: async (input) => {
      interrupts.push(input.reason || '');
      gate.resolve();
    },
  });
  const store = testStore({
    complete: async (input) => {
      completions.push(input);
      return 'completed';
    },
  });
  const daemon = await daemonWith(driver, store);

  const running = daemon.run();
  await eventually(() => daemon.activeAttemptCount === 1);
  await eventually(() =>
    store.events.some(({ event }) => event.type === 'attempt-started')
  );
  const draining = daemon.drain();
  await daemon.interruptActive('test-force-shutdown');
  await draining;
  await running;

  expect(interrupts).toEqual(['test-force-shutdown']);
  expect(completions).toEqual([]);
});

test('rejects a heartbeat interval above one third of the lease', async () => {
  const driver = testDriver();
  const registry = new ExecutionRuntimeDriverRegistryV1();
  await registry.register(driver);

  expect(
    () =>
      new ExecutionDaemonV1({
        workerId: 'test-worker',
        store: testStore(),
        registry,
        clock: { now: () => TEST_NOW },
        wait: immediateWait,
        logger: silentLogger(),
        heartbeatIntervalMs: 10_001,
        leaseDurationMs: 30_000,
      })
  ).toThrow(/one third/);
});

test('orders worktree lifecycle, sanitizes runtime input, and skips terminal append', async () => {
  const order: string[] = [];
  const starts: RuntimeStartAttemptV1[] = [];
  const lifecycle = preparedLifecycle();
  const finalized = finalizedLifecycle(lifecycle, true);
  const coordinator = testWorkspaceCoordinator({
    async prepareOrRecover() {
      order.push('prepare');
      return {
        lifecycle,
        workspace: { uri: 'file:///trusted/worktree', revision: HEAD },
      };
    },
    async finalizeOrRecover(input) {
      order.push('finalize');
      return finalizedLifecycle(input, true);
    },
    async cleanupOrRecover({ lifecycle: input, cleanedAt }) {
      order.push('cleanup');
      return { ...input, cleanedAt };
    },
  });
  const driver = testDriver({
    start(input) {
      order.push('start');
      starts.push(input);
      return events([
        { type: 'attempt-started', runtimeAttemptId: 'runtime-worktree' },
        { type: 'text-delta', text: 'done' },
        { type: 'attempt-completed', status: 'succeeded' },
      ]);
    },
  });
  const store = testStore({
    claim: async () => workspaceClaim(),
    async appendEvent(input) {
      order.push(`append:${input.event.type}`);
      store.events.push(input);
      return 'appended';
    },
    async persistWorkspaceLifecycle(input) {
      order.push(
        input.lifecycle.cleanedAt
          ? 'persist:cleaned'
          : input.lifecycle.finalized
            ? 'persist:finalized'
            : 'persist:prepared'
      );
      store.lifecycles.push(input);
      return 'persisted';
    },
    async persistTerminalEvent(input) {
      order.push('persist:terminal');
      store.terminals.push(input);
      return 'appended';
    },
    async createKnowledgeChangeRequest(input) {
      order.push('change-request');
      expect(input.finalized).toEqual(finalized.finalized);
      return { changeRequest: { id: 'change-1' } };
    },
    async complete(input) {
      order.push('complete');
      store.completions.push(input);
      return 'completed';
    },
  });
  const daemon = await daemonWith(driver, store, immediateWait, coordinator);

  const running = daemon.run();
  await eventually(() => order.includes('complete'));
  await daemon.drain();
  await running;

  expect(starts).toHaveLength(1);
  expect(starts[0].workspace).toEqual({
    uri: 'file:///trusted/worktree',
    revision: HEAD,
  });
  expect(JSON.stringify(starts[0])).not.toContain('/private/repository');
  expect(store.events.map(({ event }) => event.type)).toEqual([
    'attempt-started',
    'text-delta',
  ]);
  expect(store.terminals).toHaveLength(1);
  expect(order).toEqual([
    'prepare',
    'persist:prepared',
    'start',
    'append:attempt-started',
    'append:text-delta',
    'persist:terminal',
    'finalize',
    'persist:finalized',
    'change-request',
    'cleanup',
    'persist:cleaned',
    'complete',
  ]);
});

test('recovers durable unchanged completion without restarting runtime', async () => {
  const starts: RuntimeStartAttemptV1[] = [];
  const resumes: RuntimeResumeAttemptV1[] = [];
  const order: string[] = [];
  const completed = withRuntimeCompletion(preparedLifecycle(), 'succeeded');
  const coordinator = testWorkspaceCoordinator({
    async prepareOrRecover() {
      order.push('prepare');
      return {
        lifecycle: completed,
        workspace: { uri: 'file:///trusted/worktree', revision: HEAD },
      };
    },
    async finalizeOrRecover(input) {
      order.push('finalize');
      return finalizedLifecycle(input, false);
    },
    async cleanupOrRecover({ lifecycle, cleanedAt }) {
      order.push('cleanup');
      return { ...lifecycle, cleanedAt };
    },
  });
  const driver = testDriver({
    nativeResume: true,
    start(input) {
      starts.push(input);
      return events([]);
    },
    resume(input) {
      resumes.push(input);
      return events([]);
    },
  });
  const store = testStore({
    claim: async () =>
      workspaceClaim({
        workspaceLifecycle: completed,
        runtimeRunId: 'already-finished',
      }),
    async persistWorkspaceLifecycle(input) {
      order.push(
        input.lifecycle.cleanedAt
          ? 'persist:cleaned'
          : input.lifecycle.finalized
            ? 'persist:finalized'
            : 'persist:completed'
      );
      store.lifecycles.push(input);
      return 'persisted';
    },
    async complete(input) {
      order.push('complete');
      store.completions.push(input);
      return 'completed';
    },
  });
  const daemon = await daemonWith(driver, store, immediateWait, coordinator);

  const running = daemon.run();
  await eventually(() => store.completions.length === 1);
  await daemon.drain();
  await running;

  expect(starts).toEqual([]);
  expect(resumes).toEqual([]);
  expect(store.terminals).toEqual([]);
  expect(order).toEqual([
    'prepare',
    'persist:completed',
    'finalize',
    'persist:finalized',
    'cleanup',
    'persist:cleaned',
    'complete',
  ]);
  expect(store.completions[0].status).toBe('succeeded');
});

test('initial workspace cancellation prepares, records interrupted, cleans, and completes cancelled', async () => {
  const order: string[] = [];
  const driver = testDriver({
    start() {
      throw new Error('cancelled attempts must not start');
    },
  });
  const coordinator = testWorkspaceCoordinator({
    async prepareOrRecover() {
      order.push('prepare');
      return {
        lifecycle: preparedLifecycle(),
        workspace: { uri: 'file:///trusted/worktree', revision: HEAD },
      };
    },
    async cleanupOrRecover({ lifecycle, cleanedAt }) {
      order.push('cleanup');
      return { ...lifecycle, cleanedAt };
    },
  });
  const store = testStore({
    claim: async () => workspaceClaim({ cancelRequested: true }),
    heartbeat: async () => 'cancel-requested',
    async persistWorkspaceLifecycle(input) {
      order.push(input.lifecycle.cleanedAt ? 'persist:cleaned' : 'persist:prepared');
      store.lifecycles.push(input);
      return 'persisted';
    },
    async persistTerminalEvent(input) {
      order.push('persist:terminal');
      store.terminals.push(input);
      return 'appended';
    },
    async complete(input) {
      order.push('complete');
      store.completions.push(input);
      return 'completed';
    },
  });
  const daemon = await daemonWith(driver, store, immediateWait, coordinator);

  const running = daemon.run();
  await eventually(() => store.completions.length === 1);
  await daemon.drain();
  await running;

  expect(store.terminals[0].event).toMatchObject({
    type: 'attempt-completed',
    status: 'interrupted',
  });
  expect(store.completions[0].status).toBe('cancelled');
  expect(order).toEqual([
    'prepare',
    'persist:prepared',
    'persist:terminal',
    'cleanup',
    'persist:cleaned',
    'complete',
  ]);
});

test('terminal cancel race replaces rejected success with one interrupted terminal', async () => {
  const terminalStatuses: string[] = [];
  let heartbeats = 0;
  const coordinator = testWorkspaceCoordinator();
  const store = testStore({
    claim: async () => workspaceClaim(),
    heartbeat: async () => {
      heartbeats += 1;
      return heartbeats >= 2 ? 'cancel-requested' : 'renewed';
    },
    async persistTerminalEvent(input) {
      terminalStatuses.push(input.event.status);
      store.terminals.push(input);
      return input.event.status === 'succeeded' ? 'fenced' : 'appended';
    },
  });
  const daemon = await daemonWith(
    testDriver(),
    store,
    immediateWait,
    coordinator
  );

  const running = daemon.run();
  await eventually(() => store.completions.length === 1);
  await daemon.drain();
  await running;

  expect(terminalStatuses).toEqual(['succeeded', 'interrupted']);
  expect(store.completions[0].status).toBe('cancelled');
});

test('fenced prepared persistence stops runtime and later lifecycle side effects', async () => {
  let starts = 0;
  let cleanup = 0;
  const coordinator = testWorkspaceCoordinator({
    async cleanupOrRecover(input) {
      cleanup += 1;
      return input.lifecycle;
    },
  });
  const store = testStore({
    claim: async () => workspaceClaim(),
    persistWorkspaceLifecycle: async () => 'fenced',
  });
  const daemon = await daemonWith(
    testDriver({
      start() {
        starts += 1;
        return events([]);
      },
    }),
    store,
    immediateWait,
    coordinator
  );

  const running = daemon.run();
  await eventually(() => daemon.activeAttemptCount === 0);
  await daemon.drain();
  await running;

  expect(starts).toBe(0);
  expect(cleanup).toBe(0);
  expect(store.completions).toEqual([]);
});

test('forced shutdown during change-request persistence skips stale cleanup and completion', async () => {
  const changeRequestEntered = deferred<void>();
  const changeRequestResult = deferred<void>();
  let cleanup = 0;
  const lifecycle = finalizedLifecycle(
    withRuntimeCompletion(preparedLifecycle(), 'succeeded'),
    true
  );
  const coordinator = testWorkspaceCoordinator({
    async cleanupOrRecover({ lifecycle: input, cleanedAt }) {
      cleanup += 1;
      return { ...input, cleanedAt };
    },
  });
  const store = testStore({
    claim: async () =>
      workspaceClaim({
        workspaceLifecycle: lifecycle,
        runtimeRunId: 'runtime-change-request',
      }),
    async createKnowledgeChangeRequest() {
      changeRequestEntered.resolve();
      await changeRequestResult.promise;
      return { changeRequest: { id: 'change-after-shutdown' } };
    },
  });
  const daemon = await daemonWith(
    testDriver(),
    store,
    controllableWait().wait,
    coordinator
  );

  const running = daemon.run();
  await changeRequestEntered.promise;
  const persistedBeforeShutdown = store.lifecycles.length;
  await daemon.interruptActive('test-change-request-shutdown');
  changeRequestResult.resolve();
  await running;

  expect(cleanup).toBe(0);
  expect(store.lifecycles).toHaveLength(persistedBeforeShutdown);
  expect(store.completions).toEqual([]);
});

test('late fenced heartbeat after completion does not interrupt or warn', async () => {
  const terminal = deferred<void>();
  const heartbeatResult = deferred<'fenced'>();
  const interrupts: string[] = [];
  const warnings: Array<{ message: string; reason?: unknown }> = [];
  let heartbeatCalls = 0;
  let heartbeatInFlight = false;
  const wait = controllableWait();
  const waitSignals: AbortSignal[] = [];
  const observedWait: ExecutionDaemonWaitV1 = (durationMs, signal) => {
    waitSignals.push(signal);
    return wait.wait(durationMs, signal);
  };
  const driver = testDriver({
    events: async function* () {
      yield {
        type: 'attempt-started',
        runtimeAttemptId: 'runtime-completed-before-heartbeat',
      };
      await terminal.promise;
      yield { type: 'attempt-completed', status: 'succeeded' };
    },
    interrupt: async (input) => {
      interrupts.push(input.reason || '');
    },
  });
  const store = testStore({
    heartbeat: async () => {
      heartbeatCalls += 1;
      if (heartbeatCalls === 1) return 'renewed';
      heartbeatInFlight = true;
      return heartbeatResult.promise;
    },
  });
  const logger: ExecutionDaemonLoggerV1 = {
    debug() {},
    info() {},
    warn(message, context) {
      warnings.push({ message, reason: context?.reason });
    },
    error() {},
  };
  const daemon = await daemonWith(
    driver,
    store,
    observedWait,
    undefined,
    logger
  );

  const running = daemon.run();
  while (!heartbeatInFlight) {
    await eventually(() => wait.pendingCount > 0);
    wait.releaseOne();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  terminal.resolve();
  await eventually(() => store.completions.length === 1);
  await eventually(() => waitSignals.some((signal) => signal.aborted));
  heartbeatResult.resolve('fenced');
  await eventually(() => daemon.activeAttemptCount === 0);
  await daemon.drain();
  await running;

  expect(interrupts).toEqual([]);
  expect(warnings).not.toContainEqual({
    message: 'Execution daemon attempt was fenced.',
    reason: 'heartbeat-fenced',
  });
});

type TestStoreV1 = ExecutionDaemonStoreV1 & {
  events: AppendExecutionDaemonEventInputV1[];
  heartbeats: HeartbeatExecutionDaemonAttemptInputV1[];
  completions: CompleteExecutionDaemonAttemptInputV1[];
  lifecycles: PersistExecutionDaemonWorkspaceLifecycleInputV1[];
  terminals: PersistExecutionDaemonTerminalEventInputV1[];
};

function testStore(
  overrides: Partial<ExecutionDaemonStoreV1> = {}
): TestStoreV1 {
  let listed = false;
  const store: TestStoreV1 = {
    events: [],
    heartbeats: [],
    completions: [],
    lifecycles: [],
    terminals: [],
    async listCandidates() {
      if (listed) return [];
      listed = true;
      return [{ attemptId: 'attempt-1', runtimeId: 'test-runtime' }];
    },
    async claim() {
      return claim();
    },
    async heartbeat(input) {
      store.heartbeats.push(input);
      return 'renewed';
    },
    async appendEvent(input) {
      store.events.push(input);
      return 'appended';
    },
    async persistWorkspaceLifecycle(input) {
      store.lifecycles.push(input);
      return 'persisted';
    },
    async persistTerminalEvent(input) {
      store.terminals.push(input);
      return 'appended';
    },
    async createKnowledgeChangeRequest() {
      return { changeRequest: { id: 'change-default' } };
    },
    async complete(input) {
      store.completions.push(input);
      return 'completed';
    },
    ...overrides,
  };
  return store;
}

function claim(
  overrides: Partial<ExecutionDaemonClaimV1> = {}
): ExecutionDaemonClaimV1 {
  return {
    jobId: 'job-1',
    attemptId: 'attempt-1',
    attemptNumber: 1,
    runtimeId: 'test-runtime',
    generation: 1,
    cancelRequested: false,
    executionSpec: {
      schemaVersion: VERSION,
      goal: 'Run daemon test',
      kind: 'coding',
      requirements: {},
    },
    contextManifest: { schemaVersion: 1, frozen: true },
    ...overrides,
  };
}

type TestDriverOptionsV1 = {
  nativeResume?: boolean;
  waitingForHuman?: boolean;
  events?: readonly RuntimeEventV1[] | (() => AsyncIterable<RuntimeEventV1>);
  start?: (input: RuntimeStartAttemptV1) => AsyncIterable<RuntimeEventV1>;
  resume?: (input: RuntimeResumeAttemptV1) => AsyncIterable<RuntimeEventV1>;
  interrupt?: ExecutionRuntimeDriverV1['interrupt'];
};

function testDriver(
  options: TestDriverOptionsV1 = {}
): ExecutionRuntimeDriverV1 {
  const configuredEvents = options.events ?? [
    { type: 'attempt-started', runtimeAttemptId: 'runtime-default' },
    { type: 'attempt-completed', status: 'succeeded' },
  ];
  const driver: ExecutionRuntimeDriverV1 = {
    async describe() {
      return {
        schemaVersion: VERSION,
        runtimeId: 'test-runtime',
        displayName: 'Test runtime',
        runtimeVersion: 'test',
        capabilities: {
          schemaVersion: VERSION,
          kinds: ['coding'],
          nativeResume: options.nativeResume ?? false,
          checkpoint: false,
          streaming: 'typed-events',
          interrupt: 'graceful',
          workspace: 'none',
          sandbox: 'host',
          structuredArtifacts: false,
          waitingForHuman: options.waitingForHuman ?? false,
          supportedModels: ['*'],
        },
      };
    },
    start(input) {
      if (options.start) return options.start(input);
      return typeof configuredEvents === 'function'
        ? configuredEvents()
        : events(configuredEvents);
    },
    ...(options.resume ? { resume: options.resume } : {}),
    interrupt: options.interrupt ?? (async () => {}),
    async reconcile(input) {
      return {
        runtimeAttemptId: input.runtimeAttemptId,
        status: 'unknown',
      };
    },
    async archive() {
      return [];
    },
  };
  return driver;
}

async function daemonWith(
  driver: ExecutionRuntimeDriverV1,
  store: ExecutionDaemonStoreV1,
  wait: ExecutionDaemonWaitV1 = immediateWait,
  workspaceCoordinator?: ExecutionDaemonWorkspaceCoordinatorV1,
  logger: ExecutionDaemonLoggerV1 = silentLogger()
): Promise<ExecutionDaemonV1> {
  const registry = new ExecutionRuntimeDriverRegistryV1();
  await registry.register(driver);
  return new ExecutionDaemonV1({
    workerId: 'test-worker',
    store,
    registry,
    ...(workspaceCoordinator
      ? {
          workspaceCoordinators: new Map([
            ['test-runtime', workspaceCoordinator],
          ]),
        }
      : {}),
    clock: { now: () => TEST_NOW },
    wait,
    logger,
    pollIntervalMs: 1,
    heartbeatIntervalMs: 1,
    leaseDurationMs: 3,
  });
}

const HEAD = 'a'.repeat(40);
const FINAL_HEAD = 'b'.repeat(40);
const PATCH_SHA = 'c'.repeat(64);

function workspaceClaim(
  overrides: Partial<ExecutionDaemonClaimV1> = {}
): ExecutionDaemonClaimV1 {
  return claim({
    knowledgeWorkspace: {
      binding: {
        schemaVersion: 1,
        bindingId: 'binding-1',
        spaceId: 'space-1',
        workspaceId: 'workspace-1',
        agentId: null,
        mountPath: '/',
        defaultBranch: 'main',
        baseCommit: HEAD,
      },
      repositoryPath: '/private/repository',
    },
    workspaceLifecycle: null,
    ...overrides,
  });
}

function preparedLifecycle(): WorkspaceLifecycleV1 {
  return {
    schemaVersion: 1,
    kind: 'git-worktree',
    binding: {
      schemaVersion: 1,
      bindingId: 'binding-1',
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
      agentId: null,
      mountPath: '/',
      defaultBranch: 'main',
      baseCommit: HEAD,
    },
    prepared: {
      schemaVersion: 1,
      spaceId: 'space-1',
      mountPath: '/',
      repositoryPath: '/private/repository',
      worktreePath: '/trusted/worktree',
      defaultBranch: 'main',
      branch: 'agent/attempt-1',
      baseCommit: HEAD,
      jobId: 'job-1',
      attemptId: 'attempt-1',
      attemptNumber: 1,
    },
  };
}

function withRuntimeCompletion(
  lifecycle: WorkspaceLifecycleV1,
  status: 'succeeded' | 'failed' | 'cancelled'
): WorkspaceLifecycleV1 {
  return {
    ...lifecycle,
    runtimeCompletion: {
      status,
      ...(status === 'succeeded' ? { result: { text: 'done' } } : {}),
    },
  };
}

function finalizedLifecycle(
  lifecycle: WorkspaceLifecycleV1,
  changed: boolean
): WorkspaceLifecycleV1 {
  return {
    ...lifecycle,
    finalized: {
      schemaVersion: 1,
      spaceId: 'space-1',
      jobId: 'job-1',
      attemptId: 'attempt-1',
      changed,
      baseCommit: HEAD,
      headCommit: changed ? FINAL_HEAD : HEAD,
      branch: 'agent/attempt-1',
      files: changed ? ['README.md'] : [],
      diffSummary: {
        filesChanged: changed ? 1 : 0,
        insertions: changed ? 1 : 0,
        deletions: 0,
        shortStat: changed ? '1 file changed, 1 insertion(+)' : '',
      },
      patchSha256: PATCH_SHA,
    },
  };
}

function testWorkspaceCoordinator(
  overrides: Partial<ExecutionDaemonWorkspaceCoordinatorV1> = {}
): ExecutionDaemonWorkspaceCoordinatorV1 {
  return {
    async prepareOrRecover(input) {
      const lifecycle = input.existingLifecycle ?? preparedLifecycle();
      return {
        lifecycle,
        workspace: { uri: 'file:///trusted/worktree', revision: HEAD },
      };
    },
    async finalizeOrRecover(input) {
      return finalizedLifecycle(input, false);
    },
    async cleanupOrRecover({ lifecycle, cleanedAt }) {
      return { ...lifecycle, cleanedAt };
    },
    ...overrides,
  };
}

function silentLogger(): ExecutionDaemonLoggerV1 {
  return {
    debug() {},
    info() {},
    warn() {},
    error(message, context) {
      if (process.env.DEBUG_DAEMON_TESTS) {
        console.error(message, context);
      }
    },
  };
}

async function immediateWait(
  durationMs: number,
  signal: AbortSignal
): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, Math.max(durationMs, 0));
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

function controllableWait() {
  const pending: Array<() => void> = [];
  return {
    get pendingCount() {
      return pending.length;
    },
    wait: (_durationMs: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', finish);
          resolve();
        };
        pending.push(finish);
        signal.addEventListener('abort', finish, { once: true });
        if (signal.aborted) finish();
      }),
    releaseOne() {
      pending.shift()?.();
    },
  };
}

async function eventually(
  condition: () => boolean,
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for daemon test condition.');
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function* events(
  values: readonly RuntimeEventV1[]
): AsyncIterable<RuntimeEventV1> {
  for (const value of values) {
    yield value;
  }
}

function deferred<T>() {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
