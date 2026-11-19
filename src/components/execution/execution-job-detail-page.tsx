'use client';

import * as React from 'react';
import { AlertCircle, ArrowLeft, ExternalLink, FileJson, LoaderCircle, RefreshCw, StopCircle } from 'lucide-react';
import Link from 'next/link';

import { AppShell } from '@/components/layout/app-shell';
import { useT } from '@/components/providers/language-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAppRouter, useAppSearchParams } from '@/lib/app-router';
import {
  answerExecutionInputRequest,
  cancelExecutionJob,
  getExecutionArtifactContent,
  getExecutionJobDetail,
  listExecutionArtifacts,
  listExecutionEvents,
  listExecutionLogs,
  type ExecutionArtifact,
  type ExecutionJobDetail,
  type ExecutionLog,
  type ExecutionPageInfo,
  type JsonValue,
} from '@/lib/execution/client';
import { formatStableDateTime } from '@/lib/time';

import { ExecutionRecoveryPanel } from './execution-recovery-panel';
import { canCancelExecution, ExecutionStatusBadge } from './execution-status';

const DETAIL_TABS = ['events', 'logs', 'attempts', 'artifacts'] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

export function ExecutionJobDetailPage({ jobId }: { jobId: string }) {
  const t = useT();
  const tRef = React.useRef(t);
  React.useEffect(() => {
    tRef.current = t;
  }, [t]);
  const router = useAppRouter();
  const searchParams = useAppSearchParams();
  const [detail, setDetail] = React.useState<ExecutionJobDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [cancelConfirmationOpen, setCancelConfirmationOpen] = React.useState(false);
  const detailStatusId = React.useId();
  const requestedTab = searchParams.get('tab');
  const activeTab: DetailTab = isDetailTab(requestedTab) ? requestedTab : 'events';
  const revision = getRevision(detail);
  const missingRevisionMessage = t('jobs.missingRevision');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getExecutionJobDetail(jobId);
      if (result.ok) setDetail(result.data);
      else setError(result.error);
    } catch {
      setError(tRef.current('jobs.detailLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  React.useEffect(() => { void load(); }, [load]);

  const cancel = async () => {
    if (revision === null) {
      setCancelConfirmationOpen(false);
      setError(missingRevisionMessage);
      return;
    }
    setBusy('cancel');
    setError(null);
    try {
      const result = await cancelExecutionJob(jobId, revision);
      setCancelConfirmationOpen(false);
      if (!result.ok) {
        setError(result.error);
      } else {
        await load();
      }
    } catch {
      setError(t('jobs.cancelFailed'));
    } finally {
      setBusy(null);
    }
  };

  const selectTab = (nextValue: string) => {
    if (!isDetailTab(nextValue)) return;
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.set('tab', nextValue);
    router.replace(
      `/jobs/${encodeURIComponent(jobId)}?${nextSearchParams.toString()}`,
      { scroll: false }
    );
  };

  return (
    <>
      <AppShell
        actions={detail && canCancelExecution(detail.job.status) ? (
          <Button
            disabled={busy !== null || revision === null}
            onClick={() => setCancelConfirmationOpen(true)}
            size="sm"
            title={revision === null ? missingRevisionMessage : undefined}
            variant="destructive"
          >
            <StopCircle aria-hidden="true" /> {t('jobs.cancel')}
          </Button>
        ) : null}
        subtitle={t('jobs.detailSubtitle')}
        title={detail?.job.goal || t('jobs.detailTitleFallback')}
      >
        <main className="h-full overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
            <p aria-live="polite" className="sr-only" id={detailStatusId} role="status">
              {loading && !detail
                ? t('jobs.liveLoading')
                : busy === 'cancel'
                  ? t('jobs.liveCancelling')
                  : busy
                    ? t('jobs.liveSubmittingInput')
                    : detail
                      ? t('jobs.liveStatus', {
                          id: detail.job.id,
                          status: detail.job.status.replaceAll('_', ' '),
                        })
                      : t('jobs.liveUnavailable')}
            </p>
            <div className="flex items-center justify-between gap-3">
              <Button asChild variant="ghost"><Link href="/jobs"><ArrowLeft aria-hidden="true" /> {t('jobs.allJobs')}</Link></Button>
              <Button aria-busy={loading} disabled={loading} onClick={() => void load()} variant="outline"><RefreshCw aria-hidden="true" className={loading ? 'animate-spin motion-reduce:animate-none' : ''} /> {t('jobs.refresh')}</Button>
            </div>

            {error ? <ErrorNotice message={error} /> : null}
            {detail && revision === null && error !== missingRevisionMessage ? (
              <ErrorNotice message={missingRevisionMessage} />
            ) : null}
            {loading && !detail ? (
              <div aria-live="polite" className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground" role="status"><LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> {t('jobs.loadingDetail')}</div>
            ) : detail ? (
              <div className="mt-5 min-w-0 space-y-5" data-testid="execution-job-detail">
                <JobOverview detail={detail} />
                <InputRequests detail={detail} onChange={setDetail} setBusy={setBusy} setError={setError} busy={busy} />
                <ExecutionRecoveryPanel
                  jobId={detail.job.id}
                  onActionRequested={load}
                />
                <Tabs className="min-w-0" onValueChange={selectTab} value={activeTab}>
                  <div className="overflow-x-auto pb-1">
                    <TabsList aria-label={t('jobs.sectionsAria')}>
                      <TabsTrigger value="events">{t('jobs.tabEvents', { count: detail.events.items.length })}</TabsTrigger>
                      <TabsTrigger data-testid="execution-job-logs-tab" value="logs">{t('jobs.tabLogs')}</TabsTrigger>
                      <TabsTrigger value="attempts">{t('jobs.tabAttempts', { count: detail.job.attempts?.length || 0 })}</TabsTrigger>
                      <TabsTrigger value="artifacts">{t('jobs.tabArtifacts', { count: detail.artifacts.items.length })}</TabsTrigger>
                    </TabsList>
                  </div>
                  <TabsContent value="events"><EventsPanel detail={detail} setDetail={setDetail} setError={setError} /></TabsContent>
                  <TabsContent value="logs"><LogsPanel jobId={detail.job.id} /></TabsContent>
                  <TabsContent value="attempts"><AttemptsPanel detail={detail} /></TabsContent>
                  <TabsContent value="artifacts"><ArtifactsPanel detail={detail} setDetail={setDetail} setError={setError} /></TabsContent>
                </Tabs>
              </div>
            ) : null}
          </div>
        </main>
      </AppShell>
      <Dialog open={cancelConfirmationOpen} onOpenChange={(nextOpen) => busy === null && setCancelConfirmationOpen(nextOpen)}>
        <DialogContent className="sm:max-w-md" data-testid="execution-cancel-confirmation">
          <DialogHeader>
            <DialogTitle>{t('jobs.cancelDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('jobs.cancelDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={busy !== null} onClick={() => setCancelConfirmationOpen(false)} type="button" variant="ghost">{t('jobs.keepRunning')}</Button>
            <Button aria-busy={busy === 'cancel'} disabled={busy !== null} onClick={() => void cancel()} type="button" variant="destructive">
              {busy === 'cancel' ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <StopCircle aria-hidden="true" />}
              {busy === 'cancel' ? t('jobs.cancelling') : t('jobs.cancelJob')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function JobOverview({ detail }: { detail: ExecutionJobDetail }) {
  const t = useT();
  const job = detail.job;
  return (
    <Card className="gap-4">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2"><ExecutionStatusBadge status={job.status} /><Badge variant="outline">{job.kind}</Badge></div>
        <CardTitle className="break-words text-xl [overflow-wrap:anywhere]">{job.goal}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Meta label={t('jobs.metaJobId')} mono value={job.id} />
        <Meta label={t('jobs.metaRuntime')} value={job.selectedRuntimeId || t('jobs.metaPending')} />
        <Meta label={t('jobs.metaQueued')} value={formatStableDateTime(job.queuedAt)} />
        <Meta label={t('jobs.metaUpdated')} value={formatStableDateTime(job.updatedAt)} />
        <Meta label={t('jobs.metaRevision')} value={getRevision(detail)?.toString() || t('jobs.metaUnavailable')} />
        <Meta label={t('jobs.metaAttempts')} value={`${job.attempts?.length ?? 0}/${job.maxAttempts ?? 1}`} />
        <Meta label={t('jobs.metaStarted')} value={formatStableDateTime(job.startedAt)} />
        <Meta label={t('jobs.metaFinished')} value={formatStableDateTime(job.finishedAt)} />
      </CardContent>
      {(job.result !== null && job.result !== undefined) || (job.error !== null && job.error !== undefined) ? (
        <CardContent className="grid gap-3 border-t pt-5 md:grid-cols-2">
          {job.result !== null && job.result !== undefined ? <JsonBlock label={t('jobs.jsonResult')} value={job.result} /> : null}
          {job.error !== null && job.error !== undefined ? <JsonBlock label={t('jobs.jsonError')} value={job.error} /> : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

function InputRequests({ detail, onChange, setBusy, setError, busy }: {
  detail: ExecutionJobDetail;
  onChange: React.Dispatch<React.SetStateAction<ExecutionJobDetail | null>>;
  setBusy: (value: string | null) => void;
  setError: (value: string | null) => void;
  busy: string | null;
}) {
  const t = useT();
  const pending = detail.inputRequests.items.filter((request) => request.status === 'pending');
  const revision = getRevision(detail);
  if (pending.length === 0) return null;
  return (
    <section aria-label={t('jobs.inputRequestsAria')} className="space-y-3">
      {pending.map((request) => (
        <InputRequestCard
          busy={busy !== null}
          disabled={revision === null}
          key={request.id}
          onAnswer={async (response) => {
            if (revision === null) {
              setError(t('jobs.missingRevision'));
              return;
            }
            setBusy(request.id);
            setError(null);
            try {
              const result = await answerExecutionInputRequest(
                detail.job.id,
                request,
                revision,
                response
              );
              if (result.ok) onChange(result.data);
              else setError(result.error);
            } catch {
              setError(t('jobs.inputSubmitFailed'));
            } finally {
              setBusy(null);
            }
          }}
          prompt={request.prompt}
        />
      ))}
    </section>
  );
}

function InputRequestCard({ busy, disabled, onAnswer, prompt }: { busy: boolean; disabled: boolean; onAnswer: (response: JsonValue) => Promise<void>; prompt: string }) {
  const t = useT();
  const [answer, setAnswer] = React.useState('');
  const promptId = React.useId();
  const hintId = React.useId();
  const submitAnswer = () => {
    const response = answer.trim();
    if (busy || disabled || !response) return;
    void onAnswer(response);
  };
  return (
    <Card className="gap-4 border-amber-500/30 bg-amber-500/5" data-testid="execution-input-request">
      <CardHeader>
        <CardTitle className="text-base">{t('jobs.inputRequiredTitle')}</CardTitle>
        <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]" id={promptId}>{prompt}</p>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            submitAnswer();
          }}
        >
          <Textarea
            aria-describedby={`${promptId} ${hintId}`}
            aria-label={t('jobs.inputAnswerAria')}
            autoComplete="off"
            disabled={busy || disabled}
            name="answer"
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submitAnswer();
              }
            }}
            placeholder={t('jobs.inputAnswerPlaceholder')}
            value={answer}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground" id={hintId}>
              {t('jobs.inputAnswerHint')}
            </p>
            <Button aria-busy={busy} disabled={busy || disabled || !answer.trim()} type="submit">
              {busy ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null} {t('jobs.resumeJob')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function EventsPanel({ detail, setDetail, setError }: { detail: ExecutionJobDetail; setDetail: React.Dispatch<React.SetStateAction<ExecutionJobDetail | null>>; setError: (value: string | null) => void }) {
  const t = useT();
  const [loading, setLoading] = React.useState(false);
  const loadMore = async () => {
    const cursor = detail.events.pageInfo.nextCursor;
    if (!cursor) return;
    setLoading(true);
    try {
      const result = await listExecutionEvents(detail.job.id, cursor);
      if (!result.ok) setError(result.error);
      else setDetail((current) => current ? ({ ...current, events: { items: [...current.events.items, ...result.data.items], pageInfo: result.data.pageInfo } }) : current);
    } catch {
      setError(t('jobs.eventsMoreFailed'));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Card aria-busy={loading} className="gap-0 overflow-hidden py-0">
      <div className="divide-y">
        {detail.events.items.length === 0 ? <Empty text={t('jobs.eventsEmpty')} /> : detail.events.items.map((event) => (
          <div className="grid gap-3 p-4 sm:grid-cols-[6rem_11rem_1fr]" key={event.id}>
            <span className="font-mono text-xs text-muted-foreground">#{event.sequence}</span>
            <div><Badge variant="outline">{event.type}</Badge><div className="mt-1 text-xs text-muted-foreground">{formatStableDateTime(event.occurredAt)}</div></div>
            {event.payloadValid ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">{pretty(event.payload)}</pre> : <span className="text-sm text-destructive">{t('jobs.invalidPayload')}</span>}
          </div>
        ))}
      </div>
      {detail.events.pageInfo.hasNextPage ? <div className="border-t p-3 text-center"><Button aria-busy={loading} disabled={loading} onClick={() => void loadMore()} variant="outline">{loading ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null} {t('jobs.loadMoreEvents')}</Button></div> : null}
    </Card>
  );
}

function LogsPanel({ jobId }: { jobId: string }) {
  const t = useT();
  const tRef = React.useRef(t);
  React.useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [items, setItems] = React.useState<ExecutionLog[]>([]);
  const [pageInfo, setPageInfo] = React.useState<ExecutionPageInfo>({
    hasNextPage: false,
    nextCursor: null,
  });
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadInitial = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listExecutionLogs(jobId);
      if (result.ok) {
        setItems(result.data.items);
        setPageInfo(result.data.pageInfo);
      } else {
        setError(result.error);
      }
    } catch {
      setError(tRef.current('jobs.logsLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  React.useEffect(() => { void loadInitial(); }, [loadInitial]);

  const loadMore = async () => {
    if (!pageInfo.nextCursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await listExecutionLogs(jobId, pageInfo.nextCursor);
      if (result.ok) {
        setItems((current) => [...current, ...result.data.items]);
        setPageInfo(result.data.pageInfo);
      } else {
        setError(result.error);
      }
    } catch {
      setError(t('jobs.logsMoreFailed'));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Card aria-busy={loading || loadingMore} className="gap-0 overflow-hidden py-0" data-testid="execution-job-logs">
      {loading ? (
        <div aria-live="polite" className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground" role="status"><LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> {t('jobs.logsLoading')}</div>
      ) : error && items.length === 0 ? (
        <div className="space-y-3 p-10 text-center text-sm"><p className="text-destructive" role="alert">{error}</p><Button onClick={() => void loadInitial()} size="sm" variant="outline">{t('jobs.retry')}</Button></div>
      ) : items.length === 0 ? (
        <Empty text={t('jobs.logsEmpty')} />
      ) : (
        <div className="divide-y">
          {items.map((log) => (
            <div className="grid gap-3 p-4 sm:grid-cols-[8rem_1fr]" data-testid="execution-log-entry" key={log.id}>
              <div className="space-y-2">
                <div className="font-mono text-xs text-muted-foreground">#{log.sequence}</div>
                <Badge variant="outline">{log.type}</Badge>
                {log.percent !== null ? <div className="text-xs font-medium">{log.percent}%</div> : null}
              </div>
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{formatStableDateTime(log.occurredAt)}</span><span>{log.source}</span>{log.attemptId ? <span className="font-mono">{t('jobs.logAttempt', { id: log.attemptId })}</span> : null}</div>
                {log.payloadValid ? <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs text-foreground">{log.text}</pre> : <p className="text-sm text-destructive">{t('jobs.invalidLogPayload')}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      {error && items.length > 0 ? <div className="border-t p-3 text-center text-sm text-destructive" role="alert">{error}</div> : null}
      {pageInfo.hasNextPage ? <div className="border-t p-3 text-center"><Button aria-busy={loadingMore} disabled={loadingMore} onClick={() => void loadMore()} variant="outline">{loadingMore ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null} {t('jobs.loadMoreLogs')}</Button></div> : null}
    </Card>
  );
}

function AttemptsPanel({ detail }: { detail: ExecutionJobDetail }) {
  const t = useT();
  return (
    <Card className="gap-0 overflow-hidden py-0">
      {(detail.job.attempts || []).length === 0 ? <Empty text={t('jobs.attemptsEmpty')} /> : (detail.job.attempts || []).map((attempt) => (
        <div className="border-l-2 border-l-muted p-4 [&+&]:border-t" key={attempt.id}>
          <div className="flex flex-wrap items-center gap-2"><strong>{t('jobs.attemptTitle', { number: attempt.number })}</strong><ExecutionStatusBadge status={attempt.status} /><span className="text-xs text-muted-foreground">{t('jobs.attemptGeneration', { generation: attempt.generation })}</span></div>
          <div className="mt-2 grid min-w-0 gap-2 text-xs text-muted-foreground sm:grid-cols-3"><span className="break-all">{attempt.runtimeId || t('jobs.attemptNoRuntime')}</span><span>{t('jobs.attemptStarted', { time: formatStableDateTime(attempt.startedAt) })}</span><span>{t('jobs.attemptFinished', { time: formatStableDateTime(attempt.finishedAt) })}</span></div>
          {attempt.error !== null ? <div className="mt-3"><JsonBlock label={t('jobs.attemptError')} value={attempt.error} /></div> : null}
        </div>
      ))}
    </Card>
  );
}

function ArtifactsPanel({ detail, setDetail, setError }: { detail: ExecutionJobDetail; setDetail: React.Dispatch<React.SetStateAction<ExecutionJobDetail | null>>; setError: (value: string | null) => void }) {
  const t = useT();
  const [contents, setContents] = React.useState<Record<string, JsonValue | null>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const loadContent = async (artifact: ExecutionArtifact) => {
    setBusy(artifact.id);
    try {
      const result = await getExecutionArtifactContent(detail.job.id, artifact.id);
      if (result.ok) setContents((current) => ({ ...current, [artifact.id]: result.data }));
      else setError(result.error);
    } catch {
      setError(t('jobs.artifactContentFailed'));
    } finally {
      setBusy(null);
    }
  };
  const loadMore = async () => {
    const cursor = detail.artifacts.pageInfo.nextCursor;
    if (!cursor) return;
    setBusy('more');
    try {
      const result = await listExecutionArtifacts(detail.job.id, cursor);
      if (!result.ok) setError(result.error);
      else setDetail((current) => current ? ({ ...current, artifacts: { items: [...current.artifacts.items, ...result.data.items], pageInfo: result.data.pageInfo } }) : current);
    } catch {
      setError(t('jobs.artifactsMoreFailed'));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div aria-busy={busy !== null} className="space-y-3">
      {detail.artifacts.items.length === 0 ? <Card><Empty text={t('jobs.artifactsEmpty')} /></Card> : detail.artifacts.items.map((artifact) => (
        <Card className="gap-3" key={artifact.id}>
          <CardHeader className="gap-2"><div className="flex min-w-0 items-start justify-between gap-3"><CardTitle className="flex min-w-0 items-start gap-2 text-base"><FileJson aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><span className="break-words [overflow-wrap:anywhere]">{artifact.name}</span></CardTitle><Badge className="shrink-0" variant="outline">{artifact.kind}</Badge></div></CardHeader>
          <CardContent className="space-y-3 text-xs text-muted-foreground">
            <div className="flex flex-wrap gap-x-4 gap-y-1"><span>{artifact.mimeType || t('jobs.unknownMediaType')}</span><span>{formatBytes(artifact.sizeBytes, t('jobs.unknownSize'))}</span><span>{artifact.storage}</span><span>{formatStableDateTime(artifact.createdAt)}</span></div>
            {artifact.sha256 ? <div className="break-all font-mono">SHA-256 {artifact.sha256}</div> : null}
            {artifact.metadataValid && artifact.metadata !== null ? <JsonBlock label={t('jobs.jsonMetadata')} value={artifact.metadata} /> : null}
            {Object.prototype.hasOwnProperty.call(contents, artifact.id) ? <JsonBlock label={t('jobs.jsonContent')} value={contents[artifact.id]} /> : null}
            <div className="flex flex-wrap gap-2">
              {artifact.contentAvailable ? <Button aria-busy={busy === artifact.id} disabled={busy === artifact.id} onClick={() => void loadContent(artifact)} size="sm" variant="outline">{busy === artifact.id ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null} {t('jobs.viewSafeContent')}</Button> : null}
              {safeExternalArtifactUrl(artifact.externalUrl) ? <Button asChild size="sm" variant="outline"><a href={safeExternalArtifactUrl(artifact.externalUrl) ?? undefined} rel="noopener noreferrer" target="_blank"><ExternalLink aria-hidden="true" /> {t('jobs.openExternalArtifact')}</a></Button> : null}
              {!artifact.contentAvailable && !artifact.externalUrl ? <span>{artifact.contentUnavailableReason || t('jobs.contentUnavailableDefault')}</span> : null}
            </div>
          </CardContent>
        </Card>
      ))}
      {detail.artifacts.pageInfo.hasNextPage ? <div className="text-center"><Button aria-busy={busy === 'more'} disabled={busy === 'more'} onClick={() => void loadMore()} variant="outline">{busy === 'more' ? <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null} {t('jobs.loadMoreArtifacts')}</Button></div> : null}
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: JsonValue | null }) {
  return (
    <details className="min-w-0 rounded-lg border bg-muted/30">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">{label}</summary>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all border-t bg-muted p-3 text-xs text-foreground">{pretty(value)}</pre>
    </details>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className={mono ? 'break-all font-mono text-xs' : 'mt-1 font-medium'}>{value}</div></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="p-10 text-center text-sm text-muted-foreground">{text}</div>;
}

function ErrorNotice({ message }: { message: string }) {
  return <div aria-live="assertive" className="mt-5 flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive" role="alert"><AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> <span className="break-words [overflow-wrap:anywhere]">{message}</span></div>;
}

function isDetailTab(value: string | null): value is DetailTab {
  return DETAIL_TABS.some((tab) => tab === value);
}

function getRevision(detail: ExecutionJobDetail | null) {
  const revision = detail?.job.revision;
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0
    ? revision
    : null;
}

function pretty(value: JsonValue | null) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function formatBytes(value: number | null, unknownLabel: string) {
  if (value === null) return unknownLabel;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function safeExternalArtifactUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}
