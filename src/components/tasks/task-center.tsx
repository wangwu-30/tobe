'use client';

import * as React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  Columns3,
  Inbox,
  LayoutList,
  Plus,
  RefreshCw,
  Search,
  Users,
  Zap,
} from 'lucide-react';

import { AppShell } from '@/components/layout/app-shell';
import { useAppLanguage, useT } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ZoneErrorBoundary } from '@/framework/resilience';
import { useAppPathname, useAppRouter, useAppSearchParams } from '@/lib/app-router';
import {
  listTaskAgents,
  listTasks,
  updateTask,
  type TaskAgent,
  type TaskKind,
  type TaskStatus,
  type TeamTask,
} from '@/lib/tasks/client';
import { cn } from '@/lib/utils';
import { TaskCard } from './task-card';
import { TaskComposerDialog } from './task-composer-dialog';
import { TASK_BOARD_COLUMNS, TASK_STATUS_OPTIONS } from './task-presentation';

type TaskView = 'list' | 'board';
type StatusFilter = TaskStatus | 'all' | 'active';
type TaskParamKey = 'assignee' | 'kind' | 'q' | 'status' | 'view';

const DEFAULT_STATUS_FILTER: StatusFilter = 'active';
const DEFAULT_KIND_FILTER: TaskKind | 'all' = 'all';
const DEFAULT_ASSIGNEE_FILTER = 'all';
const DEFAULT_TASK_VIEW: TaskView = 'list';
const TASK_STATUSES = new Set<TaskStatus>([
  'open',
  'claimed',
  'in_progress',
  'blocked',
  'review',
  'done',
  'cancelled',
]);
const TASK_KINDS = new Set<TaskKind>(['execution', 'help']);
const TASK_VIEWS = new Set<TaskView>(['board', 'list']);

