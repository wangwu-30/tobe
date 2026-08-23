import process from 'node:process';

import type {
  RoomHostLoggerV1,
  RoomHostWaitV1,
  RoomSessionHostOptionsV1,
} from '@/agent/room-host/host';
import { createStubRoomSessionRuntimeV1 } from '@/agent/room-host/stub-runtime';
import type { RoomSessionRuntimePortV1 } from '@/agent/room-runtime/contracts';
import { RoomSessionRuntimeRegistryV1 } from '@/agent/room-runtime/registry';

import {
  RoomSessionHostConfigErrorV1,
  loadRoomSessionHostConfigV1,
  type PiRoomSessionHostRuntimeConfigV1,
  type RoomSessionHostConfigV1,
  type RoomSessionHostRuntimeConfigV1,
  type StubRoomSessionHostRuntimeConfigV1,
} from './config';

export type RoomSessionHostRuntimeBindingV1 = {
  runtimeId: string;
  runtime: RoomSessionRuntimePortV1;
};

export type RoomSessionHostFactoryContextV1 = {
  config: RoomSessionHostConfigV1;
  runtimes: readonly RoomSessionHostRuntimeBindingV1[];
};

export interface RoomSessionHostProcessControllerV1 {
  run(): Promise<void>;
  stop(reason: 'SIGINT' | 'SIGTERM' | 'process-error'): Promise<void>;
}

export type RoomSessionHostFactoryV1 = (
  context: RoomSessionHostFactoryContextV1
) =>
  | RoomSessionHostProcessControllerV1
  | Promise<RoomSessionHostProcessControllerV1>;

type RoomSessionHostLifecycleV1 = {
  run(): Promise<void>;
  drain(): Promise<void>;
  interruptActive(reason?: string): Promise<void>;
};

export type RoomSessionHostCompositionDependenciesV1 = {
  createStore(input: {
    organizationId: string;
    defaultRuntimeId: string;
  }): RoomSessionHostOptionsV1['store'];
  createContextSource(input: {
    organizationId: string;
  }): RoomSessionHostOptionsV1['contextSource'];
  createContextBuilder(): RoomSessionHostOptionsV1['contextBuilder'];
  createRegistry(): RoomSessionRuntimeRegistryV1;
  createHost(options: RoomSessionHostOptionsV1): RoomSessionHostLifecycleV1;
  wait: RoomHostWaitV1;
  logger: RoomHostLoggerV1;
  disconnect(): Promise<void>;
};

export type RoomSessionHostProcessSignalV1 = 'SIGINT' | 'SIGTERM';

export interface RoomSessionHostProcessPortV1 {
  readonly pid: number;
  onSignal(
    signal: RoomSessionHostProcessSignalV1,
    listener: () => void
  ): () => void;
  write(target: 'stdout' | 'stderr', text: string): void;
}

export type RunRoomSessionHostProcessOptionsV1 = {
  factory?: RoomSessionHostFactoryV1;
  environment?: Readonly<Record<string, string | undefined>>;
  host?: RoomSessionHostProcessPortV1;
};

type StructuredProcessEventV1 =
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
      reason: RoomSessionHostProcessSignalV1 | 'completed';
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

/**
 * Process composition accepts arbitrary RoomSessionRuntimePortV1 bindings. A
 * production deployment can supply PiRoomSessionRuntimeAdapterV1 without the
 * Host depending on Pi, while the default executable uses deterministic stub
 * bindings for local smoke and contract exercises.
 */
export async function createRoomSessionHostProcessControllerV1(
  context: RoomSessionHostFactoryContextV1,
  dependencies?: RoomSessionHostCompositionDependenciesV1
): Promise<RoomSessionHostProcessControllerV1> {
  const resolvedDependencies =
    dependencies ??
    (await import('./production-composition')).createRoomSessionHostProductionDependenciesV1();
  const registry = resolvedDependencies.createRegistry();
  for (const binding of context.runtimes) {
    const descriptor = await binding.runtime.describe();
    if (descriptor.runtimeId !== binding.runtimeId) {
      throw new Error(
        `Configured Room runtime ${binding.runtimeId} described itself as ${descriptor.runtimeId}.`
      );
    }
    await registry.register(binding.runtime);
  }
  const defaultRuntimeId = context.runtimes[0]?.runtimeId;
  if (!defaultRuntimeId) {
    throw new Error('Room Session Host requires at least one runtime.');
  }

  const host = resolvedDependencies.createHost({
    workerId: context.config.workerId,
    store: resolvedDependencies.createStore({
      organizationId: context.config.organizationId,
      defaultRuntimeId,
    }),
    registry,
    contextSource: resolvedDependencies.createContextSource({
      organizationId: context.config.organizationId,
    }),
    contextBuilder: resolvedDependencies.createContextBuilder(),
    clock: { now: () => new Date() },
    wait: resolvedDependencies.wait,
    logger: resolvedDependencies.logger,
    pollIntervalMs: context.config.pollIntervalMs,
    heartbeatIntervalMs: context.config.heartbeatIntervalMs,
    leaseDurationMs: context.config.leaseDurationMs,
    maxConcurrentSessions: context.config.maxConcurrentSessions,
    maxDeliveryAttempts: context.config.maxDeliveryAttempts,
    retryBaseDelayMs: context.config.retryBaseDelayMs,
    retryMaxDelayMs: context.config.retryMaxDelayMs,
  });

  return createProcessController({
    host,
    shutdownGraceMs: context.config.shutdownGraceMs,
    wait: resolvedDependencies.wait,
    disconnect: resolvedDependencies.disconnect,
  });
}

