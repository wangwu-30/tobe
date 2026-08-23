import { RUNTIME_CONTRACT_VERSION_V1 } from '@/agent/execution/contracts';

type ExecutionRuntimeRegistryActor = {
  organizationId: string;
};

export type ExecutionRuntimeRegistryStoreV1 = {
  findById(id: string): Promise<ExistingExecutionRuntimeIdentityV1 | null>;
  findByOrganizationAndKey(
    organizationId: string,
    key: string
  ): Promise<ExistingExecutionRuntimeIdentityV1 | null>;
  migrateLegacyBuiltin(input: {
    id: string;
    organizationId: string;
    legacyKey: string;
    key: string;
  }): Promise<number>;
  upsert(input: {
    where: {
      organizationId_key: { organizationId: string; key: string };
    };
    create: BuiltinExecutionRuntimeWriteV1;
    update: Record<string, never>;
  }): Promise<unknown>;
};

type ExistingExecutionRuntimeIdentityV1 = {
  id: string;
  organizationId: string;
  key: string;
  driver: string;
  endpoint: string | null;
  enabled: boolean;
  registrationJson: string;
  healthStatus: string;
  capacityTotal: number;
  capacityUsed: number;
};

type BuiltinExecutionRuntimeWriteV1 = {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  driver: string;
  version: null;
  endpoint: null;
  enabled: false;
  registrationJson: string;
  capabilitiesJson: string;
  healthStatus: 'offline';
  healthJson: string;
  lastHeartbeatAt: null;
  capacityTotal: 0;
  capacityUsed: 0;
  capacityJson: string;
  capacityUpdatedAt: null;
};

export const BUILTIN_OPENHANDS_RUNTIME_KEY_V1 = 'builtin:openhands';
const LEGACY_BUILTIN_OPENHANDS_RUNTIME_KEY_V1 = 'openhands';

const OPENHANDS_UNAVAILABLE_MESSAGE =
  'OpenHands adapter skeleton unavailable until verified protocol implementation; no explicit endpoint/token configuration is installed.';

const OPENHANDS_REGISTRATION_JSON = JSON.stringify({
  schemaVersion: 1,
  builtin: true,
  configurationState: 'unavailable',
  executable: false,
  requiredConfiguration: ['endpoint', 'token'],
  reason: 'unverified-api-contract',
});

/**
 * There is no configured deployment behind the built-in entry, so its
 * capabilities fail closed. The concrete OpenHands adapter may advertise
 * coding/workspace/sandbox capabilities only after deployment configuration
 * supplies those facts.
 */
const OPENHANDS_CAPABILITIES_JSON = JSON.stringify({
  schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
  kinds: [],
  nativeResume: false,
  checkpoint: false,
  streaming: 'none',
  interrupt: 'none',
  workspace: 'none',
  sandbox: 'remote',
  structuredArtifacts: false,
  waitingForHuman: false,
  supportedModels: [],
});

const OPENHANDS_HEALTH_JSON = JSON.stringify({
  state: 'offline',
  acceptingNewAttempts: false,
  configurationState: 'unavailable',
  message: OPENHANDS_UNAVAILABLE_MESSAGE,
});

const OPENHANDS_CAPACITY_JSON = JSON.stringify({
  state: 'unavailable',
  reason: 'runtime-disabled',
});

export function builtinOpenHandsRuntimeIdV1(organizationId: string): string {
  return `builtin-openhands:${organizationId}`;
}

/**
 * Installs the organization-local OpenHands catalog entry idempotently.
 *
 * The catalog identity is namespaced away from deployable runtime keys. Once
 * created, ensure never rewrites runtime-owned health or capacity facts.
 * Dormant rows created with the legacy `openhands` key are migrated in place,
 * while a row that may have become a real deployment is left untouched.
 */
