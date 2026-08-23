import { prisma } from '@/lib/db/prisma';

export type DraftThreadBindingDb = {
  commentThread: {
    updateMany(args: {
      data: {
        revision: { increment: number };
        versionId: string;
      };
      where: {
        deletedAt: null;
        documentId: string;
        draftRevision: { lte: number };
        organizationId: string;
        status: { in: string[] };
        versionId: null;
      };
    }): Promise<unknown>;
  };
};

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

export async function bindDraftThreadsToVersion(
  wikiId: string,
  versionId: string,
  snapshotDraftRevision: number,
  organizationId: string,
  db: DraftThreadBindingDb = prisma
) {
  await db.commentThread.updateMany({
    where: {
      deletedAt: null,
      documentId: wikiId,
      organizationId,
      versionId: null,
      draftRevision: {
        lte: snapshotDraftRevision,
      },
      status: {
        in: ['open', 'applied'],
      },
    },
    data: {
      versionId,
      revision: {
        increment: 1,
      },
    },
  });
}

export async function getCurrentDraftRevisionForDocument(
  organizationId: string,
  wikiId: string
) {
  const wiki = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: wikiId,
      organizationId,
    },
    select: {
      draftRevision: true,
    },
  });

  return wiki?.draftRevision ?? 0;
}

export const getBoundVersionIdForDocument = getBoundVersionIdForWiki;
