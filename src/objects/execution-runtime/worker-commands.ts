import type {
  RuntimeDescriptorV1,
  RuntimeHealthV1,
} from '@/agent/execution/contracts';
import { RUNTIME_CONTRACT_VERSION_V1 } from '@/agent/execution/contracts';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/framework/resilience/app-error';

import type { ExecutionRuntimeActor } from './queries';
import {
  mapExecutionRuntimeV1,
  parseRuntimeCapabilitiesJsonV1,
  type ExecutionRuntimeJsonObjectV1,
  type ExecutionRuntimeRow,
  type ExecutionRuntimeV1,
} from './schema';

const HEALTH_STATES = [
  'healthy',
  'degraded',
  'unhealthy',
  'offline',
] as const;

export type RegisterExecutionRuntimeDaemonInput = {
  descriptor: RuntimeDescriptorV1;
  driver: string;
  key?: string;
  endpoint?: string | null;
  enabled?: boolean;
  registration?: ExecutionRuntimeJsonObjectV1;
  health?: RuntimeHealthV1;
  capacityTotal: number;
  capacity?: ExecutionRuntimeJsonObjectV1;
  now?: Date;
};

export type HeartbeatExecutionRuntimeDaemonInput = {
  runtimeId: string;
  health: RuntimeHealthV1;
  capacityTotal?: number;
  capacity?: ExecutionRuntimeJsonObjectV1;
  now?: Date;
};

type RuntimeIdentityRow = {
  id: string;
  organizationId: string;
  key: string;
};