export async function ensureBuiltinExecutionRuntimes(
  actor: ExecutionRuntimeRegistryActor,
  store?: ExecutionRuntimeRegistryStoreV1
): Promise<void> {
  const runtimeStore = store ?? (await loadExecutionRuntimeStore());
  const create = builtinOpenHandsRuntimeWriteV1(actor.organizationId);
  const existingById = await runtimeStore.findById(create.id);

  if (existingById) {
    if (
      existingById.organizationId === actor.organizationId &&
      existingById.key === BUILTIN_OPENHANDS_RUNTIME_KEY_V1
    ) {
      return;
    }
    if (isDormantLegacyBuiltinOpenHands(existingById, actor.organizationId)) {
      const namespacedEntry = await runtimeStore.findByOrganizationAndKey(
        actor.organizationId,
        BUILTIN_OPENHANDS_RUNTIME_KEY_V1
      );
      if (!namespacedEntry) {
        await runtimeStore.migrateLegacyBuiltin({
          id: create.id,
          organizationId: actor.organizationId,
          legacyKey: LEGACY_BUILTIN_OPENHANDS_RUNTIME_KEY_V1,
          key: BUILTIN_OPENHANDS_RUNTIME_KEY_V1,
        });
      }
    }
    return;
  }

  const existingByKey = await runtimeStore.findByOrganizationAndKey(
    actor.organizationId,
    BUILTIN_OPENHANDS_RUNTIME_KEY_V1
  );
  if (existingByKey) {
    return;
  }

  await runtimeStore.upsert({
    where: {
      organizationId_key: {
        organizationId: actor.organizationId,
        key: BUILTIN_OPENHANDS_RUNTIME_KEY_V1,
      },
    },
    create,
    update: {},
  });
}

function isDormantLegacyBuiltinOpenHands(
  runtime: ExistingExecutionRuntimeIdentityV1,
  organizationId: string
): boolean {
  return (
    runtime.organizationId === organizationId &&
    runtime.key === LEGACY_BUILTIN_OPENHANDS_RUNTIME_KEY_V1 &&
    runtime.driver === 'openhands' &&
    runtime.endpoint === null &&
    runtime.enabled === false &&
    runtime.healthStatus === 'offline' &&
    runtime.capacityTotal === 0 &&
    runtime.capacityUsed === 0 &&
    runtime.registrationJson === OPENHANDS_REGISTRATION_JSON
  );
}

async function loadExecutionRuntimeStore(): Promise<
  ExecutionRuntimeRegistryStoreV1
> {
  const { prisma } = await import('@/lib/db/prisma');
  return {
    async findById(id) {
      return prisma.executionRuntime.findUnique({
        where: { id },
        select: {
          id: true,
          organizationId: true,
          key: true,
          driver: true,
          endpoint: true,
          enabled: true,
          registrationJson: true,
          healthStatus: true,
          capacityTotal: true,
          capacityUsed: true,
        },
      });
    },
    async findByOrganizationAndKey(organizationId, key) {
      return prisma.executionRuntime.findUnique({
        where: { organizationId_key: { organizationId, key } },
        select: {
          id: true,
          organizationId: true,
          key: true,
          driver: true,
          endpoint: true,
          enabled: true,
          registrationJson: true,
          healthStatus: true,
          capacityTotal: true,
          capacityUsed: true,
        },
      });
    },
    async migrateLegacyBuiltin({ id, organizationId, legacyKey, key }) {
      const result = await prisma.executionRuntime.updateMany({
        where: {
          id,
          organizationId,
          key: legacyKey,
          driver: 'openhands',
          endpoint: null,
          enabled: false,
          registrationJson: OPENHANDS_REGISTRATION_JSON,
          healthStatus: 'offline',
          capacityTotal: 0,
          capacityUsed: 0,
        },
        data: { key },
      });
      return result.count;
    },
    upsert(input) {
      return prisma.executionRuntime.upsert(input);
    },
  };
}

function builtinOpenHandsRuntimeWriteV1(
  organizationId: string
): BuiltinExecutionRuntimeWriteV1 {
  return {
    id: builtinOpenHandsRuntimeIdV1(organizationId),
    organizationId,
    key: BUILTIN_OPENHANDS_RUNTIME_KEY_V1,
    name: 'OpenHands',
    driver: 'openhands',
    version: null,
    endpoint: null,
    enabled: false,
    registrationJson: OPENHANDS_REGISTRATION_JSON,
    capabilitiesJson: OPENHANDS_CAPABILITIES_JSON,
    healthStatus: 'offline',
    healthJson: OPENHANDS_HEALTH_JSON,
    lastHeartbeatAt: null,
    capacityTotal: 0,
    capacityUsed: 0,
    capacityJson: OPENHANDS_CAPACITY_JSON,
    capacityUpdatedAt: null,
  };
}
