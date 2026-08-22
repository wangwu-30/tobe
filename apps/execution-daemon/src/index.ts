import process from 'node:process';

import {
  ExecutionDaemonV1,
  type ExecutionDaemonLoggerV1,
  type ExecutionDaemonOptionsV1,
  type ExecutionDaemonStoreV1,
  type ExecutionDaemonWaitV1,
  type ExecutionDaemonWorkspaceCoordinatorV1,
} from '@/agent/execution/daemon';
import type { ExecutionRuntimeDriverV1 } from '@/agent/execution/driver';
import {
  GenericCliExecutionRuntimeDriverV1,
  type GenericCliExecutionRuntimeDriverConfigV1,
} from '@/agent/execution/drivers/generic-cli';
import { GitWorktreeExecutionRuntimeDriverV1 } from '@/agent/execution/drivers/git-worktree-wrapper';
import { GitWorktreeLifecycleCoordinatorV1 } from '@/agent/execution/git-worktree-coordinator';
import { createPrismaExecutionDaemonStore } from '@/agent/execution/prisma-daemon-store';
import { ExecutionRuntimeDriverRegistryV1 } from '@/agent/execution/registry';
import { loadExecutionRuntimePluginV1 } from '@/agent/execution/runtime-plugin-loader';
import {
  ExecutionDaemonConfigErrorV1,
  loadExecutionDaemonConfigV1,
  resolveExecutionDaemonRuntimeEnvironmentV1,
  type ExecutionDaemonConfigV1,
  type ExecutionDaemonRuntimeConfigV1,
} from '@/agent/execution/daemon-config';
import type { RuntimeHealthV1 } from '@/agent/execution/contracts';
import type {
  GitWorktreePortV1,
  GitWorktreeRecoveryPortV1,
} from '@/agent/knowledge/contracts';
import {
  LocalGitWorktreePort,
  type LocalGitWorktreePortConfig,
} from '@/agent/knowledge/git-worktree';
import {
  readExecutionDaemonTestBarrierV1,
  withExecutionDaemonTestCleanupBarrierV1,
  withExecutionDaemonTestRelayBarrierV1,
  withExecutionDaemonTestStoreBarrierV1,
  type ExecutionDaemonTestBarrierV1,
} from './test-barrier';

export type ExecutionDaemonRuntimeBindingV1 = {
  config: ExecutionDaemonRuntimeConfigV1;
  driver: ExecutionRuntimeDriverV1;
  workspaceCoordinator?: ExecutionDaemonWorkspaceCoordinatorV1;
};

type ExecutionDaemonRuntimeBindingDependenciesV1 = {
  createGenericCliDriver(
    config: GenericCliExecutionRuntimeDriverConfigV1
  ): ExecutionRuntimeDriverV1;
  loadExternalModuleDriver(
    input: Parameters<typeof loadExecutionRuntimePluginV1>[0]
  ): Promise<ExecutionRuntimeDriverV1>;
  createGitWorktreePort(
    config: LocalGitWorktreePortConfig
  ): GitWorktreePortV1 & GitWorktreeRecoveryPortV1;
  createGitWorktreeCoordinator(
    port: GitWorktreePortV1 & GitWorktreeRecoveryPortV1
  ): ExecutionDaemonWorkspaceCoordinatorV1;
};

export type ExecutionDaemonFactoryContextV1 = {
  config: ExecutionDaemonConfigV1;
  runtimes: readonly ExecutionDaemonRuntimeBindingV1[];
  testBarrier?: ExecutionDaemonTestBarrierV1;
};

/**
 * The deliberately narrow process-to-core boundary. It does not expose claim,
 * heartbeat, event, or Prisma shapes; a control-plane adapter owns those
 * mappings and returns this lifecycle-only controller.
 */
export interface ExecutionDaemonProcessControllerV1 {
  run(): Promise<void>;
  stop(reason: 'SIGINT' | 'SIGTERM' | 'process-error'): Promise<void>;
}

export type ExecutionDaemonFactoryV1 = (
  context: ExecutionDaemonFactoryContextV1
) =>
  | ExecutionDaemonProcessControllerV1
  | Promise<ExecutionDaemonProcessControllerV1>;

type RuntimeRegistryV1 = Pick<
  ExecutionRuntimeDriverRegistryV1,
  'register' | 'list' | 'lookup'
>;

type RuntimeDaemonActorV1 = { organizationId: string };
type ExecutionDaemonLifecycleV1 = Pick<
  ExecutionDaemonV1,
  'run' | 'drain' | 'interruptActive'
>;

