'use client';

import * as React from 'react';
import { AlertTriangle, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  inspectExecutionRecovery,
  requestExecutionRecoveryActionClient,
  type ExecutionRecoveryInspection,
  type ExecutionRecoveryIncident,
} from '@/lib/execution/recovery-client';
import { formatStableDateTime } from '@/lib/time';

/**
 * Operator-only recovery surface. Mount it on a Job detail page with the
 * current job id; it remains hidden when no recovery history exists.
 */
export function ExecutionRecoveryPanel({
  jobId,
  onActionRequested,
}: {
  jobId: string;
  onActionRequested?: () => void | Promise<void>;
}) {
  const [inspection, setInspection] =
    React.useState<ExecutionRecoveryInspection | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<'retry' | 'discard' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const descriptionId = React.useId();
  const statusId = React.useId();

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await inspectExecutionRecovery(jobId);
      if (result.ok) setInspection(result.data);
      else setError(result.error);
    } catch {
      setError('Recovery state could not be checked. Try again.');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const requestAction = async (action: 'retry' | 'discard') => {
    const incident = inspection?.current;
    if (!incident) return;
    if (
      action === 'discard' &&
      !window.confirm(
        'Discard the quarantined workspace? Uncommitted workspace changes will be permanently removed.'
      )
    ) {
      return;
    }
    setBusy(action);
    setError(null);
    try {
      const result = await requestExecutionRecoveryActionClient(
        jobId,
        incident,
        action
      );
      if (!result.ok) {
        setError(result.error);
      } else {
        await load();
        await onActionRequested?.();
      }
    } catch {
      setError('The recovery action could not be requested. Try again.');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !inspection) {
    return (
      <div
        aria-live="polite"
        className="flex items-center gap-2 text-sm text-muted-foreground"
        data-testid="execution-recovery-loading"
        role="status"
      >
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> Checking recovery state…
      </div>
    );
  }
  if (!error && !inspection?.items.length) return null;

  const current = inspection?.current ?? null;
  return (
    <Card
      aria-busy={loading || busy !== null}
      aria-describedby={descriptionId}
      aria-labelledby={statusId}
      className="border-orange-500/30 bg-orange-500/5"
      data-testid="execution-recovery-panel"
    >
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle aria-hidden="true" className="size-5 text-orange-700" />
            <CardTitle className="text-base" id={statusId}>Workspace recovery</CardTitle>
            {current ? <Badge variant="outline">Quarantined</Badge> : null}
          </div>
          <Button
            aria-busy={loading}
            disabled={loading || busy !== null}
            onClick={() => void load()}
            size="sm"
            variant="ghost"
          >
            <RefreshCw
              aria-hidden="true"
              className={loading ? 'animate-spin motion-reduce:animate-none' : ''}
            />
            Refresh recovery
          </Button>
        </div>
        <p className="text-sm text-muted-foreground" id={descriptionId}>
          Automatic recovery stopped to preserve an unexpected workspace.
          Inspect the safe classification before choosing an operator action.
        </p>
        <p aria-live="polite" className="sr-only" role="status">
          {busy === 'retry'
            ? 'Retrying execution workspace recovery.'
            : busy === 'discard'
              ? 'Discarding quarantined workspace.'
              : current
                ? `Workspace recovery status is quarantined with classification ${current.classification}.`
                : 'No open workspace quarantine.'}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p aria-live="assertive" className="text-sm text-destructive" role="alert">{error}</p>
        ) : null}
        {current ? (
          <>
            <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <RecoveryFact label="Classification" value={current.classification} />
              <RecoveryFact label="Stage" value={current.stage} />
              <RecoveryFact label="Reason" value={current.reasonCode} />
              <RecoveryFact label="Detected" value={formatStableDateTime(current.createdAt)} />
            </dl>
            {current.classification === 'partial' || current.classification === 'drifted' ? (
              <p className="text-sm text-orange-800">
                This state cannot be safely discarded automatically. Resolve the
                workspace outside the product, then retry inspection.
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                aria-busy={busy === 'retry'}
                disabled={busy !== null}
                onClick={() => void requestAction('retry')}
                variant="outline"
              >
                {busy === 'retry' ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden="true" />}
                Retry recovery
              </Button>
              <Button
                aria-busy={busy === 'discard'}
                disabled={busy !== null || !current.discardable}
                onClick={() => void requestAction('discard')}
                variant="destructive"
              >
                {busy === 'discard' ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Trash2 aria-hidden="true" />}
                Discard workspace
              </Button>
            </div>
            <RecoveryHistory items={inspection?.items ?? []} />
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              No open quarantine. Recovery history remains available for audit.
            </p>
            <RecoveryHistory items={inspection?.items ?? []} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RecoveryFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-xs">{value}</dd>
    </div>
  );
}

function RecoveryHistory({
  items,
}: {
  items: ExecutionRecoveryIncident[];
}) {
  return (
    <section aria-label="Recovery audit history" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Recovery audit</h3>
        <Badge variant="outline">{items.length} incident{items.length === 1 ? '' : 's'}</Badge>
      </div>
      <div className="space-y-3" data-testid="execution-recovery-history">
        {items.map((incident) => (
          <article
            className="rounded-md border bg-background/70 p-3"
            data-testid={`execution-recovery-incident-${incident.id}`}
            key={incident.id}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">rev {incident.revision}</Badge>
              <Badge variant="outline">{incident.status.replaceAll('_', ' ')}</Badge>
              {incident.requestedAction ? (
                <Badge variant="outline">action {incident.requestedAction}</Badge>
              ) : null}
              {incident.resolution ? (
                <Badge variant="outline">resolution {incident.resolution}</Badge>
              ) : null}
            </div>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <RecoveryFact label="Classification" value={incident.classification} />
              <RecoveryFact label="Stage" value={incident.stage} />
              <RecoveryFact label="Reason" value={incident.reasonCode} />
              <RecoveryFact label="Created" value={formatStableDateTime(incident.createdAt)} />
              <RecoveryFact
                label="Requested by"
                value={incident.actionRequestedById || 'Not requested'}
              />
              <RecoveryFact
                label="Requested at"
                value={formatStableDateTime(incident.actionRequestedAt)}
              />
              <RecoveryFact
                label="Resolved at"
                value={formatStableDateTime(incident.resolvedAt)}
              />
              <RecoveryFact
                label="Generation"
                value={String(incident.generation)}
              />
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
