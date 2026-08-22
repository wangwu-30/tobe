import { expect, test } from '@playwright/test';

import { RUNTIME_CONTRACT_VERSION_V1 } from './contracts';
import type {
  ExecutionRuntimeDriverV1,
  RuntimeEventV1,
} from './driver';
import {
  ExecutionRuntimeDriverRegistryErrorV1,
  ExecutionRuntimeDriverRegistryV1,
} from './registry';

const VERSION = RUNTIME_CONTRACT_VERSION_V1;

function driver(runtimeId: string): ExecutionRuntimeDriverV1 {
  return {
    async describe() {
      return {
        schemaVersion: VERSION,
        runtimeId,
        displayName: runtimeId,
        runtimeVersion: 'test',
        capabilities: {
          schemaVersion: VERSION,
          kinds: ['coding'],
          nativeResume: false,
          checkpoint: false,
          streaming: 'none',
          interrupt: 'none',
          workspace: 'none',
          sandbox: 'host',
          structuredArtifacts: false,
          waitingForHuman: false,
          supportedModels: [],
        },
      };
    },
    start() {
      return noEvents();
    },
    async interrupt() {},
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
}

async function* noEvents(): AsyncIterable<RuntimeEventV1> {}

function waitingDriver(
  runtimeId: string,
  options: { nativeResume: boolean; implementsResume: boolean }
): ExecutionRuntimeDriverV1 {
  const base = driver(runtimeId);
  return {
    ...base,
    async describe() {
      const descriptor = await base.describe();
      return {
        ...descriptor,
        capabilities: {
          ...descriptor.capabilities,
          nativeResume: options.nativeResume,
          waitingForHuman: true,
        },
      };
    },
    ...(options.implementsResume ? { resume: noEvents } : {}),
  };
}

test('registers multiple drivers and supports stable lookup and listing', async () => {
  const registry = new ExecutionRuntimeDriverRegistryV1();
  const openhands = driver('openhands');
  const genericCli = driver('generic-cli');

  await expect(registry.register(openhands)).resolves.toBe(openhands);
  await expect(registry.register(genericCli)).resolves.toBe(genericCli);

  expect(registry.lookup('openhands')).toBe(openhands);
  expect(registry.lookup('generic-cli')).toBe(genericCli);
  expect(registry.lookup('missing')).toBeUndefined();
  expect(registry.list()).toEqual([openhands, genericCli]);
});

test('rejects duplicate runtime ids without replacing the first driver', async () => {
  const registry = new ExecutionRuntimeDriverRegistryV1();
  const first = driver('openhands');
  const duplicate = driver('openhands');
  await registry.register(first);

  const registration = registry.register(duplicate);
  await expect(registration).rejects.toBeInstanceOf(
    ExecutionRuntimeDriverRegistryErrorV1
  );
  await expect(registration).rejects.toMatchObject({
    code: 'duplicate-runtime-id',
    runtimeId: 'openhands',
  });
  expect(registry.lookup('openhands')).toBe(first);
  expect(registry.list()).toEqual([first]);
});

test('rejects empty and whitespace-padded runtime ids', async () => {
  for (const runtimeId of ['', ' openhands', 'openhands ']) {
    const registry = new ExecutionRuntimeDriverRegistryV1();
    await expect(registry.register(driver(runtimeId))).rejects.toMatchObject({
      code: 'invalid-runtime-id',
      runtimeId,
    });
    expect(registry.list()).toEqual([]);
  }
});

test('rejects waiting-for-human without advertised native resume', async () => {
  const registry = new ExecutionRuntimeDriverRegistryV1();

  await expect(
    registry.register(
      waitingDriver('invalid-waiting-runtime', {
        nativeResume: false,
        implementsResume: true,
      })
    )
  ).rejects.toMatchObject({
    code: 'waiting-for-human-requires-native-resume',
    runtimeId: 'invalid-waiting-runtime',
  });
  expect(registry.list()).toEqual([]);
});

test('rejects waiting-for-human when the driver omits resume()', async () => {
  const registry = new ExecutionRuntimeDriverRegistryV1();

  await expect(
    registry.register(
      waitingDriver('missing-resume-runtime', {
        nativeResume: true,
        implementsResume: false,
      })
    )
  ).rejects.toMatchObject({
    code: 'waiting-for-human-requires-resume-implementation',
    runtimeId: 'missing-resume-runtime',
  });
  expect(registry.list()).toEqual([]);
});

test('registers waiting-for-human only with native resume and resume()', async () => {
  const registry = new ExecutionRuntimeDriverRegistryV1();
  const resumable = waitingDriver('resumable-runtime', {
    nativeResume: true,
    implementsResume: true,
  });

  await expect(registry.register(resumable)).resolves.toBe(resumable);
  expect(registry.lookup('resumable-runtime')).toBe(resumable);
});