export type ExecutionDaemonCompositionDependenciesV1 = {
  createStore(actor: RuntimeDaemonActorV1): ExecutionDaemonStoreV1;
  createRegistry(): RuntimeRegistryV1;
  createDaemon(options: ExecutionDaemonOptionsV1): ExecutionDaemonLifecycleV1;
  registerRuntime: typeof import('@/objects/execution-runtime/worker-commands').registerExecutionRuntimeDaemon;
  heartbeatRuntime: typeof import('@/objects/execution-runtime/worker-commands').heartbeatExecutionRuntimeDaemon;
  /** Omit only in isolated composition tests that deliberately disable relay. */
  relayRoomProjections?: typeof import('@/objects/execution-job/room-projection').relayExecutionRoomProjections;
  wait: ExecutionDaemonWaitV1;
  logger: ExecutionDaemonLoggerV1;
  disconnect(): Promise<void>;
};

export type RunExecutionDaemonProcessOptionsV1 = {
  factory?: ExecutionDaemonFactoryV1;
  environment?: Readonly<Record<string, string | undefined>>;
  host?: ExecutionDaemonProcessHostV1;
};

export type ExecutionDaemonProcessSignalV1 = 'SIGINT' | 'SIGTERM';

export interface ExecutionDaemonProcessHostV1 {
  readonly pid: number;
  onSignal(
    signal: ExecutionDaemonProcessSignalV1,
    listener: () => void
  ): () => void;
  write(target: 'stdout' | 'stderr', text: string): void;
}

type StructuredProcessEvent =
  | {
      schemaVersion: 1;
      type: 'ready';
      organizationId: string;
      workerId: string;
      runtimeIds: readonly string[];
      pid: number;
    }
  | {
      schemaVersion: 1;
      type: 'stopped';
      reason: ExecutionDaemonProcessSignalV1 | 'completed';
      workerId: string;
      pid: number;
    }
  | {
      schemaVersion: 1;
      type: 'error';
      code: string;
      message: string;
      pid: number;
    };

export async function createExecutionDaemonProcessControllerV1(
  context: ExecutionDaemonFactoryContextV1,
  dependencies: ExecutionDaemonCompositionDependenciesV1 =
    DEFAULT_COMPOSITION_DEPENDENCIES_V1
): Promise<ExecutionDaemonProcessControllerV1> {
  const actor = { organizationId: context.config.organizationId };
  try {
    const registry = dependencies.createRegistry();
    const health = healthyRuntimeState();

    for (const binding of context.runtimes) {
      const descriptor = await binding.driver.describe();
      if (descriptor.runtimeId !== binding.config.runtimeId) {
        throw new Error(
          `Configured runtime ${binding.config.runtimeId} described itself as ${descriptor.runtimeId}.`
        );
      }
      await registry.register(binding.driver);
      await dependencies.registerRuntime(actor, {
        descriptor,
        driver: binding.config.driver,
        capacityTotal: binding.config.capacityTotal,
        health,
        registration: { workerId: context.config.workerId },
      });
    }

    const maxConcurrentAttempts = totalRuntimeCapacity(context.runtimes);
    const workspaceCoordinators = new Map<
      string,
      ExecutionDaemonWorkspaceCoordinatorV1
    >();
    for (const binding of context.runtimes) {
      if (binding.workspaceCoordinator) {
        workspaceCoordinators.set(
          binding.config.runtimeId,
          binding.workspaceCoordinator
        );
      }
    }
    const daemon = dependencies.createDaemon({
      workerId: context.config.workerId,
      store: withExecutionDaemonTestStoreBarrierV1(
        dependencies.createStore(actor),
        context.testBarrier
      ),
      registry,
      workspaceCoordinators,
      clock: { now: () => new Date() },
      wait: dependencies.wait,
      logger: dependencies.logger,
      pollIntervalMs: context.config.pollIntervalMs,
      heartbeatIntervalMs: context.config.heartbeatIntervalMs,
      leaseDurationMs: context.config.leaseDurationMs,
      pollBatchSize: maxConcurrentAttempts,
      maxConcurrentAttempts,
    });

    const controllerDependencies = dependencies.relayRoomProjections
      ? {
          ...dependencies,
          relayRoomProjections: withExecutionDaemonTestRelayBarrierV1(
            dependencies.relayRoomProjections,
            context.testBarrier
          ),
        }
      : dependencies;

    return createComposedProcessController({
      actor,
      config: context.config,
      daemon,
      dependencies: controllerDependencies,
    });
  } catch (error) {
    await dependencies.disconnect().catch(() => undefined);
    throw error;
  }
}