export function TaskCenter() {
  const language = useAppLanguage();
  const t = useT();
  const pathname = useAppPathname();
  const router = useAppRouter();
  const searchParams = useAppSearchParams();
  const [tasks, setTasks] = React.useState<TeamTask[]>([]);
  const [agents, setAgents] = React.useState<TaskAgent[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [composerOpen, setComposerOpen] = React.useState(false);
  const [blockedTask, setBlockedTask] = React.useState<TeamTask | null>(null);
  const [completingTask, setCompletingTask] = React.useState<TeamTask | null>(null);
  const [blockedReason, setBlockedReason] = React.useState('');
  const [updatingIds, setUpdatingIds] = React.useState<Set<string>>(new Set());
  const noticeTimerRef = React.useRef<number | null>(null);
  const search = searchParams.get('q') || '';
  const statusFilter = readStatusFilter(searchParams.get('status'));
  const kindFilter = readKindFilter(searchParams.get('kind'));
  const requestedAssigneeFilter = readAssigneeFilter(searchParams.get('assignee'));
  const assigneeFilter =
    requestedAssigneeFilter === DEFAULT_ASSIGNEE_FILTER ||
    requestedAssigneeFilter === 'unassigned' ||
    isLoading ||
    agents.some((agent) => agent.id === requestedAssigneeFilter)
      ? requestedAssigneeFilter
      : DEFAULT_ASSIGNEE_FILTER;
  const view = readTaskView(searchParams.get('view'));
  const numberFormatter = React.useMemo(() => new Intl.NumberFormat(language), [language]);

  const replaceTaskParams = React.useCallback(
    (updates: Partial<Record<TaskParamKey, string>>) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates) as Array<[TaskParamKey, string]>) {
        if (isDefaultTaskParam(key, value)) {
          nextParams.delete(key);
        } else {
          nextParams.set(key, value);
        }
      }
      const query = nextParams.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  React.useEffect(() => {
    const currentQuery = searchParams.toString();
    const nextParams = new URLSearchParams(currentQuery);
    const normalizedValues: Record<TaskParamKey, string> = {
      assignee: assigneeFilter,
      kind: kindFilter,
      q: search,
      status: statusFilter,
      view,
    };

    for (const [key, value] of Object.entries(normalizedValues) as Array<
      [TaskParamKey, string]
    >) {
      if (isDefaultTaskParam(key, value)) {
        nextParams.delete(key);
      } else {
        nextParams.set(key, value);
      }
    }

    const normalizedQuery = nextParams.toString();
    if (normalizedQuery !== currentQuery) {
      router.replace(normalizedQuery ? `${pathname}?${normalizedQuery}` : pathname, {
        scroll: false,
      });
    }
  }, [assigneeFilter, kindFilter, pathname, router, search, searchParams, statusFilter, view]);

  const showNotice = React.useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 4000);
  }, []);

  React.useEffect(
    () => () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    },
    []
  );

  const loadData = React.useCallback(async (refresh = false) => {
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const [taskResult, agentResult] = await Promise.all([listTasks(), listTaskAgents()]);
      if (!taskResult.ok) {
        setError(taskResult.error || t('tasks.loadFailed'));
      } else {
        setTasks(sortTasks(taskResult.data));
        if (agentResult.ok) setAgents(agentResult.data);
      }
    } catch {
      setError(t('tasks.loadFailed'));
    } finally {
      if (refresh) {
        setIsRefreshing(false);
      } else {
        setIsLoading(false);
      }
    }
  }, [t]);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredTasks = React.useMemo(() => {
    const needle = search.trim().toLocaleLowerCase(language);
    return tasks.filter((task) => {
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active'
          ? !['done', 'cancelled'].includes(task.status)
          : task.status === statusFilter);
      const matchesKind = kindFilter === 'all' || task.kind === kindFilter;
      const matchesAssignee =
        assigneeFilter === 'all' ||
        (assigneeFilter === 'unassigned'
          ? !task.assigneeId
          : task.assigneeId === assigneeFilter);
      const searchable = [
        task.title,
        task.description,
        task.sourceTitle,
        task.assignee?.name,
        ...task.documents.map((document) => document.title),
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase(language);
      return matchesStatus && matchesKind && matchesAssignee && (!needle || searchable.includes(needle));
    });
  }, [assigneeFilter, kindFilter, language, search, statusFilter, tasks]);

  const stats = React.useMemo(() => {
    const active = tasks.filter((task) => !['done', 'cancelled'].includes(task.status));
    return {
      active: active.length,
      blocked: tasks.filter((task) => task.status === 'blocked').length,
      done: tasks.filter((task) => task.status === 'done').length,
      help: active.filter((task) => task.kind === 'help').length,
      unassigned: active.filter((task) => task.status === 'open' || !task.assigneeId).length,
    };
  }, [tasks]);

  const handleCreated = React.useCallback(
    (task: TeamTask) => {
      setTasks((current) => sortTasks([task, ...current.filter((item) => item.id !== task.id)]));
      replaceTaskParams({
        assignee: DEFAULT_ASSIGNEE_FILTER,
        kind: DEFAULT_KIND_FILTER,
        q: '',
        status: DEFAULT_STATUS_FILTER,
      });
      showNotice(t('tasks.createdNotice'));
    },
    [replaceTaskParams, showNotice, t]
  );

  const commitStatusChange = React.useCallback(
    async (task: TeamTask, status: TaskStatus, reason?: string) => {
      setError(null);
      setUpdatingIds((current) => new Set(current).add(task.id));
      try {
        const result = await updateTask(task.id, {
          ...(status === 'blocked' ? { blockedReason: reason?.trim() } : {}),
          expectedRevision: task.revision,
          ...(task.updatedAt ? { expectedUpdatedAt: task.updatedAt } : {}),
          status,
        });

        if (!result.ok) {
          setError(result.error || t('tasks.updateFailed'));
        } else {
          const updated = result.data || {
            ...task,
            status,
            updatedAt: new Date().toISOString(),
          };
          setTasks((current) =>
            sortTasks(
              current.map((item) =>
                item.id === task.id ? { ...item, ...updated } : item
              )
            )
          );
          showNotice(
            t('tasks.updatedNotice', {
              status: statusLabel(status, t),
              title: task.title,
            })
          );
        }
      } catch {
        setError(t('tasks.updateFailed'));
      } finally {
        setUpdatingIds((current) => {
          const next = new Set(current);
          next.delete(task.id);
          return next;
        });
      }
    },
    [showNotice, t]
  );

  const handleStatusChange = React.useCallback(
    (task: TeamTask, status: TaskStatus) => {
      if (status === 'blocked') {
        setBlockedReason(task.blockedReason || '');
        setBlockedTask(task);
        return;
      }
      if (status === 'done') {
        setCompletingTask(task);
        return;
      }
      return commitStatusChange(task, status);
    },
    [commitStatusChange]
  );

  const resetFilters = React.useCallback(() => {
    replaceTaskParams({
      assignee: DEFAULT_ASSIGNEE_FILTER,
      kind: DEFAULT_KIND_FILTER,
      q: '',
      status: DEFAULT_STATUS_FILTER,
    });
  }, [replaceTaskParams]);
  const hasFilters =
    Boolean(search.trim()) ||
    statusFilter !== 'active' ||
    kindFilter !== 'all' ||
    assigneeFilter !== 'all';

  return (
    <AppShell
      actions={
        <Button data-testid="create-task-button" onClick={() => setComposerOpen(true)} size="sm">
          <Plus aria-hidden="true" />
          {t('tasks.newTask')}
        </Button>
      }
      subtitle={t('tasks.teamwork')}
      title={t('sidebar.teamTasks')}
    >
      <ZoneErrorBoundary zone="task-center">
        <main className="h-full min-w-0 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
            <header>
              <div className="max-w-2xl">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  <Users aria-hidden="true" className="size-3.5" />
                  {t('tasks.teamwork')}
                </div>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                  {t('tasks.centerTitle')}
                </h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t('tasks.centerDescription')}
                </p>
              </div>
            </header>

            <section
              aria-label={t('tasks.overview')}
              className="mt-6 grid grid-cols-2 overflow-hidden rounded-xl border bg-card sm:grid-cols-3 lg:grid-cols-5"
            >
              <Stat icon={<CircleDashed />} label={t('tasks.stat.active')} value={numberFormatter.format(stats.active)} />
              <Stat icon={<Inbox />} label={t('tasks.stat.unassigned')} value={numberFormatter.format(stats.unassigned)} />
              <Stat icon={<CircleHelp />} label={t('tasks.stat.help')} value={numberFormatter.format(stats.help)} />
              <Stat icon={<AlertCircle />} label={t('tasks.stat.blocked')} tone={stats.blocked > 0 ? 'danger' : 'default'} value={numberFormatter.format(stats.blocked)} />
              <Stat className="col-span-2 sm:col-span-1" icon={<CheckCircle2 />} label={t('tasks.stat.done')} value={numberFormatter.format(stats.done)} />
            </section>

            {notice ? <SuccessNotice message={notice} /> : null}
            {error ? (
              <ErrorNotice message={error} onRetry={() => void loadData(true)} />
            ) : null}

            <section aria-label={t('tasks.list')} className="mt-6">
              <TaskFilters
                agents={agents}
                assignee={assigneeFilter}
                kind={kindFilter}
                onAssigneeChange={(value) => replaceTaskParams({ assignee: value })}
                onKindChange={(value) => replaceTaskParams({ kind: value })}
                onRefresh={() => void loadData(true)}
                onSearchChange={(value) => replaceTaskParams({ q: value })}
                onStatusChange={(value) => replaceTaskParams({ status: value })}
                onViewChange={(value) => replaceTaskParams({ view: value })}
                refreshing={isLoading || isRefreshing}
                search={search}
                status={statusFilter}
                view={view}
              />

              <div className="mt-3 flex items-center justify-between px-1 text-xs text-muted-foreground">
                <span aria-atomic="true" aria-live="polite">{isLoading ? t('tasks.syncing') : t('tasks.showingCount', { shown: numberFormatter.format(filteredTasks.length), total: numberFormatter.format(tasks.length) })}</span>
                {hasFilters ? (
                  <Button className="h-7 px-2" onClick={resetFilters} size="xs" type="button" variant="ghost">
                    {t('tasks.clearFilters')}
                  </Button>
                ) : null}
              </div>

              {isLoading ? (
                <LoadingState />
              ) : filteredTasks.length === 0 ? (
                <EmptyState hasFilters={hasFilters} onCreate={() => setComposerOpen(true)} />
              ) : view === 'list' ? (
                <div className="mt-3 space-y-2" data-testid="task-list">
                  {filteredTasks.map((task) => (
                    <TaskCard
                      agents={agents}
                      isUpdating={updatingIds.has(task.id)}
                      key={task.id}
                      onStatusChange={handleStatusChange}
                      task={task}
                    />
                  ))}
                </div>
              ) : (
                <TaskBoard agents={agents} onStatusChange={handleStatusChange} tasks={filteredTasks} updatingIds={updatingIds} />
              )}
            </section>
          </div>
        </main>
        <TaskComposerDialog agents={agents} onCreated={handleCreated} onOpenChange={setComposerOpen} open={composerOpen} />
        <BlockTaskDialog
          onConfirm={() => {
            const task = blockedTask;
            const reason = blockedReason.trim();
            if (!task || !reason) return;
            setBlockedTask(null);
            setBlockedReason('');
            void commitStatusChange(task, 'blocked', reason);
          }}
          onOpenChange={(open) => {
            if (!open) {
              setBlockedTask(null);
              setBlockedReason('');
            }
          }}
          onReasonChange={setBlockedReason}
          open={blockedTask !== null}
          reason={blockedReason}
        />
        <CompleteTaskDialog
          language={language}
          onConfirm={() => {
            const task = completingTask;
            if (!task) return;
            setCompletingTask(null);
            void commitStatusChange(task, 'done');
          }}
          onOpenChange={(open) => {
            if (!open) setCompletingTask(null);
          }}
          task={completingTask}
        />
      </ZoneErrorBoundary>
    </AppShell>
  );
}

