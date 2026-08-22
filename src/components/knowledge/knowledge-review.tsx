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
import type { KnowledgeChangeRequestDetail } from '@/lib/knowledge/client';
import { formatStableDateTime } from '@/lib/time';
import type { KnowledgeChangeRequestDto, KnowledgeMergeOperationDto } from '@/objects/knowledge';

import { KnowledgeState, KnowledgeStatusBadge, humanize, shortSha, useUnsavedChangesWarning } from './knowledge-presentation';

type BusyAction = 'approve' | 'merge' | 'reject' | null;

export function KnowledgeReviewWorkspace({
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
  const detailAnnouncement = React.useMemo(() => {
    if (detailLoading && selectedId) return 'Loading proposal details…';
    if (detailError && selectedId) return 'Selected proposal details could not be loaded.';
    if (detail) {
      return `Details updated for ${detail.changeRequest.diffSummary || 'Knowledge proposal'}. Status ${humanize(detail.changeRequest.status)}.`;
    }
    if (changes.length === 0) return 'No knowledge proposals are available.';
    return 'Select a proposal to inspect its trusted diff.';
  }, [changes.length, detail, detailError, detailLoading, selectedId]);

  return (
    <section aria-label="Knowledge review workspace" className="mt-6 grid min-h-[620px] min-w-0 overflow-hidden rounded-xl border bg-card lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]" data-testid="knowledge-review-workspace">
      <p aria-atomic="true" aria-live="polite" className="sr-only" data-testid="knowledge-detail-announcement">
        {detailAnnouncement}
      </p>
      <div className="min-w-0 border-b lg:border-b-0 lg:border-r">
        <div className="border-b p-4">
          <h2 className="font-semibold" id="knowledge-proposals-heading">Proposed changes</h2>
          <p className="mt-1 text-sm text-muted-foreground">One proposal stays in focus from review through activation.</p>
        </div>
        <nav aria-labelledby="knowledge-proposals-heading" className="max-h-[min(680px,50vh)] touch-pan-y overflow-y-auto overscroll-contain p-2 lg:max-h-[680px]">
          {loading ? (
            <KnowledgeState kind="loading" text="Loading review queue…" />
          ) : queueError && changes.length === 0 ? (
            <KnowledgeState
              action={<Button onClick={() => void onRefresh()} size="sm" variant="outline"><RefreshCw aria-hidden="true" /> Try again</Button>}
              kind="error"
              text={queueError}
              title="Review queue could not be loaded"
            />
          ) : changes.length === 0 ? (
            <KnowledgeState
              title="Review queue is clear"
              text="New agent proposals will appear here before they can reach trusted knowledge."
              action={<Button onClick={() => void onRefresh()} size="sm" variant="outline"><RefreshCw aria-hidden="true" /> Check again</Button>}
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
                  <span className="min-w-0 break-words text-sm font-medium" title={change.diffSummary || 'Knowledge proposal'}>{change.diffSummary || 'Knowledge proposal'}</span>
                  <KnowledgeStatusBadge status={change.status} />
                </div>
                <p className="mt-2 break-all font-mono text-xs text-muted-foreground" title={change.branchName}>{change.branchName}</p>
                <p className="mt-1 text-xs text-muted-foreground">{shortSha(change.baseCommit)} → {shortSha(change.headCommit)}</p>
              </Link>
            ))
          )}
          {queueError && changes.length > 0 ? (
            <div className="m-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300" role="status">
              The queue could not be refreshed. Showing the last loaded proposals.
            </div>
          ) : null}
        </nav>
      </div>
      <div className="min-w-0">
        {detailLoading ? (
          <KnowledgeState kind="loading" text="Loading trusted diff and audit trail…" />
        ) : detailError ? (
          <KnowledgeState
            action={<Button onClick={() => void onRefresh()} size="sm" variant="outline"><RefreshCw aria-hidden="true" /> Try again</Button>}
            kind="error"
            text={detailError}
            title="Proposal could not be loaded"
          />
        ) : detail ? (
          <KnowledgeReviewDetail busyAction={busyAction} detail={detail} onMerge={onMerge} onRefresh={onRefresh} onReview={onReview} pollError={pollError} proposalGoal={proposalGoal} proposerLabel={proposerLabel} />
        ) : (
          <KnowledgeState text={changes.length ? 'Select a proposal to inspect its trusted Git diff.' : 'No proposal is selected.'} />
        )}
      </div>
    </section>
  );
}

