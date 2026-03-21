import type { WorkspaceEditLockData } from '@/types';
import { prisma } from '@/lib/db/prisma';
import { mapWorkspaceEditLock } from './view';

export async function getActiveWorkspaceLock(
  organizationId: string,
  workspaceId: string
): Promise<WorkspaceEditLockData | null> {
  const lock = await prisma.wikiEditLock.findFirst({
    where: {
      documentId: workspaceId,
      expiresAt: {
        gt: new Date(),
      },
      organizationId,
    },
  });

  return lock ? mapWorkspaceEditLock(lock) : null;
}
