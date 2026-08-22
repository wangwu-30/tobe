import { expect, test } from '@playwright/test';

import { safeJsonParse } from '@/framework/resilience';

import { mapExecutionRuntimeCandidateV1, mapExecutionRuntimeV1 } from './schema';
import {
  BUILTIN_OPENHANDS_RUNTIME_KEY_V1,
  builtinOpenHandsRuntimeIdV1,
  ensureBuiltinExecutionRuntimes,
  type ExecutionRuntimeRegistryStoreV1,
} from './registry';

type UpsertInput = Parameters<ExecutionRuntimeRegistryStoreV1['upsert']>[0];
type StoredRuntime = Omit<
  UpsertInput['create'],
  | 'capacityTotal'
  | 'capacityUsed'
  | 'enabled'
  | 'endpoint'
  | 'healthStatus'
  | 'lastHeartbeatAt'
  | 'capacityUpdatedAt'
  | 'version'
> & {
  capacityTotal: number;
  capacityUsed: number;
  capacityUpdatedAt: Date | null;
  createdAt: Date;
  enabled: boolean;
  endpoint: string | null;
  healthStatus: string;
  lastHeartbeatAt: Date | null;
  updatedAt: Date;
  version: string | null;
};

class InMemoryRuntimeStore implements ExecutionRuntimeRegistryStoreV1 {
  readonly rows = new Map<string, StoredRuntime>();

  async findById(id: string) {
    return Array.from(this.rows.values()).find((row) => row.id === id) ?? null;
  }

  async findByOrganizationAndKey(organizationId: string, key: string) {
    return this.rows.get(`${organizationId}:${key}`) ?? null;
  }

  async migrateLegacyBuiltin(input: {
    id: string;
    organizationId: string;
    legacyKey: string;
    key: string;
  }): Promise<number> {
    const legacyStorageKey = `${input.organizationId}:${input.legacyKey}`;
    const current = this.rows.get(legacyStorageKey);
    if (!current || current.id !== input.id) return 0;

    this.rows.delete(legacyStorageKey);
    this.rows.set(`${input.organizationId}:${input.key}`, {
      ...current,
      key: input.key,
      updatedAt: new Date(),
    });
    return 1;
  }

  async upsert(input: UpsertInput): Promise<unknown> {
    const unique = input.where.organizationId_key;
    const storageKey = `${unique.organizationId}:${unique.key}`;
    const current = this.rows.get(storageKey);
    const now = new Date();

    this.rows.set(
      storageKey,
      current
        ? { ...current, ...input.update, updatedAt: now }
        : { ...input.create, createdAt: now, updatedAt: now }
    );

    return this.rows.get(storageKey);
  }

  list(organizationId: string): StoredRuntime[] {
    return Array.from(this.rows.values()).filter(
      (row) => row.organizationId === organizationId
    );
  }
}

const ORGANIZATION_A = 'runtime-registry-org-a';
const ORGANIZATION_B = 'runtime-registry-org-b';

test('ensure is idempotent and requires no HTTP transport', async () => {
  const store = new InMemoryRuntimeStore();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('Built-in registration must not perform HTTP.');
  }) as typeof globalThis.fetch;

  try {
    await Promise.all(
      Array.from({ length: 4 }, () =>
        ensureBuiltinExecutionRuntimes(
          { organizationId: ORGANIZATION_A },
          store
        )
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const rows = store.list(ORGANIZATION_A);
  expect(fetchCalls).toBe(0);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: builtinOpenHandsRuntimeIdV1(ORGANIZATION_A),
    organizationId: ORGANIZATION_A,
    key: BUILTIN_OPENHANDS_RUNTIME_KEY_V1,
    name: 'OpenHands',
    driver: 'openhands',
    endpoint: null,
    enabled: false,
    healthStatus: 'offline',
    lastHeartbeatAt: null,
    capacityTotal: 0,
    capacityUsed: 0,
    capacityUpdatedAt: null,
  });
  expect(
    safeJsonParse<unknown>(rows[0].registrationJson, null)
  ).toMatchObject({
    builtin: true,
    configurationState: 'unavailable',
    executable: false,
    reason: 'unverified-api-contract',
  });
});

test('re-ensure preserves runtime-owned activation and heartbeat facts', async () => {
  const store = new InMemoryRuntimeStore();
  await ensureBuiltinExecutionRuntimes(
    { organizationId: ORGANIZATION_A },
    store
  );

  const storageKey = `${ORGANIZATION_A}:${BUILTIN_OPENHANDS_RUNTIME_KEY_V1}`;
  const row = store.rows.get(storageKey);
  expect(row).toBeDefined();
  if (!row) return;

  store.rows.set(storageKey, {
    ...row,
    endpoint: 'https://unverified.invalid',
    enabled: true,
    healthStatus: 'healthy',
    healthJson: '{"acceptingNewAttempts":true}',
    capacityTotal: 8,
    capacityUsed: 3,
    lastHeartbeatAt: new Date('2026-08-21T12:00:00.000Z'),
    capacityUpdatedAt: new Date('2026-08-21T12:00:00.000Z'),
  });

  await ensureBuiltinExecutionRuntimes(
    { organizationId: ORGANIZATION_A },
    store
  );
  const preserved = store.list(ORGANIZATION_A)[0];
  const runtime = mapExecutionRuntimeV1(preserved, {
    now: new Date('2026-08-21T12:00:01.000Z'),
  });
  const candidate = mapExecutionRuntimeCandidateV1(preserved, {
    now: new Date('2026-08-21T12:00:01.000Z'),
  });

  expect(runtime).toMatchObject({
    endpoint: 'https://unverified.invalid',
    enabled: true,
    health: {
      state: 'healthy',
      acceptingNewAttempts: true,
    },
    capacity: {
      availableSlots: 5,
      activeAttempts: 3,
      maxConcurrentAttempts: 8,
    },
  });
  expect(candidate).toMatchObject({
    descriptor: {
      runtimeId: builtinOpenHandsRuntimeIdV1(ORGANIZATION_A),
    },
    health: {
      state: 'healthy',
      acceptingNewAttempts: true,
    },
    capacity: { availableSlots: 5 },
  });
});

