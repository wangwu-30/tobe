import { ForbiddenError, NotFoundError, ValidationError } from '@/framework/resilience';
import { mapWorkspaceVersion } from '@/objects/workspace/view';
import type {
  StateLabelData,
  WorkspaceVersionData,
} from '@/types';

import { mapStateLabel } from '../label/schema';

import type { WorkspaceStateActorContext } from './shared';

type KnownRequestError = {
  code?: string;
};

type LabelRecord = Parameters<typeof mapStateLabel>[0];
type VersionRecord = Parameters<typeof mapWorkspaceVersion>[0];

type AlignmentDb = {
  $transaction<T>(action: (db: AlignmentTransaction) => Promise<T>): Promise<T>;
};

type AlignmentTransaction = {
  organizationMembership: {
    findUnique(args: {
      where: {
        organizationId_userId: {
          organizationId: string;
          userId: string;
        };
      };
      select: { role: true };
    }): Promise<{ role: string } | null>;
  };
  version: {
    findFirst(args: {
      where: {
        deletedAt: null;
        documentId: string;
        id: string;
        organizationId: string;
      };
      include?: {
        labels?: {
          where?: { deletedAt?: null };
        };
      };
    }): Promise<(VersionRecord & { labels?: LabelRecord[] }) | null>;
  };
  label: {
    create(args: {
      data: {
        organizationId: string;
        versionId: string;
        kind: string;
        name: string;
        createdByUserId: string;
        originDeviceId: string;
      };
    }): Promise<unknown>;
    findMany(args: {
      where: {
        deletedAt: null;
        organizationId: string;
        versionId: {
          in: string[];
        };
      };
      orderBy: Array<{ createdAt: 'asc' } | { id: 'asc' }>;
    }): Promise<LabelRecord[]>;
  };
};

export async function alignWorkspaceVersionWithDb(
  db: AlignmentDb,
  actor: WorkspaceStateActorContext,
  input: {
    versionId: string;
    workspaceId: string;
  }
): Promise<WorkspaceVersionData> {
  const versionId = input.versionId.trim();
  const workspaceId = input.workspaceId.trim();
  if (!versionId || !workspaceId) {
    throw new ValidationError('workspaceId and versionId are required.');
  }

  return db.$transaction(async (tx) => {
    const membership = await tx.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: actor.organizationId,
          userId: actor.userId,
        },
      },
      select: { role: true },
    });
    if (!membership) {
      throw new ForbiddenError('Organization membership is required.');
    }

    const version = await tx.version.findFirst({
      where: {
        deletedAt: null,
        documentId: workspaceId,
        id: versionId,
        organizationId: actor.organizationId,
      },
      include: {
        labels: {
          where: { deletedAt: null },
        },
      },
    });
    if (!version) {
      throw new NotFoundError('Document version not found.');
    }

    const labels = (version.labels || []).map(mapStateLabel);
    if (!labels.some((label) => label.kind === 'milestone' || label.kind === 'head')) {
      throw new ValidationError(
        'Only an immutable visible document version can be aligned.'
      );
    }

    if (!labels.some((label) => label.kind === 'aligned')) {
      try {
        await tx.label.create({
          data: {
            organizationId: actor.organizationId,
            versionId: version.id,
            kind: 'aligned',
            name: version.title,
            createdByUserId: actor.userId,
            originDeviceId: actor.deviceId,
          },
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }
      }
    }

    const activeLabels = await tx.label.findMany({
      where: {
        deletedAt: null,
        organizationId: actor.organizationId,
        versionId: {
          in: [version.id],
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return mapWorkspaceVersion({
      ...version,
      labels: activeLabels.map(mapStateLabel),
    });
  });
}

function isUniqueConstraintError(value: unknown): value is KnownRequestError {
  return typeof value === 'object' && value !== null && (value as KnownRequestError).code === 'P2002';
}
