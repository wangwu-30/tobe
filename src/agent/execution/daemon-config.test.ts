import { expect, test } from '@playwright/test';

import {
  ExecutionDaemonConfigErrorV1,
  loadExecutionDaemonConfigV1,
  parseExecutionDaemonConfigV1,
  resolveExecutionDaemonRuntimeEnvironmentV1,
} from './daemon-config';

function validConfig() {
  return {
    schemaVersion: 1,
    organizationId: 'local-org',
    workerId: 'worker-1',
    pollIntervalMs: 250,
    heartbeatIntervalMs: 10_000,
    leaseDurationMs: 30_000,
    shutdownGraceMs: 15_000,
    runtimes: [
      {
        driver: 'generic-cli',
        runtimeId: 'generic-cli-local',
        runtimeVersion: '1.0.0',
        executable: '/usr/bin/node',
        args: ['/opt/dao/runtime.mjs'],
        cwd: '/var/lib/dao/workspaces',
        envAllowlist: ['PATH', 'DAO_RUNTIME_TOKEN'],
        capacityTotal: 2,
      },
    ],
  };
}

test('parses the strict V1 daemon configuration', () => {
  expect(parseExecutionDaemonConfigV1(validConfig())).toEqual(validConfig());
});

test('parses a strict external module runtime with named or default factory export', () => {
  const config = validConfig();
  const external = {
    driver: 'external-module',
    runtimeId: 'custom-runtime',
    contractVersion: 1,
    modulePath: '/opt/dao/runtime plugins/custom-runtime.mjs',
    exportName: 'createRuntime',
    envAllowlist: ['CUSTOM_RUNTIME_TOKEN'],
    capacityTotal: 3,
  };

  expect(
    parseExecutionDaemonConfigV1({ ...config, runtimes: [external] }).runtimes
  ).toEqual([external]);
  expect(
    parseExecutionDaemonConfigV1({
      ...config,
      runtimes: [{ ...external, exportName: 'default' }],
    }).runtimes[0]
  ).toMatchObject({ exportName: 'default' });
});

test('rejects unknown external driver, module, export, contract, and secret fields', () => {
  const config = validConfig();
  const external = {
    driver: 'external-module',
    runtimeId: 'custom-runtime',
    contractVersion: 1,
    modulePath: '/opt/dao/runtime.mjs',
    exportName: 'createRuntime',
    envAllowlist: ['CUSTOM_RUNTIME_TOKEN'],
    capacityTotal: 1,
  };
  const cases = [
    { runtime: { ...external, driver: 'unknown' }, path: 'runtimes[0].driver' },
    { runtime: { ...external, contractVersion: 2 }, path: 'runtimes[0].contractVersion' },
    { runtime: { ...external, modulePath: './runtime.mjs' }, path: 'runtimes[0].modulePath' },
    { runtime: { ...external, exportName: 'bad-export' }, path: 'runtimes[0].exportName' },
    { runtime: { ...external, exportName: 'then' }, path: 'runtimes[0].exportName' },
    { runtime: { ...external, token: 'must-not-be-configured' }, path: 'runtimes[0].token' },
    { runtime: { ...external, envAllowlist: ['TOKEN=secret'] }, path: 'runtimes[0].envAllowlist[0]' },
  ];

  for (const item of cases) {
    expectConfigError(
      () => parseExecutionDaemonConfigV1({ ...config, runtimes: [item.runtime] }),
      'invalid-config',
      item.path
    );
  }
});

test('accepts an exact worktree deployment configuration', () => {
  const config = validConfig();
  const withWorktree = {
    ...config,
    runtimes: [
      {
        ...config.runtimes[0],
        worktree: {
          enabled: true,
          managedRoot: '/var/lib/dao/worktrees',
          commitAuthor: {
            name: 'Dao Execution Agent',
            email: 'execution-agent@example.test',
          },
        },
      },
    ],
  };

  expect(parseExecutionDaemonConfigV1(withWorktree)).toEqual(withWorktree);
});