export function createRoomSessionHostRuntimeBindingsV1(
  config: RoomSessionHostConfigV1,
  dependencies: {
    createPiRuntime?: (
      config: PiRoomSessionHostRuntimeConfigV1
    ) => RoomSessionRuntimePortV1;
  } = {}
): RoomSessionHostRuntimeBindingV1[] {
  return config.runtimes.map((runtimeConfig) => ({
    runtimeId: runtimeConfig.runtimeId,
    runtime: createConfiguredRuntime(
      runtimeConfig,
      dependencies.createPiRuntime
    ),
  }));
}

function createConfiguredRuntime(
  config: RoomSessionHostRuntimeConfigV1,
  createPiRuntime?: (
    config: PiRoomSessionHostRuntimeConfigV1
  ) => RoomSessionRuntimePortV1
): RoomSessionRuntimePortV1 {
  if (config.driver === 'pi-agent-core') {
    if (!createPiRuntime) {
      throw new Error('Pi Room runtime factory is unavailable.');
    }
    return createPiRuntime(config);
  }
  return createConfiguredStubRuntime(config);
}

function createConfiguredStubRuntime(
  config: StubRoomSessionHostRuntimeConfigV1
): RoomSessionRuntimePortV1 {
  return createStubRoomSessionRuntimeV1({
    runtimeId: config.runtimeId,
    runtimeVersion: config.runtimeVersion,
    responseText: config.responseText,
  });
}

function createProcessController(input: {
  host: RoomSessionHostLifecycleV1;
  shutdownGraceMs: number;
  wait: RoomHostWaitV1;
  disconnect(): Promise<void>;
}): RoomSessionHostProcessControllerV1 {
  let runPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;

  const stop = async (): Promise<void> => {
    let drainError: unknown = null;
    const drain = input.host.drain();
    try {
      const drained = await raceWithTimeout(
        drain,
        input.shutdownGraceMs,
        input.wait
      );
      if (!drained) {
        await input.host.interruptActive('room-host-shutdown-grace-expired');
        await drain;
      }
    } catch (error) {
      drainError = error;
    }
    await runPromise?.catch(() => undefined);
    await input.disconnect();
    if (drainError) throw drainError;
  };

  return {
    run() {
      if (runPromise) {
        throw new Error(
          'Room Session Host process controller can only run once.'
        );
      }
      const running = input.host.run();
      runPromise = running;
      return running;
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
  wait: RoomHostWaitV1
): Promise<boolean> {
  const controller = new AbortController();
  const result = await Promise.race([
    operation.then(() => true),
    wait(durationMs, controller.signal).then(() => false),
  ]);
  controller.abort();
  return result;
}

export async function runRoomSessionHostProcessV1(
  options: RunRoomSessionHostProcessOptionsV1 = {}
): Promise<number> {
  let controller: RoomSessionHostProcessControllerV1 | null = null;
  const host = options.host ?? NODE_PROCESS_PORT;
  let stopReason: RoomSessionHostProcessSignalV1 | 'completed' = 'completed';
  let stopPromise: Promise<void> | null = null;
  let stopError: unknown = null;
  const removeSignalListeners: Array<() => void> = [];

  const requestStop = (signal: RoomSessionHostProcessSignalV1): void => {
    if (!controller || stopPromise) return;
    stopReason = signal;
    stopPromise = controller.stop(signal).catch((error: unknown) => {
      stopError = error;
      writeStructuredEvent(host, 'stderr', errorEvent(host, error));
    });
  };

  try {
    const config = await loadRoomSessionHostConfigV1({
      environment: options.environment ?? process.env,
    });
    const createPiRuntime = config.runtimes.some(
      (runtime) => runtime.driver === 'pi-agent-core'
    )
      ? (await import('./pi-runtime')).createConfiguredPiRoomRuntimeV1
      : undefined;
    const runtimes = createRoomSessionHostRuntimeBindingsV1(config, {
      createPiRuntime,
    });
    controller = await (
      options.factory ?? createRoomSessionHostProcessControllerV1
    )({ config, runtimes });
    removeSignalListeners.push(
      host.onSignal('SIGINT', () => requestStop('SIGINT')),
      host.onSignal('SIGTERM', () => requestStop('SIGTERM'))
    );

    const running = controller.run();
    writeStructuredEvent(host, 'stdout', {
      schemaVersion: 1,
      type: 'ready',
      organizationId: config.organizationId,
      workerId: config.workerId,
      runtimeIds: runtimes.map(({ runtimeId }) => runtimeId),
      pid: host.pid,
    });
    await running;
    if (stopPromise) await stopPromise;
    if (stopError) return 1;
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
        // The original error remains authoritative.
      }
    }
    writeStructuredEvent(host, 'stderr', errorEvent(host, error));
    return 1;
  } finally {
    for (const removeListener of removeSignalListeners) removeListener();
  }
}

function errorEvent(
  host: RoomSessionHostProcessPortV1,
  error: unknown
): StructuredProcessEventV1 {
  return {
    schemaVersion: 1,
    type: 'error',
    code:
      error instanceof RoomSessionHostConfigErrorV1
        ? error.code
        : 'room-session-host-failed',
    message: error instanceof Error ? error.message : 'Unknown host error.',
    pid: host.pid,
  };
}

function writeStructuredEvent(
  host: RoomSessionHostProcessPortV1,
  target: 'stdout' | 'stderr',
  event: StructuredProcessEventV1
): void {
  host.write(target, `${JSON.stringify(event)}\n`);
}

const NODE_PROCESS_PORT: RoomSessionHostProcessPortV1 = {
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
  void runRoomSessionHostProcessV1().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