export async function createExecutionDaemonRuntimeBindingsV1(
  config: ExecutionDaemonConfigV1,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: ExecutionDaemonRuntimeBindingDependenciesV1 =
    DEFAULT_RUNTIME_BINDING_DEPENDENCIES_V1
): Promise<ExecutionDaemonRuntimeBindingV1[]> {
  const testBarrier = readExecutionDaemonTestBarrierV1(environment);
  return Promise.all(config.runtimes.map(async (runtime) => {
    const runtimeEnvironment = resolveExecutionDaemonRuntimeEnvironmentV1(
      runtime,
      environment
    );
    const baseDriver = runtime.driver === 'generic-cli'
      ? dependencies.createGenericCliDriver({
          executable: runtime.executable,
          args: runtime.args,
          cwd: runtime.cwd,
          env: runtimeEnvironment,
          runtimeId: runtime.runtimeId,
          runtimeVersion: runtime.runtimeVersion,
          ...(runtime.timeoutMs === undefined
            ? {}
            : { timeoutMs: runtime.timeoutMs }),
          ...(runtime.interruptGracePeriodMs === undefined
            ? {}
            : { interruptGracePeriodMs: runtime.interruptGracePeriodMs }),
          ...(runtime.maxStdoutBytes === undefined
            ? {}
            : { maxStdoutBytes: runtime.maxStdoutBytes }),
          ...(runtime.maxStderrBytes === undefined
            ? {}
            : { maxStderrBytes: runtime.maxStderrBytes }),
          ...(runtime.supportedModels === undefined
            ? {}
            : { supportedModels: runtime.supportedModels }),
          ...(runtime.features === undefined
            ? {}
            : { features: runtime.features }),
          ...(runtime.selectionPriority === undefined
            ? {}
            : { selectionPriority: runtime.selectionPriority }),
        })
      : await dependencies.loadExternalModuleDriver({
          contractVersion: runtime.contractVersion,
          modulePath: runtime.modulePath,
          exportName: runtime.exportName,
          runtimeId: runtime.runtimeId,
          environment: runtimeEnvironment,
        });

    if (!runtime.worktree) {
      return { config: runtime, driver: baseDriver };
    }

    const gitWorktrees = dependencies.createGitWorktreePort({
      managedRoot: runtime.worktree.managedRoot,
      commitAuthor: { ...runtime.worktree.commitAuthor },
    });
    return {
      config: runtime,
      driver: new GitWorktreeExecutionRuntimeDriverV1(baseDriver),
      workspaceCoordinator: withExecutionDaemonTestCleanupBarrierV1(
        dependencies.createGitWorktreeCoordinator(gitWorktrees),
        testBarrier
      ),
    };
  }));
}