function KnowledgeReviewDetail({
  busyAction,
  detail,
  onMerge,
  onRefresh,
  onReview,
  pollError,
  proposalGoal,
  proposerLabel,
}: {
  busyAction: BusyAction;
  detail: KnowledgeChangeRequestDetail;
  onMerge: () => Promise<boolean>;
  onRefresh: () => Promise<void> | void;
  onReview: (action: 'approve' | 'reject', note: string) => Promise<boolean>;
  pollError: string | null;
  proposalGoal: string | null;
  proposerLabel: string | null;
}) {
  const change = detail.changeRequest;
  const [note, setNote] = React.useState(change.reviewNote ?? '');
  const [rejectDialogOpen, setRejectDialogOpen] = React.useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = React.useState(false);
  React.useEffect(() => setNote(change.reviewNote ?? ''), [change.id, change.reviewNote]);
  const savedNote = change.reviewNote ?? '';
  const noteDirty = note !== savedNote;
  const busy = busyAction !== null;
  useUnsavedChangesWarning(
    noteDirty && !busy,
    'Your review note has not been submitted. Leave this proposal without saving it?'
  );

  const operation = detail.mergeOperations[0];
  const queueBusy = operation?.status === 'queued' || operation?.status === 'running';
  const operationMatchesRevision = operation?.expectedRevision === change.revision;
  const activeForProposal = detail.activeSnapshot?.commitSha === change.headCommit;
  const metadata = readDiffMetadata(change.diffMetadata);
  const pipelineAnnouncement = [
    `Proposal ${change.status === 'pending_review' ? 'awaiting review' : humanize(change.status).toLowerCase()}.`,
    operation
      ? `Merge pipeline ${operation.status === 'running' ? 'merging and indexing' : operation.status === 'succeeded' ? 'index ready' : humanize(operation.status).toLowerCase()}.`
      : null,
    activeForProposal ? 'Active in retrieval.' : null,
  ].filter(Boolean).join(' ');

  return (
    <article aria-busy={busy} className="flex h-full min-w-0 flex-col" aria-label="Knowledge proposal review">
      <header className="border-b p-5">
        <p aria-atomic="true" aria-live="polite" className="sr-only" data-testid="knowledge-pipeline-status">
          {pipelineAnnouncement}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <KnowledgeStatusBadge status={change.status} />
          {operation ? <KnowledgeStatusBadge status={operation.status} /> : null}
          {activeForProposal ? <Badge variant="secondary"><CheckCircle2 aria-hidden="true" /> Active in retrieval</Badge> : null}
        </div>
        <h2 className="mt-3 break-words text-xl font-semibold" id="knowledge-review-detail-heading" tabIndex={-1}>{change.diffSummary || 'Knowledge proposal'}</h2>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {detail.space.scope === 'team' ? 'Team knowledge' : 'Agent knowledge'} · {detail.space.defaultBranch} · proposal {shortSha(change.headCommit)}
        </p>
        {metadata.files.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {metadata.files.slice(0, 5).map((file) => <Badge className="max-w-full break-all whitespace-normal" key={file} title={file} variant="outline"><FileCode2 aria-hidden="true" />{file}</Badge>)}
            {metadata.files.length > 5 ? <Badge variant="outline">+{metadata.files.length - 5} files</Badge> : null}
          </div>
        ) : null}
      </header>

      <section className="grid border-b sm:grid-cols-3" aria-label="Proposal audit">
        <AuditCell icon={<ShieldCheck aria-hidden="true" />} label="Proposed by" value={proposerLabel || `Execution job ${shortSha(change.jobId)}`} detail={proposalGoal || `Attempt ${shortSha(change.attemptId)}`} />
        <AuditCell icon={<UserRoundCheck aria-hidden="true" />} label="Reviewer" value={change.reviewerId ? `User ${shortSha(change.reviewerId)}` : 'Not reviewed yet'} detail={change.reviewedAt ? formatStableDateTime(change.reviewedAt) : 'Human decision required'} />
        <AuditCell icon={<Clock3 aria-hidden="true" />} label="Latest activity" value={formatStableDateTime(operation?.updatedAt || change.updatedAt)} detail={operation ? `${humanize(operation.status)} · attempt ${operation.attemptCount}` : humanize(change.status)} />
      </section>

      <div className="grid min-h-[300px] flex-1 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0">
          <p className="border-b px-4 py-3 text-xs text-muted-foreground sm:px-5" id="knowledge-diff-help">
            Long diffs stay horizontally scrollable. Tab to focus the diff, then use arrow keys to review it; on touch devices, swipe sideways to inspect wide changes.
          </p>
          <pre
            aria-describedby="knowledge-diff-help"
            aria-label="Git diff"
            className="max-h-[70vh] min-h-[300px] min-w-0 overflow-auto overscroll-contain bg-muted/30 p-4 font-mono text-xs leading-5 whitespace-pre sm:p-5"
            data-testid="knowledge-diff"
            tabIndex={0}
          >
          {detail.diff.patch || 'No textual diff.'}
          </pre>
        </div>
        <StageRail change={change} operation={operation} active={activeForProposal} />
      </div>

      <div className="border-t p-5">
        {pollError ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300" role="status">
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">Live status could not be refreshed: {pollError}</span>
            <Button onClick={() => void onRefresh()} size="sm" variant="outline"><RefreshCw aria-hidden="true" /> Retry status</Button>
          </div>
        ) : null}
        {operation?.errorMessage ? (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
            <div className="flex min-w-0 gap-2"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><div className="min-w-0"><p className="font-medium">{operation.status === 'conflicted' ? 'The proposal no longer applies cleanly.' : 'The merge or index worker could not finish.'}</p><p className="mt-1 break-words [overflow-wrap:anywhere]">{operation.errorMessage}</p></div></div>
          </div>
        ) : null}

        {change.status === 'pending_review' || change.status === 'conflicted' ? (
          <>
            {change.status === 'conflicted' ? (
              <p className="mb-3 text-sm text-muted-foreground">Review the updated diff, then approve again to create a new merge revision.</p>
            ) : null}
            <Label htmlFor="knowledge-review-note">Review note <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <p className="mt-1 text-xs text-muted-foreground" id="knowledge-review-note-help">Recorded in the audit trail. Press Ctrl+Enter or Command+Enter to approve.</p>
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
              placeholder="Example: Verified sources and approved the updated guidance…"
              spellCheck="true"
              value={note}
            />
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Dialog onOpenChange={setRejectDialogOpen} open={rejectDialogOpen}>
                <DialogTrigger asChild><Button className="w-full sm:w-auto" variant="outline" disabled={busy || queueBusy}>Reject</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Reject this proposal?</DialogTitle>
                    <DialogDescription>The reviewed diff will stay in the audit trail, but it cannot enter the trusted merge queue.</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild><Button variant="outline">Keep reviewing</Button></DialogClose>
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
                      {busyAction === 'reject' ? 'Rejecting proposal…' : 'Reject proposal'}
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
                {busyAction === 'approve' ? 'Approving proposal…' : 'Approve proposal'}
              </Button>
            </div>
          </>
        ) : change.status === 'approved' ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {queueBusy ? 'The trusted worker is merging and building the retrieval index. This view updates automatically.' : operationMatchesRevision && operation?.status === 'failed' ? 'The last worker attempt failed. Refresh after the worker retry is scheduled, or reject this proposal.' : operation && !operationMatchesRevision ? 'This approval is a new revision after the previous merge attempt. Queue it when ready.' : 'Approval is recorded. Queue the trusted merge and index pipeline when ready.'}
            </p>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {operationMatchesRevision && operation?.status === 'failed' ? <Button disabled={busy} onClick={() => void onRefresh()} variant="outline"><RefreshCw aria-hidden="true" /> Check worker</Button> : null}
              <Dialog onOpenChange={setMergeDialogOpen} open={mergeDialogOpen}>
                <DialogTrigger asChild>
                  <Button disabled={busy || (operationMatchesRevision && Boolean(operation))}>
                    {queueBusy ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <GitBranch aria-hidden="true" />}
                    {queueBusy ? 'Trusted merge processing…' : 'Queue merge'}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Queue this approved revision?</DialogTitle>
                    <DialogDescription>A trusted worker will verify the exact approved Git head, perform a compare-and-swap merge, and build the retrieval index.</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
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
                      {busyAction === 'merge' ? 'Queueing trusted merge…' : 'Queue trusted merge'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        ) : change.status === 'merged' && !activeForProposal ? (
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{operation?.status === 'failed' ? 'The merge completed, but index activation failed. A trusted worker retry is required.' : 'Merge completed. The trusted worker is finishing index activation.'}</p><Button onClick={() => void onRefresh()} variant="outline"><RefreshCw aria-hidden="true" /> Check activation</Button></div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {activeForProposal ? 'This reviewed revision is merged, indexed, and active for retrieval.' : `This proposal is ${humanize(change.status).toLowerCase()}.`}
          </p>
        )}
      </div>
    </article>
  );
}