test('validates worktree config as an exact, enabled deployment object', () => {
  const invalidCases = [
    {
      worktree: {
        enabled: false,
        managedRoot: '/var/lib/dao/worktrees',
        commitAuthor: {
          name: 'Dao Execution Agent',
          email: 'execution-agent@example.test',
        },
      },
      path: 'runtimes[0].worktree.enabled',
    },
    {
      worktree: {
        enabled: true,
        managedRoot: 'relative/worktrees',
        commitAuthor: {
          name: 'Dao Execution Agent',
          email: 'execution-agent@example.test',
        },
      },
      path: 'runtimes[0].worktree.managedRoot',
    },
    {
      worktree: {
        enabled: true,
        managedRoot: '/var/lib/dao/worktrees',
        commitAuthor: {
          name: 'Dao Execution Agent',
          email: 'execution-agent@example.test',
          signingKey: 'not-accepted',
        },
      },
      path: 'runtimes[0].worktree.commitAuthor.signingKey',
    },
    {
      worktree: {
        enabled: true,
        managedRoot: '/var/lib/dao/worktrees',
        commitAuthor: {
          name: ' ',
          email: 'execution-agent@example.test',
        },
      },
      path: 'runtimes[0].worktree.commitAuthor.name',
    },
    {
      worktree: {
        enabled: true,
        managedRoot: '/var/lib/dao/worktrees',
        commitAuthor: {
          name: 'Dao Execution Agent',
        },
      },
      path: 'runtimes[0].worktree.commitAuthor.email',
    },
    {
      worktree: {
        enabled: true,
        managedRoot: '/var/lib/dao/worktrees',
        commitAuthor: {
          name: 'Dao Execution Agent',
          email: 'execution-agent@example.test',
        },
        unknown: true,
      },
      path: 'runtimes[0].worktree.unknown',
    },
  ];

  for (const item of invalidCases) {
    const config = validConfig();
    expectConfigError(
      () =>
        parseExecutionDaemonConfigV1({
          ...config,
          runtimes: [{ ...config.runtimes[0], worktree: item.worktree }],
        }),
      'invalid-config',
      item.path
    );
  }
});

test('loads JSON only from the trusted absolute config path', async () => {
  const calls: string[] = [];
  const config = validConfig();
  const loaded = await loadExecutionDaemonConfigV1({
    environment: { DAO_EXECUTION_DAEMON_CONFIG_PATH: '/etc/dao/daemon.json' },
    readTrustedFile: async (path, encoding) => {
      calls.push(`${path}:${encoding}`);
      return JSON.stringify(config);
    },
  });

  expect(loaded).toEqual(config);
  expect(calls).toEqual(['/etc/dao/daemon.json:utf8']);

  await expect(
    loadExecutionDaemonConfigV1({ environment: {} })
  ).rejects.toMatchObject({ code: 'missing-config-path' });
  await expect(
    loadExecutionDaemonConfigV1({
      environment: { DAO_EXECUTION_DAEMON_CONFIG_PATH: './daemon.json' },
    })
  ).rejects.toMatchObject({ code: 'invalid-config-path' });
});

test('requires schemaVersion 1 and rejects unknown fields', () => {
  expectConfigError(
    () => parseExecutionDaemonConfigV1({ ...validConfig(), schemaVersion: 2 }),
    'unsupported-schema-version',
    'schemaVersion'
  );
  expectConfigError(
    () =>
      parseExecutionDaemonConfigV1({
        ...validConfig(),
        token: 'must-not-be-accepted',
      }),
    'invalid-config',
    'token'
  );
  expectConfigError(
    () => {
      const config = validConfig();
      return parseExecutionDaemonConfigV1({
        ...config,
        runtimes: [{ ...config.runtimes[0], environment: {} }],
      });
    },
    'invalid-config',
    'runtimes[0].environment'
  );
});