function createComposedProcessController(input: {
  actor: RuntimeDaemonActorV1;
  config: ExecutionDaemonConfigV1;
  daemon: ExecutionDaemonLifecycleV1;
  dependencies: ExecutionDaemonCompositionDependenciesV1;
}): ExecutionDaemonProcessControllerV1 {
  const heartbeatController = new AbortController();
  const projectionController = new AbortController();
  let heartbeatPromise: Promise<void> | null = null;
  let projectionPromise: Promise<void> | null = null;
  let runPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;

  const heartbeatRuntimes = async (): Promise<void> => {
    while (!heartbeatController.signal.aborted) {
      await Promise.all(
        input.config.runtimes.map((runtime) =>
          input.dependencies.heartbeatRuntime(input.actor, {
            runtimeId: runtime.runtimeId,
            health: healthyRuntimeState(),
            capacityTotal: runtime.capacityTotal,
          })
        )
      );
      try {
        await input.dependencies.wait(
          input.config.heartbeatIntervalMs,
          heartbeatController.signal
        );
      } catch (error) {
        if (!heartbeatController.signal.aborted) {
          throw error;
        }
      }
    }
  };

  const relayRoomProjections = async (): Promise<void> => {
    const relay = input.dependencies.relayRoomProjections;
    if (!relay) return;
    while (!projectionController.signal.aborted) {
      try {
        const result = await relay(input.actor, { limit: 32 });
        if (result.failed > 0) {
          input.dependencies.logger.warn(
            'Execution Room projection relay retained failed rows for retry.',
            { failed: result.failed, workerId: input.config.workerId }
          );
        }
      } catch (error) {
        input.dependencies.logger.error(
          'Execution Room projection relay failed; pending rows remain durable.',
          { error: errorMessage(error), workerId: input.config.workerId }
        );
      }
      try {
        await input.dependencies.wait(
          input.config.pollIntervalMs,
          projectionController.signal
        );
      } catch (error) {
        if (!projectionController.signal.aborted) {
          input.dependencies.logger.warn(
            'Execution Room projection relay wait failed.',
            { error: errorMessage(error), workerId: input.config.workerId }
          );
        }
      }
    }
  };

  const stop = async (): Promise<void> => {
    let drainError: unknown = null;
    heartbeatController.abort();
    projectionController.abort();
    const drain = input.daemon.drain();
    try {
      const drained = await raceWithTimeout(
        drain,
        input.config.shutdownGraceMs,
        input.dependencies.wait
      );
      if (!drained) {
        await input.daemon.interruptActive(
          'execution-daemon-shutdown-grace-expired'
        );
        await drain;
      }
    } catch (error) {
      drainError = error;
    }
    // Do not write an offline runtime heartbeat here. Runtime ids may be
    // shared by multiple daemon processes; liveness expires through the
    // control-plane heartbeat TTL once this process stops refreshing it.
    await heartbeatPromise?.catch(() => undefined);
    if (projectionPromise) {
      const projectionStopped = await raceWithTimeout(
        projectionPromise,
        input.config.shutdownGraceMs,
        input.dependencies.wait
      );
      if (!projectionStopped) {
        input.dependencies.logger.warn(
          'Execution Room projection relay exceeded shutdown grace.',
          { workerId: input.config.workerId }
        );
      }
    }
    await runPromise?.catch(() => undefined);
    await input.dependencies.disconnect();
    if (drainError) {
      throw drainError;
    }
  };

  return {
    run() {
      if (runPromise) {
        throw new Error('Execution daemon process controller can only run once.');
      }
      heartbeatPromise = heartbeatRuntimes();
      projectionPromise = relayRoomProjections();
      runPromise = Promise.race([
        input.daemon.run(),
        heartbeatPromise.then(() => {
          if (!heartbeatController.signal.aborted) {
            throw new Error(
              'Execution runtime registration heartbeat stopped unexpectedly.'
            );
          }
        }),
      ]);
      return runPromise;
    },
    stop() {
      stopPromise ??= stop();
      return stopPromise;
    },
  };
}

async function raceWithTimeout(
  operation: Promise<void>,
  durationMs: number,
  wait: ExecutionDaemonWaitV1
): Promise<boolean> {
  const controller = new AbortController();
  const result = await Promise.race([
    operation.then(() => true),
    wait(durationMs, controller.signal).then(() => false),
  ]);
  controller.abort();
  return result;
}

function totalRuntimeCapacity(
  runtimes: readonly ExecutionDaemonRuntimeBindingV1[]
): number {
  const total = runtimes.reduce(
    (sum, runtime) => sum + runtime.config.capacityTotal,
    0
  );
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new Error('Execution daemon total runtime capacity is invalid.');
  }
  return total;
}

function healthyRuntimeState(): RuntimeHealthV1 {
  return { state: 'healthy', acceptingNewAttempts: true };
}

const DEFAULT_COMPOSITION_DEPENDENCIES_V1: ExecutionDaemonCompositionDependenciesV1 = {
  createStore: createPrismaExecutionDaemonStore,
  createRegistry: () => new ExecutionRuntimeDriverRegistryV1(),
  createDaemon: (options) => new ExecutionDaemonV1(options),
  async registerRuntime(...args) {
    const { registerExecutionRuntimeDaemon } = await import(
      '@/objects/execution-runtime/worker-commands'
    );
    return registerExecutionRuntimeDaemon(...args);
  },
  async heartbeatRuntime(...args) {
    const { heartbeatExecutionRuntimeDaemon } = await import(
      '@/objects/execution-runtime/worker-commands'
    );
    return heartbeatExecutionRuntimeDaemon(...args);
  },
  async relayRoomProjections(...args) {
    const { relayExecutionRoomProjections } = await import(
      '@/objects/execution-job/room-projection'
    );
    return relayExecutionRoomProjections(...args);
  },
  wait: waitForDuration,
  logger: createStructuredLogger(),
  async disconnect() {
    const { getPrismaClient } = await import('@/lib/db/prisma');
    await getPrismaClient().$disconnect();
  },
};

const DEFAULT_RUNTIME_BINDING_DEPENDENCIES_V1: ExecutionDaemonRuntimeBindingDependenciesV1 = {
  createGenericCliDriver: (config) =>
    new GenericCliExecutionRuntimeDriverV1(config),
  loadExternalModuleDriver: (input) => loadExecutionRuntimePluginV1(input),
  createGitWorktreePort: (config) => new LocalGitWorktreePort(config),
  createGitWorktreeCoordinator: (port) =>
    new GitWorktreeLifecycleCoordinatorV1(port),
};

