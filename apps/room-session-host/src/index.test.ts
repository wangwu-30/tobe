import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import type { RoomSessionHostOptionsV1 } from '@/agent/room-host';
import { StubRoomSessionRuntimeV1 } from '@/agent/room-host/stub-runtime';
import { RoomSessionRuntimeRegistryV1 } from '@/agent/room-runtime/registry';
import { safeJsonParse } from '@/framework/resilience/safe-data';
import {
  createRoomSessionHostProcessControllerV1,
  createRoomSessionHostRuntimeBindingsV1,
  runRoomSessionHostProcessV1,
  type RoomSessionHostCompositionDependenciesV1,
  type RoomSessionHostProcessPortV1,
  type RoomSessionHostProcessSignalV1,
} from './index';
import {
  ROOM_SESSION_HOST_CONFIG_PATH_ENV,
  parseRoomSessionHostConfigV1,
  type RoomSessionHostConfigV1,
} from './config';

test('strict config validates lease cadence and duplicate runtimes', () => {
  expect(parseRoomSessionHostConfigV1(config())).toMatchObject({
    workerId: 'room-host-1',
    maxConcurrentSessions: 4,
  });
  expect(() =>
    parseRoomSessionHostConfigV1({
      ...config(),
      heartbeatIntervalMs: 1_001,
      leaseDurationMs: 3_000,
    })
  ).toThrow(/one third/);
  expect(() =>
    parseRoomSessionHostConfigV1({
      ...config(),
      runtimes: [runtimeConfig(), runtimeConfig()],
    })
  ).toThrow(/unique/);
  expect(() =>
    parseRoomSessionHostConfigV1({ ...config(), unexpected: true })
  ).toThrow(/unknown configuration field/);
});

test('strict config accepts Pi and rejects runtime driver impersonation', () => {
  expect(
    parseRoomSessionHostConfigV1({
      ...config(),
      runtimes: [piRuntimeConfig()],
    }).runtimes[0]
  ).toEqual(piRuntimeConfig());

  expect(() =>
    parseRoomSessionHostConfigV1({
      ...config(),
      runtimes: [{ ...runtimeConfig(), runtimeId: 'pi-agent-core' }],
    })
  ).toThrow(/must not impersonate pi-agent-core/);
  expect(() =>
    parseRoomSessionHostConfigV1({
      ...config(),
      runtimes: [{ ...piRuntimeConfig(), runtimeId: 'pi-alias' }],
    })
  ).toThrow(/must use runtimeId pi-agent-core/);
  expect(() =>
    parseRoomSessionHostConfigV1({
      ...config(),
      runtimes: [{ ...piRuntimeConfig(), apiKey: 'must-not-live-in-config' }],
    })
  ).toThrow(/unknown configuration field/);
});

test('runtime binding delegates only the Pi driver to the production factory', async () => {
  const pi = new StubRoomSessionRuntimeV1({ runtimeId: 'pi-agent-core' });
  const observed: unknown[] = [];
  const bindings = createRoomSessionHostRuntimeBindingsV1(
    { ...config(), runtimes: [piRuntimeConfig(), runtimeConfig()] },
    {
      createPiRuntime(runtimeConfig) {
        observed.push(runtimeConfig);
        return pi;
      },
    }
  );

  expect(observed).toEqual([piRuntimeConfig()]);
  expect(bindings.map(({ runtimeId }) => runtimeId)).toEqual([
    'pi-agent-core',
    'stub-runtime',
  ]);
  expect(bindings[0].runtime).toBe(pi);
  await expect(bindings[1].runtime.describe()).resolves.toMatchObject({
    runtimeId: 'stub-runtime',
  });
});

test('composition registers runtime ports and injects the default runtime into the Prisma seam', async () => {
  const calls: string[] = [];
  let captured: RoomSessionHostOptionsV1 | undefined;
  let finish = () => {};
  const dependencies: RoomSessionHostCompositionDependenciesV1 = {
    createStore(input) {
      calls.push(`store:${input.organizationId}:${input.defaultRuntimeId}`);
      return unusedStore();
    },
    createContextSource(input) {
      calls.push(`context:${input.organizationId}`);
      return { async load() { throw new Error('unused'); } };
    },
    createContextBuilder() {
      calls.push('builder');
      return { build() { throw new Error('unused'); } };
    },
    createRegistry: () => new RoomSessionRuntimeRegistryV1(),
    createHost(options) {
      captured = options;
      return {
        run: () => new Promise<void>((resolve) => { finish = resolve; }),
        async drain() { calls.push('drain'); finish(); },
        async interruptActive() { calls.push('interrupt'); },
      };
    },
    wait: waitUntilAborted,
    logger: silentLogger(),
    async disconnect() { calls.push('disconnect'); },
  };
  const runtime = new StubRoomSessionRuntimeV1({
    runtimeId: 'stub-runtime',
  });
  const controller = await createRoomSessionHostProcessControllerV1(
    {
      config: config(),
      runtimes: [{ runtimeId: 'stub-runtime', runtime }],
    },
    dependencies
  );

  const running = controller.run();
  await controller.stop('SIGTERM');
  await running;

  expect(calls).toEqual([
    'store:test-org:stub-runtime',
    'context:test-org',
    'builder',
    'drain',
    'disconnect',
  ]);
  expect(captured).toMatchObject({
    workerId: 'room-host-1',
    maxConcurrentSessions: 4,
  });
  expect(captured?.registry.lookup('stub-runtime')).toBe(runtime);
});