function TaskFilters({
  agents, assignee, kind, onAssigneeChange, onKindChange, onRefresh, onSearchChange,
  onStatusChange, onViewChange, refreshing, search, status, view,
}: {
  agents: TaskAgent[]; assignee: string; kind: TaskKind | 'all'; refreshing: boolean;
  search: string; status: StatusFilter; view: TaskView;
  onAssigneeChange: (value: string) => void; onKindChange: (value: TaskKind | 'all') => void;
  onRefresh: () => void; onSearchChange: (value: string) => void;
  onStatusChange: (value: StatusFilter) => void; onViewChange: (value: TaskView) => void;
}) {
  const t = useT();
  const language = useAppLanguage();
  const labels = taskLocalCopy(language);
  return (
    <div aria-label={t('tasks.list')} className="flex flex-col gap-3 rounded-xl border bg-card p-3 lg:flex-row lg:items-center" role="search">
      <div className="relative min-w-0 flex-1">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label={t('tasks.searchPlaceholder')} autoComplete="off" className="border-0 bg-muted/55 pl-9 shadow-none" data-testid="task-search-input" name="q" onChange={(event) => onSearchChange(event.target.value)} placeholder={t('tasks.searchPlaceholder')} type="search" value={search} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex">
        <Select name="status" onValueChange={(value) => onStatusChange(value as StatusFilter)} value={status}>
          <SelectTrigger aria-label={labels.statusFilter} className="w-full lg:w-32" data-testid="task-status-filter" size="sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">{t('tasks.filter.active')}</SelectItem><SelectItem value="all">{t('tasks.filter.allStatuses')}</SelectItem>
            {TASK_STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{t(option.labelKey)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select name="kind" onValueChange={(value) => onKindChange(value as TaskKind | 'all')} value={kind}>
          <SelectTrigger aria-label={labels.kindFilter} className="w-full lg:w-28" data-testid="task-kind-filter" size="sm"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">{t('tasks.filter.allKinds')}</SelectItem><SelectItem value="execution">{t('tasks.kind.execution')}</SelectItem><SelectItem value="help">{t('tasks.kind.help')}</SelectItem></SelectContent>
        </Select>
        <Select name="assignee" onValueChange={onAssigneeChange} value={assignee}>
          <SelectTrigger aria-label={labels.assigneeFilter} className="col-span-2 w-full sm:col-span-1 lg:w-36" data-testid="task-assignee-filter" size="sm"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">{t('tasks.filter.allAssignees')}</SelectItem><SelectItem value="unassigned">{t('tasks.filter.unassigned')}</SelectItem>{agents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-3 lg:border-l lg:border-t-0 lg:pl-3 lg:pt-0">
        <div aria-label={labels.taskView} className="inline-flex rounded-lg bg-muted p-0.5" role="group">
          <Button aria-label={t('tasks.view.list')} aria-pressed={view === 'list'} className="h-7 px-2.5" data-testid="task-view-list" onClick={() => onViewChange('list')} size="sm" variant={view === 'list' ? 'secondary' : 'ghost'}><LayoutList /><span className="hidden sm:inline">{t('tasks.view.listShort')}</span></Button>
          <Button aria-label={t('tasks.view.board')} aria-pressed={view === 'board'} className="h-7 px-2.5" data-testid="task-view-board" onClick={() => onViewChange('board')} size="sm" variant={view === 'board' ? 'secondary' : 'ghost'}><Columns3 /><span className="hidden sm:inline">{t('tasks.view.boardShort')}</span></Button>
        </div>
        <Button aria-busy={refreshing} aria-label={t('tasks.refresh')} disabled={refreshing} onClick={onRefresh} size="icon-sm" variant="ghost"><RefreshCw className={cn(refreshing && 'animate-spin motion-reduce:animate-none')} /></Button>
      </div>
    </div>
  );
}

function TaskBoard({ agents, onStatusChange, tasks, updatingIds }: {
  agents: TaskAgent[]; tasks: TeamTask[]; updatingIds: Set<string>;
  onStatusChange: (task: TeamTask, status: TaskStatus) => void | Promise<void>;
}) {
  const t = useT();
  const language = useAppLanguage();
  const labels = taskLocalCopy(language);
  const numberFormatter = React.useMemo(() => new Intl.NumberFormat(language), [language]);
  return (
    <div
      aria-describedby="task-board-help"
      aria-label={t('tasks.view.board')}
      className="mt-3"
      role="region"
    >
      <div className="flex items-start justify-between gap-3 px-1 pb-2 text-xs text-muted-foreground">
        <p id="task-board-help">
          {labels.boardHelp}
        </p>
      </div>
      <div
        className="overflow-x-auto pb-2 focus-visible:rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={0}
      >
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(4,minmax(18rem,1fr))] sm:snap-x sm:snap-mandatory"
          data-testid="task-board"
        >
        {TASK_BOARD_COLUMNS.map((column) => {
          const columnTasks = tasks.filter((task) => column.statuses.includes(task.status));
          return (
            <section className="min-w-0 rounded-xl bg-muted/35 p-2.5 sm:min-w-[18rem] sm:snap-start" key={column.labelKey}>
              <header className="mb-2.5 flex items-start justify-between gap-2 px-1">
                <div><h2 className="text-sm font-medium">{t(column.labelKey)}</h2><p className="mt-0.5 text-[11px] text-muted-foreground">{t(column.descriptionKey)}</p></div>
                <span className="rounded-full bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground ring-1 ring-border">{numberFormatter.format(columnTasks.length)}</span>
              </header>
              <div className="space-y-2">
                {columnTasks.length ? columnTasks.map((task) => <TaskCard agents={agents} compact isUpdating={updatingIds.has(task.id)} key={task.id} onStatusChange={onStatusChange} task={task} />) : <div className="rounded-lg border border-dashed bg-background/50 px-3 py-8 text-center text-xs text-muted-foreground">{t('tasks.none')}</div>}
              </div>
            </section>
          );
        })}
        </div>
      </div>
    </div>
  );
}

function Stat({ className, icon, label, tone = 'default', value }: { className?: string; icon: React.ReactNode; label: string; tone?: 'danger' | 'default'; value: string }) {
  return <div className={cn('min-w-0 border-b border-r p-3.5 last:border-r-0 sm:p-4 lg:border-b-0', className)}><div className="flex items-center gap-2 text-xs text-muted-foreground [&_svg]:size-3.5"><span aria-hidden="true">{icon}</span><span className="truncate" title={label}>{label}</span></div><div className={cn('mt-2 text-xl font-semibold tabular-nums', tone === 'danger' && value !== '0' && 'text-destructive')}>{value}</div></div>;
}

function SuccessNotice({ message }: { message: string }) {
  return <div aria-atomic="true" className="mt-4 flex min-w-0 items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-300" data-testid="tasks-success" role="status"><CheckCircle2 aria-hidden="true" className="size-4 shrink-0" /><span className="min-w-0 break-words">{message}</span></div>;
}

function ErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT();
  return <div aria-atomic="true" className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" data-testid="tasks-error" role="alert"><span className="inline-flex min-w-0 items-center gap-2"><AlertCircle aria-hidden="true" className="size-4 shrink-0" /><span className="min-w-0 break-words">{message}</span></span><Button className="h-7" onClick={onRetry} size="sm" variant="ghost">{t('chat.retry')}</Button></div>;
}

