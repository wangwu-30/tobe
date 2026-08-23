'use client';

import * as React from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CalendarClock,
  Check,
  CircleHelp,
  History,
  LoaderCircle,
  Play,
  RotateCcw,
  Send,
  UserPlus,
  UserRound,
  Zap,
} from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAppLanguage, useT } from '@/components/providers/language-provider';
import { cn } from '@/lib/utils';
import { formatRelativeTime, formatStableDate } from '@/lib/time';
import type { TaskAgent, TaskStatus, TeamTask } from '@/lib/tasks/client';
import type { TaskActivity } from '@/lib/tasks/client';
import {
  TASK_KIND_META,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
} from './task-presentation';

export function TaskCard({
  agents,
  compact = false,
  isUpdating = false,
  onStatusChange,
  task,
}: {
  agents: TaskAgent[];
  compact?: boolean;
  isUpdating?: boolean;
  onStatusChange: (task: TeamTask, status: TaskStatus) => void | Promise<void>;
  task: TeamTask;
}) {
  const language = useAppLanguage();
  const t = useT();
  const statusMeta = TASK_STATUS_META[task.status];
  const priorityMeta =
    task.priority === null ? null : TASK_PRIORITY_META[task.priority];
  const assignee =
    task.assignee ||
    agents.find((agent) => agent.id === task.assigneeId) ||
    (task.assigneeId
      ? {
          avatarUrl: null,
          handle: null,
          id: task.assigneeId,
          kind: task.assigneeType,
          name: task.assigneeType === 'agent' ? 'Agent' : t('tasks.teamMember'),
        }
      : null);
  const primaryAction = getPrimaryAction(task.status, t);
  const secondaryAction = getSecondaryAction(task.status, t);
  const KindIcon = task.kind === 'help' ? CircleHelp : Zap;
  const titleId = `task-card-title-${task.id}`;
  const metaId = `task-card-meta-${task.id}`;

  return (
    <article
      className={cn(
        'group min-w-0 rounded-lg border bg-card transition-colors hover:border-foreground/20',
        compact ? 'p-3.5' : 'p-4 sm:p-5'
      )}
      aria-busy={isUpdating}
      aria-describedby={metaId}
      aria-labelledby={titleId}
      data-status={task.status}
      data-testid={`task-card-${task.id}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div
          aria-hidden="true"
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md',
            task.kind === 'help'
              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
              : 'bg-blue-500/10 text-blue-700 dark:text-blue-400'
          )}
          title={t(TASK_KIND_META[task.kind].labelKey)}
        >
          <KindIcon className="size-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1">
              <h3
                className="break-words text-sm font-semibold leading-6 [overflow-wrap:anywhere] sm:text-[15px]"
                id={titleId}
              >
                {task.title}
              </h3>
              <div
                className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
                id={metaId}
              >
                <span>{t(TASK_KIND_META[task.kind].shortLabelKey)}</span>
                {priorityMeta ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className={priorityMeta.className}>{t(priorityMeta.labelKey)}</span>
                  </>
                ) : null}
                {task.updatedAt ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>{formatRelativeTime(task.updatedAt, language, t('tasks.recentlyUpdated'))}</span>
                  </>
                ) : null}
              </div>
            </div>

            <span
              aria-label={t(statusMeta.labelKey)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium',
                statusMeta.className
              )}
              data-testid={`task-status-${task.id}`}
            >
              <span
                aria-hidden="true"
                className={cn('size-1.5 rounded-full', statusMeta.dotClassName)}
              />
              {t(statusMeta.labelKey)}
            </span>
          </div>

          {task.description ? (
            <p
              className={cn(
                'mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]',
                compact && 'line-clamp-3'
              )}
            >
              {task.description}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Assignee agent={assignee} unassignedLabel={t('tasks.filter.unassigned')} />
            {task.dueAt ? (
              <span
                className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1"
              >
                <CalendarClock aria-hidden="true" className="size-3.5" />
                {t('tasks.due', { date: formatStableDate(task.dueAt) })}
              </span>
            ) : null}
          </div>

          {task.documents.length > 0 ? (
            <div className="mt-3 flex min-w-0 flex-wrap gap-1.5">
              {task.documents.map((document) => (
                <a
                  aria-label={document.title || t('tasks.composer.linkedDocument')}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  href={document.href}
                  key={`${task.id}-${document.id}-${document.href}`}
                  rel={document.href.startsWith('http') ? 'noreferrer' : undefined}
                  target={document.href.startsWith('http') ? '_blank' : undefined}
                  title={document.title || t('tasks.composer.linkedDocument')}
                >
                  <span className="truncate">{document.title || t('tasks.composer.linkedDocument')}</span>
                  <ArrowUpRight aria-hidden="true" className="size-3 shrink-0" />
                </a>
              ))}
            </div>
          ) : task.sourceTitle ? (
            <div className="mt-3 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {t('tasks.fromSource', { title: task.sourceTitle })}
            </div>
          ) : null}

          {!compact && (task.activities.length > 0 || task.createdAt) ? (
            <TaskTimeline language={language} task={task} />
          ) : null}

          {primaryAction || secondaryAction ? (
            <div
              className={cn(
                'mt-4 flex flex-wrap items-center gap-2 border-t pt-3',
                compact && 'mt-3'
              )}
            >
              {primaryAction ? (
                <Button
                  aria-label={`${primaryAction.label}: ${task.title}`}
                  className="h-8"
                  data-testid={`task-action-${task.id}`}
                  disabled={isUpdating}
                  onClick={() => void onStatusChange(task, primaryAction.status)}
                  size="sm"
                  variant={primaryAction.status === 'done' ? 'default' : 'outline'}
                >
                  {isUpdating ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="animate-spin motion-reduce:animate-none"
                    />
                  ) : (
                    <primaryAction.icon aria-hidden="true" />
                  )}
                  {primaryAction.label}
                </Button>
              ) : null}
              {secondaryAction ? (
                <Button
                  aria-label={`${secondaryAction.label}: ${task.title}`}
                  className="h-8 text-muted-foreground"
                  data-testid={`task-secondary-action-${task.id}`}
                  disabled={isUpdating}
                  onClick={() => void onStatusChange(task, secondaryAction.status)}
                  size="sm"
                  variant="ghost"
                >
                  <secondaryAction.icon aria-hidden="true" />
                  {secondaryAction.label}
                </Button>
              ) : null}
              {isUpdating ? (
                <span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
                  {t('tasks.syncing')}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function Assignee({ agent, unassignedLabel }: { agent: TaskAgent | null; unassignedLabel: string }) {
  if (!agent) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1">
        <UserRound aria-hidden="true" className="size-3.5" />
        {unassignedLabel}
      </span>
    );
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-muted/60 py-0.5 pl-0.5 pr-2">
      <Avatar size="sm">
        {agent.avatarUrl ? <AvatarImage alt="" src={agent.avatarUrl} /> : null}
        <AvatarFallback>
          {agent.kind?.toLowerCase().includes('agent') ? (
            <Bot aria-hidden="true" className="size-3" />
          ) : (
            initials(agent.name)
          )}
        </AvatarFallback>
      </Avatar>
      <span className="max-w-32 truncate">{agent.name}</span>
    </span>
  );
}

function TaskTimeline({ language, task }: { language: string; task: TeamTask }) {
  const t = useT();
  const items = task.activities.slice(0, 5);
  const timelineId = `task-card-timeline-${task.id}`;

  return (
    <details className="group/timeline mt-3 text-xs text-muted-foreground">
      <summary
        aria-controls={timelineId}
        className="inline-flex list-none items-center gap-1.5 rounded-md py-1 pr-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden"
      >
        <History aria-hidden="true" className="size-3.5" />
        {items.length > 0 ? t('tasks.activityCount', { count: task.activities.length }) : t('tasks.createdInfo')}
      </summary>
      <div
        className="mt-2 space-y-2 border-l pl-3"
        data-testid={`task-timeline-${task.id}`}
        id={timelineId}
      >
        {items.length > 0 ? (
          items.map((activity) => (
            <div className="relative leading-5 before:absolute before:-left-[15px] before:top-2 before:size-1 before:rounded-full before:bg-muted-foreground/50" key={activity.id}>
              <span className="break-words text-foreground/80 [overflow-wrap:anywhere]">
                {activity.actorName ? `${activity.actorName} ` : ''}{activityLabel(activity, t)}
              </span>
              {activity.createdAt ? (
                <span className="ml-1.5">
                  {formatRelativeTime(activity.createdAt, language)}
                </span>
              ) : null}
            </div>
          ))
        ) : (
          <div className="relative leading-5 before:absolute before:-left-[15px] before:top-2 before:size-1 before:rounded-full before:bg-muted-foreground/50">
            {t('tasks.createdTask')}
            {task.createdAt ? (
              <span className="ml-1.5">{formatRelativeTime(task.createdAt, language)}</span>
            ) : null}
          </div>
        )}
      </div>
    </details>
  );
}

function getPrimaryAction(status: TaskStatus, t: ReturnType<typeof useT>): {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  status: TaskStatus;
} | null {
  if (status === 'open') return { icon: UserPlus, label: t('tasks.action.claim'), status: 'claimed' };
  if (status === 'claimed') return { icon: Play, label: t('tasks.action.start'), status: 'in_progress' };
  if (status === 'in_progress') return { icon: Send, label: t('tasks.action.review'), status: 'review' };
  if (status === 'blocked') return { icon: RotateCcw, label: t('tasks.action.resume'), status: 'in_progress' };
  if (status === 'review') return { icon: Check, label: t('tasks.action.done'), status: 'done' };
  return null;
}

function getSecondaryAction(status: TaskStatus, t: ReturnType<typeof useT>): {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  status: TaskStatus;
} | null {
  if (status === 'in_progress') {
    return { icon: AlertTriangle, label: t('tasks.action.block'), status: 'blocked' };
  }
  if (status === 'review') {
    return { icon: RotateCcw, label: t('tasks.action.return'), status: 'in_progress' };
  }
  return null;
}

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || 'TA';
}

function activityLabel(activity: TaskActivity, t: ReturnType<typeof useT>) {
  if (activity.kind === 'created') return t('tasks.activity.created');
  if (activity.kind === 'assigned') return t('tasks.activity.assigned');
  if (activity.kind === 'status_changed') return t('tasks.activity.statusChanged');
  if (activity.kind === 'updated') return t('tasks.activity.updated');
  return activity.label;
}
