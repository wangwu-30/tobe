import * as React from 'react';
import { AlertCircle, BookOpen, CheckCircle2, LoaderCircle, TriangleAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { useNavigationBlocker } from '@/lib/navigation/navigation-guard';

const STATUS_LABELS: Record<string, string> = {
  approved: 'Approved',
  conflicted: 'Needs attention',
  failed: 'Index failed',
  merged: 'Merged',
  pending_review: 'Awaiting review',
  queued: 'Merge queued',
  rejected: 'Rejected',
  running: 'Merging and indexing',
  succeeded: 'Index ready',
};

export function KnowledgeStatusBadge({ status }: { status: string }) {
  const danger = ['rejected', 'conflicted', 'failed'].includes(status);
  const success = ['merged', 'succeeded'].includes(status);
  const active = ['queued', 'running'].includes(status);
  const label = STATUS_LABELS[status] || humanize(status);
  return (
    <Badge
      className="max-w-full whitespace-normal break-words text-left [overflow-wrap:anywhere]"
      title={label}
      variant={danger ? 'destructive' : success ? 'secondary' : 'outline'}
    >
      {active ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : success ? <CheckCircle2 aria-hidden="true" /> : null}
      {label}
    </Badge>
  );
}

export function KnowledgeState({
  action,
  kind = 'empty',
  text,
  title,
}: {
  action?: React.ReactNode;
  kind?: 'empty' | 'error' | 'loading';
  text: string;
  title?: string;
}) {
  return (
    <div
      aria-busy={kind === 'loading'}
      aria-live={kind === 'loading' ? 'polite' : undefined}
      className="flex min-h-48 min-w-0 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground"
      role={kind === 'loading' ? 'status' : kind === 'error' ? 'alert' : undefined}
    >
      {kind === 'loading' ? (
        <LoaderCircle aria-hidden="true" className="size-5 motion-safe:animate-spin" />
      ) : kind === 'error' ? (
        <TriangleAlert aria-hidden="true" className="size-5 text-destructive" />
      ) : (
        <BookOpen aria-hidden="true" className="size-5" />
      )}
      <div className="max-w-full min-w-0">
        {title ? <p className="break-words font-medium text-foreground [overflow-wrap:anywhere]">{title}</p> : null}
        <p className={(title ? 'mt-1 ' : '') + 'break-words [overflow-wrap:anywhere]'}>{text}</p>
      </div>
      {action}
    </div>
  );
}

export function KnowledgeNotice({
  children,
  onDismiss,
  tone,
}: {
  children: React.ReactNode;
  onDismiss?: () => void;
  tone: 'success' | 'error';
}) {
  return (
    <div
      className={
        'mt-4 flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ' +
        (tone === 'error'
          ? 'border-destructive/40 bg-destructive/5 text-destructive'
          : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300')
      }
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
    >
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">
        {tone === 'error' ? <AlertCircle aria-hidden="true" className="mr-2 inline size-4" /> : null}
        {children}
      </span>
      {onDismiss ? (
        <button
          className="min-h-11 shrink-0 touch-manipulation rounded-sm px-2 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:min-h-0"
          onClick={onDismiss}
          type="button"
        >
          <span className="sr-only">Dismiss {tone === 'error' ? 'error' : 'notification'}</span>
          <span aria-hidden="true">Dismiss</span>
        </button>
      ) : null}
    </div>
  );
}

export function shortSha(value: string | null | undefined) {
  return value ? value.slice(0, 8) : '—';
}

export function humanize(value: string) {
  return value.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());
}

export function useUnsavedChangesWarning(dirty: boolean, message: string) {
  useNavigationBlocker(dirty, message);
}