function LoadingState() {
  const t = useT();
  return <div aria-live="polite" className="mt-3 space-y-2" data-testid="tasks-loading" role="status">{[0, 1, 2].map((item) => <div aria-hidden="true" className="animate-pulse rounded-xl border bg-card p-5 motion-reduce:animate-none" key={item}><div className="h-4 w-2/5 rounded bg-muted" /><div className="mt-3 h-3 w-4/5 rounded bg-muted" /><div className="mt-3 h-3 w-1/3 rounded bg-muted" /></div>)}<span className="sr-only">{t('tasks.loading')}</span></div>;
}

function EmptyState({ hasFilters, onCreate }: { hasFilters: boolean; onCreate: () => void }) {
  const t = useT();
  return <div className="mt-3 rounded-xl border border-dashed bg-muted/15 px-6 py-16 text-center" data-testid="tasks-empty"><div aria-hidden="true" className="mx-auto flex size-11 items-center justify-center rounded-xl bg-muted">{hasFilters ? <Search className="size-5 text-muted-foreground" /> : <Zap className="size-5 text-muted-foreground" />}</div><h2 className="mt-4 text-sm font-semibold">{hasFilters ? t('tasks.empty.filteredTitle') : t('tasks.empty.title')}</h2><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">{hasFilters ? t('tasks.empty.filteredDescription') : t('tasks.empty.description')}</p>{!hasFilters ? <Button className="mt-5" onClick={onCreate} size="sm"><Plus aria-hidden="true" />{t('tasks.newTask')}</Button> : null}</div>;
}

