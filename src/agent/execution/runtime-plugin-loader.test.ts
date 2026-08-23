import { expect, test } from '@playwright/test';

import type { ExecutionRuntimeDriverV1 } from './driver';
import {
  ExecutionRuntimePluginLoadErrorV1,
  loadExecutionRuntimePluginV1,
} from './runtime-plugin-loader';

test('loads named and default V1 factories with a frozen deployment context', async () => {
  const contexts: unknown[] = [];
  const driver = runtimeDriver('external-runtime');
  const importUrls: string[] = [];
  for (const exportName of ['createRuntime', 'default']) {
    const loaded = await loadExecutionRuntimePluginV1(
      {
        contractVersion: 1,
        modulePath: '/trusted/runtime plugins/a#b%.mjs',
        exportName,
        runtimeId: 'external-runtime',
        environment: { RUNTIME_TOKEN: 'secret' },
      },
      {
        async importModule(moduleUrl) {
          importUrls.push(moduleUrl);
          return {
            [exportName](context: unknown) {
              contexts.push(context);
              return driver;
            },
          };
        },
      }
    );
    expect(loaded).toBe(driver);
  }

  expect(importUrls).toEqual([
    'file:///trusted/runtime%20plugins/a%23b%25.mjs',
    'file:///trusted/runtime%20plugins/a%23b%25.mjs',
  ]);
  expect(contexts).toEqual([
    { contractVersion: 1, runtimeId: 'external-runtime', environment: { RUNTIME_TOKEN: 'secret' } },
    { contractVersion: 1, runtimeId: 'external-runtime', environment: { RUNTIME_TOKEN: 'secret' } },
  ]);
  expect(Object.isFrozen(contexts[0])).toBe(true);
  expect(Object.isFrozen((contexts[0] as { environment: object }).environment)).toBe(true);
});

test('fails closed for module, export, factory, driver, and runtime id failures', async () => {
  const base = {
    contractVersion: 1 as const,
    modulePath: '/trusted/runtime.mjs',
    exportName: 'createRuntime',
    runtimeId: 'external-runtime',
    environment: {},
  };
  const cases: Array<{
    expectedCode: ExecutionRuntimePluginLoadErrorV1['code'];
    importModule(): Promise<unknown>;
  }> = [
    {
      expectedCode: 'plugin-module-load-failed',
      async importModule() { throw new Error('/secret/runtime/path'); },
    },
    { expectedCode: 'plugin-factory-export-missing', async importModule() { return {}; } },
    { expectedCode: 'plugin-factory-export-invalid', async importModule() { return { createRuntime: {} }; } },
    {
      expectedCode: 'plugin-factory-failed',
      async importModule() { return { createRuntime() { throw new Error('token=secret'); } }; },
    },
    { expectedCode: 'invalid-plugin-driver-contract', async importModule() { return { createRuntime() { return {}; } }; } },
    {
      expectedCode: 'plugin-runtime-id-mismatch',
      async importModule() { return { createRuntime() { return runtimeDriver('other-runtime'); } }; },
    },
  ];

  for (const item of cases) {
    await expect(
      loadExecutionRuntimePluginV1(base, { importModule: item.importModule })
    ).rejects.toMatchObject({
      name: 'ExecutionRuntimePluginLoadErrorV1',
      code: item.expectedCode,
    });
  }
});

test('rejects malformed descriptors and an unsafe waiting-input contract', async () => {
  const base = {
    contractVersion: 1 as const,
    modulePath: '/trusted/runtime.mjs',
    exportName: 'default',
    runtimeId: 'external-runtime',
    environment: {},
  };
  const malformed = runtimeDriver('external-runtime');
  malformed.describe = async () => ({ schemaVersion: 2 } as never);
  await expect(
    loadExecutionRuntimePluginV1(base, {
      importModule: async () => ({ default: () => malformed }),
    })
  ).rejects.toMatchObject({ code: 'invalid-plugin-driver-contract' });

  const unsafe = runtimeDriver('external-runtime');
  unsafe.describe = async () => ({
    ...(await runtimeDriver('external-runtime').describe()),
    capabilities: {
      ...(await runtimeDriver('external-runtime').describe()).capabilities,
      waitingForHuman: true,
      nativeResume: false,
    },
  });
  await expect(
    loadExecutionRuntimePluginV1(base, {
      importModule: async () => ({ default: () => unsafe }),
    })
  ).rejects.toMatchObject({ code: 'invalid-plugin-driver-contract' });

  const missingResume = runtimeDriver('external-runtime');
  missingResume.describe = async () => ({
    ...(await runtimeDriver('external-runtime').describe()),
    capabilities: {
      ...(await runtimeDriver('external-runtime').describe()).capabilities,
      nativeResume: true,
    },
  });
  await expect(
    loadExecutionRuntimePluginV1(base, {
      importModule: async () => ({ default: () => missingResume }),
    })
  ).rejects.toMatchObject({ code: 'invalid-plugin-driver-contract' });
});

function runtimeDriver(runtimeId: string): ExecutionRuntimeDriverV1 {
  return {
    async describe() {
      return {
        schemaVersion: 1,
        runtimeId,
        displayName: 'External runtime',
        runtimeVersion: '1.0.0',
        capabilities: {
          schemaVersion: 1,
          kinds: ['coding'],
          nativeResume: false,
          checkpoint: false,
          streaming: 'typed-events',
          interrupt: 'graceful',
          workspace: 'none',
          sandbox: 'host',
          structuredArtifacts: false,
          waitingForHuman: false,
          supportedModels: [],
        },
      };
    },
    async *start() {},
    async interrupt() {},
    async reconcile(input) {
      return { runtimeAttemptId: input.runtimeAttemptId, status: 'unknown' };
    },
    async archive() { return []; },
  };
}
