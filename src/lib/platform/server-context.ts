import { prisma } from '@/lib/db/prisma';
import { ForbiddenError } from '@/framework/resilience';
import { retrySqliteBusyV1 } from '@/lib/db/sqlite-busy-retry';
import { ensureBuiltinAgentProfileV1 } from '@/objects/agent-profile/commands';
import {
  DAO_DEVICE_HEADER,
  DAO_ORGANIZATION_HEADER,
  DAO_USER_HEADER,
  LOCAL_DEVICE_ID,
  LOCAL_ORGANIZATION_ID,
  LOCAL_ORGANIZATION_SLUG,
  LOCAL_SUBSCRIPTION_ID,
  LOCAL_USER_ID,
} from '@/lib/platform/defaults';

type PlatformIdentity = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

type PlatformContext = PlatformIdentity & { actorType: 'user' };

const globalForPlatform = globalThis as typeof globalThis & {
  __daoPlatformBootstrap?: Promise<void>;
};

export async function getPlatformContextFromHeaders(headers?: Headers): Promise<PlatformContext> {
  const organizationId = trustedLocalHeader(
    headers,
    DAO_ORGANIZATION_HEADER,
    LOCAL_ORGANIZATION_ID
  );
  const userId = trustedLocalHeader(headers, DAO_USER_HEADER, LOCAL_USER_ID);
  const deviceId = trustedLocalHeader(
    headers,
    DAO_DEVICE_HEADER,
    LOCAL_DEVICE_ID
  );

  await ensurePlatformContext();

  return {
    actorType: 'user',
    deviceId,
    organizationId,
    userId,
  };
}

export async function ensurePlatformContext({
  deviceId = LOCAL_DEVICE_ID,
  organizationId = LOCAL_ORGANIZATION_ID,
  userId = LOCAL_USER_ID,
}: Partial<PlatformIdentity> = {}) {
  if (
    deviceId !== LOCAL_DEVICE_ID ||
    organizationId !== LOCAL_ORGANIZATION_ID ||
    userId !== LOCAL_USER_ID
  ) {
    throw new ForbiddenError(
      'The local runtime cannot bootstrap a request-provided platform identity.'
    );
  }
  if (!globalForPlatform.__daoPlatformBootstrap) {
    globalForPlatform.__daoPlatformBootstrap = bootstrapDefaultPlatform({
      deviceId,
      organizationId,
      userId,
    }).finally(() => {
      globalForPlatform.__daoPlatformBootstrap = undefined;
    });
  }

  await globalForPlatform.__daoPlatformBootstrap;
}

/**
 * The single-user local product has no network identity provider. Headers are
 * transport receipts from the trusted Web runtime, not an authentication
 * mechanism, so they may only repeat the principal frozen in process config.
 * Unknown values fail closed and are never materialized as users or owners.
 */
function trustedLocalHeader(
  headers: Headers | undefined,
  name: string,
  expected: string
): string {
  const supplied = headers?.get(name);
  if (supplied !== undefined && supplied !== null && supplied !== expected) {
    throw new ForbiddenError('The request principal is not trusted by this runtime.');
  }
  return expected;
}

async function bootstrapDefaultPlatform({
  deviceId,
  organizationId,
  userId,
}: PlatformIdentity) {
  await retrySqliteBusyV1(async () => {
    await prisma.organization.upsert({
      where: { id: organizationId },
      update: {
        slug: LOCAL_ORGANIZATION_SLUG,
        name: 'Local Organization',
      },
      create: {
        id: organizationId,
        slug: LOCAL_ORGANIZATION_SLUG,
        name: 'Local Organization',
      },
    });

    await prisma.user.upsert({
      where: { id: userId },
      update: {
        name: 'Local User',
      },
      create: {
        id: userId,
        name: 'Local User',
        email: 'local@chengxing.local',
      },
    });

    await prisma.organizationMembership.upsert({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      update: {
        role: 'owner',
      },
      create: {
        organizationId,
        userId,
        role: 'owner',
      },
    });

    await prisma.subscription.upsert({
      where: { organizationId },
      update: {
        id: LOCAL_SUBSCRIPTION_ID,
        plan: 'local',
        status: 'inactive',
        cloudEnabled: false,
      },
      create: {
        id: LOCAL_SUBSCRIPTION_ID,
        organizationId,
        plan: 'local',
        status: 'inactive',
        cloudEnabled: false,
      },
    });

    await prisma.device.upsert({
      where: { id: deviceId },
      update: {
        organizationId,
        userId,
        label: 'Local Device',
        type: 'local',
        lastSeenAt: new Date(),
      },
      create: {
        id: deviceId,
        organizationId,
        userId,
        label: 'Local Device',
        type: 'local',
        lastSeenAt: new Date(),
      },
    });

    // Install the coordinator as part of the trusted organization bootstrap,
    // never as a side effect of a member-facing Agent list/read operation.
    await ensureBuiltinAgentProfileV1({ organizationId });
  });
}