test('migrates only a dormant legacy builtin and leaves deployment key openhands free', async () => {
  const store = new InMemoryRuntimeStore();
  const now = new Date('2026-08-21T12:00:00.000Z');
  const legacyKey = `${ORGANIZATION_A}:openhands`;
  store.rows.set(legacyKey, {
    id: builtinOpenHandsRuntimeIdV1(ORGANIZATION_A),
    organizationId: ORGANIZATION_A,
    key: 'openhands',
    name: 'OpenHands',
    driver: 'openhands',
    version: null,
    endpoint: null,
    enabled: false,
    registrationJson: JSON.stringify({
      schemaVersion: 1,
      builtin: true,
      configurationState: 'unavailable',
      executable: false,
      requiredConfiguration: ['endpoint', 'token'],
      reason: 'unverified-api-contract',
    }),
    capabilitiesJson: '{}',
    healthStatus: 'offline',
    healthJson: '{}',
    lastHeartbeatAt: null,
    capacityTotal: 0,
    capacityUsed: 0,
    capacityJson: '{}',
    capacityUpdatedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  await ensureBuiltinExecutionRuntimes(
    { organizationId: ORGANIZATION_A },
    store
  );

  expect(store.rows.has(legacyKey)).toBe(false);
  expect(
    store.rows.get(`${ORGANIZATION_A}:${BUILTIN_OPENHANDS_RUNTIME_KEY_V1}`)
  ).toMatchObject({
    id: builtinOpenHandsRuntimeIdV1(ORGANIZATION_A),
    key: BUILTIN_OPENHANDS_RUNTIME_KEY_V1,
    enabled: false,
    healthStatus: 'offline',
  });

  store.rows.set(legacyKey, {
    ...store.rows.get(
      `${ORGANIZATION_A}:${BUILTIN_OPENHANDS_RUNTIME_KEY_V1}`
    )!,
    id: 'openhands-production',
    key: 'openhands',
    endpoint: 'https://openhands.example.test',
    enabled: true,
    registrationJson: JSON.stringify({ builtin: false }),
    healthStatus: 'healthy',
    healthJson: JSON.stringify({
      state: 'healthy',
      acceptingNewAttempts: true,
    }),
    capacityTotal: 4,
    capacityUsed: 1,
    lastHeartbeatAt: now,
    capacityUpdatedAt: now,
  });

  await ensureBuiltinExecutionRuntimes(
    { organizationId: ORGANIZATION_A },
    store
  );

  expect(store.list(ORGANIZATION_A)).toHaveLength(2);
  expect(store.rows.get(legacyKey)).toMatchObject({
    id: 'openhands-production',
    key: 'openhands',
    enabled: true,
    healthStatus: 'healthy',
    capacityTotal: 4,
    capacityUsed: 1,
  });
});

test('does not migrate an active legacy row that may be a real deployment', async () => {
  const store = new InMemoryRuntimeStore();
  const now = new Date('2026-08-21T12:00:00.000Z');
  const legacyKey = `${ORGANIZATION_A}:openhands`;
  store.rows.set(legacyKey, {
    id: builtinOpenHandsRuntimeIdV1(ORGANIZATION_A),
    organizationId: ORGANIZATION_A,
    key: 'openhands',
    name: 'OpenHands deployment',
    driver: 'openhands',
    version: '1.0.0',
    endpoint: 'https://openhands.example.test',
    enabled: true,
    registrationJson: JSON.stringify({ builtin: true, workerId: 'worker-1' }),
    capabilitiesJson: '{}',
    healthStatus: 'healthy',
    healthJson: '{}',
    lastHeartbeatAt: now,
    capacityTotal: 4,
    capacityUsed: 1,
    capacityJson: '{}',
    capacityUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await ensureBuiltinExecutionRuntimes(
    { organizationId: ORGANIZATION_A },
    store
  );

  expect(store.list(ORGANIZATION_A)).toEqual([
    expect.objectContaining({
      id: builtinOpenHandsRuntimeIdV1(ORGANIZATION_A),
      key: 'openhands',
      enabled: true,
      healthStatus: 'healthy',
      capacityUsed: 1,
    }),
  ]);
});

test('each organization receives its own stable built-in id', async () => {
  const store = new InMemoryRuntimeStore();
  await Promise.all([
    ensureBuiltinExecutionRuntimes(
      { organizationId: ORGANIZATION_A },
      store
    ),
    ensureBuiltinExecutionRuntimes(
      { organizationId: ORGANIZATION_B },
      store
    ),
  ]);

  const organizationARows = store.list(ORGANIZATION_A);
  const organizationBRows = store.list(ORGANIZATION_B);
  expect(organizationARows).toHaveLength(1);
  expect(organizationBRows).toHaveLength(1);
  expect(organizationARows[0].id).toBe(
    builtinOpenHandsRuntimeIdV1(ORGANIZATION_A)
  );
  expect(organizationBRows[0].id).toBe(
    builtinOpenHandsRuntimeIdV1(ORGANIZATION_B)
  );
  expect(organizationARows[0].id).not.toBe(organizationBRows[0].id);
});
