import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/prisma';
import { isRecoveryVersionType } from '@/lib/workspace/planning';

import { normalizeWorkspaceVersionType } from './schema';

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
        parentVersionId: true,
        versionType: true,
      },
    });

    if (!version) {
      return null;
    }

    if (!isRecoveryVersionType(normalizeWorkspaceVersionType(version.versionType))) {
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
    orderBy: { lockedAt: 'desc' },
  });
}
