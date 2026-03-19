import { getCanonicalDeliverableType } from '@/lib/workspace/deliverable-types';
import type { DeliverableType } from '@/types';

type TranslateFn = (
  key: 'goal.webPage' | 'goal.document',
  variables?: Record<string, string | number>
) => string;

export function formatDeliverableTypeLabel(
  deliverableType: DeliverableType,
  t: TranslateFn
) {
  const canonicalDeliverableType = getCanonicalDeliverableType(deliverableType);

  if (canonicalDeliverableType === 'web') {
    return t('goal.webPage');
  }

  return t('goal.document');
}
