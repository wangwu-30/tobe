import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_LABELS: Record<string, string> = {
  blocked: 'Blocked',
  cancel_requested: 'Cancelling',
  cancelled: 'Cancelled',
  failed: 'Failed',
  pending: 'Pending',
  quarantined: 'Quarantined',
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  waiting_input: 'Needs input',
};

export function ExecutionStatusBadge({ status }: { status: string }) {
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
      {STATUS_LABELS[status] || status.replaceAll('_', ' ')}
    </Badge>
  );
}

export function canCancelExecution(status: string) {
  return !['cancel_requested', 'cancelled', 'failed', 'succeeded'].includes(status);
}
