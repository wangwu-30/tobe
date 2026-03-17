import type { DeliverableType } from '@/types';

type TranslateFn = (
  key: 'goal.webPage' | 'goal.codeDeliverable' | 'goal.slides' | 'goal.document',
  variables?: Record<string, string | number>
) => string;

export function formatDeliverableTypeLabel(
  deliverableType: DeliverableType,
  t: TranslateFn
) {
  if (deliverableType === 'web') {
    return t('goal.webPage');
  }

  if (deliverableType === 'code') {
    return t('goal.codeDeliverable');
  }

  if (deliverableType === 'slides') {
    return t('goal.slides');
  }

  return t('goal.document');
}
