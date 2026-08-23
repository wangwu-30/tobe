import process from 'node:process';

import type {
  HandleRoomDeliveryInputV1,
  RoomSessionRuntimePortV1,
} from '@/agent/room-runtime/contracts';
import type { RoomHostStoreV1 } from '@/agent/room-host/store';
import { isRecord, safeJsonParse } from '@/framework/resilience/safe-data';
import { consumeRoomDelegationGrant } from '@/objects/room';

import { createRoomSessionHostProductionDependenciesV1 } from './production-composition';
import {
  createRoomSessionHostProcessControllerV1,
  runRoomSessionHostProcessV1,
  type RoomSessionHostFactoryContextV1,
} from './index';
import {
  withRoomHostProcessClaimBarrierV1,
  withRoomHostProcessRuntimeBarrierV1,
  waitAtRoomHostProcessBarrierV1,
  type RoomHostProcessBarrierV1,
} from './process-test-fixture';

const BARRIER_DIRECTORY_ENV = 'DAO_ROOM_HOST_TEST_BARRIER_DIRECTORY';
const BARRIER_NAME_ENV = 'DAO_ROOM_HOST_TEST_BARRIER_NAME';
const BARRIER_PHASE_ENV = 'DAO_ROOM_HOST_TEST_BARRIER_PHASE';
const BARRIER_PARTICIPANTS_ENV = 'DAO_ROOM_HOST_TEST_BARRIER_PARTICIPANTS';
const DELEGATION_COMMAND_ENV = 'DAO_ROOM_HOST_TEST_DELEGATION_COMMAND';
const ONLY_SESSION_ID_ENV = 'DAO_ROOM_HOST_TEST_ONLY_SESSION_ID';

type RoomHostProcessDelegationCommandV1 = {
  afterConsumeBarrierName?: string;
  beforeConsumeBarrierName?: string;
  instruction: string;
  invocationId: string;
  sourceDeliveryId: string;
  targetAgentId: string;
  userId: string;
};

function readBarrier(): RoomHostProcessBarrierV1 | null {
  const directory = process.env[BARRIER_DIRECTORY_ENV];
  const name = process.env[BARRIER_NAME_ENV];
  const phase = process.env[BARRIER_PHASE_ENV];
  const participantCount = process.env[BARRIER_PARTICIPANTS_ENV];
  const expectedParticipants = Number(participantCount);
  if (!name && !phase && !participantCount) {
    return null;
  }
  if (
    !directory ||
    !name ||
    (phase !== 'claim' && phase !== 'handle') ||
    !Number.isSafeInteger(expectedParticipants) ||
    expectedParticipants < 1
  ) {
    throw new Error('Room Host process test barrier environment is invalid.');
  }
  return { directory, expectedParticipants, name, phase };
}

