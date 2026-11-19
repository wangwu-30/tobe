'use client';

import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileCode2,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/components/providers/language-provider';
import {
  proposeKnowledgeToWikiClient,
  type KnowledgeChangeRequestDetail,
  type KnowledgeWorkspaceOption,
} from '@/lib/knowledge/client';
import { formatStableDateTime } from '@/lib/time';
import type { KnowledgeChangeRequestDto, KnowledgeMergeOperationDto } from '@/objects/knowledge';

import {
  formatKnowledgeStatusLabel,
  KnowledgeState,
  KnowledgeStatusBadge,
  shortSha,
  useUnsavedChangesWarning,
} from './knowledge-presentation';

type BusyAction = 'approve' | 'merge' | 'reject' | null;

export function KnowledgeReviewWorkspace({
  boundWorkspaces = [],
  busyAction,
  changes,
  detail,
  detailError,
  detailLoading,
  loading,
  onMerge,
  onRefresh,
  onReview,
  onSelect,
  pollError,
  proposalGoal,
  proposerLabel,
  queueError,
  selectedId,
}: {
  boundWorkspaces?: KnowledgeWorkspaceOption[];
  busyAction: BusyAction;
  changes: KnowledgeChangeRequestDto[];
  detail: KnowledgeChangeRequestDetail | null;
  detailError: string | null;
  detailLoading: boolean;
  loading: boolean;
  onMerge: () => Promise<boolean>;
  onRefresh: () => Promise<void> | void;
  onReview: (action: 'approve' | 'reject', note: string) => Promise<boolean>;
  onSelect: (id: string) => void;
  pollError: string | null;
  proposalGoal: string | null;
  proposerLabel: string | null;
  queueError: string | null;
  selectedId: string | null;
}) {
  const t = useT();
  const detailAnnouncement = React.useMemo(() => {
    if (detailLoading && selectedId) return t('knowledge.announceLoadingDetail');
    if (detailError && selectedId) return t('knowledge.announceDetailError');
    if (detail) {
      return t('knowledge.announceDetailUpdated', {
        status: formatKnowledgeStatusLabel(detail.changeRequest.status, t),
        title: detail.changeRequest.diffSummary || t('knowledge.proposalFallbackTitle'),
      });
    }
    if (changes.length === 0) return t('knowledge.announceEmpty');
    return t('knowledge.announceSelect');
  }, [changes.length, detail, detailError, detailLoading, selectedId, t]);

  return (
    <section aria-label={t('knowledge.reviewWorkspaceAria')} className="mt-6 grid min-h-[620px] min-w-0 overflow-hidden rounded-xl border bg-card lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]" data-testid="knowledge-review-workspace">
      <p aria-atomic="true" aria-live="polite" className="sr-only" data-testid="knowledge-detail-announcement">
        {detailAnnouncement}
      </p>
      <div className="min-w-0 border-b lg:border-b-0 lg:border-r">
        <div className="border-b p-4">
          <h2 className="font-semibold" id="knowledge-proposals-heading">{t('knowledge.proposedChangesHeading')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('knowledge.proposedChangesSubtitle')}</p>
        </div>
        <nav aria-labelledby="knowledge-proposals-heading" className="max-h-[min(680px,50vh)] touch-pan-y overflow-y-auto overscroll-contain p-2 lg:max-h-[680px]">
          {loading ? (
            <KnowledgeState kind="loading" text={t('knowledge.queueLoading')} />
          ) : queueError && changes.length === 0 ? (
            <KnowledgeState
              action={<Button onClick={() => void onRefresh()} size="sm" variant="outline"><RefreshCw aria-hidden="true" /> {t('knowledge.tryAgain')}</Button>}
              kind="error"
              text={queueError}
              title={t('knowledge.queueErrorTitle')}
            />
          ) : changes.length === 0 ? (
            <KnowledgeState
              title={t('knowledge.queueEmptyTitle')}
              text={t('knowledge.queueEmptyText')}
              action={<Button onClick={() => void onRefresh()} size="sm" variant="outline"><RefreshCw aria-hidden="true" /> {t('knowledge.checkAgain')}</Button>}
            />
          ) : (
            changes.map((change) => (
              <Link
                aria-current={selectedId === change.id ? 'page' : undefined}
                href={knowledgeReviewHref(change.id)}
                key={change.id}
                onClick={() => onSelect(change.id)}
                className={
                  'mb-2 w-full touch-manipulation rounded-lg border p-3 text-left transition-colors motion-reduce:transition-none ' +
                  (selectedId === change.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/60')
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 break-words text-sm font-medium" title={change.diffSummary || t('knowledge.proposalFallbackTitle')}>{change.diffSummary || t('knowledge.proposalFallbackTitle')}</span>
                  <KnowledgeStatusBadge status={change.status} />
                </div>
                <p className="mt-2 break-all font-mono text-xs text-muted-foreground" title={change.branchName}>{change.branchName}</p>
                <p className="mt-1 text-xs text-muted-foreground">{shortSha(change.baseCommit)} → {shortSha(change.headCommit)}</p>
              </Link>
            ))
          )}
          {queueError && changes.length > 0 ? (
            <div className="m-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300" role="status">
              {t('knowledge.queueRefreshWarning')}
            </div>
          ) : null}
        </nav>
      </div>
      <div className="min-w-0">
        {detailLoading ? (
          <KnowledgeState kind="loading" text={t('knowledge.detailLoading')} />
        ) : detailError ? (
          <KnowledgeState
            action={<Button onClick={() => void onRefresh()} size="sm" variant="outline"><RefreshCw aria-hidden="true" /> {t('knowledge.tryAgain')}</Button>}
            kind="error"
            text={detailError}
            title={t('knowledge.detailErrorTitle')}
          />
        ) : detail ? (
          <KnowledgeReviewDetail boundWorkspaces={boundWorkspaces} busyAction={busyAction} detail={detail} onMerge={onMerge} onRefresh={onRefresh} onReview={onReview} pollError={pollError} proposalGoal={proposalGoal} proposerLabel={proposerLabel} />
        ) : (
          <KnowledgeState text={changes.length ? t('knowledge.selectProposalPrompt') : t('knowledge.noProposalSelected')} />
        )}
      </div>
    </section>
  );
}

function KnowledgeReviewDetail({
  boundWorkspaces,
  busyAction,
  detail,
  onMerge,
  onRefresh,
  onReview,
  pollError,
  proposalGoal,
  proposerLabel,
}: {
  boundWorkspaces: KnowledgeWorkspaceOption[];
  busyAction: BusyAction;
  detail: KnowledgeChangeRequestDetail;
  onMerge: () => Promise<boolean>;
  onRefresh: () => Promise<void> | void;
  onReview: (action: 'approve' | 'reject', note: string) => Promise<boolean>;
  pollError: string | null;
  proposalGoal: string | null;
  proposerLabel: string | null;
}) {
  const t = useT();
  const change = detail.changeRequest;
  const [note, setNote] = React.useState(change.reviewNote ?? '');
  const [rejectDialogOpen, setRejectDialogOpen] = React.useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = React.useState(false);
  const metadata = readDiffMetadata(change.diffMetadata);
  const [bridgeFile, setBridgeFile] = React.useState(metadata.files[0] ?? '');
  const [bridgeWorkspaceId, setBridgeWorkspaceId] = React.useState(
    boundWorkspaces[0]?.id ?? ''
  );
  const [bridgeBusy, setBridgeBusy] = React.useState(false);
  const [bridgeError, setBridgeError] = React.useState<string | null>(null);
  const [bridgeResult, setBridgeResult] = React.useState<{
    documentPath: string;
    workspaceId: string;
  } | null>(null);
  React.useEffect(() => {
    setNote(change.reviewNote ?? '');
    setBridgeFile(readDiffMetadata(change.diffMetadata).files[0] ?? '');
    setBridgeError(null);
    setBridgeResult(null);
  }, [change.diffMetadata, change.id, change.reviewNote]);
  React.useEffect(() => {
    setBridgeWorkspaceId((current) =>
      boundWorkspaces.some((item) => item.id === current)
        ? current
        : (boundWorkspaces[0]?.id ?? '')
    );
  }, [boundWorkspaces]);
  const savedNote = change.reviewNote ?? '';
  const noteDirty = note !== savedNote;
  const busy = busyAction !== null;
  useUnsavedChangesWarning(
    noteDirty && !busy,
    t('knowledge.unsavedNoteWarning')
  );

  const operation = detail.mergeOperations[0];
  const queueBusy = operation?.status === 'queued' || operation?.status === 'running';
  const operationMatchesRevision = operation?.expectedRevision === change.revision;
  const activeForProposal =
    detail.activeSnapshot !== null &&
    (detail.activeSnapshot.commitSha === change.headCommit ||
      (change.mergedCommit !== null &&
        detail.activeSnapshot.commitSha === change.mergedCommit));
  const canProposeToWiki =
    activeForProposal &&
    metadata.files.length > 0 &&
    boundWorkspaces.length > 0;
  const handleProposeToWiki = async () => {
    if (!bridgeFile || !bridgeWorkspaceId || bridgeBusy) return;
    setBridgeBusy(true);
    setBridgeError(null);
    setBridgeResult(null);
    try {
      const result = await proposeKnowledgeToWikiClient({
        documentPath: bridgeFile,
        spaceId: detail.space.id,
        workspaceId: bridgeWorkspaceId,
      });
      if (!result.ok) {
        setBridgeError(result.error);
      } else {
        setBridgeResult({
          documentPath: result.data.source.documentPath,
          workspaceId: result.data.workspaceId,
        });
      }
    } catch (caught) {
      setBridgeError(
        caught instanceof Error ? caught.message : t('knowledge.proposeToWikiFailed')
      );
    } finally {
      setBridgeBusy(false);
    }
  };
  const changeStatusLabel = formatKnowledgeStatusLabel(change.status, t);
  const operationStatusLabel = operation
    ? formatKnowledgeStatusLabel(operation.status, t)
    : null;
  const pipelineAnnouncement = [
    t('knowledge.proposalStatusSummary', { status: changeStatusLabel.toLowerCase() }),
    operationStatusLabel ? `${t('knowledge.pipelineTitle')}: ${operationStatusLabel}.` : null,
    activeForProposal ? `${t('knowledge.activeInRetrieval')}.` : null,
  ].filter(Boolean).join(' ');

  return (
    <article aria-busy={busy} className="flex h-full min-w-0 flex-col" aria-label={t('knowledge.reviewArticleAria')}>
      <header className="border-b p-5">
        <p aria-atomic="true" aria-live="polite" className="sr-only" data-testid="knowledge-pipeline-status">
          {pipelineAnnouncement}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <KnowledgeStatusBadge status={change.status} />
          {operation ? <KnowledgeStatusBadge status={operation.status} /> : null}
          {activeForProposal ? <Badge variant="secondary"><CheckCircle2 aria-hidden="true" /> {t('knowledge.activeInRetrieval')}</Badge> : null}
        </div>
        <h2 className="mt-3 break-words text-xl font-semibold" id="knowledge-review-detail-heading" tabIndex={-1}>{change.diffSummary || t('knowledge.proposalFallbackTitle')}</h2>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {t('knowledge.proposalMeta', {
            branch: detail.space.defaultBranch,
            scope: detail.space.scope === 'team' ? t('knowledge.teamKnowledge') : t('knowledge.agentKnowledge'),
            sha: shortSha(change.headCommit),
          })}
        </p>
        {metadata.files.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {metadata.files.slice(0, 5).map((file) => <Badge className="max-w-full break-all whitespace-normal" key={file} title={file} variant="outline"><FileCode2 aria-hidden="true" />{file}</Badge>)}
            {metadata.files.length > 5 ? <Badge variant="outline">{t('knowledge.moreFiles', { count: metadata.files.length - 5 })}</Badge> : null}
          </div>
        ) : null}
      </header>

      <section className="grid border-b sm:grid-cols-3" aria-label={t('knowledge.auditAria')}>
        <AuditCell icon={<ShieldCheck aria-hidden="true" />} label={t('knowledge.proposedBy')} value={proposerLabel || t('knowledge.executionJobFallback', { sha: shortSha(change.jobId) })} detail={proposalGoal || t('knowledge.attemptFallback', { sha: shortSha(change.attemptId) })} />
        <AuditCell icon={<UserRoundCheck aria-hidden="true" />} label={t('knowledge.reviewer')} value={change.reviewerId ? t('knowledge.userFallback', { sha: shortSha(change.reviewerId) }) : t('knowledge.notReviewedYet')} detail={change.reviewedAt ? formatStableDateTime(change.reviewedAt) : t('knowledge.humanDecisionRequired')} />
        <AuditCell icon={<Clock3 aria-hidden="true" />} label={t('knowledge.latestActivity')} value={formatStableDateTime(operation?.updatedAt || change.updatedAt)} detail={operation ? t('knowledge.activityAttempt', { count: operation.attemptCount, status: operationStatusLabel || operation.status }) : t('knowledge.auditStatusLabel', { status: changeStatusLabel })} />
      </section>

      <div className="grid min-h-[300px] flex-1 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0">
          <p className="border-b px-4 py-3 text-xs text-muted-foreground sm:px-5" id="knowledge-diff-help">
            {t('knowledge.diffHelp')}
          </p>
          <pre
            aria-describedby="knowledge-diff-help"
            aria-label={t('knowledge.diffAria')}
            className="max-h-[70vh] min-h-[300px] min-w-0 overflow-auto overscroll-contain bg-muted/30 p-4 font-mono text-xs leading-5 whitespace-pre sm:p-5"
            data-testid="knowledge-diff"
            tabIndex={0}
          >
          {detail.diff.patch || t('knowledge.noTextualDiff')}
          </pre>
        </div>
        <StageRail change={change} operation={operation} active={activeForProposal} />
      </div>

      <div className="border-t p-5">
        {pollError ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300" role="status">
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{t('knowledge.pollErrorPrefix', { error: pollError })}</span>
            <Button onClick={() => void onRefresh()} size="sm" variant="outline"><RefreshCw aria-hidden="true" /> {t('knowledge.retryStatus')}</Button>
          </div>
        ) : null}
        {operation?.errorMessage ? (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
            <div className="flex min-w-0 gap-2"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><div className="min-w-0"><p className="font-medium">{operation.status === 'conflicted' ? t('knowledge.conflictHeadline') : t('knowledge.workerErrorHeadline')}</p><p className="mt-1 break-words [overflow-wrap:anywhere]">{operation.errorMessage}</p></div></div>
          </div>
        ) : null}

        {change.status === 'pending_review' || change.status === 'conflicted' ? (
          <>
            {change.status === 'conflicted' ? (
              <p className="mb-3 text-sm text-muted-foreground">{t('knowledge.conflictReapproveHint')}</p>
            ) : null}
            <Label htmlFor="knowledge-review-note">{t('knowledge.reviewNoteLabel')} <span className="font-normal text-muted-foreground">{t('knowledge.optionalTag')}</span></Label>
            <p className="mt-1 text-xs text-muted-foreground" id="knowledge-review-note-help">{t('knowledge.reviewNoteHelp')}</p>
            <Textarea
              aria-describedby="knowledge-review-note-help"
              aria-keyshortcuts="Control+Enter Meta+Enter"
              autoComplete="off"
              className="mt-2 min-h-20"
              disabled={busy || queueBusy}
              id="knowledge-review-note"
              name="reviewNote"
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  if (!busy && !queueBusy) void onReview('approve', note);
                }
              }}
              placeholder={t('knowledge.reviewNotePlaceholder')}
              spellCheck="true"
              value={note}
            />
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Dialog onOpenChange={setRejectDialogOpen} open={rejectDialogOpen}>
                <DialogTrigger asChild><Button className="w-full sm:w-auto" variant="outline" disabled={busy || queueBusy}>{t('knowledge.reject')}</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t('knowledge.rejectDialogTitle')}</DialogTitle>
                    <DialogDescription>{t('knowledge.rejectDialogDescription')}</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild><Button variant="outline">{t('knowledge.keepReviewing')}</Button></DialogClose>
                    <Button
                      aria-busy={busyAction === 'reject'}
                      disabled={busy}
                      onClick={async () => {
                        if (await onReview('reject', note)) {
                          setRejectDialogOpen(false);
                          focusDetailHeading();
                        }
                      }}
                      variant="destructive"
                    >
                      {busyAction === 'reject' ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : null}
                      {busyAction === 'reject' ? t('knowledge.rejectingProposal') : t('knowledge.rejectProposal')}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Button
                aria-busy={busyAction === 'approve'}
                className="w-full sm:w-auto"
                disabled={busy || queueBusy}
                onClick={() => void onReview('approve', note)}
              >
                {busyAction === 'approve' ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <ShieldCheck aria-hidden="true" />}
                {busyAction === 'approve' ? t('knowledge.approvingProposal') : t('knowledge.approveProposal')}
              </Button>
            </div>
          </>
        ) : change.status === 'approved' ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {queueBusy
                ? t('knowledge.approvedBusyHint')
                : operationMatchesRevision && operation?.status === 'failed'
                  ? t('knowledge.approvedFailedHint')
                  : operation && !operationMatchesRevision
                    ? t('knowledge.approvedNewRevisionHint')
                    : t('knowledge.approvedReadyHint')}
            </p>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {operationMatchesRevision && operation?.status === 'failed' ? <Button disabled={busy} onClick={() => void onRefresh()} variant="outline"><RefreshCw aria-hidden="true" /> {t('knowledge.checkWorker')}</Button> : null}
              <Dialog onOpenChange={setMergeDialogOpen} open={mergeDialogOpen}>
                <DialogTrigger asChild>
                  <Button disabled={busy || (operationMatchesRevision && Boolean(operation))}>
                    {queueBusy ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <GitBranch aria-hidden="true" />}
                    {queueBusy ? t('knowledge.queueMergeBusy') : t('knowledge.queueMerge')}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t('knowledge.mergeDialogTitle')}</DialogTitle>
                    <DialogDescription>{t('knowledge.mergeDialogDescription')}</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild><Button variant="outline">{t('knowledge.cancel')}</Button></DialogClose>
                    <Button
                      aria-busy={busyAction === 'merge'}
                      disabled={busy}
                      onClick={async () => {
                        if (await onMerge()) {
                          setMergeDialogOpen(false);
                          focusDetailHeading();
                        }
                      }}
                    >
                      {busyAction === 'merge' ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <GitBranch aria-hidden="true" />}
                      {busyAction === 'merge' ? t('knowledge.queueingTrustedMerge') : t('knowledge.queueTrustedMerge')}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        ) : change.status === 'merged' && !activeForProposal ? (
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{operation?.status === 'failed' ? t('knowledge.mergedIndexFailed') : t('knowledge.mergedIndexFinishing')}</p><Button onClick={() => void onRefresh()} variant="outline"><RefreshCw aria-hidden="true" /> {t('knowledge.checkActivation')}</Button></div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {activeForProposal ? t('knowledge.activeSummary') : t('knowledge.proposalStatusSummary', { status: changeStatusLabel.toLowerCase() })}
            </p>
            {canProposeToWiki ? (
              <div
                className="rounded-lg border bg-muted/20 p-4"
                data-testid="knowledge-propose-to-wiki"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {t('knowledge.proposeToWikiTitle')}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {t('knowledge.proposeToWikiHint')}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={t('knowledge.proposeToWikiFileAria')}
                      className="h-9 rounded-md border border-input bg-background px-2.5 text-xs text-foreground"
                      disabled={bridgeBusy}
                      onChange={(event) => setBridgeFile(event.target.value)}
                      value={bridgeFile}
                    >
                      {metadata.files.map((file) => (
                        <option key={file} value={file}>
                          {file}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={t('knowledge.proposeToWikiWorkspaceAria')}
                      className="h-9 rounded-md border border-input bg-background px-2.5 text-xs text-foreground"
                      disabled={bridgeBusy}
                      onChange={(event) => setBridgeWorkspaceId(event.target.value)}
                      value={bridgeWorkspaceId}
                    >
                      {boundWorkspaces.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.title}
                        </option>
                      ))}
                    </select>
                    <Button
                      aria-busy={bridgeBusy}
                      data-testid="knowledge-propose-to-wiki-button"
                      disabled={bridgeBusy || !bridgeFile || !bridgeWorkspaceId}
                      onClick={() => void handleProposeToWiki()}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {bridgeBusy ? (
                        <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />
                      ) : null}
                      {bridgeBusy
                        ? t('knowledge.proposeToWikiBusy')
                        : t('knowledge.proposeToWikiAction')}
                    </Button>
                  </div>
                </div>
                {bridgeError ? (
                  <p className="mt-2 text-xs text-destructive" role="alert">
                    {bridgeError}
                  </p>
                ) : null}
                {bridgeResult ? (
                  <div
                    className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
                    data-testid="knowledge-propose-to-wiki-success"
                    role="status"
                  >
                    <span>
                      {t('knowledge.proposeToWikiSuccess', {
                        path: bridgeResult.documentPath,
                      })}
                    </span>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/workspace/${bridgeResult.workspaceId}`}>
                        {t('knowledge.proposeToWikiOpenLink')}
                      </Link>
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </article>
  );
}

function StageRail({ active, change, operation }: { active: boolean; change: KnowledgeChangeRequestDto; operation?: KnowledgeMergeOperationDto }) {
  const t = useT();
  const reviewDone = ['approved', 'merged'].includes(change.status);
  const queueDone = Boolean(operation && operation.status !== 'queued');
  const mergeDone =
    change.status === 'merged' ||
    operation?.status === 'succeeded' ||
    Boolean(operation?.mergedCommit);
  const mergeFailed =
    operation?.status === 'conflicted' ||
    (operation?.status === 'failed' && !operation.mergedCommit);
  const indexFailed = operation?.status === 'failed' && Boolean(operation.mergedCommit);
  return (
    <aside className="min-w-0 border-t bg-background p-4 lg:border-l lg:border-t-0" aria-label={t('knowledge.pipelineTitle')}>
      <h3 className="text-sm font-medium">{t('knowledge.pipelineTitle')}</h3>
      <ol className="mt-4 space-y-4">
        <Stage done label={t('knowledge.stageProposal')} detail={t('knowledge.stageProposalDetail')} />
        <Stage done={reviewDone} failed={change.status === 'rejected' || change.status === 'conflicted'} active={change.status === 'pending_review'} label={t('knowledge.stageReview')} detail={change.status === 'conflicted' ? t('knowledge.stageReviewRenew') : change.reviewedAt ? formatStableDateTime(change.reviewedAt) : t('knowledge.stageReviewWaiting')} />
        <Stage done={queueDone} active={operation?.status === 'queued'} label={t('knowledge.stageQueue')} detail={operation ? (operation.status === 'queued' ? t('knowledge.stageQueueWaiting') : t('knowledge.stageQueueClaimed')) : t('knowledge.stageQueueNone')} />
        <Stage done={mergeDone} failed={mergeFailed} active={operation?.status === 'running' && !operation.mergedCommit} label={t('knowledge.stageMerge')} detail={mergeDone ? t('knowledge.stageMergeDone', { sha: shortSha(operation?.mergedCommit || change.mergedCommit) }) : mergeFailed ? formatKnowledgeStatusLabel(operation?.status || 'conflicted', t) : t('knowledge.stageMergeWaiting')} />
        <Stage done={active} failed={indexFailed} active={(operation?.status === 'running' && Boolean(operation.mergedCommit)) || (change.status === 'merged' && !active && !indexFailed)} label={t('knowledge.stageIndex')} detail={active ? t('knowledge.stageIndexActive') : indexFailed ? t('knowledge.stageIndexFailed') : t('knowledge.stageIndexWaiting')} />
      </ol>
    </aside>
  );
}

function Stage({ active, detail, done, failed, label }: { active?: boolean; detail: string; done?: boolean; failed?: boolean; label: string }) {
  return <li className="flex gap-3"><span aria-hidden="true" className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${failed ? 'border-destructive bg-destructive/10 text-destructive' : done ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700' : active ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground'}`}>{active && !done && !failed ? <LoaderCircle className="size-3 motion-safe:animate-spin" /> : done ? <CheckCircle2 className="size-3" /> : failed ? <AlertTriangle className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />}</span><div className="min-w-0"><p className="text-sm font-medium">{label}</p><p className="mt-0.5 break-words text-xs text-muted-foreground">{detail}</p></div></li>;
}

function AuditCell({ detail, icon, label, value }: { detail: string; icon: React.ReactNode; label: string; value: string }) {
  return <div className="min-w-0 border-b p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><div className="flex items-center gap-2 text-xs text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0"><span aria-hidden="true">{icon}</span>{label}</div><p className="mt-1 break-words text-sm font-medium [overflow-wrap:anywhere]" title={value}>{value}</p><p className="mt-0.5 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]" title={detail}>{detail}</p></div>;
}

function focusDetailHeading() {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.getElementById('knowledge-review-detail-heading')?.focus();
    });
  });
}

function readDiffMetadata(value: KnowledgeChangeRequestDto['diffMetadata']) {
  const files = Array.isArray(value.files) ? value.files.filter((item): item is string => typeof item === 'string') : [];
  return { files };
}

function knowledgeReviewHref(changeId: string) {
  const params = new URLSearchParams({ view: 'reviews', change: changeId });
  return `/knowledge?${params.toString()}`;
}