function StageRail({ active, change, operation }: { active: boolean; change: KnowledgeChangeRequestDto; operation?: KnowledgeMergeOperationDto }) {
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
    <aside className="min-w-0 border-t bg-background p-4 lg:border-l lg:border-t-0" aria-label="Trust pipeline">
      <h3 className="text-sm font-medium">Trust pipeline</h3>
      <ol className="mt-4 space-y-4">
        <Stage done label="Proposal" detail="Diff captured" />
        <Stage done={reviewDone} failed={change.status === 'rejected' || change.status === 'conflicted'} active={change.status === 'pending_review'} label="Review" detail={change.status === 'conflicted' ? 'Approval must be renewed' : change.reviewedAt ? formatStableDateTime(change.reviewedAt) : 'Awaiting a person'} />
        <Stage done={queueDone} active={operation?.status === 'queued'} label="Queue" detail={operation ? (operation.status === 'queued' ? 'Waiting for trusted worker' : 'Claimed by trusted worker') : 'Not queued'} />
        <Stage done={mergeDone} failed={mergeFailed} active={operation?.status === 'running' && !operation.mergedCommit} label="Merge" detail={mergeDone ? `Merged ${shortSha(operation?.mergedCommit || change.mergedCommit)}` : mergeFailed ? humanize(operation?.status || 'conflicted') : 'Waiting in pipeline'} />
        <Stage done={active} failed={indexFailed} active={(operation?.status === 'running' && Boolean(operation.mergedCommit)) || (change.status === 'merged' && !active && !indexFailed)} label="Index" detail={active ? 'Active for retrieval' : indexFailed ? 'Worker attention needed' : 'Waiting for merge'} />
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
