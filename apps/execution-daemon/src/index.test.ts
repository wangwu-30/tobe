import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import type { ExecutionDaemonOptionsV1 } from '@/agent/execution/daemon';
import type { ExecutionRuntimeDriverV1 } from '@/agent/execution/driver';
import { GitWorktreeLifecycleCoordinatorV1 } from '@/agent/execution/git-worktree-coordinator';
import type {
  GitWorktreePortV1,
  GitWorktreeRecoveryPortV1,
} from '@/agent/knowledge/contracts';
import { safeJsonParse } from '@/framework/resilience/safe-data';
import {
  createExecutionDaemonProcessControllerV1,
  createExecutionDaemonRuntimeBindingsV1,
  runExecutionDaemonProcessV1,
  type ExecutionDaemonCompositionDependenciesV1,
  type ExecutionDaemonProcessHostV1,
  type ExecutionDaemonProcessSignalV1,
  type ExecutionDaemonRuntimeBindingV1,
} from './index';

test('runtime bindings advertise git-worktree only when it is configured', async () => {
  const plain = runtimeConfig();
  const worktree = worktreeRuntimeConfig({ runtimeId: 'runtime-worktree' });
  const bindings = await createExecutionDaemonRuntimeBindingsV1(
    { ...config(), runtimes: [plain, worktree] },
    {}
  );

  await expect(bindings[0].driver.describe()).resolves.toMatchObject({
    runtimeId: plain.runtimeId,
    capabilities: { workspace: 'none' },
  });
  expect(bindings[0].workspaceCoordinator).toBeUndefined();
  await expect(bindings[1].driver.describe()).resolves.toMatchObject({
    runtimeId: worktree.runtimeId,
    capabilities: { workspace: 'git-worktree' },
  });
  expect(bindings[1].workspaceCoordinator).toBeDefined();
});

test('creates isolated worktree ports and coordinators from each runtime config', async () => {
  const plain = runtimeConfig();
  const first = worktreeRuntimeConfig({
    runtimeId: 'runtime-worktree-1',
    managedRoot: '/private/worktrees/one',
    authorName: 'Runtime One',
    authorEmail: 'runtime-one@example.test',
  });
  const second = worktreeRuntimeConfig({
    runtimeId: 'runtime-worktree-2',
    managedRoot: '/private/worktrees/two',
    authorName: 'Runtime Two',
    authorEmail: 'runtime-two@example.test',
  });
  const driverConfigs: Array<{ runtimeId?: string }> = [];
  const portConfigs: Array<{
    managedRoot: string;
    commitAuthor: { name: string; email: string };
  }> = [];
  const ports: GitWorktreePortV1[] = [];
  const coordinatorPorts: GitWorktreePortV1[] = [];
  const coordinators: NonNullable<
    ExecutionDaemonRuntimeBindingV1['workspaceCoordinator']
  >[] = [];

  const bindings = await createExecutionDaemonRuntimeBindingsV1(
    { ...config(), runtimes: [plain, first, second] },
    {},
    {
      createGenericCliDriver(driverConfig) {
        driverConfigs.push(driverConfig);
        return runtimeDriver(driverConfig.runtimeId);
      },
      async loadExternalModuleDriver() {
        throw new Error('External loader should not be used by this test.');
      },
      createGitWorktreePort(portConfig) {
        portConfigs.push(portConfig);
        const port = unusedGitWorktreePort();
        ports.push(port);
        return port;
      },
      createGitWorktreeCoordinator(port) {
        coordinatorPorts.push(port);
        const coordinator = new GitWorktreeLifecycleCoordinatorV1(port);
        coordinators.push(coordinator);
        return coordinator;
      },
    }
  );

  expect(driverConfigs.map(({ runtimeId }) => runtimeId)).toEqual([
    'runtime-1',
    'runtime-worktree-1',
    'runtime-worktree-2',
  ]);
  expect(portConfigs).toEqual([
    {
      managedRoot: '/private/worktrees/one',
      commitAuthor: {
        name: 'Runtime One',
        email: 'runtime-one@example.test',
      },
    },
    {
      managedRoot: '/private/worktrees/two',
      commitAuthor: {
        name: 'Runtime Two',
        email: 'runtime-two@example.test',
      },
    },
  ]);
  expect(ports).toHaveLength(2);
  expect(ports[0]).not.toBe(ports[1]);
  expect(coordinatorPorts).toEqual(ports);
  expect(coordinators).toHaveLength(2);
  expect(coordinators[0]).not.toBe(coordinators[1]);
  expect(bindings[0].workspaceCoordinator).toBeUndefined();
  expect(bindings[1].workspaceCoordinator).toBe(coordinators[0]);
  expect(bindings[2].workspaceCoordinator).toBe(coordinators[1]);
});

