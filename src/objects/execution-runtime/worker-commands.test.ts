import { expect, test } from '@playwright/test';

import {
  RUNTIME_CONTRACT_VERSION_V1,
  type RuntimeDescriptorV1,
} from '@/agent/execution';
import { ConflictError, NotFoundError } from '@/framework/resilience';

import type { ExecutionRuntimeRow } from './schema';
import {
  heartbeatExecutionRuntimeDaemon,
  registerExecutionRuntimeDaemon,
  type ExecutionRuntimeDaemonStoreV1,
} from './worker-commands';

const NOW = new Date('2026-08-21T12:00:00.000Z');
const LATER = new Date('2026-08-21T12:00:10.000Z');
const ACTOR = { organizationId: 'runtime-daemon-org' };
const OTHER_ACTOR = { organizationId: 'runtime-daemon-other-org' };

class InMemoryDaemonStore implements ExecutionRuntimeDaemonStoreV1 {
  readonly rows = new Map<string, ExecutionRuntimeRow>();

  async findById(id: string) {
    const row = this.rows.get(id);
    return row ? identity(row) : null;
  }

  async findByOrganizationAndKey(organizationId: string, key: string) {
    const row = Array.from(this.rows.values()).find(
      (candidate) =>
        candidate.organizationId === organizationId && candidate.key === key
    );
    return row ? identity(row) : null;
  }

  async upsertById(input: Parameters<ExecutionRuntimeDaemonStoreV1['upsertById']>[0]) {
    const current = this.rows.get(input.id);
    const next = current
      ? { ...current, ...input.update, updatedAt: input.update.updatedAt || LATER }
      : {
          ...input.create,
          createdAt: input.create.createdAt || NOW,
          updatedAt: input.create.updatedAt || NOW,
        };
    this.rows.set(input.id, next as ExecutionRuntimeRow);
    return this.rows.get(input.id) as ExecutionRuntimeRow;
  }

  async updateByOrganizationAndId(
    input: Parameters<ExecutionRuntimeDaemonStoreV1['updateByOrganizationAndId']>[0]
  ) {
    const current = this.rows.get(input.id);
    if (!current || current.organizationId !== input.organizationId) return null;
    const next = { ...current, ...input.data } as ExecutionRuntimeRow;
    this.rows.set(input.id, next);
    return next;
  }
}

test('registers and re-registers a daemon without resetting capacityUsed', async () => {
  const store = new InMemoryDaemonStore();
  const registered = await registerExecutionRuntimeDaemon(
    ACTOR,
    {
      descriptor: descriptor(),
      driver: 'generic-cli',
      capacityTotal: 4,
      now: NOW,
    },
    store
  );
  expect(registered).toMatchObject({
    runtimeId: 'runtime-daemon-local',
    organizationId: ACTOR.organizationId,
    enabled: true,
    health: { state: 'healthy', acceptingNewAttempts: true },
    capacity: { activeAttempts: 0, maxConcurrentAttempts: 4 },
  });

  const current = store.rows.get('runtime-daemon-local');
  expect(current).toBeDefined();
  if (!current) return;
  store.rows.set(current.id, { ...current, capacityUsed: 3 });

  const refreshed = await registerExecutionRuntimeDaemon(
    ACTOR,
    {
      descriptor: { ...descriptor(), displayName: 'Renamed runtime' },
      driver: 'generic-cli',
      capacityTotal: 6,
      now: LATER,
    },
    store
  );
  expect(refreshed).toMatchObject({
    name: 'Renamed runtime',
    capacity: {
      activeAttempts: 3,
      maxConcurrentAttempts: 6,
      availableSlots: 3,
    },
  });
  expect(store.rows.get(current.id)?.capacityUsed).toBe(3);
});

test('heartbeat is organization-scoped and never changes capacityUsed', async () => {
  const store = new InMemoryDaemonStore();
  await registerExecutionRuntimeDaemon(
    ACTOR,
    { descriptor: descriptor(), driver: 'generic-cli', capacityTotal: 4, now: NOW },
    store
  );
  const current = store.rows.get('runtime-daemon-local');
  expect(current).toBeDefined();
  if (!current) return;
  store.rows.set(current.id, { ...current, capacityUsed: 2 });

  await expect(
    heartbeatExecutionRuntimeDaemon(
      OTHER_ACTOR,
      {
        runtimeId: current.id,
        health: { state: 'healthy', acceptingNewAttempts: true },
        now: LATER,
      },
      store
    )
  ).rejects.toBeInstanceOf(NotFoundError);

  const heartbeat = await heartbeatExecutionRuntimeDaemon(
    ACTOR,
    {
      runtimeId: current.id,
      health: {
        state: 'degraded',
        acceptingNewAttempts: false,
        message: 'draining',
      },
      capacityTotal: 5,
      capacity: { queueDepth: 2 },
      now: LATER,
    },
    store
  );
  expect(heartbeat).toMatchObject({
    health: {
      state: 'degraded',
      acceptingNewAttempts: false,
      message: 'draining',
      observedAt: LATER.toISOString(),
    },
    capacity: { activeAttempts: 2, maxConcurrentAttempts: 5 },
    capacityDetails: { queueDepth: 2 },
    lastHeartbeatAt: LATER.toISOString(),
  });
  expect(store.rows.get(current.id)?.capacityUsed).toBe(2);
});

test('registration rejects cross-organization ids and organization-local key aliases', async () => {
  const store = new InMemoryDaemonStore();
  await registerExecutionRuntimeDaemon(
    ACTOR,
    { descriptor: descriptor(), driver: 'generic-cli', capacityTotal: 1, now: NOW },
    store
  );
  await expect(
    registerExecutionRuntimeDaemon(
      OTHER_ACTOR,
      { descriptor: descriptor(), driver: 'generic-cli', capacityTotal: 1, now: NOW },
      store
    )
  ).rejects.toBeInstanceOf(ConflictError);
  await expect(
    registerExecutionRuntimeDaemon(
      ACTOR,
      {
        descriptor: { ...descriptor(), runtimeId: 'runtime-daemon-alias' },
        key: 'runtime-daemon-local',
        driver: 'generic-cli',
        capacityTotal: 1,
        now: NOW,
      },
      store
    )
  ).rejects.toBeInstanceOf(ConflictError);
});

function identity(row: ExecutionRuntimeRow) {
  return { id: row.id, organizationId: row.organizationId, key: row.key };
}

function descriptor(): RuntimeDescriptorV1 {
  return {
    schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
    runtimeId: 'runtime-daemon-local',
    displayName: 'Local CLI',
    runtimeVersion: '1',
    capabilities: {
      schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
      kinds: ['coding'],
      nativeResume: false,
      checkpoint: false,
      streaming: 'text',
      interrupt: 'process-kill',
      workspace: 'none',
      sandbox: 'host',
      structuredArtifacts: false,
      waitingForHuman: false,
      supportedModels: ['*'],
    },
  };
}
