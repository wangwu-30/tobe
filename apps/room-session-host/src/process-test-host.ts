import process from 'node:process';

import { createRoomSessionHostProductionDependenciesV1 } from './production-composition';
import {
  createRoomSessionHostProcessControllerV1,
  runRoomSessionHostProcessV1,
  type RoomSessionHostFactoryContextV1,
} from './index';
import {
  withRoomHostProcessClaimBarrierV1,
  withRoomHostProcessRuntimeBarrierV1,
  type RoomHostProcessBarrierV1,
} from './process-test-fixture';

const BARRIER_DIRECTORY_ENV = 'DAO_ROOM_HOST_TEST_BARRIER_DIRECTORY';
const BARRIER_NAME_ENV = 'DAO_ROOM_HOST_TEST_BARRIER_NAME';
const BARRIER_PHASE_ENV = 'DAO_ROOM_HOST_TEST_BARRIER_PHASE';
const BARRIER_PARTICIPANTS_ENV = 'DAO_ROOM_HOST_TEST_BARRIER_PARTICIPANTS';

function readBarrier(): RoomHostProcessBarrierV1 | null {
  const directory = process.env[BARRIER_DIRECTORY_ENV];
  const name = process.env[BARRIER_NAME_ENV];
  const phase = process.env[BARRIER_PHASE_ENV];
  const expectedParticipants = Number(process.env[BARRIER_PARTICIPANTS_ENV]);
  if (!directory && !name && !phase && !process.env[BARRIER_PARTICIPANTS_ENV]) {
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

async function createBarrierHost(
  context: RoomSessionHostFactoryContextV1
) {
  const barrier = readBarrier();
  const dependencies = createRoomSessionHostProductionDependenciesV1();
  return createRoomSessionHostProcessControllerV1(
    {
      ...context,
      runtimes: context.runtimes.map((binding) => ({
        ...binding,
        runtime: withRoomHostProcessRuntimeBarrierV1(
          binding.runtime,
          barrier,
          context.config.workerId
        ),
      })),
    },
    {
      ...dependencies,
      createStore(input) {
        return withRoomHostProcessClaimBarrierV1(
          dependencies.createStore(input),
          barrier,
          context.config.workerId
        );
      },
    }
  );
}

void runRoomSessionHostProcessV1({ factory: createBarrierHost }).then(
  (exitCode) => {
    process.exitCode = exitCode;
  }
);