test('loads an external module driver with only allowlisted environment values', async () => {
  const external = {
    driver: 'external-module' as const,
    runtimeId: 'runtime-external',
    contractVersion: 1 as const,
    modulePath: '/trusted/runtime.mjs',
    exportName: 'createRuntime',
    envAllowlist: ['RUNTIME_TOKEN'],
    capacityTotal: 1,
  };
  const loadInputs: unknown[] = [];
  const bindings = await createExecutionDaemonRuntimeBindingsV1(
    { ...config(), runtimes: [external] },
    { RUNTIME_TOKEN: 'secret', BLOCKED_SECRET: 'blocked' },
    {
      createGenericCliDriver() {
        throw new Error('Generic CLI should not be used by this test.');
      },
      async loadExternalModuleDriver(input) {
        loadInputs.push(input);
        return runtimeDriver(input.runtimeId);
      },
      createGitWorktreePort() {
        throw new Error('Git worktree should not be used by this test.');
      },
      createGitWorktreeCoordinator() {
        throw new Error('Git worktree should not be used by this test.');
      },
    }
  );

  expect(bindings).toHaveLength(1);
  expect(bindings[0].config).toEqual(external);
  expect(loadInputs).toEqual([
    {
      contractVersion: 1,
      modulePath: '/trusted/runtime.mjs',
      exportName: 'createRuntime',
      runtimeId: 'runtime-external',
      environment: { RUNTIME_TOKEN: 'secret' },
    },
  ]);
  expect(JSON.stringify(bindings[0].config)).not.toContain('secret');
});

test('applies the optional worktree wrapper to an external module driver', async () => {
  const external = {
    driver: 'external-module' as const,
    runtimeId: 'runtime-external-worktree',
    contractVersion: 1 as const,
    modulePath: '/trusted/runtime.mjs',
    exportName: 'default',
    envAllowlist: [],
    capacityTotal: 1,
    worktree: {
      enabled: true as const,
      managedRoot: '/trusted/worktrees',
      commitAuthor: { name: 'Runtime', email: 'runtime@example.test' },
    },
  };
  const bindings = await createExecutionDaemonRuntimeBindingsV1(
    { ...config(), runtimes: [external] },
    {},
    {
      createGenericCliDriver() {
        throw new Error('Generic CLI should not be used by this test.');
      },
      async loadExternalModuleDriver(input) {
        return runtimeDriver(input.runtimeId);
      },
      createGitWorktreePort: () => unusedGitWorktreePort(),
      createGitWorktreeCoordinator: (port) =>
        new GitWorktreeLifecycleCoordinatorV1(port),
    }
  );

  await expect(bindings[0].driver.describe()).resolves.toMatchObject({
    runtimeId: 'runtime-external-worktree',
    capabilities: { workspace: 'git-worktree' },
  });
  expect(bindings[0].workspaceCoordinator).toBeDefined();
});

