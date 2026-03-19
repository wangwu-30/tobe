import type { DeliverableType } from '@/types';

export type CanonicalDeliverableType = 'document' | 'web';

export function normalizeStoredDeliverableType(
  deliverableType: unknown
): DeliverableType | null {
  if (
    deliverableType === 'document' ||
    deliverableType === 'web' ||
    deliverableType === 'code'
  ) {
    return deliverableType;
  }

  if (deliverableType === 'slides') {
    return 'document';
  }

  return null;
}

export function getCanonicalDeliverableType(
  deliverableType: DeliverableType | null | undefined
): CanonicalDeliverableType {
  const normalized = normalizeStoredDeliverableType(deliverableType);

  if (normalized === 'web') {
    return normalized;
  }

  return 'document';
}
