import type { AppCopyKey } from '@/lib/i18n/copy';
import type { TaskKind, TaskPriority, TaskStatus } from '@/lib/tasks/client';

export const TASK_STATUS_META: Record<
  TaskStatus,
  { className: string; dotClassName: string; labelKey: AppCopyKey }
> = {
  open: {
    className: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300',
    dotClassName: 'bg-slate-400',
    labelKey: 'tasks.status.open',
  },
  claimed: {
    className: 'border-border bg-muted/40 text-foreground',
    dotClassName: 'bg-blue-500',
    labelKey: 'tasks.status.claimed',
  },
  in_progress: {
    className: 'border-border bg-muted/40 text-foreground',
    dotClassName: 'bg-amber-500',
    labelKey: 'tasks.status.inProgress',
  },
  blocked: {
    className: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
    dotClassName: 'bg-red-500',
    labelKey: 'tasks.status.blocked',
  },
  review: {
    className: 'border-border bg-muted/40 text-foreground',
    dotClassName: 'bg-violet-500',
    labelKey: 'tasks.status.review',
  },
  done: {
    className: 'border-border bg-muted/40 text-muted-foreground',
    dotClassName: 'bg-emerald-500',
    labelKey: 'tasks.status.done',
  },
  cancelled: {
    className: 'border-border bg-muted/50 text-muted-foreground',
    dotClassName: 'bg-muted-foreground/50',
    labelKey: 'tasks.status.cancelled',
  },
};

export const TASK_KIND_META: Record<TaskKind, { labelKey: AppCopyKey; shortLabelKey: AppCopyKey }> = {
  execution: { labelKey: 'tasks.kind.executionTask', shortLabelKey: 'tasks.kind.execution' },
  help: { labelKey: 'tasks.kind.helpTask', shortLabelKey: 'tasks.kind.help' },
};

export const TASK_PRIORITY_META: Record<TaskPriority, { className: string; labelKey: AppCopyKey }> = {
  0: { className: 'text-muted-foreground', labelKey: 'tasks.priority.low' },
  1: { className: 'text-muted-foreground', labelKey: 'tasks.priority.normal' },
  2: { className: 'text-orange-600 dark:text-orange-400', labelKey: 'tasks.priority.high' },
  3: { className: 'font-medium text-red-600 dark:text-red-400', labelKey: 'tasks.priority.urgent' },
};

export const TASK_STATUS_OPTIONS: Array<{ labelKey: AppCopyKey; value: TaskStatus }> = [
  { labelKey: 'tasks.status.open', value: 'open' },
  { labelKey: 'tasks.status.claimed', value: 'claimed' },
  { labelKey: 'tasks.status.inProgress', value: 'in_progress' },
  { labelKey: 'tasks.status.blocked', value: 'blocked' },
  { labelKey: 'tasks.status.review', value: 'review' },
  { labelKey: 'tasks.status.done', value: 'done' },
  { labelKey: 'tasks.status.cancelled', value: 'cancelled' },
];

export const TASK_BOARD_COLUMNS: Array<{
  descriptionKey: AppCopyKey;
  labelKey: AppCopyKey;
  statuses: TaskStatus[];
}> = [
  { descriptionKey: 'tasks.board.todoDescription', labelKey: 'tasks.board.todo', statuses: ['open', 'claimed'] },
  { descriptionKey: 'tasks.board.progressDescription', labelKey: 'tasks.board.progress', statuses: ['in_progress', 'blocked'] },
  { descriptionKey: 'tasks.board.reviewDescription', labelKey: 'tasks.board.review', statuses: ['review'] },
  { descriptionKey: 'tasks.board.closedDescription', labelKey: 'tasks.board.closed', statuses: ['done', 'cancelled'] },
];
