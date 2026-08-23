'use client';

import * as React from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle, RefreshCw, Server } from 'lucide-react';
import Link from 'next/link';

import { useT } from '@/components/providers/language-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  createExecutionIdempotencyKey,
  createExecutionJob,
  getExecutionJob,
  listExecutionRuntimes,
  type ExecutionLaunch,
  type ExecutionRuntime,
  type RuntimeSelection,
} from '@/lib/execution/client';
import { cn } from '@/lib/utils';

const AUTO_RUNTIME = '__auto__';

export type ExecutionJobDialogProps = {
  alignedVersionId?: string | null;
  alignmentError?: string | null;
  conversationId?: string | null;
  documentVersionId?: string | null;
  isAligning?: boolean;
  onAlign: () => Promise<void> | void;
  onCreateVersion: () => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  projectId?: string | null;
  sourceTitle?: string | null;
  workspaceId: string;
};

export function ExecutionJobDialog({
  alignedVersionId = null,
  alignmentError = null,
  conversationId = null,
  documentVersionId = null,
  isAligning = false,
  onAlign,
  onCreateVersion,
  onOpenChange,
  open,
  projectId = null,
  sourceTitle = null,
  workspaceId,
}: ExecutionJobDialogProps) {
  const t = useT();
  const aligned = Boolean(
    documentVersionId && alignedVersionId === documentVersionId
  );
  const initialGoal = sourceTitle?.trim() || '';
  const [goal, setGoal] = React.useState('');
  const [runtimeValue, setRuntimeValue] = React.useState(AUTO_RUNTIME);
  const [runtimes, setRuntimes] = React.useState<ExecutionRuntime[]>([]);
  const [isLoadingRuntimes, setIsLoadingRuntimes] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [runtimeError, setRuntimeError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [goalInvalid, setGoalInvalid] = React.useState(false);
  const [launch, setLaunch] = React.useState<ExecutionLaunch | null>(null);
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = React.useState(false);
  const idempotencyKeyRef = React.useRef(createExecutionIdempotencyKey());
  const refreshRequestRef = React.useRef(0);
  const submitRequestRef = React.useRef(0);
  const goalHintId = React.useId();
  const runtimeStatusId = React.useId();
  const goalErrorId = React.useId();

  React.useEffect(() => {
    if (!open) return;

    let active = true;
    setGoal(initialGoal);
    setRuntimeValue(AUTO_RUNTIME);
    setRuntimes([]);
    setRuntimeError(null);
    setError(null);
    setGoalInvalid(false);
    setLaunch(null);
    setDiscardConfirmationOpen(false);
    setIsSubmitting(false);
    setIsRefreshing(false);
    setIsLoadingRuntimes(true);
    refreshRequestRef.current += 1;
    submitRequestRef.current += 1;
    idempotencyKeyRef.current = createExecutionIdempotencyKey();

    void listExecutionRuntimes().then((result) => {
      if (!active) return;
      setIsLoadingRuntimes(false);
      if (result.ok) {
        setRuntimes(result.data);
      } else {
        setRuntimeError(result.error || t('execution.runtimeLoadFailed'));
      }
    });

    return () => {
      active = false;
    };
  }, [
    conversationId,
    documentVersionId,
    open,
    projectId,
    sourceTitle,
    t,
    workspaceId,
    initialGoal,
  ]);

  const isDirty = !launch && (goal !== initialGoal || runtimeValue !== AUTO_RUNTIME);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        onOpenChange(true);
        return;
      }
      if (isSubmitting) return;
      if (isDirty) {
        setDiscardConfirmationOpen(true);
        return;
      }
      onOpenChange(nextOpen);
    },
    [isDirty, isSubmitting, onOpenChange]
  );

  const discardAndClose = React.useCallback(() => {
    setDiscardConfirmationOpen(false);
    onOpenChange(false);
  }, [onOpenChange]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!documentVersionId || !aligned) {
      setError(t('execution.alignmentRequired'));
      return;
    }
    const cleanGoal = goal.trim();
    if (!cleanGoal) {
      setError(t('execution.goalRequired'));
      setGoalInvalid(true);
      return;
    }

    const runtimeSelection: RuntimeSelection =
      runtimeValue === AUTO_RUNTIME
        ? { mode: 'auto' }
        : { mode: 'explicit', runtimeId: runtimeValue };

    setError(null);
    setGoalInvalid(false);
    setIsSubmitting(true);
    const requestId = ++submitRequestRef.current;
    const result = await createExecutionJob(
      {
        conversationId,
        documentVersionId,
        goal: cleanGoal,
        kind: 'coding',
        projectId,
        requirements: {},
        runtimeSelection,
        workspaceId,
      },
      idempotencyKeyRef.current
    );
    if (submitRequestRef.current !== requestId) return;
    setIsSubmitting(false);

    if (!result.ok) {
      setError(result.error || t('execution.createFailed'));
      return;
    }
    setLaunch(result.data);
  };

  const handleRefresh = async () => {
    if (!launch) return;
    const jobId = launch.job.id;
    const requestId = ++refreshRequestRef.current;
    setError(null);
    setIsRefreshing(true);
    const result = await getExecutionJob(jobId);
    if (refreshRequestRef.current !== requestId) return;
    setIsRefreshing(false);
    if (!result.ok) {
      setError(result.error || t('execution.refreshFailed'));
      return;
    }

    setLaunch((current) => {
      if (!current || current.job.id !== jobId) return current;
      return {
        job: result.data,
        receipt: current.receipt,
      };
    });
  };

  const resetComposer = () => {
    refreshRequestRef.current += 1;
    submitRequestRef.current += 1;
    setLaunch(null);
    setError(null);
    setRuntimeValue(AUTO_RUNTIME);
    idempotencyKeyRef.current = createExecutionIdempotencyKey();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-[560px]"
          data-testid="workspace-execution-dialog"
        >
          {launch ? (
            <ExecutionResult
              error={error}
              isRefreshing={isRefreshing}
              launch={launch}
              onClose={() => handleOpenChange(false)}
              onRefresh={() => void handleRefresh()}
              onStartAnother={resetComposer}
              runtimes={runtimes}
            />
          ) : (
            <>
            <DialogHeader>
              <DialogTitle>{t('execution.title')}</DialogTitle>
              <DialogDescription>{t('execution.description')}</DialogDescription>
            </DialogHeader>

            <form aria-describedby={`${goalHintId} ${runtimeStatusId}`} className="space-y-5" onSubmit={handleSubmit}>
              {sourceTitle ? (
                <div className="break-words rounded-lg border bg-muted/30 px-3 py-2.5 text-sm [overflow-wrap:anywhere]">
                  <span className="text-muted-foreground">
                    {t('execution.document')}
                  </span>
                  <span className="ml-2 font-medium">{sourceTitle}</span>
                </div>
              ) : null}

              <div
                aria-live="polite"
                className={cn(
                  'rounded-lg border px-3 py-3 text-sm [overflow-wrap:anywhere]',
                  aligned && documentVersionId
                    ? 'border-emerald-500/25 bg-emerald-500/5'
                    : 'border-amber-500/25 bg-amber-500/5'
                )}
                data-testid="workspace-execution-alignment"
                role="status"
              >
                <div className="flex items-start gap-2">
                  {aligned && documentVersionId ? (
                    <CheckCircle2
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-emerald-600"
                    />
                  ) : (
                    <CircleAlert
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-amber-600"
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium">
                      {!documentVersionId
                        ? t('execution.draftNotExecutable')
                        : aligned
                          ? t('execution.aligned')
                          : t('execution.notAligned')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {!documentVersionId
                        ? t('execution.draftRequiresVersion')
                        : aligned
                          ? t('execution.alignedHint')
                          : t('execution.alignVersionHint')}
                    </p>
                    {!documentVersionId ? (
                      <Button
                        className="mt-2 w-full sm:w-auto"
                        data-testid="workspace-execution-create-version"
                        disabled={isSubmitting}
                        onClick={() => void onCreateVersion()}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {t('execution.createVersion')}
                      </Button>
                    ) : !aligned ? (
                      <Button
                        aria-busy={isAligning}
                        className="mt-2 w-full sm:w-auto"
                        data-testid="workspace-execution-align-version"
                        disabled={isSubmitting || isAligning}
                        onClick={() => void onAlign()}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {isAligning ? (
                          <>
                            <LoaderCircle
                              aria-hidden="true"
                              className="animate-spin motion-reduce:animate-none"
                            />
                            {t('execution.aligning')}
                          </>
                        ) : (
                          t('execution.alignVersion')
                        )}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {alignmentError ? (
                  <p className="mt-2 text-xs text-destructive" role="alert">
                    {alignmentError}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="execution-goal">{t('execution.goal')}</Label>
                <Textarea
                  aria-describedby={goalInvalid ? `${goalHintId} ${goalErrorId}` : goalHintId}
                  aria-invalid={goalInvalid ? true : undefined}
                  autoComplete="off"
                  className="min-h-28 resize-none"
                  data-testid="workspace-execution-goal-input"
                  disabled={isSubmitting}
                  id="execution-goal"
                  maxLength={2000}
                  name="goal"
                  onChange={(event) => {
                    setGoal(event.target.value);
                    if (goalInvalid && event.target.value.trim()) {
                      setGoalInvalid(false);
                      setError(null);
                    }
                  }}
                  placeholder={t('execution.goalPlaceholder')}
                  value={goal}
                />
                <p className="text-xs text-muted-foreground" id={goalHintId}>
                  {t('execution.snapshotHint')}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="execution-runtime">{t('execution.runtime')}</Label>
                <Select
                  disabled={isSubmitting}
                  name="runtime"
                  onValueChange={setRuntimeValue}
                  value={runtimeValue}
                >
                  <SelectTrigger
                    className="w-full"
                    data-testid="workspace-execution-runtime-select"
                    id="execution-runtime"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO_RUNTIME}>
                      {t('execution.runtimeAuto')}
                    </SelectItem>
                    {runtimes.map((runtime) => (
                      <SelectItem
                        disabled={!isRuntimeSelectable(runtime)}
                        key={runtime.id}
                        value={runtime.id}
                      >
                        {runtime.name}
                        {runtime.healthState ? ` · ${runtime.healthState}` : ''}
                        {!supportsCoding(runtime) ? ' · coding unsupported' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {runtimeError ? (
                  <p className="text-xs text-destructive" id={runtimeStatusId} role="alert">
                    {runtimeError || t('execution.runtimeLoadFailed')}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground" id={runtimeStatusId} aria-live="polite" role="status">
                    {isLoadingRuntimes
                      ? t('execution.loadingRuntimes')
                      : runtimes.length === 0
                        ? t('execution.noRuntimes')
                        : t('execution.runtimeHint')}
                  </p>
                )}
              </div>

              {error ? (
                <div
                  className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  id={goalErrorId}
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
                  {t('common.cancel')}
                </Button>
                <Button
                  data-testid="workspace-execution-submit"
                  disabled={
                    isSubmitting ||
                    isAligning ||
                    !goal.trim() ||
                    !documentVersionId ||
                    !aligned
                  }
                  type="submit"
                >
                  {isSubmitting ? (
                    <>
                      <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
                      {t('execution.starting')}
                    </>
                  ) : (
                    t('execution.start')
                  )}
                </Button>
              </DialogFooter>
            </form>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={discardConfirmationOpen} onOpenChange={setDiscardConfirmationOpen}>
        <DialogContent className="sm:max-w-md" data-testid="workspace-execution-discard-confirmation">
          <DialogHeader>
            <DialogTitle>Discard execution changes?</DialogTitle>
            <DialogDescription>
              Your edited goal or runtime selection will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setDiscardConfirmationOpen(false)} type="button" variant="ghost">Keep editing</Button>
            <Button onClick={discardAndClose} type="button" variant="destructive">Discard changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ExecutionResult({
  error,
  isRefreshing,
  launch,
  onClose,
  onRefresh,
  onStartAnother,
  runtimes,
}: {
  error: string | null;
  isRefreshing: boolean;
  launch: ExecutionLaunch;
  onClose: () => void;
  onRefresh: () => void;
  onStartAnother: () => void;
  runtimes: ExecutionRuntime[];
}) {
  const t = useT();
  const blocked = launch.receipt.blocked;
  const runtimeId = launch.job.selectedRuntimeId || launch.receipt.selectedRuntimeId;
  const runtime =
    launch.job.selectedRuntime || runtimes.find((candidate) => candidate.id === runtimeId);
  const runtimeLabel = runtime?.name || runtimeId || t('execution.runtimePending');
  const selectionReason =
    launch.job.selectionReason ||
    launch.receipt.selectionReason ||
    t('execution.notProvided');

  return (
    <>
      <DialogHeader>
        <div
          className={cn(
            'mb-1 flex size-10 items-center justify-center rounded-full',
            blocked
              ? 'bg-destructive/10 text-destructive'
              : 'bg-emerald-500/10 text-emerald-600'
          )}
        >
          {blocked ? <CircleAlert aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
        </div>
        <DialogTitle>
          {blocked ? t('execution.blockedTitle') : t('execution.acceptedTitle')}
        </DialogTitle>
        <DialogDescription>
          {blocked
            ? t('execution.blockedDescription')
            : t('execution.acceptedDescription')}
        </DialogDescription>
      </DialogHeader>

      <div
        className="divide-y rounded-lg border bg-muted/15"
        data-testid="workspace-execution-result"
        aria-live="polite"
        role="status"
      >
        <ResultRow
          label={t('execution.receipt')}
          testId="workspace-execution-receipt"
          value={
            <span className="inline-flex items-center gap-2">
              <Badge variant={blocked ? 'destructive' : 'secondary'}>
                {blocked
                  ? t('execution.receiptBlocked')
                  : t('execution.receiptAccepted')}
              </Badge>
              {launch.receipt.id ? (
                <span className="font-mono text-xs text-muted-foreground">
                  {launch.receipt.id}
                </span>
              ) : null}
            </span>
          }
        />
        <ResultRow
          label={t('execution.jobId')}
          testId="workspace-execution-job-id"
          value={launch.job.id}
          mono
        />
        <ResultRow
          label={t('execution.status')}
          testId="workspace-execution-status"
          value={
            <Badge variant={blocked ? 'destructive' : 'secondary'}>
              {launch.job.status}
            </Badge>
          }
        />
        <ResultRow
          label={t('execution.selectedRuntime')}
          testId="workspace-execution-selected-runtime"
          value={
            <span className="inline-flex items-center gap-1.5">
              <Server aria-hidden="true" className="size-3.5 text-muted-foreground" />
              {runtimeLabel}
            </span>
          }
        />
        <ResultRow
          label={t('execution.selectionReason')}
          testId="workspace-execution-selection-reason"
          value={selectionReason}
        />
      </div>

      {launch.receipt.reason ? (
        <div
          className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {launch.receipt.reason}
        </div>
      ) : null}
      {error ? (
        <div
          className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <DialogFooter>
        <Button asChild variant="outline">
          <Link href={`/jobs/${encodeURIComponent(launch.job.id)}`} onClick={onClose}>View job</Link>
        </Button>
        <Button onClick={onStartAnother} type="button" variant="ghost">
          {t('execution.startAnother')}
        </Button>
        <Button
          data-testid="workspace-execution-refresh"
          aria-busy={isRefreshing}
          disabled={isRefreshing}
          onClick={onRefresh}
          type="button"
          variant="outline"
        >
          <RefreshCw aria-hidden="true" className={cn(isRefreshing && 'animate-spin motion-reduce:animate-none')} />
          {isRefreshing ? t('execution.refreshing') : t('execution.refresh')}
        </Button>
        <Button onClick={onClose} type="button">
          {t('execution.close')}
        </Button>
      </DialogFooter>
    </>
  );
}

function ResultRow({
  label,
  mono = false,
  testId,
  value,
}: {
  label: string;
  mono?: boolean;
  testId?: string;
  value: React.ReactNode;
}) {
  return (
    <div
      className="grid gap-1 px-3 py-2.5 text-sm sm:grid-cols-[9rem_1fr]"
      data-testid={testId}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 break-all font-medium', mono && 'font-mono text-xs')}>
        {value}
      </span>
    </div>
  );
}

function isRuntimeSelectable(runtime: ExecutionRuntime) {
  const health = runtime.healthState?.toLowerCase();
  return (
    runtime.enabled &&
    runtime.acceptingNewAttempts !== false &&
    runtime.availableSlots !== 0 &&
    health !== 'offline' &&
    health !== 'unhealthy' &&
    supportsCoding(runtime)
  );
}

function supportsCoding(runtime: ExecutionRuntime) {
  return runtime.capabilities?.kinds.includes('coding') === true;
}