function BlockTaskDialog({
  onConfirm,
  onOpenChange,
  onReasonChange,
  open,
  reason,
}: {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  onReasonChange: (reason: string) => void;
  open: boolean;
  reason: string;
}) {
  const t = useT();
  const reasonId = React.useId();
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('tasks.action.block')}</DialogTitle>
          <DialogDescription>{t('tasks.blockedPrompt')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={reasonId}>{t('tasks.blockedPrompt')}</Label>
            <Textarea
              autoComplete="off"
              className="min-h-24 resize-none"
              id={reasonId}
              maxLength={1000}
              name="blockedReason"
              onChange={(event) => onReasonChange(event.target.value)}
              value={reason}
            />
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
              {t('tasks.composer.cancel')}
            </Button>
            <Button disabled={!reason.trim()} type="submit" variant="destructive">
              {t('tasks.action.block')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function sortTasks(tasks: TeamTask[]) {
  const rank: Record<TaskStatus, number> = { blocked: 0, review: 1, in_progress: 2, claimed: 3, open: 4, done: 5, cancelled: 6 };
  return [...tasks].sort((left, right) => rank[left.status] - rank[right.status] || (right.priority ?? -1) - (left.priority ?? -1) || String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')));
}

function statusLabel(status: TaskStatus, t: ReturnType<typeof useT>) {
  const key = TASK_STATUS_OPTIONS.find((option) => option.value === status)?.labelKey;
  return key ? t(key) : status;
}

function readStatusFilter(value: string | null): StatusFilter {
  if (value === 'active' || value === 'all') return value;
  return value && TASK_STATUSES.has(value as TaskStatus)
    ? (value as TaskStatus)
    : DEFAULT_STATUS_FILTER;
}

function readKindFilter(value: string | null): TaskKind | 'all' {
  if (value === 'all') return value;
  return value && TASK_KINDS.has(value as TaskKind)
    ? (value as TaskKind)
    : DEFAULT_KIND_FILTER;
}

function readAssigneeFilter(value: string | null): string {
  if (!value || value === DEFAULT_ASSIGNEE_FILTER) return DEFAULT_ASSIGNEE_FILTER;
  if (value === 'unassigned') return value;

  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  return value.length <= 200 && value.trim() === value && !hasControlCharacter
    ? value
    : DEFAULT_ASSIGNEE_FILTER;
}

function readTaskView(value: string | null): TaskView {
  return value && TASK_VIEWS.has(value as TaskView)
    ? (value as TaskView)
    : DEFAULT_TASK_VIEW;
}

function isDefaultTaskParam(key: TaskParamKey, value: string): boolean {
  switch (key) {
    case 'assignee':
      return value === DEFAULT_ASSIGNEE_FILTER;
    case 'kind':
      return value === DEFAULT_KIND_FILTER;
    case 'q':
      return value.length === 0;
    case 'status':
      return value === DEFAULT_STATUS_FILTER;
    case 'view':
      return value === DEFAULT_TASK_VIEW;
  }
}