function readDelegationCommand(): RoomHostProcessDelegationCommandV1 | null {
  const raw = process.env[DELEGATION_COMMAND_ENV];
  if (!raw) return null;
  const value = safeJsonParse<unknown>(raw, null);
  if (!isRecord(value)) invalidDelegationCommand();
  const allowed = new Set([
    'afterConsumeBarrierName',
    'beforeConsumeBarrierName',
    'instruction',
    'invocationId',
    'sourceDeliveryId',
    'targetAgentId',
    'userId',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    invalidDelegationCommand();
  }
  const command = {
    afterConsumeBarrierName: optionalText(value.afterConsumeBarrierName),
    beforeConsumeBarrierName: optionalText(value.beforeConsumeBarrierName),
    instruction: requiredText(value.instruction),
    invocationId: requiredText(value.invocationId),
    sourceDeliveryId: requiredText(value.sourceDeliveryId),
    targetAgentId: requiredText(value.targetAgentId),
    userId: requiredText(value.userId),
  };
  return {
    ...(command.afterConsumeBarrierName
      ? { afterConsumeBarrierName: command.afterConsumeBarrierName }
      : {}),
    ...(command.beforeConsumeBarrierName
      ? { beforeConsumeBarrierName: command.beforeConsumeBarrierName }
      : {}),
    instruction: command.instruction,
    invocationId: command.invocationId,
    sourceDeliveryId: command.sourceDeliveryId,
    targetAgentId: command.targetAgentId,
    userId: command.userId,
  };
}

async function createBarrierHost(
  context: RoomSessionHostFactoryContextV1
) {
  const barrier = readBarrier();
  const delegation = readDelegationCommand();
  const dependencies = createRoomSessionHostProductionDependenciesV1();
  return createRoomSessionHostProcessControllerV1(
    {
      ...context,
      runtimes: context.runtimes.map((binding) => ({
        ...binding,
        runtime: withRoomHostProcessDelegationV1(
          withRoomHostProcessRuntimeBarrierV1(
            binding.runtime,
            barrier,
            context.config.workerId
          ),
          delegation,
          process.env[BARRIER_DIRECTORY_ENV],
          context.config.workerId
        ),
      })),
    },
    {
      ...dependencies,
      createStore(input) {
        return withRoomHostProcessClaimBarrierV1(
          withOnlyRoomSessionV1(
            dependencies.createStore(input),
            optionalEnvironmentText(process.env[ONLY_SESSION_ID_ENV])
          ),
          barrier,
          context.config.workerId
        );
      },
    }
  );
}

function withOnlyRoomSessionV1(
  store: RoomHostStoreV1,
  roomSessionId: string | null
): RoomHostStoreV1 {
  if (!roomSessionId) return store;
  return {
    ...store,
    async listCandidates(input) {
      const candidates = await store.listCandidates({
        ...input,
        limit: Math.max(input.limit, 32),
      });
      const selected = candidates.find(
        (candidate) => candidate.roomSessionId === roomSessionId
      );
      return selected ? [selected] : [];
    },
    claim(input) {
      if (input.roomSessionId !== roomSessionId) return Promise.resolve(null);
      return store.claim(input);
    },
  };
}

/**
 * Test-entry-only runtime hook. It exercises the real durable delegation
 * command while the Host owns the source lease, then can pause after the
 * transaction commits so another OS process can consume the target delivery.
 */
function withRoomHostProcessDelegationV1(
  runtime: RoomSessionRuntimePortV1,
  command: RoomHostProcessDelegationCommandV1 | null,
  barrierDirectory: string | undefined,
  workerId: string
): RoomSessionRuntimePortV1 {
  if (!command) return runtime;
  return {
    describe: () => runtime.describe(),
    open: (input) => runtime.open(input),
    resume: (input) => runtime.resume(input),
    checkpoint: (input) => runtime.checkpoint(input),
    async *handle(input: HandleRoomDeliveryInputV1) {
      if (input.delivery.deliveryId === command.sourceDeliveryId) {
        if (command.beforeConsumeBarrierName) {
          await waitAtDelegationBarrier(
            barrierDirectory,
            command.beforeConsumeBarrierName,
            workerId,
            input,
            { stage: 'before-consume' }
          );
        }
        const result = await consumeRoomDelegationGrant(
          {
            organizationId: input.handle.session.organizationId,
            userId: command.userId,
          },
          input.handle.session.roomId,
          {
            instruction: command.instruction,
            invocationId: command.invocationId,
            source: {
              deliveryId: input.delivery.deliveryId,
              generation: input.handle.generation,
              roomSessionId: input.handle.session.roomSessionId,
              workerId,
            },
            targetAgentId: command.targetAgentId,
          }
        );
        if (command.afterConsumeBarrierName) {
          await waitAtDelegationBarrier(
            barrierDirectory,
            command.afterConsumeBarrierName,
            workerId,
            input,
            {
              stage: 'after-consume',
              delegationStatus: result.status,
              invocationId: result.invocationId,
              ...(result.status === 'accepted'
                ? { targetDeliveryId: result.deliveryId }
                : { failureCode: result.code }),
            }
          );
        }
      }
      yield* runtime.handle(input);
    },
  };
}

function waitAtDelegationBarrier(
  directory: string | undefined,
  name: string,
  workerId: string,
  input: HandleRoomDeliveryInputV1,
  metadata: Readonly<Record<string, unknown>>
) {
  if (!directory) invalidDelegationCommand();
  return waitAtRoomHostProcessBarrierV1(
    { directory, expectedParticipants: 1, name, phase: 'handle' },
    `${workerId}-${input.delivery.deliveryId}`,
    {
      deliveryId: input.delivery.deliveryId,
      roomSessionId: input.delivery.roomSessionId,
      ...metadata,
    }
  );
}

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) invalidDelegationCommand();
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value);
}

function optionalEnvironmentText(value: string | undefined): string | null {
  return value?.trim() || null;
}

function invalidDelegationCommand(): never {
  throw new Error(
    `${DELEGATION_COMMAND_ENV} must contain a valid process-test delegation command.`
  );
}

void runRoomSessionHostProcessV1({ factory: createBarrierHost }).then(
  (exitCode) => {
    process.exitCode = exitCode;
  }
);