test('default composition shape registers runtimes, heartbeats, drains, and disconnects', async () => {
  const calls: string[] = [];
  let finishDaemon = () => {};
  const captured = {
    daemonOptions: undefined as ExecutionDaemonOptionsV1 | undefined,
  };
  const binding = runtimeBinding();
  const dependencies: ExecutionDaemonCompositionDependenciesV1 = {
    createStore(actor) {
      calls.push(`store:${actor.organizationId}`);
      return {
        async listCandidates() { return []; },
        async claim() { return null; },
        async heartbeat() { return 'renewed'; },
        async appendEvent() { return 'appended'; },
        async complete() { return 'completed'; },
      };
    },
    createRegistry() {
      const drivers: ExecutionDaemonRuntimeBindingV1['driver'][] = [];
      return {
        async register(driver) {
          drivers.push(driver);
          calls.push('registry:register');
          return driver;
        },
        list: () => drivers,
        lookup: () => drivers[0],
      };
    },
    createDaemon(options) {
      captured.daemonOptions = options;
      calls.push('daemon:create');
      return {
        run: () => new Promise<void>((resolve) => { finishDaemon = resolve; }),
        async drain() {
          calls.push('daemon:drain');
          finishDaemon();
        },
        async interruptActive() { calls.push('daemon:interrupt'); },
      };
    },
    async registerRuntime(actor, input) {
      calls.push(`runtime:register:${actor.organizationId}:${input.descriptor.runtimeId}`);
      return {} as never;
    },
    async heartbeatRuntime(_actor, input) {
      calls.push(`runtime:heartbeat:${input.health.state}`);
      return {} as never;
    },
    async relayRoomProjections(actor, input) {
      calls.push(`projection:relay:${actor.organizationId}:${input?.limit}`);
      return { delivered: 0, failed: 0, ignored: 0, processed: 0 };
    },
    wait: (_duration, signal) => waitUntilAborted(signal),
    logger: {
      debug() {}, info() {}, warn() {}, error() {},
    },
    async disconnect() { calls.push('prisma:disconnect'); },
  };

  const controller = await createExecutionDaemonProcessControllerV1(
    { config: config(), runtimes: [binding] },
    dependencies
  );
  const running = controller.run();
  await expect.poll(() => calls.filter((call) => call.startsWith('runtime:heartbeat')).length).toBe(1);
  await controller.stop('SIGTERM');
  await running;

  expect(captured.daemonOptions).toMatchObject({
    workerId: 'worker-1',
    pollIntervalMs: 100,
    heartbeatIntervalMs: 1_000,
    leaseDurationMs: 3_000,
    maxConcurrentAttempts: 2,
  });
  expect(captured.daemonOptions?.workspaceCoordinators).toEqual(new Map());
  expect(calls).toContain('runtime:register:test-org:runtime-1');
  expect(calls).toContain('runtime:heartbeat:healthy');
  expect(calls).toContain('projection:relay:test-org:32');
  expect(calls).not.toContain('runtime:heartbeat:offline');
  expect(calls).toContain('daemon:drain');
  expect(calls.at(-1)).toBe('prisma:disconnect');
});

