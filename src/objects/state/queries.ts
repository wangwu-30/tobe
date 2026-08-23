import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  resolveCurrentVersionFile,
  resolveCurrentWorkspaceFile,
} from '@/objects/file/schema';
import { listStateLabelsByStateIds } from '@/objects/label/queries';
import { mapWorkspaceVersion } from '@/objects/workspace/view';
import type {
  WorkspaceFileData,
  WorkspaceVersionData,
  WorkspaceVersionFileData,
} from '@/types';

import { resolveDraftBaseVersionIdFromLineage } from './schema';

type WorkspaceVersionRecord = Parameters<typeof mapWorkspaceVersion>[0];

export async function mapWorkspaceVersionsWithLabels(
  params: {
    organizationId: string;
    versions: WorkspaceVersionRecord[];
  },
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<WorkspaceVersionData[]> {
  if (params.versions.length === 0) {
    return [];
  }

  const labelsByStateId = await listStateLabelsByStateIds(
    {
      organizationId: params.organizationId,
      stateIds: params.versions.map((version) => version.id),
    },
    db
  );

  return params.versions.map((version) =>
    mapWorkspaceVersion({
      ...version,
      labels: labelsByStateId.get(version.id) || [],
    })
  );
}

export async function mapWorkspaceVersionWithLabels(
  params: {
    organizationId: string;
    version: WorkspaceVersionRecord;
  },
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<WorkspaceVersionData> {
  const [mappedVersion] = await mapWorkspaceVersionsWithLabels(
    {
      organizationId: params.organizationId,
      versions: [params.version],
    },
    db
  );

  return mappedVersion;
}

export async function listWorkspaceVersions(
  params: {
    organizationId: string;
    workspaceId: string;
  },
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<WorkspaceVersionData[]> {
  const versions = await db.version.findMany({
    where: {
      deletedAt: null,
      documentId: params.workspaceId,
      organizationId: params.organizationId,
    },
    orderBy: { versionNum: 'desc' },
  });

  return mapWorkspaceVersionsWithLabels(
    {
      organizationId: params.organizationId,
      versions,
    },
    db
  );
}

export async function resolveDraftBaseVersionIdForVersion(
  params: {
    organizationId: string;
    versionId: string | null;
    workspaceId: string;
  },
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<string | null> {
  const versions = await db.version.findMany({
    where: {
      deletedAt: null,
      documentId: params.workspaceId,
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

  return resolveDraftBaseVersionIdFromLineage({
    startVersionId: params.versionId,
    versions,
  });
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

export function buildWorkspaceVersionSelection(params: {
  conversationActiveFileId?: string | null;
  requestedFileId?: string | null;
  selectedVersionId?: string | null;
  versions: WorkspaceVersionData[];
  workspaceFiles: WorkspaceFileData[];
}): {
  currentFile: WorkspaceFileData | WorkspaceVersionFileData | null;
  selectedVersion: WorkspaceVersionData | null;
  versionFiles: WorkspaceVersionFileData[];
  visibleVersions: WorkspaceVersionData[];
} {
  const selectedVersion =
    params.versions.find((version) => version.id === params.selectedVersionId) || null;
  const versionFiles = selectedVersion ? selectedVersion.files : [];
  const resolvedFileId = params.requestedFileId || params.conversationActiveFileId || null;
  const currentFile =
    selectedVersion && versionFiles.length > 0
      ? resolveCurrentVersionFile({
          fileId: resolvedFileId,
          files: versionFiles,
        })
      : resolveCurrentWorkspaceFile({
          fileId: resolvedFileId,
          files: params.workspaceFiles,
        });

  return {
    currentFile,
    selectedVersion,
    versionFiles,
    visibleVersions: params.versions.filter((version) => version.visible),
  };
}
