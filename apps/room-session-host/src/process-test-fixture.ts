import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  HandleRoomDeliveryInputV1,
  RoomSessionRuntimePortV1,
} from '@/agent/room-runtime/contracts';
import type { RoomHostStoreV1 } from '@/agent/room-host/store';

const POLL_INTERVAL_MS = 5;

export type RoomHostProcessBarrierV1 = {
  directory: string;
  expectedParticipants: number;
  name: string;
  phase: 'claim' | 'handle';
};

/**
 * Test-only, filesystem-backed barriers used by independently spawned Room
 * Host processes. Each participant publishes an atomic arrival marker, waits
 * for the configured participant count, and then waits for the parent test to
 * atomically publish a release marker.
 */
export function withRoomHostProcessClaimBarrierV1(
  store: RoomHostStoreV1,
  barrier: RoomHostProcessBarrierV1 | null,
  participantId: string
): RoomHostStoreV1 {
  if (!barrier || barrier.phase !== 'claim') return store;
  return {
    ...store,
    async claim(input) {
      await waitAtRoomHostProcessBarrierV1(
        barrier,
        `${participantId}-${input.roomSessionId}`,
        {
          roomSessionId: input.roomSessionId,
          workerId: input.workerId,
        }
      );
      return store.claim(input);
    },
  };
}

export function withRoomHostProcessRuntimeBarrierV1(
  runtime: RoomSessionRuntimePortV1,
  barrier: RoomHostProcessBarrierV1 | null,
  participantId: string
): RoomSessionRuntimePortV1 {
  if (!barrier || barrier.phase !== 'handle') return runtime;
  return {
    describe: () => runtime.describe(),
    open: (input) => runtime.open(input),
    resume: (input) => runtime.resume(input),
    checkpoint: (input) => runtime.checkpoint(input),
    async *handle(input: HandleRoomDeliveryInputV1) {
      if (input.delivery.deliverySequence === 1) {
        await waitAtRoomHostProcessBarrierV1(
          barrier,
          `${participantId}-${input.delivery.roomSessionId}`,
          {
            deliveryId: input.delivery.deliveryId,
            deliverySequence: input.delivery.deliverySequence,
            roomSessionId: input.delivery.roomSessionId,
          }
        );
      }
      yield* runtime.handle(input);
    },
  };
}

export async function waitAtRoomHostProcessBarrierV1(
  barrier: RoomHostProcessBarrierV1,
  participantId: string,
  metadata: Readonly<Record<string, unknown>>
): Promise<void> {
  await mkdir(barrier.directory, { recursive: true });
  const arrivalPath = path.join(
    barrier.directory,
    `${barrier.name}.arrived.${safeFileSegment(participantId)}.json`
  );
  await writeJsonAtomically(arrivalPath, {
    schemaVersion: 1,
    barrier: barrier.name,
    participantId,
    pid: process.pid,
    ...metadata,
  });

  const releasePaths = [
    path.join(barrier.directory, `${barrier.name}.release`),
    path.join(
      barrier.directory,
      `${barrier.name}.release.${safeFileSegment(participantId)}`
    ),
  ];
  while (!(await anyMarkerExists(releasePaths))) await wait(POLL_INTERVAL_MS);
}

async function anyMarkerExists(markerPaths: string[]) {
  return (await Promise.all(markerPaths.map(markerExists))).some(Boolean);
}

async function markerExists(markerPath: string) {
  try {
    await readFile(markerPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function writeJsonAtomically(targetPath: string, value: unknown) {
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value), 'utf8');
  await rename(temporaryPath, targetPath);
}

function safeFileSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function wait(durationMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, durationMs));
}
