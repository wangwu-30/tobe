'use client';

import { useT } from '@/components/providers/language-provider';
import { Badge } from '@/components/ui/badge';
import type { AppCopyKey } from '@/lib/i18n/copy';
import { cn } from '@/lib/utils';

const STATUS_LABEL_KEYS: Record<string, AppCopyKey> = {
  blocked: 'jobs.statusBlocked',
  cancel_requested: 'jobs.statusCancelling',
  cancelled: 'jobs.statusCancelled',
  failed: 'jobs.statusFailed',
  pending: 'jobs.statusPending',
  quarantined: 'jobs.statusQuarantined',
  queued: 'jobs.statusQueued',
  running: 'jobs.statusRunning',
  succeeded: 'jobs.statusSucceeded',
  waiting_input: 'jobs.statusWaitingInput',
};

export function ExecutionStatusBadge({ status }: { status: string }) {
  const t = useT();
  const labelKey = STATUS_LABEL_KEYS[status];
  return (
    <Badge
      className={cn(
        status === 'succeeded' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700',
        status === 'failed' && 'border-destructive/20 bg-destructive/10 text-destructive',
        status === 'cancelled' && 'border-muted-foreground/20 bg-muted text-foreground',
        status === 'running' && 'border-blue-500/20 bg-blue-500/10 text-blue-700',
        status === 'waiting_input' && 'border-amber-500/20 bg-amber-500/10 text-amber-700',
        status === 'quarantined' && 'border-orange-500/20 bg-orange-500/10 text-orange-700',
        status === 'blocked' && 'border-orange-500/20 bg-orange-500/10 text-orange-700'
      )}
      variant="outline"
    >
      {labelKey ? t(labelKey) : status.replaceAll('_', ' ')}
    </Badge>
  );
}

export function canCancelExecution(status: string) {
  return !['cancel_requested', 'cancelled', 'failed', 'succeeded'].includes(status);
}