test('process emits ready and stopped events and removes signal listeners', async () => {
  const configPath = path.join(
    process.cwd(),
    '.tmp-room-session-host-index-test.json'
  );
  await writeFile(configPath, JSON.stringify(config()), 'utf8');
  const processHost = new FakeProcessHost();
  let finish = () => {};
  const calls: string[] = [];

  try {
    const running = runRoomSessionHostProcessV1({
      environment: { [ROOM_SESSION_HOST_CONFIG_PATH_ENV]: configPath },
      host: processHost,
      factory: async ({ config: loaded, runtimes }) => {
        expect(loaded.workerId).toBe('room-host-1');
        expect(runtimes.map(({ runtimeId }) => runtimeId)).toEqual([
          'stub-runtime',
        ]);
        return {
          run: () => new Promise<void>((resolve) => { finish = resolve; }),
          async stop(reason) {
            calls.push(`stop:${reason}`);
            finish();
          },
        };
      },
    });
    await expect.poll(() => processHost.stdout.length).toBe(1);
    processHost.emit('SIGTERM');
    expect(await running).toBe(0);

    expect(processHost.stdout.map((line) => line.type)).toEqual([
      'ready',
      'stopped',
    ]);
    expect(processHost.stdout[1]).toMatchObject({
      reason: 'SIGTERM',
      workerId: 'room-host-1',
    });
    expect(calls).toEqual(['stop:SIGTERM']);
    expect(processHost.listenerCount).toBe(0);
  } finally {
    await unlink(configPath).catch(() => undefined);
  }
});

function config(): RoomSessionHostConfigV1 {
  return {
    schemaVersion: 1,
    organizationId: 'test-org',
    workerId: 'room-host-1',
    pollIntervalMs: 100,
    heartbeatIntervalMs: 1_000,
    leaseDurationMs: 3_000,
    shutdownGraceMs: 2_000,
    maxConcurrentSessions: 4,
    maxDeliveryAttempts: 3,
    retryBaseDelayMs: 250,
    retryMaxDelayMs: 10_000,
    runtimes: [runtimeConfig()],
  };
}

function runtimeConfig() {
  return {
    driver: 'stub' as const,
    runtimeId: 'stub-runtime',
    runtimeVersion: '1.0.0',
    responseText: 'hello from the stub',
  };
}

function piRuntimeConfig() {
  return {
    driver: 'pi-agent-core' as const,
    runtimeId: 'pi-agent-core' as const,
    runtimeVersion: '0.57.1',
    providerId: 'openai',
    modelId: 'gpt-5.2',
    systemPrompt: 'Coordinate this Project Room.',
    thinkingLevel: 'low' as const,
  };
}

function unusedStore() {
  return {
    async listCandidates() { return []; },
    async claim() { return null; },
    async heartbeat() { return 'renewed' as const; },
    async bindRuntime() { return 'bound' as const; },
    async appendEvent() { return 'fenced' as const; },
    async persistCheckpoint() { return 'persisted' as const; },
    async finishDelivery() { return 'fenced' as const; },
    async retryDelivery() { return 'fenced' as const; },
  };
}

function silentLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

const waitUntilAborted = (_duration: number, signal: AbortSignal) =>
  new Promise<void>((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

class FakeProcessHost implements RoomSessionHostProcessPortV1 {
  readonly pid = 42;
  readonly stdout: Array<Record<string, unknown>> = [];
  readonly stderr: Array<Record<string, unknown>> = [];
  private readonly listeners = new Map<
    RoomSessionHostProcessSignalV1,
    Set<() => void>
  >();

  get listenerCount() {
    return [...this.listeners.values()].reduce(
      (count, listeners) => count + listeners.size,
      0
    );
  }

  onSignal(signal: RoomSessionHostProcessSignalV1, listener: () => void) {
    const listeners = this.listeners.get(signal) ?? new Set();
    listeners.add(listener);
    this.listeners.set(signal, listeners);
    return () => listeners.delete(listener);
  }

  write(target: 'stdout' | 'stderr', text: string) {
    const value = safeJsonParse<Record<string, unknown> | null>(text, null);
    if (!value) throw new Error('Process wrote invalid structured JSON.');
    this[target].push(value);
  }

  emit(signal: RoomSessionHostProcessSignalV1) {
    for (const listener of this.listeners.get(signal) ?? []) listener();
  }
}
