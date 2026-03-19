import type { DeliverableType, LegacyDeliverableType } from '@/types';

export type CanonicalDeliverableType = 'document' | 'web';

export function parseStoredDeliverableType(
  deliverableType: unknown
): LegacyDeliverableType | null {
  if (
    deliverableType === 'document' ||
    deliverableType === 'web' ||
    deliverableType === 'slides' ||
    deliverableType === 'code'
  ) {
    return deliverableType;
  }

  return null;
}

export function normalizeStoredDeliverableType(
  deliverableType: unknown
): DeliverableType | null {
  const parsed = parseStoredDeliverableType(deliverableType);
  if (parsed === 'web') {
    return 'web';
  }

  if (parsed) {
    return 'document';
  }

  return null;
}

export function getCanonicalDeliverableType(
  deliverableType: LegacyDeliverableType | null | undefined
): CanonicalDeliverableType {
  const normalized = normalizeStoredDeliverableType(deliverableType);

  if (normalized === 'web') {
    return normalized;
  }

  return 'document';
}
