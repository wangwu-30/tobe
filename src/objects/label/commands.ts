import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { StateLabelData, StateLabelKind } from '@/types';

import { mapStateLabel, normalizeStateLabelKind } from './schema';

type StateLabelActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

export async function createStateLabel(
  actor: StateLabelActorContext,
  input: {
    kind: StateLabelKind;
    name: string;
    stateId: string;
  },
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<StateLabelData> {
  const name = input.name.trim();
  if (!name) {
    throw new Error('State label name is required.');
  }

  const label = await db.label.create({
    data: {
      organizationId: actor.organizationId,
      versionId: input.stateId,
      kind: normalizeStateLabelKind(input.kind),
      name,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
    },
  });

  return mapStateLabel(label);
}

export async function archiveStateLabel(
  actor: StateLabelActorContext,
  input: {
    labelId: string;
  },
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<StateLabelData> {
  const label = await db.label.findFirst({
    where: {
      deletedAt: null,
      id: input.labelId,
      organizationId: actor.organizationId,
    },
  });

  if (!label) {
    throw new Error('State label not found.');
  }

  const archived = await db.label.update({
    where: { id: label.id },
    data: {
      deletedAt: new Date(),
      originDeviceId: actor.deviceId,
      revision: {
        increment: 1,
      },
    },
  });

  return mapStateLabel(archived);
}
