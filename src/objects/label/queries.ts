import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { StateLabelData } from '@/types';

import { mapStateLabel } from './schema';

export async function listStateLabelsByStateIds(
  params: {
    organizationId: string;
    stateIds: string[];
  },
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<Map<string, StateLabelData[]>> {
  if (params.stateIds.length === 0) {
    return new Map();
  }

  const labels = await db.label.findMany({
    where: {
      deletedAt: null,
      organizationId: params.organizationId,
      versionId: {
        in: params.stateIds,
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const labelsByStateId = new Map<string, StateLabelData[]>();
  labels.map(mapStateLabel).forEach((label) => {
    const bucket = labelsByStateId.get(label.stateId) || [];
    bucket.push(label);
    labelsByStateId.set(label.stateId, bucket);
  });

  return labelsByStateId;
}

export async function listStateLabels(
  params: {
    organizationId: string;
    stateId: string;
  },
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<StateLabelData[]> {
  return (
    (await listStateLabelsByStateIds(
      {
        organizationId: params.organizationId,
        stateIds: [params.stateId],
      },
      db
    )).get(params.stateId) || []
  );
}
