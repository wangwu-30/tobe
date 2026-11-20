'use client';

import * as React from 'react';
import { FileDiff, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiCall } from '@/framework/resilience';
import {
  buildDiffRows,
  normalizePreviewText,
  type VersionTranslateFn,
} from './deliverable-version-helpers';
import { DiffViewer, VersionPane } from './deliverable-version-views';

import type { StagedChangeSetData, WorkspaceVersionData } from '@/types';

export function StagedChangeReviewDialog({
  allVersions,
  currentText,
  interactionsEnabled,
  onLoadVersions,
  onOpenChange,
  onStagedChangeDecided,
  open,
  pendingStagedChanges,
  t,
  workspaceId,
}: {
  allVersions: WorkspaceVersionData[];
  currentText: string;
  interactionsEnabled: boolean;
  onLoadVersions: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  onStagedChangeDecided?: (action: 'apply' | 'discard') => Promise<void> | void;
  open: boolean;
  pendingStagedChanges: StagedChangeSetData[];
  t: VersionTranslateFn;
  workspaceId: string;
}) {
  const [selectedChangeSetId, setSelectedChangeSetId] = React.useState<string | null>(null);
  const [stagedChangeBusy, setStagedChangeBusy] = React.useState<
    { action: 'apply' | 'discard'; id: string } | null
  >(null);
  const [stagedChangeNotice, setStagedChangeNotice] = React.useState<{
    tone: 'error' | 'success';
    text: string;
  } | null>(null);

  const selectedChangeSet =
    pendingStagedChanges.find((changeSet) => changeSet.id === selectedChangeSetId) ||
    pendingStagedChanges[0] ||
    null;

  React.useEffect(() => {
    if (!open) {
      setStagedChangeNotice(null);
      return;
    }
    if (!selectedChangeSetId || !pendingStagedChanges.some(({ id }) => id === selectedChangeSetId)) {
      setSelectedChangeSetId(pendingStagedChanges[0]?.id || null);
    }
  }, [open, pendingStagedChanges, selectedChangeSetId]);

  const decideStagedChange = React.useCallback(
    async (changeSet: StagedChangeSetData, action: 'apply' | 'discard') => {
      setStagedChangeBusy({ action, id: changeSet.id });
      setStagedChangeNotice(null);
      const result = await apiCall<StagedChangeSetData>(
        `/api/workspaces/${workspaceId}/staged-changes/${changeSet.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, expectedRevision: changeSet.revision }),
        }
      );

      if (!result.ok) {
        const message =
          result.error.status === 409
            ? t('version.stagedReviewConflict')
            : result.error.status === 403
              ? t('version.stagedReviewForbidden')
              : result.error.status === 423
                ? t('version.stagedReviewLocked')
                : action === 'apply'
                  ? t('workspace.stagedChangesCouldNotApply')
                  : t('workspace.stagedChangesCouldNotDiscard');
        setStagedChangeNotice({ tone: 'error', text: message });
        setStagedChangeBusy(null);
        return;
      }

      const noticeText =
        action === 'apply'
          ? t('workspace.appliedStagedChanges')
          : t('workspace.discardedStagedChanges');
      setStagedChangeNotice({
        tone: 'success',
        text: noticeText,
      });

      const remainingPendingCount = pendingStagedChanges.filter(
        (item) => item.id !== changeSet.id
      ).length;

      try {
        await Promise.all([onLoadVersions(), onStagedChangeDecided?.(action)]);
      } finally {
        setStagedChangeBusy(null);
      }

      if (remainingPendingCount === 0) {
        onOpenChange(false);
      }
    },
    [onLoadVersions, onOpenChange, onStagedChangeDecided, pendingStagedChanges, t, workspaceId]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-[1100px]"
        data-testid="staged-review-panel"
      >
        <DialogHeader className="border-b px-5 py-4 pr-12 text-left">
          <DialogTitle>{t('version.stagedReviewTitle')}</DialogTitle>
          <DialogDescription>{t('version.stagedReviewDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 md:grid-cols-[280px_minmax(0,1fr)]">
          <div className="max-h-[70vh] overflow-auto border-b p-3 md:border-b-0 md:border-r">
            <div className="space-y-2" aria-label={t('version.stagedReviewQueue')}>
              {pendingStagedChanges.map((changeSet) => (
                <button
                  key={changeSet.id}
                  type="button"
                  className={`w-full rounded-xl border px-3 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    selectedChangeSet?.id === changeSet.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border/70'
                  }`}
                  data-testid={`staged-change-${changeSet.id}`}
                  aria-current={selectedChangeSet?.id === changeSet.id ? 'true' : undefined}
                  onClick={() => {
                    setSelectedChangeSetId(changeSet.id);
                    setStagedChangeNotice(null);
                  }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {changeSet.title}
                    </span>
                    <Badge variant="outline">{t('version.stagedReviewPending')}</Badge>
                  </span>
                  <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {changeSet.summary}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 min-w-0 overflow-auto p-4 sm:p-5">
            {selectedChangeSet ? (
              <StagedChangeReview
                allVersions={allVersions}
                busy={stagedChangeBusy?.id === selectedChangeSet.id ? stagedChangeBusy.action : null}
                changeSet={selectedChangeSet}
                currentText={currentText}
                interactionsEnabled={interactionsEnabled}
                onApply={() => void decideStagedChange(selectedChangeSet, 'apply')}
                onDiscard={() => void decideStagedChange(selectedChangeSet, 'discard')}
                t={t}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('version.stagedReviewEmpty')}
              </p>
            )}
          </div>
        </div>
        {stagedChangeNotice && (stagedChangeNotice.tone === 'error' || !onStagedChangeDecided) ? (
          <div
            className={`border-t px-5 py-3 text-sm ${
              stagedChangeNotice.tone === 'error'
                ? 'bg-destructive/5 text-destructive'
                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            }`}
            data-testid="staged-change-notice"
            role={stagedChangeNotice.tone === 'error' ? 'alert' : 'status'}
            aria-live="polite"
          >
            {stagedChangeNotice.text}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StagedChangeReview({
  allVersions,
  busy,
  changeSet,
  currentText,
  interactionsEnabled,
  onApply,
  onDiscard,
  t,
}: {
  allVersions: WorkspaceVersionData[];
  busy: 'apply' | 'discard' | null;
  changeSet: StagedChangeSetData;
  currentText: string;
  interactionsEnabled: boolean;
  onApply: () => void;
  onDiscard: () => void;
  t: VersionTranslateFn;
}) {
  const baseVersion = changeSet.baseVersionId
    ? allVersions.find((version) => version.id === changeSet.baseVersionId) || null
    : null;
  const disabled = busy !== null || !interactionsEnabled;

  return (
    <article aria-busy={busy !== null} aria-labelledby="staged-review-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="staged-review-heading" className="break-words text-lg font-semibold">
            {changeSet.title}
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {changeSet.summary}
          </p>
        </div>
        <Badge variant="secondary" data-testid={`staged-change-status-${changeSet.id}`}>
          {t('version.stagedReviewPending')}
        </Badge>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{t('version.stagedReviewFiles', { count: changeSet.changes.length })}</span>
        <span>{t('version.stagedReviewRevision', { revision: changeSet.revision })}</span>
        <span>{t('version.stagedReviewSource', { source: changeSet.sourceType })}</span>
      </div>

      <div className="mt-5 space-y-4">
        {changeSet.changes.map((change, index) => {
          const baseFile =
            baseVersion?.files.find((file) => file.id === change.fileId) ||
            baseVersion?.files.find((file) => file.name === change.name) ||
            null;
          const beforeText = normalizePreviewText(
            change.preimage?.content ??
              baseFile?.content ??
              (changeSet.changes.length === 1 ? currentText : '')
          );
          const afterText = normalizePreviewText(change.nextContent ?? '');
          const rows = buildDiffRows(beforeText, afterText);

          return (
            <section
              key={`${change.fileId || change.name}-${index}`}
              className="overflow-hidden rounded-2xl border border-border/70"
              data-testid={`staged-change-diff-${changeSet.id}`}
            >
              <header className="border-b bg-muted/20 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <FileDiff className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <h4 className="truncate text-sm font-medium">{change.name}</h4>
                </div>
                {change.summary ? (
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{change.summary}</p>
                ) : null}
              </header>
              <div className="p-3">
                {rows ? (
                  <DiffViewer
                    leftLabel={
                      baseFile
                        ? t('version.stagedReviewBeforeBase')
                        : t('version.stagedReviewBeforeCurrent')
                    }
                    rightLabel={t('version.stagedReviewAfter')}
                    rows={rows}
                  />
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    <VersionPane label={t('version.stagedReviewBefore')} text={beforeText} />
                    <VersionPane label={t('version.stagedReviewAfter')} text={afterText} />
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div className="mt-5 flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          disabled={disabled}
          onClick={onDiscard}
          data-testid={`staged-change-discard-${changeSet.id}`}
        >
          {busy === 'discard' ? (
            <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          )}
          {busy === 'discard' ? t('version.stagedReviewDiscarding') : t('version.stagedReviewDiscard')}
        </Button>
        <Button
          disabled={disabled}
          onClick={onApply}
          data-testid={`staged-change-apply-${changeSet.id}`}
        >
          {busy === 'apply' ? (
            <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          )}
          {busy === 'apply' ? t('version.stagedReviewApplying') : t('version.stagedReviewApply')}
        </Button>
      </div>
    </article>
  );
}