test('starts the Room projection relay immediately and isolates periodic retry failures', async () => {
  const calls: string[] = [];
  const logs: Array<{
    level: 'warn' | 'error';
    message: string;
    context?: Readonly<Record<string, unknown>>;
  }> = [];
  let finishDaemon = () => {};
  let relayCalls = 0;
  let projectionWaits = 0;
  const dependencies = dependenciesForTest(calls, {
    createDaemon() {
      return {
        run: () => new Promise<void>((resolve) => { finishDaemon = resolve; }),
        async drain() { finishDaemon(); },
        async interruptActive() {},
      };
    },
    async relayRoomProjections(actor, input) {
      relayCalls += 1;
      calls.push(
        `projection:relay:${actor.organizationId}:${input?.limit}:${relayCalls}`
      );
      if (relayCalls === 1) {
        throw new Error('temporary projection failure');
      }
      return { delivered: 0, failed: 1, ignored: 0, processed: 1 };
    },
    wait(duration, signal) {
      if (duration === 100) {
        projectionWaits += 1;
        calls.push(`projection:wait:${projectionWaits}`);
        if (projectionWaits === 1) return Promise.resolve();
      }
      return waitUntilAborted(signal);
    },
    logger: {
      debug() {},
      info() {},
      warn(message, context) { logs.push({ level: 'warn', message, context }); },
      error(message, context) { logs.push({ level: 'error', message, context }); },
    },
  });
  const controller = await createExecutionDaemonProcessControllerV1(
    { config: config(), runtimes: [runtimeBinding()] },
    dependencies
  );

  const running = controller.run();
  let runSettled = false;
  void running.finally(() => { runSettled = true; });
  await expect.poll(() => relayCalls).toBe(2);

  expect(
    calls.indexOf('projection:relay:test-org:32:1')
  ).toBeLessThan(calls.indexOf('projection:wait:1'));
  expect(calls).toContain('runtime:heartbeat:healthy');
  expect(runSettled).toBe(false);
  expect(logs).toEqual([
    {
      level: 'error',
      message:
        'Execution Room projection relay failed; pending rows remain durable.',
      context: {
        error: 'temporary projection failure',
        workerId: 'worker-1',
      },
    },
    {
      level: 'warn',
      message:
        'Execution Room projection relay retained failed rows for retry.',
      context: { failed: 1, workerId: 'worker-1' },
    },
  ]);

  await controller.stop('SIGTERM');
  await running;
  expect(calls.at(-1)).toBe('prisma:disconnect');
});

test('bounds SIGTERM shutdown when a Room projection relay stays in flight', async () => {
  const calls: string[] = [];
  const warnings: Array<{
    message: string;
    context?: Readonly<Record<string, unknown>>;
  }> = [];
  let finishDaemon = () => {};
  let relayStarted = false;
  let shutdownWaits = 0;
  const dependencies = dependenciesForTest(calls, {
    createDaemon() {
      return {
        run: () => new Promise<void>((resolve) => { finishDaemon = resolve; }),
        async drain() { finishDaemon(); },
        async interruptActive() {},
      };
    },
    async relayRoomProjections() {
      relayStarted = true;
      return new Promise<never>(() => {});
    },
    wait(duration, signal) {
      if (duration === 15_000) {
        shutdownWaits += 1;
        return Promise.resolve();
      }
      return waitUntilAborted(signal);
    },
    logger: {
      debug() {},
      info() {},
      warn(message, context) { warnings.push({ message, context }); },
      error() {},
    },
  });
  const controller = await createExecutionDaemonProcessControllerV1(
    { config: config(), runtimes: [runtimeBinding()] },
    dependencies
  );

  const running = controller.run();
  await expect.poll(() => relayStarted).toBe(true);
  await expect(controller.stop('SIGTERM')).resolves.toBeUndefined();
  await running;

  expect(shutdownWaits).toBe(2);
  expect(warnings).toContainEqual({
    message: 'Execution Room projection relay exceeded shutdown grace.',
    context: { workerId: 'worker-1' },
  });
  expect(calls.at(-1)).toBe('prisma:disconnect');
});