type RuntimeDaemonWrite = {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  driver: string;
  version: string | null;
  endpoint: string | null;
  enabled: boolean;
  registrationJson: string;
  capabilitiesJson: string;
  healthStatus: string;
  healthJson: string;
  lastHeartbeatAt: Date | null;
  capacityTotal: number;
  capacityUsed: number;
  capacityJson: string;
  capacityUpdatedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

type RuntimeDaemonUpdate = Omit<
  RuntimeDaemonWrite,
  'id' | 'organizationId' | 'capacityUsed' | 'createdAt'
>;

type RuntimeHeartbeatUpdate = Pick<
  RuntimeDaemonWrite,
  | 'healthStatus'
  | 'healthJson'
  | 'lastHeartbeatAt'
  | 'capacityUpdatedAt'
  | 'updatedAt'
> & {
  capacityTotal?: number;
  capacityJson?: string;
};

export type ExecutionRuntimeDaemonStoreV1 = {
  findById(id: string): Promise<RuntimeIdentityRow | null>;
  findByOrganizationAndKey(
    organizationId: string,
    key: string
  ): Promise<RuntimeIdentityRow | null>;
  upsertById(input: {
    id: string;
    create: RuntimeDaemonWrite;
    update: RuntimeDaemonUpdate;
  }): Promise<ExecutionRuntimeRow>;
  updateByOrganizationAndId(input: {
    organizationId: string;
    id: string;
    data: RuntimeHeartbeatUpdate;
  }): Promise<ExecutionRuntimeRow | null>;
};

/**
 * Registers an actively supervised daemon runtime. Re-registration refreshes
 * its descriptor and advertised capacity, while deliberately leaving the
 * database-owned capacityUsed counter untouched.
 */
export async function registerExecutionRuntimeDaemon(
  actor: Pick<ExecutionRuntimeActor, 'organizationId'>,
  input: RegisterExecutionRuntimeDaemonInput,
  store?: ExecutionRuntimeDaemonStoreV1
): Promise<ExecutionRuntimeV1> {
  const organizationId = requireText(
    actor.organizationId,
    'organizationId is required.'
  );
  const normalized = normalizeRegistrationInput(input);
  const runtimeStore = store ?? (await loadExecutionRuntimeDaemonStore());
  const [sameId, sameKey] = await Promise.all([
    runtimeStore.findById(normalized.create.id),
    runtimeStore.findByOrganizationAndKey(
      organizationId,
      normalized.create.key
    ),
  ]);

  if (sameId && sameId.organizationId !== organizationId) {
    throw new ConflictError(
      'Execution runtime id is already registered to another organization.'
    );
  }
  if (sameKey && sameKey.id !== normalized.create.id) {
    throw new ConflictError(
      'Execution runtime key is already registered with a different id.'
    );
  }

  const row = await runtimeStore.upsertById({
    id: normalized.create.id,
    create: { ...normalized.create, organizationId },
    update: normalized.update,
  });
  if (row.organizationId !== organizationId) {
    throw new ConflictError(
      'Execution runtime registration escaped its organization boundary.'
    );
  }
  return mapExecutionRuntimeV1(row, { now: normalized.now });
}

/**
 * Refreshes daemon liveness and health. A heartbeat may change total capacity
 * but never writes capacityUsed, which is owned by atomic attempt claim and
 * completion transactions.
 */
export async function heartbeatExecutionRuntimeDaemon(
  actor: Pick<ExecutionRuntimeActor, 'organizationId'>,
  input: HeartbeatExecutionRuntimeDaemonInput,
  store?: ExecutionRuntimeDaemonStoreV1
): Promise<ExecutionRuntimeV1> {
  const organizationId = requireText(
    actor.organizationId,
    'organizationId is required.'
  );
  const runtimeId = requireText(input.runtimeId, 'runtimeId is required.');
  const now = readNow(input.now);
  const data: RuntimeHeartbeatUpdate = {
    ...serializeHealth(input.health, now),
    lastHeartbeatAt: now,
    capacityUpdatedAt: now,
    updatedAt: now,
    ...(input.capacityTotal === undefined
      ? {}
      : { capacityTotal: readCapacityTotal(input.capacityTotal) }),
    ...(input.capacity === undefined
      ? {}
      : { capacityJson: serializeJsonObject(input.capacity, 'capacity') }),
  };
  const runtimeStore = store ?? (await loadExecutionRuntimeDaemonStore());
  const row = await runtimeStore.updateByOrganizationAndId({
    organizationId,
    id: runtimeId,
    data,
  });
  if (!row) {
    throw new NotFoundError('Execution runtime not found.');
  }
  return mapExecutionRuntimeV1(row, { now });
}

function normalizeRegistrationInput(input: RegisterExecutionRuntimeDaemonInput) {
  const descriptor = input.descriptor;
  if (
    !descriptor ||
    descriptor.schemaVersion !== RUNTIME_CONTRACT_VERSION_V1
  ) {
    throw new ValidationError(
      'Runtime descriptor must use schemaVersion 1.'
    );
  }
  const id = requireText(descriptor.runtimeId, 'runtimeId is required.');
  const key = requireText(input.key ?? id, 'runtime key is required.');
  const name = requireText(
    descriptor.displayName,
    'runtime displayName is required.'
  );
  const driver = requireText(input.driver, 'runtime driver is required.');
  const version = requireText(
    descriptor.runtimeVersion,
    'runtimeVersion is required.'
  );
  const capabilitiesJson = serializeJsonObject(
    descriptor.capabilities as unknown as ExecutionRuntimeJsonObjectV1,
    'capabilities'
  );
  if (!parseRuntimeCapabilitiesJsonV1(capabilitiesJson)) {
    throw new ValidationError('Runtime capabilities are invalid.');
  }
  if (
    descriptor.selectionPriority !== undefined &&
    !Number.isFinite(descriptor.selectionPriority)
  ) {
    throw new ValidationError('selectionPriority must be finite.');
  }

  const registration = {
    ...(input.registration || {}),
    ...(descriptor.selectionPriority === undefined
      ? {}
      : { selectionPriority: descriptor.selectionPriority }),
  };
  const now = readNow(input.now);
  const capacityTotal = readCapacityTotal(input.capacityTotal);
  const health =
    input.health ||
    ({
      state: 'healthy',
      acceptingNewAttempts: capacityTotal > 0,
    } satisfies RuntimeHealthV1);
  const healthWrite = serializeHealth(health, now);
  const create: RuntimeDaemonWrite = {
    id,
    organizationId: '',
    key,
    name,
    driver,
    version,
    endpoint: readOptionalText(input.endpoint, 'endpoint'),
    enabled: input.enabled ?? true,
    registrationJson: serializeJsonObject(registration, 'registration'),
    capabilitiesJson,
    ...healthWrite,
    lastHeartbeatAt: now,
    capacityTotal,
    capacityUsed: 0,
    capacityJson: serializeJsonObject(input.capacity || {}, 'capacity'),
    capacityUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const update: RuntimeDaemonUpdate = {
    key: create.key,
    name: create.name,
    driver: create.driver,
    version: create.version,
    endpoint: create.endpoint,
    enabled: create.enabled,
    registrationJson: create.registrationJson,
    capabilitiesJson: create.capabilitiesJson,
    healthStatus: create.healthStatus,
    healthJson: create.healthJson,
    lastHeartbeatAt: create.lastHeartbeatAt,
    capacityTotal: create.capacityTotal,
    capacityJson: create.capacityJson,
    capacityUpdatedAt: create.capacityUpdatedAt,
    updatedAt: create.updatedAt,
  };
  return { create, now, update };
}

function serializeHealth(health: RuntimeHealthV1, now: Date) {
  if (
    !health ||
    !HEALTH_STATES.some((state) => state === health.state) ||
    typeof health.acceptingNewAttempts !== 'boolean'
  ) {
    throw new ValidationError('Runtime health is invalid.');
  }
  const healthJson = serializeJsonObject(
    {
      state: health.state,
      acceptingNewAttempts: health.acceptingNewAttempts,
      observedAt: readObservedAt(health.observedAt, now),
      ...(health.message === undefined
        ? {}
        : { message: requireText(health.message, 'health message is invalid.') }),
    },
    'health'
  );
  return { healthStatus: health.state, healthJson };
}

function readObservedAt(value: string | undefined, fallback: Date): string {
  if (value === undefined) return fallback.toISOString();
  const observedAt = new Date(value);
  if (Number.isNaN(observedAt.valueOf())) {
    throw new ValidationError('health observedAt must be an ISO date.');
  }
  return observedAt.toISOString();
}

function readCapacityTotal(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError(
      'capacityTotal must be a non-negative safe integer.'
    );
  }
  return value;
}

function readNow(value: Date | undefined): Date {
  const now = value ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw new ValidationError('now must be a valid Date.');
  }
  return now;
}

