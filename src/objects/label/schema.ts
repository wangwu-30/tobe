import type { StateLabelData, StateLabelKind } from '@/types';

export function normalizeStateLabelKind(
  value: string | null | undefined
): StateLabelKind {
  if (
    value === 'head' ||
    value === 'recovery' ||
    value === 'pinned' ||
    value === 'aligned'
  ) {
    return value;
  }

  return 'milestone';
}

export function mapStateLabel(label: {
  createdAt: Date;
  createdByUserId: string | null;
  deletedAt: Date | null;
  id: string;
  kind: string;
  name: string;
  organizationId: string;
  originDeviceId: string | null;
  revision: number;
  updatedAt: Date;
  versionId: string;
}): StateLabelData {
  return {
    id: label.id,
    organizationId: label.organizationId,
    stateId: label.versionId,
    kind: normalizeStateLabelKind(label.kind),
    name: label.name,
    createdByUserId: label.createdByUserId,
    originDeviceId: label.originDeviceId,
    revision: label.revision,
    deletedAt: label.deletedAt,
    createdAt: label.createdAt,
    updatedAt: label.updatedAt,
  };
}
