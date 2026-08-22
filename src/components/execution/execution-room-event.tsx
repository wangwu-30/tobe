'use client';

import * as React from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  CircleX,
  MessageCircleQuestion,
  MessageSquareReply,
} from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  parseExecutionRoomEvent,
  type ExecutionRoomLifecycleEvent,
} from '@/lib/execution/room-events';
import { formatStableDateTime } from '@/lib/time';
import type { RoomEventDtoV1 } from '@/objects/room';

import { ExecutionStatusBadge } from './execution-status';

export function renderExecutionRoomEvent(event: RoomEventDtoV1) {
  const executionEvent = parseExecutionRoomEvent(event);
  return executionEvent ? (
    <ExecutionRoomEvent event={executionEvent} />
  ) : null;
}

export function ExecutionRoomEvent({
  event,
}: {
  event: ExecutionRoomLifecycleEvent;
}) {
  const presentation = getPresentation(event);
  const Icon = presentation.icon;

  return (
    <article
      className="mx-3 my-2 flex items-start gap-3 rounded-xl border bg-card/60 px-3 py-3 sm:mx-5"
      data-event-id={event.eventId}
      data-job-id={event.data.jobId}
      data-testid={`room-execution-event-${event.type.slice('execution.'.length).replaceAll('_', '-')}`}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg border',
          presentation.iconClassName
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{presentation.title}</span>
          <ExecutionStatusBadge status={event.data.jobStatus} />
          <time
            className="text-[11px] text-muted-foreground"
            dateTime={event.data.occurredAt}
          >
            {formatStableDateTime(event.data.occurredAt)}
          </time>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {presentation.description}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="max-w-56 truncate" title={event.data.jobId}>
            Job <span className="font-mono">{event.data.jobId}</span>
          </span>
          <span>revision {event.data.jobRevision}</span>
          {event.data.requestId ? (
            <span className="max-w-48 truncate" title={event.data.requestId}>
              Request <span className="font-mono">{event.data.requestId}</span>
            </span>
          ) : null}
          {event.data.inputRevision ? (
            <span>input revision {event.data.inputRevision}</span>
          ) : null}
          {event.data.teamTaskId ? (
            <span className="max-w-48 truncate" title={event.data.teamTaskId}>
              Team task <span className="font-mono">{event.data.teamTaskId}</span>
            </span>
          ) : null}
        </div>
      </div>
      <Button
        asChild
        aria-label={`Open execution job ${event.data.jobId}`}
        className="shrink-0"
        size="sm"
        variant="ghost"
      >
        <Link href={`/jobs/${encodeURIComponent(event.data.jobId)}`}>
          Open job
          <ArrowUpRight aria-hidden="true" />
        </Link>
      </Button>
    </article>
  );
}

function getPresentation(event: ExecutionRoomLifecycleEvent) {
  if (event.type === 'execution.input_requested') {
    return {
      description: 'This durable job is waiting for a response before it can continue.',
      icon: MessageCircleQuestion,
      iconClassName:
        'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
      title: 'Execution needs input',
    };
  }
  if (event.type === 'execution.input_answered') {
    return {
      description: 'The response was accepted and the durable job is queued to resume.',
      icon: MessageSquareReply,
      iconClassName:
        'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300',
      title: 'Execution input answered',
    };
  }
  if (event.type === 'execution.input_cancelled') {
    return {
      description: 'The pending input request and its durable job were cancelled.',
      icon: CircleX,
      iconClassName:
        'border-muted-foreground/20 bg-muted text-muted-foreground',
      title: 'Execution input cancelled',
    };
  }
  return {
    description: 'The durable job reached a terminal state. Open it to review the result.',
    icon: CheckCircle2,
    iconClassName: cn(
      event.data.jobStatus === 'succeeded' &&
        'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
      event.data.jobStatus === 'failed' &&
        'border-destructive/20 bg-destructive/10 text-destructive',
      event.data.jobStatus === 'cancelled' &&
        'border-muted-foreground/20 bg-muted text-muted-foreground'
    ),
    title: 'Execution completed',
  };
}