test('wires worktree coordinators by runtime without exposing private config', async () => {
  const calls: string[] = [];
  const privateRoot = '/private/worktrees/do-not-register';
  const privateAuthorName = 'Private Commit Author';
  const privateAuthorEmail = 'private-author@example.test';
  const daemonConfig = {
    ...config(),
    runtimes: [
      runtimeConfig(),
      worktreeRuntimeConfig({
        runtimeId: 'runtime-worktree',
        managedRoot: privateRoot,
        authorName: privateAuthorName,
        authorEmail: privateAuthorEmail,
      }),
    ],
  };
  const bindings = await createExecutionDaemonRuntimeBindingsV1(daemonConfig, {});
  const captured = {
    daemonOptions: undefined as ExecutionDaemonOptionsV1 | undefined,
  };
  const registrations: Array<
    Parameters<
      ExecutionDaemonCompositionDependenciesV1['registerRuntime']
    >[1]
  > = [];
  const logs: unknown[] = [];
  const dependencies = dependenciesForTest(calls, {
    createDaemon(options) {
      captured.daemonOptions = options;
      return {
        run: () => Promise.resolve(),
        drain: () => Promise.resolve(),
        interruptActive: () => Promise.resolve(),
      };
    },
    async registerRuntime(_actor, input) {
      registrations.push(input);
      return {} as never;
    },
    logger: {
      debug(message, context) { logs.push({ message, context }); },
      info(message, context) { logs.push({ message, context }); },
      warn(message, context) { logs.push({ message, context }); },
      error(message, context) { logs.push({ message, context }); },
    },
  });

  await createExecutionDaemonProcessControllerV1(
    { config: daemonConfig, runtimes: bindings },
    dependencies
  );

  const coordinators = captured.daemonOptions?.workspaceCoordinators;
  expect(coordinators).toBeInstanceOf(Map);
  expect(coordinators?.size).toBe(1);
  expect(coordinators?.has('runtime-1')).toBe(false);
  expect(coordinators?.get('runtime-worktree')).toBe(
    bindings[1].workspaceCoordinator
  );
  expect(
    registrations.map(({ descriptor }) => descriptor.capabilities.workspace)
  ).toEqual(['none', 'git-worktree']);
  expect(registrations.map(({ registration }) => registration)).toEqual([
    { workerId: 'worker-1' },
    { workerId: 'worker-1' },
  ]);
  expect(JSON.stringify({ registrations, logs })).not.toContain(privateRoot);
  expect(JSON.stringify({ registrations, logs })).not.toContain(
    privateAuthorName
  );
  expect(JSON.stringify({ registrations, logs })).not.toContain(
    privateAuthorEmail
  );
});

