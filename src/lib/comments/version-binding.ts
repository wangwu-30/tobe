import { prisma } from '@/lib/db/prisma';

export async function getBoundVersionIdForWiki(wikiId: string) {
  const wiki = await prisma.document.findUnique({
    where: { id: wikiId },
    select: {
      currentVersion: true,
    },
  });

  if (!wiki || wiki.currentVersion < 1) {
    return null;
  }

  const version = await prisma.version.findFirst({
    where: {
      deletedAt: null,
      documentId: wikiId,
      versionNum: wiki.currentVersion,
    },
    select: { id: true },
  });

  return version?.id ?? null;
}

export async function bindResolvedThreadsToVersion(
  wikiId: string,
  versionId: string
) {
  await prisma.commentThread.updateMany({
    where: {
      deletedAt: null,
      documentId: wikiId,
      status: 'resolved',
      versionId: null,
    },
    data: {
      versionId,
      revision: {
        increment: 1,
      },
    },
  });
}

export const getBoundVersionIdForDocument = getBoundVersionIdForWiki;
