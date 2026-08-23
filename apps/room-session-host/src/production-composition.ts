import { DeterministicRoomContextBuilderV1 } from '@/agent/context';
import { RoomSessionHostV1 } from '@/agent/room-host/host';
import { createPrismaRoomHostContextSourceV1 } from '@/agent/room-host/prisma-context-source';
import { createPrismaRoomHostStoreV1 } from '@/agent/room-host/prisma-store';
import { RoomSessionRuntimeRegistryV1 } from '@/agent/room-runtime/registry';

import type { RoomSessionHostCompositionDependenciesV1 } from './index';

export function createRoomSessionHostProductionDependenciesV1(): RoomSessionHostCompositionDependenciesV1 {
  return {
    createStore: (input) => createPrismaRoomHostStoreV1(input),
    createContextSource: (input) =>
      createPrismaRoomHostContextSourceV1(input),
    createContextBuilder: () => new DeterministicRoomContextBuilderV1(),
    createRegistry: () => new RoomSessionRuntimeRegistryV1(),
    createHost: (options) => new RoomSessionHostV1(options),
    wait: waitForDuration,
    logger: createStructuredLogger(),
    async disconnect() {
      const { getPrismaClient } = await import('@/lib/db/prisma');
      await getPrismaClient().$disconnect();
    },
  };
}

function waitForDuration(
  durationMs: number,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(finish, durationMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    function finish() {
      signal.removeEventListener('abort', abort);
      resolve();
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

function createStructuredLogger() {
  const write = (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    context?: Readonly<Record<string, unknown>>
  ) => {
    process.stderr.write(
      `${JSON.stringify({
        schemaVersion: 1,
        type: 'room-host-log',
        level,
        message,
        ...(context ? { context } : {}),
      })}\n`
    );
  };
  return {
    debug: (message: string, context?: Readonly<Record<string, unknown>>) => write('debug', message, context),
    info: (message: string, context?: Readonly<Record<string, unknown>>) => write('info', message, context),
    warn: (message: string, context?: Readonly<Record<string, unknown>>) => write('warn', message, context),
    error: (message: string, context?: Readonly<Record<string, unknown>>) => write('error', message, context),
  };
}
