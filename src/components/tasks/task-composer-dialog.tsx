'use client';

import * as React from 'react';
import { Bot, CalendarDays, CircleHelp, LoaderCircle, Play } from 'lucide-react';

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
import { useT } from '@/components/providers/language-provider';
import { cn } from '@/lib/utils';
import {
  createTask,
  type TaskAgent,
  type TaskKind,
  type TaskPriority,
  type TeamTask,
} from '@/lib/tasks/client';

const UNASSIGNED_VALUE = '__unassigned__';
export type TaskComposerDialogProps = {
  agents?: TaskAgent[];
  defaultKind?: TaskKind;
  onCreated?: (task: TeamTask) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  projectId?: string | null;
  sourceTitle?: string | null;
  workspaceId?: string | null;
};

export function TaskComposerDialog({
  agents = [],
  defaultKind = 'execution',
  onCreated,
  onOpenChange,
  open,
  projectId = null,
  sourceTitle = null,
  workspaceId = null,
}: TaskComposerDialogProps) {
  const t = useT();
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [kind, setKind] = React.useState<TaskKind>(defaultKind);
  const [priority, setPriority] = React.useState<TaskPriority>(1);
  const [assigneeId, setAssigneeId] = React.useState(UNASSIGNED_VALUE);
  const [dueAt, setDueAt] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [titleInvalid, setTitleInvalid] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const titleErrorId = 'task-title-error';
  const submitStatusId = 'task-composer-submit-status';

  const focusTitleInput = React.useCallback(() => {
    const element = document.getElementById('task-title');
    if (element instanceof HTMLInputElement) {
      element.focus();
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setKind(defaultKind);
    setPriority(1);
    setAssigneeId(UNASSIGNED_VALUE);
    setDueAt('');
    setError(null);
    setTitleInvalid(false);
    setIsSubmitting(false);
  }, [defaultKind, open]);

  React.useEffect(() => {
    if (!open || isSubmitting) return;
    focusTitleInput();
  }, [focusTitleInput, isSubmitting, open]);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (isSubmitting && !nextOpen) return;
      onOpenChange(nextOpen);
    },
    [isSubmitting, onOpenChange]
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError(t('tasks.composer.titleRequired'));
      setTitleInvalid(true);
      focusTitleInput();
      return;
    }

    setError(null);
    setTitleInvalid(false);
    setIsSubmitting(true);
    const result = await createTask({
      assigneeId: assigneeId === UNASSIGNED_VALUE ? null : assigneeId,
      assigneeType: assigneeId === UNASSIGNED_VALUE ? null : 'agent',
      description: description.trim(),
      dueAt: dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : null,
      kind,
      priority,
      projectId,
      sourceTitle: sourceTitle?.trim() || null,
      title: cleanTitle,
      workspaceId,
    });

    if (!result.ok) {
      setError(result.error || t('tasks.composer.createFailed'));
      setIsSubmitting(false);
      return;
    }

    try {
      await onCreated?.(result.data);
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-[620px]"
        data-testid="task-composer-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t('tasks.composer.title')}</DialogTitle>
          <DialogDescription>
            {t('tasks.composer.description')}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-5" onSubmit={handleSubmit}>
          {sourceTitle ? (
            <div
              className="rounded-lg border bg-muted/35 px-3 py-2.5 text-sm [overflow-wrap:anywhere]"
              title={sourceTitle}
            >
              <span className="text-muted-foreground">{t('tasks.composer.linkedDocument')}</span>
              <span className="ml-2 font-medium">{sourceTitle}</span>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="task-title">{t('tasks.composer.taskTitle')}</Label>
            <Input
              aria-describedby={titleInvalid ? titleErrorId : undefined}
              aria-invalid={titleInvalid ? true : undefined}
              autoCapitalize="sentences"
              autoComplete="off"
              data-testid="task-title-input"
              disabled={isSubmitting}
              id="task-title"
              maxLength={160}
              name="title"
              onChange={(event) => {
                setTitle(event.target.value);
                if (titleInvalid && event.target.value.trim()) {
                  setTitleInvalid(false);
                  setError(null);
                }
              }}
              placeholder={t('tasks.composer.titlePlaceholder')}
              value={title}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-description">{t('tasks.composer.details')}</Label>
            <Textarea
              className="min-h-24 resize-none"
              data-testid="task-description-input"
              disabled={isSubmitting}
              id="task-description"
              maxLength={2000}
              name="description"
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('tasks.composer.detailsPlaceholder')}
              value={description}
            />
          </div>

          <fieldset
            aria-describedby="task-kind-help"
            className="space-y-2"
            disabled={isSubmitting}
          >
            <legend className="text-sm font-medium">{t('tasks.composer.kind')}</legend>
            <p className="sr-only" id="task-kind-help">
              {t('tasks.composer.description')}
            </p>
            <div className="grid gap-2 sm:grid-cols-2" data-testid="task-kind-select">
              <KindOption
                active={kind === 'execution'}
                description={t('tasks.composer.executionDescription')}
                icon={<Play />}
                label={t('tasks.kind.execution')}
                onClick={() => setKind('execution')}
              />
              <KindOption
                active={kind === 'help'}
                description={t('tasks.composer.helpDescription')}
                icon={<CircleHelp />}
                label={t('tasks.kind.help')}
                onClick={() => setKind('help')}
              />
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="task-priority">{t('tasks.composer.priority')}</Label>
              <Select
                disabled={isSubmitting}
                onValueChange={(value) => setPriority(Number(value) as TaskPriority)}
                value={String(priority)}
              >
                <SelectTrigger
                  aria-label={t('tasks.composer.priority')}
                  className="w-full"
                  data-testid="task-priority-select"
                  id="task-priority"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {([0, 1, 2, 3] as TaskPriority[]).map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {t((['tasks.priority.lowShort', 'tasks.priority.normalShort', 'tasks.priority.highShort', 'tasks.priority.urgent'] as const)[value])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-assignee">{t('tasks.composer.assignee')}</Label>
              <Select
                disabled={isSubmitting}
                onValueChange={setAssigneeId}
                value={assigneeId}
              >
                <SelectTrigger
                  aria-label={t('tasks.composer.assignee')}
                  className="w-full"
                  data-testid="task-assignee-select"
                  id="task-assignee"
                >
                  <SelectValue placeholder={t('tasks.composer.unassigned')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED_VALUE}>{t('tasks.composer.unassigned')}</SelectItem>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      <Bot aria-hidden="true" className="size-3.5" />
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-due-at">{t('tasks.composer.dueDate')}</Label>
            <div className="relative">
              <CalendarDays
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="pl-9"
                data-testid="task-due-input"
                disabled={isSubmitting}
                id="task-due-at"
                min={new Date().toISOString().slice(0, 10)}
                name="dueAt"
                onChange={(event) => setDueAt(event.target.value)}
                type="date"
                value={dueAt}
              />
            </div>
          </div>

          {error ? (
            <div
              aria-live="assertive"
              className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              id={titleErrorId}
              role="alert"
            >
              {error}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              disabled={isSubmitting}
              onClick={() => handleOpenChange(false)}
              type="button"
              variant="ghost"
            >
              {t('tasks.composer.cancel')}
            </Button>
            <Button
              data-testid="task-create-submit"
              disabled={isSubmitting || !title.trim()}
              aria-describedby={isSubmitting ? submitStatusId : undefined}
              type="submit"
            >
              {isSubmitting ? (
                <>
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                  />
                  {t('tasks.composer.creating')}
                </>
              ) : (
                t('tasks.composer.create')
              )}
            </Button>
          </DialogFooter>
          <p aria-atomic="true" aria-live="polite" className="sr-only" id={submitStatusId} role="status">
            {isSubmitting ? t('tasks.composer.creating') : ''}
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function KindOption({
  active,
  description,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  description: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active
          ? 'border-foreground/30 bg-foreground/[0.04] ring-1 ring-foreground/10'
          : 'hover:bg-muted/60'
      )}
      title={label}
      onClick={onClick}
      type="button"
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4',
          active ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}
