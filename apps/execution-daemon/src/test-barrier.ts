import process from 'node:process';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

import type {
  ExecutionDaemonStoreV1,
  ExecutionDaemonWorkspaceCoordinatorV1,
} from '@/agent/execution/daemon';

const TEST_BARRIER_ENV = 'DAO_EXECUTION_DAEMON_TEST_BARRIER';
const TEST_BARRIER_MARKER_ENV =
  'DAO_EXECUTION_DAEMON_TEST_BARRIER_MARKER_PATH';

type ExecutionDaemonTestBarrierStageV1 =
  | 'after-attempt-claim'
  | 'before-workspace-cleanup'
  | 'after-workspace-cleanup'
  | 'after-cleaned-lifecycle-persist'
  | 'before-room-projection-relay';

export type ExecutionDaemonTestBarrierV1 = {
  stage: ExecutionDaemonTestBarrierStageV1;
  markerPath: string;
};

/**
 * Process-test-only lifecycle barrier. It is intentionally unavailable unless
 * the daemon is launched in NODE_ENV=test, and it only pauses around the real
 * coordinator/store calls. Production cleanup and fencing behavior are never
 * bypassed.
 */
export function withExecutionDaemonTestCleanupBarrierV1(
  coordinator: ExecutionDaemonWorkspaceCoordinatorV1,
  barrier: ExecutionDaemonTestBarrierV1 | null | undefined
): ExecutionDaemonWorkspaceCoordinatorV1 {
  if (
    !barrier ||
    (barrier.stage !== 'before-workspace-cleanup' &&
      barrier.stage !== 'after-workspace-cleanup')
  ) {
    return coordinator;
  }

  return {
    prepareOrRecover: (input) => coordinator.prepareOrRecover(input),
    finalizeOrRecover: (lifecycle) =>
      coordinator.finalizeOrRecover(lifecycle),
    async cleanupOrRecover(input) {
      if (barrier.stage === 'before-workspace-cleanup') {
        await waitAtBarrier(barrier);
      }
      const cleaned = await coordinator.cleanupOrRecover(input);
      if (barrier.stage === 'after-workspace-cleanup') {
        await waitAtBarrier(barrier);
      }
      return cleaned;
    },
  };
}

export function withExecutionDaemonTestStoreBarrierV1(
  store: ExecutionDaemonStoreV1,
  barrier: ExecutionDaemonTestBarrierV1 | null | undefined
): ExecutionDaemonStoreV1 {
  if (barrier?.stage === 'after-attempt-claim') {
    return {
      ...store,
      async claim(input) {
        const claim = await store.claim(input);
        if (claim) await waitAtBarrier(barrier);
        return claim;
      },
    };
  }
  const persistWorkspaceLifecycle = store.persistWorkspaceLifecycle;
  if (
    !barrier ||
    barrier.stage !== 'after-cleaned-lifecycle-persist' ||
    !persistWorkspaceLifecycle
  ) {
    return store;
  }

  return {
    ...store,
    async persistWorkspaceLifecycle(input) {
      const result = await persistWorkspaceLifecycle.call(store, input);
      if (result === 'persisted' && input.lifecycle.cleanedAt) {
        await waitAtBarrier(barrier);
      }
      return result;
    },
  };
}

type RelayExecutionRoomProjectionsV1 =
  typeof import('@/objects/execution-job/room-projection').relayExecutionRoomProjections;

export function withExecutionDaemonTestRelayBarrierV1(
  relay: RelayExecutionRoomProjectionsV1,
  barrier: ExecutionDaemonTestBarrierV1 | null | undefined
): RelayExecutionRoomProjectionsV1 {
  if (!barrier || barrier.stage !== 'before-room-projection-relay') {
    return relay;
  }

  return async (...args) => {
    await waitAtBarrier(barrier);
    return relay(...args);
  };
}

export function readExecutionDaemonTestBarrierV1(
  environment: Readonly<Record<string, string | undefined>>
): ExecutionDaemonTestBarrierV1 | null {
  if (environment.NODE_ENV !== 'test') return null;

  const stage = environment[TEST_BARRIER_ENV];
  if (!stage) return null;
  if (!isTestBarrierStage(stage)) {
    throw new Error('Execution daemon test barrier stage is invalid.');
  }

  const markerPath = environment[TEST_BARRIER_MARKER_ENV];
  if (
    typeof markerPath !== 'string' ||
    !path.isAbsolute(markerPath) ||
    /[\r\n\0]/.test(markerPath)
  ) {
    throw new Error(
      'Execution daemon test barrier marker must be an absolute path.'
    );
  }

  return { stage, markerPath };
}

async function waitAtBarrier(
  barrier: ExecutionDaemonTestBarrierV1
): Promise<never> {
  await writeFile(
    barrier.markerPath,
    JSON.stringify({
      schemaVersion: 1,
      stage: barrier.stage,
      pid: process.pid,
    }),
    { encoding: 'utf8', flag: 'wx' }
  );
  return new Promise<never>(() => undefined);
}

function isTestBarrierStage(
  value: string
): value is ExecutionDaemonTestBarrierStageV1 {
  return (
    value === 'after-attempt-claim' ||
    value === 'before-workspace-cleanup' ||
    value === 'after-workspace-cleanup' ||
    value === 'after-cleaned-lifecycle-persist' ||
    value === 'before-room-projection-relay'
  );
}