function waitForDuration(
  durationMs: number,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const handle = setTimeout(finish, durationMs);
    const onAbort = () => {
      clearTimeout(handle);
      reject(signal.reason);
    };
    function finish() {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function createStructuredLogger(): ExecutionDaemonLoggerV1 {
  const write = (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    context?: Readonly<Record<string, unknown>>
  ) => {
    process.stderr.write(
      `${JSON.stringify({
        schemaVersion: 1,
        type: 'daemon-log',
        level,
        message,
        ...(context ? { context } : {}),
      })}\n`
    );
  };
  return {
    debug: (message, context) => write('debug', message, context),
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context),
  };
}

export async function runExecutionDaemonProcessV1(
  options: RunExecutionDaemonProcessOptionsV1 = {}
): Promise<number> {
  let controller: ExecutionDaemonProcessControllerV1 | null = null;
  const host = options.host ?? NODE_PROCESS_HOST;
  let stopReason: ExecutionDaemonProcessSignalV1 | 'completed' = 'completed';
  let stopPromise: Promise<void> | null = null;
  let stopError: unknown = null;
  const removeSignalListeners: Array<() => void> = [];

  const requestStop = (signal: ExecutionDaemonProcessSignalV1): void => {
    if (!controller || stopPromise) {
      return;
    }
    stopReason = signal;
    stopPromise = controller.stop(signal).catch((error: unknown) => {
      stopError = error;
      writeStructuredEvent(host, 'stderr', errorEvent(host, error));
    });
  };
  const onSigint = () => requestStop('SIGINT');
  const onSigterm = () => requestStop('SIGTERM');

  try {
    const environment = options.environment ?? process.env;
    const config = await loadExecutionDaemonConfigV1({ environment });
    const testBarrier = readExecutionDaemonTestBarrierV1(environment);
    const runtimes = await createExecutionDaemonRuntimeBindingsV1(
      config,
      environment
    );
    controller = await (
      options.factory ?? createExecutionDaemonProcessControllerV1
    )({ config, runtimes, ...(testBarrier ? { testBarrier } : {}) });

    removeSignalListeners.push(
      host.onSignal('SIGINT', onSigint),
      host.onSignal('SIGTERM', onSigterm)
    );

    const running = controller.run();
    writeStructuredEvent(host, 'stdout', {
      schemaVersion: 1,
      type: 'ready',
      organizationId: config.organizationId,
      workerId: config.workerId,
      runtimeIds: config.runtimes.map((runtime) => runtime.runtimeId),
      pid: host.pid,
    });

    await running;
    if (stopPromise) {
      await stopPromise;
    }
    if (stopError) {
      return 1;
    }

    writeStructuredEvent(host, 'stdout', {
      schemaVersion: 1,
      type: 'stopped',
      reason: stopReason,
      workerId: config.workerId,
      pid: host.pid,
    });
    return 0;
  } catch (error) {
    if (controller && !stopPromise) {
      try {
        await controller.stop('process-error');
      } catch {
        // The original error is authoritative and is emitted exactly once.
      }
    }
    writeStructuredEvent(host, 'stderr', errorEvent(host, error));
    return 1;
  } finally {
    for (const removeListener of removeSignalListeners) {
      removeListener();
    }
  }
}

function errorEvent(
  host: ExecutionDaemonProcessHostV1,
  error: unknown
): StructuredProcessEvent {
  return {
    schemaVersion: 1,
    type: 'error',
    code: errorCode(error),
    message: error instanceof Error ? error.message : 'Unknown daemon error.',
    pid: host.pid,
  };
}

function errorCode(error: unknown): string {
  if (error instanceof ExecutionDaemonConfigErrorV1) {
    return error.code;
  }
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return 'execution-daemon-failed';
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Unknown execution daemon error.';
}

function writeStructuredEvent(
  host: ExecutionDaemonProcessHostV1,
  target: 'stdout' | 'stderr',
  event: StructuredProcessEvent
): void {
  host.write(target, `${JSON.stringify(event)}\n`);
}

const NODE_PROCESS_HOST: ExecutionDaemonProcessHostV1 = {
  pid: process.pid,
  onSignal(signal, listener) {
    process.once(signal, listener);
    return () => process.removeListener(signal, listener);
  },
  write(target, text) {
    process[target].write(text);
  },
};

if (process.argv[1]?.endsWith('index.mjs')) {
  void runExecutionDaemonProcessV1().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