function readOptionalText(
  value: string | null | undefined,
  field: string
): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (!normalized) {
    throw new ValidationError(field + ' must be a non-empty string or null.');
  }
  return normalized;
}

function requireText(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(message);
  }
  return value.trim();
}

function serializeJsonObject(
  value: ExecutionRuntimeJsonObjectV1,
  field: string
): string {
  let raw: string | undefined;
  try {
    raw = JSON.stringify(value);
  } catch {
    throw new ValidationError(field + ' must be JSON-compatible.');
  }
  if (typeof raw !== 'string') {
    throw new ValidationError(field + ' must be JSON-compatible.');
  }
  return raw;
}

async function loadExecutionRuntimeDaemonStore(): Promise<
  ExecutionRuntimeDaemonStoreV1
> {
  const { prisma } = await import('@/lib/db/prisma');
  return {
    async findById(id) {
      return prisma.executionRuntime.findUnique({
        where: { id },
        select: { id: true, organizationId: true, key: true },
      });
    },
    async findByOrganizationAndKey(organizationId, key) {
      return prisma.executionRuntime.findUnique({
        where: { organizationId_key: { organizationId, key } },
        select: { id: true, organizationId: true, key: true },
      });
    },
    async upsertById({ id, create, update }) {
      return prisma.executionRuntime.upsert({
        where: { id },
        create,
        update,
      });
    },
    async updateByOrganizationAndId({ organizationId, id, data }) {
      const rows = await prisma.executionRuntime.updateManyAndReturn({
        where: { organizationId, id },
        data,
      });
      return rows[0] || null;
    },
  };
}