test('interrupts active work after shutdown grace expires without marking the runtime offline', async () => {
  const calls: string[] = [];
  let finishDaemon = () => {};
  let finishDrain = () => {};
  const dependencies = dependenciesForTest(calls, {
    createDaemon() {
      return {
        run: () => new Promise<void>((resolve) => { finishDaemon = resolve; }),
        drain: () => new Promise<void>((resolve) => { finishDrain = resolve; }),
        async interruptActive(reason) {
          calls.push(`daemon:interrupt:${reason}`);
          finishDrain();
          finishDaemon();
        },
      };
    },
    wait(duration, signal) {
      return duration === 15_000
        ? Promise.resolve()
        : waitUntilAborted(signal);
    },
  });
  const controller = await createExecutionDaemonProcessControllerV1(
    { config: config(), runtimes: [runtimeBinding()] },
    dependencies
  );

  const running = controller.run();
  await expect.poll(() => calls.includes('runtime:heartbeat:healthy')).toBe(true);
  await controller.stop('SIGTERM');
  await running;

  expect(calls).toContain(
    'daemon:interrupt:execution-daemon-shutdown-grace-expired'
  );
  expect(calls).not.toContain('runtime:heartbeat:offline');
  expect(calls.at(-1)).toBe('prisma:disconnect');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  test(`emits structured ready and stopped events for ${signal}`, async () => {
    const configPath = await writeProcessConfig();
    const host = new FakeProcessHost();
    let finishRun = () => {};
    try {
      const running = runExecutionDaemonProcessV1({
        environment: {
          DAO_EXECUTION_DAEMON_CONFIG_PATH: configPath,
          PATH: '/trusted/bin',
        },
        host,
        factory: async ({ runtimes }) => {
          await expect(runtimes[0].driver.describe()).resolves.toMatchObject({
            runtimeId: 'runtime-process-test',
          });
          return {
            run: () => new Promise<void>((resolve) => { finishRun = resolve; }),
            async stop(reason) {
              expect(reason).toBe(signal);
              finishRun();
            },
          };
        },
      });

      await expect.poll(() => host.events('stdout').length).toBe(1);
      host.signal(signal);
      await expect(running).resolves.toBe(0);
      expect(host.events('stdout')).toMatchObject([
        {
          schemaVersion: 1,
          type: 'ready',
          runtimeIds: ['runtime-process-test'],
        },
        { schemaVersion: 1, type: 'stopped', reason: signal },
      ]);
      expect(host.events('stderr')).toEqual([]);
      expect(host.listenerCount).toBe(0);
    } finally {
      await unlink(configPath);
    }
  });
}

test('emits a structured configuration error before ready', async () => {
  const host = new FakeProcessHost();
  await expect(
    runExecutionDaemonProcessV1({ environment: {}, host })
  ).resolves.toBe(1);
  expect(host.events('stdout')).toEqual([]);
  expect(host.events('stderr')).toMatchObject([
    { schemaVersion: 1, type: 'error', code: 'missing-config-path' },
  ]);
});

test('fails before ready when an external module cannot be loaded', async () => {
  const configPath = path.join(
    '/tmp',
    `execution-daemon-missing-plugin-${randomUUID()}.json`
  );
  const host = new FakeProcessHost();
  try {
    await writeFile(
      configPath,
      JSON.stringify({
        ...config(),
        runtimes: [
          {
            driver: 'external-module',
            runtimeId: 'missing-plugin',
            contractVersion: 1,
            modulePath: `/tmp/missing-plugin-${randomUUID()}.mjs`,
            exportName: 'default',
            envAllowlist: [],
            capacityTotal: 1,
          },
        ],
      }),
      'utf8'
    );
    await expect(
      runExecutionDaemonProcessV1({
        environment: { DAO_EXECUTION_DAEMON_CONFIG_PATH: configPath },
        host,
      })
    ).resolves.toBe(1);
    expect(host.events('stdout')).toEqual([]);
    expect(host.events('stderr')).toMatchObject([
      { schemaVersion: 1, type: 'error', code: 'plugin-module-load-failed' },
    ]);
    expect(JSON.stringify(host.events('stderr'))).not.toContain(configPath);
  } finally {
    await unlink(configPath);
  }
});

function config() {
  return {
    schemaVersion: 1 as const,
    organizationId: 'test-org',
    workerId: 'worker-1',
    pollIntervalMs: 100,
    heartbeatIntervalMs: 1_000,
    leaseDurationMs: 3_000,
    shutdownGraceMs: 15_000,
    runtimes: [runtimeConfig()],
  };
}

function dependenciesForTest(
  calls: string[],
  overrides: Partial<ExecutionDaemonCompositionDependenciesV1> = {}
): ExecutionDaemonCompositionDependenciesV1 {
  const binding = runtimeBinding();
  return {
    createStore: () => ({
      async listCandidates() { return []; },
      async claim() { return null; },
      async heartbeat() { return 'renewed'; },
      async appendEvent() { return 'appended'; },
      async complete() { return 'completed'; },
    }),
    createRegistry: () => ({
      async register(driver) { return driver; },
      list: () => [binding.driver],
      lookup: () => binding.driver,
    }),
    createDaemon: () => ({
      run: () => Promise.resolve(),
      drain: () => Promise.resolve(),
      interruptActive: () => Promise.resolve(),
    }),
    async registerRuntime() { return {} as never; },
    async heartbeatRuntime(_actor, input) {
      calls.push(`runtime:heartbeat:${input.health.state}`);
      return {} as never;
    },
    wait: (_duration, signal) => waitUntilAborted(signal),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    async disconnect() { calls.push('prisma:disconnect'); },
    ...overrides,
  };
}

function waitUntilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

type ProcessEventV1 = {
  schemaVersion: number;
  type: string;
  code?: string;
  reason?: string;
  runtimeIds?: string[];
};

class FakeProcessHost implements ExecutionDaemonProcessHostV1 {
  readonly pid = 42;
  private readonly output = { stdout: [] as string[], stderr: [] as string[] };
  private readonly listeners = new Map<
    ExecutionDaemonProcessSignalV1,
    () => void
  >();

  get listenerCount(): number {
    return this.listeners.size;
  }

  onSignal(
    signal: ExecutionDaemonProcessSignalV1,
    listener: () => void
  ): () => void {
    this.listeners.set(signal, listener);
    return () => this.listeners.delete(signal);
  }

  signal(signal: ExecutionDaemonProcessSignalV1): void {
    this.listeners.get(signal)?.();
  }

  write(target: 'stdout' | 'stderr', text: string): void {
    this.output[target].push(text);
  }

  events(target: 'stdout' | 'stderr'): ProcessEventV1[] {
    return this.output[target].map((line) =>
      safeJsonParse<ProcessEventV1>(line, { schemaVersion: 0, type: 'invalid' })
    );
  }
}

async function writeProcessConfig(): Promise<string> {
  const configPath = path.join(
    '/tmp',
    `execution-daemon-process-${randomUUID()}.json`
  );
  await writeFile(
    configPath,
    JSON.stringify({
      ...config(),
      runtimes: [
        {
          ...runtimeConfig(),
          runtimeId: 'runtime-process-test',
          envAllowlist: ['PATH'],
        },
      ],
    }),
    'utf8'
  );
  return configPath;
}

function runtimeConfig() {
  return {
    driver: 'generic-cli' as const,
    runtimeId: 'runtime-1',
    runtimeVersion: 'test',
    executable: '/usr/bin/true',
    args: [],
    cwd: '/tmp',
    envAllowlist: [],
    capacityTotal: 2,
  };
}

function worktreeRuntimeConfig(
  overrides: {
    runtimeId?: string;
    managedRoot?: string;
    authorName?: string;
    authorEmail?: string;
  } = {}
) {
  return {
    ...runtimeConfig(),
    runtimeId: overrides.runtimeId ?? 'runtime-worktree',
    worktree: {
      enabled: true as const,
      managedRoot: overrides.managedRoot ?? '/private/worktrees/default',
      commitAuthor: {
        name: overrides.authorName ?? 'Runtime Commit Author',
        email: overrides.authorEmail ?? 'runtime-author@example.test',
      },
    },
  };
}

function runtimeBinding(): ExecutionDaemonRuntimeBindingV1 {
  return {
    config: runtimeConfig(),
    driver: runtimeDriver(),
  };
}

function runtimeDriver(runtimeId = 'runtime-1'): ExecutionRuntimeDriverV1 {
  return {
      async describe() {
        return {
          schemaVersion: 1, runtimeId, displayName: 'Test',
          runtimeVersion: 'test',
          capabilities: {
            schemaVersion: 1, kinds: ['coding'], nativeResume: false, checkpoint: false,
            streaming: 'none', interrupt: 'none', workspace: 'none', sandbox: 'host',
            structuredArtifacts: false, waitingForHuman: false, supportedModels: [],
          },
        };
      },
      async *start() {},
      async interrupt() {},
      async reconcile(input) { return { runtimeAttemptId: input.runtimeAttemptId, status: 'unknown' }; },
      async archive() { return []; },
  };
}

function unusedGitWorktreePort(): GitWorktreePortV1 & GitWorktreeRecoveryPortV1 {
  const unused = async (): Promise<never> => {
    throw new Error('Git worktree port should not be used by this test.');
  };
  return {
    prepare: unused,
    prepareOrRecover: unused,
    finalize: unused,
    finalizeOrRecover: unused,
    cleanup: unused,
    cleanupOrRecover: unused,
    inspectRecoveryState: unused,
    recoverSuspended: unused,
    discardQuarantined: unused,
  };
}