test('requires absolute executable and cwd paths', () => {
  for (const field of ['executable', 'cwd'] as const) {
    const config = validConfig();
    expectConfigError(
      () =>
        parseExecutionDaemonConfigV1({
          ...config,
          runtimes: [{ ...config.runtimes[0], [field]: `relative/${field}` }],
        }),
      'invalid-config',
      `runtimes[0].${field}`
    );
  }
});

test('requires heartbeat interval no greater than one third of lease', () => {
  expectConfigError(
    () =>
      parseExecutionDaemonConfigV1({
        ...validConfig(),
        leaseDurationMs: 30_000,
        heartbeatIntervalMs: 10_001,
      }),
    'invalid-config',
    'heartbeatIntervalMs'
  );
});

test('defaults shutdown grace to 15 seconds and validates explicit values', () => {
  const withoutGrace = { ...validConfig() } as Partial<
    ReturnType<typeof validConfig>
  >;
  delete withoutGrace.shutdownGraceMs;
  expect(parseExecutionDaemonConfigV1(withoutGrace).shutdownGraceMs).toBe(15_000);
  expectConfigError(
    () => parseExecutionDaemonConfigV1({ ...validConfig(), shutdownGraceMs: 0 }),
    'invalid-config',
    'shutdownGraceMs'
  );
  expectConfigError(
    () => parseExecutionDaemonConfigV1({ ...validConfig(), shutdownGraceMs: null }),
    'invalid-config',
    'shutdownGraceMs'
  );
});

test('rejects duplicate runtime ids', () => {
  const config = validConfig();
  expectConfigError(
    () =>
      parseExecutionDaemonConfigV1({
        ...config,
        runtimes: [
          config.runtimes[0],
          {
            ...config.runtimes[0],
            executable: '/opt/dao/other-runtime',
          },
        ],
      }),
    'invalid-config',
    'runtimes[1].runtimeId'
  );
});

test('env allowlist contains unique names only and resolves no implicit values', () => {
  const config = validConfig();
  expectConfigError(
    () =>
      parseExecutionDaemonConfigV1({
        ...config,
        runtimes: [
          {
            ...config.runtimes[0],
            envAllowlist: ['PATH', 'TOKEN=secret'],
          },
        ],
      }),
    'invalid-config',
    'runtimes[0].envAllowlist[1]'
  );
  expectConfigError(
    () =>
      parseExecutionDaemonConfigV1({
        ...config,
        runtimes: [
          { ...config.runtimes[0], envAllowlist: ['PATH', 'PATH'] },
        ],
      }),
    'invalid-config',
    'runtimes[0].envAllowlist'
  );

  expect(
    resolveExecutionDaemonRuntimeEnvironmentV1(
      { envAllowlist: ['PATH', 'DAO_RUNTIME_TOKEN', 'MISSING'] },
      { PATH: '/trusted/bin', DAO_RUNTIME_TOKEN: 'secret', OTHER: 'blocked' }
    )
  ).toEqual({ PATH: '/trusted/bin', DAO_RUNTIME_TOKEN: 'secret' });

  const inheritedEnvironment = Object.assign(
    Object.create({ DAO_RUNTIME_TOKEN: 'inherited-secret' }) as Record<
      string,
      string
    >,
    { PATH: '/trusted/bin' }
  );
  expect(
    resolveExecutionDaemonRuntimeEnvironmentV1(
      { envAllowlist: ['PATH', 'DAO_RUNTIME_TOKEN'] },
      inheritedEnvironment
    )
  ).toEqual({ PATH: '/trusted/bin' });
});

function expectConfigError(
  action: () => unknown,
  code: ExecutionDaemonConfigErrorV1['code'],
  path: string
): void {
  try {
    action();
    throw new Error('Expected execution daemon configuration to be rejected.');
  } catch (error) {
    expect(error).toBeInstanceOf(ExecutionDaemonConfigErrorV1);
    expect(error).toMatchObject({ code, path });
  }
}
