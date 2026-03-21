import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/prisma';

import { isRecoveryWorkspaceState } from './schema';

export async function resolveDraftBaseVersionIdForVersion(
  params: {
    organizationId: string;
    versionId: string | null;
  },
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<string | null> {
  let currentVersionId = params.versionId;

  while (currentVersionId) {
    const version = await db.version.findFirst({
      where: {
        deletedAt: null,
        id: currentVersionId,
        organizationId: params.organizationId,
      },
      select: {
        id: true,
        labels: {
          where: {
            deletedAt: null,
          },
          select: {
            kind: true,
          },
        },
        parentVersionId: true,
      },
    });

    if (!version) {
      return null;
    }

    if (!isRecoveryWorkspaceState(version)) {
      return version.id;
    }

    currentVersionId = version.parentVersionId;
  }

  return null;
}

export function findNearestVersionBeforeMessage(params: {
  messageCreatedAt: Date;
  organizationId: string;
  workspaceId: string;
}, db: Prisma.TransactionClient | typeof prisma = prisma) {
  return db.version.findFirst({
    where: {
      deletedAt: null,
      documentId: params.workspaceId,
      organizationId: params.organizationId,
      lockedAt: {
        lte: params.messageCreatedAt,
      },
    },
    include: {
      labels: {
        where: {
          deletedAt: null,
        },
      },
    },
    orderBy: { lockedAt: 'desc' },
  });
}
