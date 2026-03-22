'use client';

import { FileText, Globe } from 'lucide-react';

import { useT } from '@/components/providers/language-provider';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDeliverableTypeLabel } from '@/lib/workspace/deliverable-labels';
import type { DeliverableType } from '@/types';

export function DeliverableTypeIcon({
  className,
  deliverableType,
}: {
  className?: string;
  deliverableType: DeliverableType;
}) {
  const Icon = deliverableType === 'web' ? Globe : FileText;

  return <Icon className={className} />;
}

export function DeliverableTypeBadge({
  className,
  deliverableType,
  variant = 'outline',
}: {
  className?: string;
  deliverableType: DeliverableType;
  variant?: 'outline' | 'secondary';
}) {
  const t = useT();

  return (
    <Badge
      variant={variant}
      className={cn('gap-1 px-1.5 py-0 text-[10px] font-normal', className)}
    >
      <DeliverableTypeIcon className="h-3 w-3" deliverableType={deliverableType} />
      {formatDeliverableTypeLabel(deliverableType, t)}
    </Badge>
  );
}
