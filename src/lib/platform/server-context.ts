import { prisma } from '@/lib/db/prisma';
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

type PlatformContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

const globalForPlatform = globalThis as typeof globalThis & {
  __daoPlatformBootstrap?: Promise<void>;
};

export async function getPlatformContextFromHeaders(headers?: Headers): Promise<PlatformContext> {
  const organizationId =
    headers?.get(DAO_ORGANIZATION_HEADER)?.trim() || LOCAL_ORGANIZATION_ID;
  const userId = headers?.get(DAO_USER_HEADER)?.trim() || LOCAL_USER_ID;
  const deviceId = headers?.get(DAO_DEVICE_HEADER)?.trim() || LOCAL_DEVICE_ID;

  await ensurePlatformContext({ deviceId, organizationId, userId });

  return {
    deviceId,
    organizationId,
    userId,
  };
}

export async function ensurePlatformContext({
  deviceId = LOCAL_DEVICE_ID,
  organizationId = LOCAL_ORGANIZATION_ID,
  userId = LOCAL_USER_ID,
}: Partial<PlatformContext> = {}) {
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

async function bootstrapDefaultPlatform({
  deviceId,
  organizationId,
  userId,
}: PlatformContext) {
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
}
