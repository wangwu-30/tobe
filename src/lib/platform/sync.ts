import { prisma } from '@/lib/db/prisma';

type RecordSyncEventParams = {
  actorUserId: string;
  entityId: string;
  entityType: string;
  occurredAt?: Date;
  organizationId: string;
  originDeviceId?: string | null;
  payload: unknown;
  revision: number;
};

export async function recordSyncEvent({
  actorUserId,
  entityId,
  entityType,
  occurredAt = new Date(),
  organizationId,
  originDeviceId,
  payload,
  revision,
}: RecordSyncEventParams) {
  await prisma.syncEvent.create({
    data: {
      id: crypto.randomUUID(),
      actorUserId,
      entityId,
      entityType,
      occurredAt,
      organizationId,
      originDeviceId: originDeviceId || null,
      payload: JSON.stringify(payload),
      pushedAt: null,
      revision,
    },
  });
}

export function buildRevisionUpdate() {
  return {
    revision: {
      increment: 1,
    },
  } as const;
}

export async function acceptSyncEvents(params: {
  backend: string;
  deviceId: string;
  events: Array<Record<string, unknown>>;
  organizationId: string;
  userId: string;
}) {
  const accepted: string[] = [];
  const now = new Date();

  for (const event of params.events) {
    if (
      typeof event.id !== 'string' ||
      typeof event.entityId !== 'string' ||
      typeof event.entityType !== 'string'
    ) {
      continue;
    }

    const existing = await prisma.syncEvent.findUnique({
      where: { id: event.id },
      select: { id: true },
    });

    if (existing) {
      accepted.push(existing.id);
      continue;
    }

    const created = await prisma.syncEvent.create({
      data: {
        id: event.id,
        actorUserId:
          typeof event.actorUserId === 'string' ? event.actorUserId : params.userId,
        entityId: event.entityId,
        entityType: event.entityType,
        occurredAt:
          typeof event.occurredAt === 'string' || event.occurredAt instanceof Date
            ? new Date(event.occurredAt)
            : now,
        organizationId:
          typeof event.organizationId === 'string'
            ? event.organizationId
            : params.organizationId,
        originDeviceId:
          typeof event.originDeviceId === 'string' ? event.originDeviceId : params.deviceId,
        payload:
          typeof event.payload === 'string'
            ? event.payload
            : JSON.stringify(event.payload || {}),
        pushedAt: now,
        revision:
          typeof event.revision === 'number' && Number.isFinite(event.revision)
            ? Math.trunc(event.revision)
            : 1,
      },
    });

    accepted.push(created.id);
  }

  await advanceSyncCursor({
    backend: params.backend,
    deviceId: params.deviceId,
    organizationId: params.organizationId,
  });

  return accepted;
}

export async function pullSyncEvents(params: {
  backend: string;
  cursor?: string | null;
  deviceId: string;
  lastOccurredAt?: string | null;
  limit?: number;
  organizationId: string;
}) {
  const cursor = await prisma.syncCursor.upsert({
    where: {
      organizationId_deviceId_backend: {
        organizationId: params.organizationId,
        deviceId: params.deviceId,
        backend: params.backend,
      },
    },
    update: {},
    create: {
      organizationId: params.organizationId,
      deviceId: params.deviceId,
      backend: params.backend,
    },
  });

  const lastOccurredAt = params.lastOccurredAt
    ? new Date(params.lastOccurredAt)
    : cursor.lastOccurredAt;
  const lastEventId = params.cursor || cursor.lastEventId;

  const items = await prisma.syncEvent.findMany({
    where: {
      organizationId: params.organizationId,
      originDeviceId: {
        not: params.deviceId,
      },
      ...(lastOccurredAt
        ? {
            OR: [
              {
                occurredAt: {
                  gt: lastOccurredAt,
                },
              },
              ...(lastEventId
                ? [
                    {
                      occurredAt: lastOccurredAt,
                      id: {
                        gt: lastEventId,
                      },
                    },
                  ]
                : []),
            ],
          }
        : {}),
    },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    take: Math.min(params.limit || 500, 500),
  });

  const nextCursor = items.at(-1)?.id ?? lastEventId ?? null;
  const nextOccurredAt = items.at(-1)?.occurredAt ?? lastOccurredAt ?? null;

  if (items.length > 0) {
    await advanceSyncCursor({
      backend: params.backend,
      deviceId: params.deviceId,
      lastEventId: nextCursor,
      lastOccurredAt: nextOccurredAt,
      organizationId: params.organizationId,
    });
  }

  return {
    items,
    nextCursor,
    nextOccurredAt,
  };
}

export async function advanceSyncCursor(params: {
  backend: string;
  deviceId: string;
  lastEventId?: string | null;
  lastOccurredAt?: Date | null;
  organizationId: string;
}) {
  return prisma.syncCursor.upsert({
    where: {
      organizationId_deviceId_backend: {
        organizationId: params.organizationId,
        deviceId: params.deviceId,
        backend: params.backend,
      },
    },
    update: {
      ...(params.lastEventId !== undefined ? { lastEventId: params.lastEventId } : {}),
      ...(params.lastOccurredAt !== undefined
        ? { lastOccurredAt: params.lastOccurredAt }
        : {}),
    },
    create: {
      organizationId: params.organizationId,
      deviceId: params.deviceId,
      backend: params.backend,
      lastEventId: params.lastEventId || null,
      lastOccurredAt: params.lastOccurredAt || null,
    },
  });
}
