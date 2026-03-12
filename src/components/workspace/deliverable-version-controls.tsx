'use client';

import * as React from 'react';
import { ArrowUpRight, GitCompareArrows, History, RotateCcw } from 'lucide-react';
import { plateToMarkdown } from '@/lib/ai/serializer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/components/providers/language-provider';
import type { DeliverableVersionData, StagedChangeSetData } from '@/types';

export function DeliverableVersionControls({
  currentSnapshotId,
  currentText,
  onCreateVersion,
  onRestoreVersion,
  onTogglePin,
  onSelectVersion,
  snapshots = [],
  stagedChangeSets = [],
  workspaceId,
}: {
  currentSnapshotId?: string | null;
  currentText: string;
  onCreateVersion: () => void;
  onRestoreVersion: (snapshotId: string) => Promise<void> | void;
  onTogglePin: (snapshotId: string, pinned: boolean) => Promise<void> | void;
  onSelectVersion: (snapshotId: string | null) => void;
  snapshots?: DeliverableVersionData[];
  stagedChangeSets?: StagedChangeSetData[];
  workspaceId: string;
}) {
  const t = useT();
  const [compareOpen, setCompareOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [allSnapshots, setAllSnapshots] = React.useState<DeliverableVersionData[]>([]);
  const [compareVersionId, setCompareVersionId] = React.useState<string>('draft');
  const [isRestoringId, setIsRestoringId] = React.useState<string | null>(null);
  const [isPinningId, setIsPinningId] = React.useState<string | null>(null);

  const loadSnapshots = React.useCallback(async () => {
    const response = await fetch(`/api/workspaces/${workspaceId}/versions?scope=all`);
    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as DeliverableVersionData[];
    setAllSnapshots(data);
  }, [workspaceId]);

  React.useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);

  React.useEffect(() => {
    if (snapshots.length > 0 || allSnapshots.length === 0) {
      setAllSnapshots(snapshots);
    }
  }, [allSnapshots.length, snapshots]);

  React.useEffect(() => {
    if (!compareOpen && !historyOpen) {
      return;
    }

    void loadSnapshots();
  }, [compareOpen, historyOpen, loadSnapshots]);

  const visibleVersions = React.useMemo(
    () => allSnapshots.filter((snapshot) => snapshot.visible),
    [allSnapshots]
  );
  const recoveryPoints = React.useMemo(
    () => allSnapshots.filter((snapshot) => snapshot.restorable && !snapshot.visible),
    [allSnapshots]
  );
  const pinnedRecoveryPoints = React.useMemo(
    () => recoveryPoints.filter((snapshot) => snapshot.pinned),
    [recoveryPoints]
  );
  const temporaryRecoveryPoints = React.useMemo(
    () => recoveryPoints.filter((snapshot) => snapshot.recoveryKind === 'temporary'),
    [recoveryPoints]
  );
  const pendingStagedChanges = React.useMemo(
    () => stagedChangeSets.filter((changeSet) => changeSet.status === 'pending'),
    [stagedChangeSets]
  );
  const pinSlotsFull = pinnedRecoveryPoints.length >= 3;

  React.useEffect(() => {
    if (compareOpen && compareVersionId === 'draft' && visibleVersions[0]) {
      setCompareVersionId(visibleVersions[0].id);
    }
  }, [compareOpen, compareVersionId, visibleVersions]);

  const selectedVersion =
    visibleVersions.find((version) => version.id === compareVersionId) || null;
  const selectedValue = currentSnapshotId || 'draft';
  const compareText = selectedVersion ? getVersionPreviewText(selectedVersion) : currentText;
  const diffRows = React.useMemo(
    () => buildDiffRows(compareText, currentText),
    [compareText, currentText]
  );

  const handleRestore = React.useCallback(
    async (snapshotId: string) => {
      setIsRestoringId(snapshotId);
      try {
        await onRestoreVersion(snapshotId);
        await loadSnapshots();
      } finally {
        setIsRestoringId(null);
      }
    },
    [loadSnapshots, onRestoreVersion]
  );

  const handleTogglePin = React.useCallback(
    async (snapshotId: string, pinned: boolean) => {
      setIsPinningId(snapshotId);
      try {
        await onTogglePin(snapshotId, pinned);
        await loadSnapshots();
      } finally {
        setIsPinningId(null);
      }
    },
    [loadSnapshots, onTogglePin]
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={selectedValue}
          onValueChange={(value) => onSelectVersion(value === 'draft' ? null : value)}
        >
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">{t('version.currentDraft')}</SelectItem>
            {visibleVersions.map((version) => (
              <SelectItem key={version.id} value={version.id}>
                {formatSnapshotOptionLabel(version, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => setCompareOpen(true)}
          disabled={visibleVersions.length === 0}
        >
          <GitCompareArrows className="mr-1 h-3.5 w-3.5" />
          {t('version.compare')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-2 rounded-full px-3"
          onClick={() => setHistoryOpen(true)}
        >
          <History className="h-3.5 w-3.5" />
          <HeaderStat label={t('version.milestone')} value={String(visibleVersions.length)} />
          <HeaderDivider />
          <HeaderStat
            label={t('version.pinnedBadge')}
            value={`${pinnedRecoveryPoints.length}/3`}
          />
          <HeaderDivider />
          <HeaderStat
            label={t('version.temporaryBadge')}
            value={String(temporaryRecoveryPoints.length)}
            emphasized={temporaryRecoveryPoints.length > 0}
          />
        </Button>
        <Button size="sm" className="h-8" onClick={onCreateVersion}>
          {t('version.createVersion')}
        </Button>
      </div>

      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="sm:max-w-[960px]">
          <DialogHeader>
            <DialogTitle>{t('version.compareVersions')}</DialogTitle>
          </DialogHeader>

          <div className="flex items-center justify-between gap-3">
            <Select value={compareVersionId} onValueChange={setCompareVersionId}>
              <SelectTrigger className="h-8 w-[280px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">{t('version.currentDraft')}</SelectItem>
                {visibleVersions.map((version) => (
                  <SelectItem key={version.id} value={version.id}>
                    {formatSnapshotOptionLabel(version, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground">
              {t('version.compareDescription')}
            </div>
          </div>

          {diffRows ? (
            <DiffViewer
              leftLabel={
                selectedVersion
                  ? formatSnapshotOptionLabel(selectedVersion, t)
                  : t('version.currentDraft')
              }
              rightLabel={t('version.currentDraft')}
              rows={diffRows}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <VersionPane
                label={
                  selectedVersion
                    ? formatSnapshotOptionLabel(selectedVersion, t)
                    : t('version.currentDraft')
                }
                text={compareText}
              />
              <VersionPane label={t('version.currentDraft')} text={currentText} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle>{t('version.history')}</DialogTitle>
          </DialogHeader>

          <p className="text-xs leading-5 text-muted-foreground">
            {t('version.historyDescription')}
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            {t('version.restoreDescription')}
          </p>

          <ScrollArea className="max-h-[520px] pr-3">
            <div className="space-y-5">
              <section className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  {t('version.milestone')}
                </div>
                {visibleVersions.length === 0 ? (
                  <EmptyHistoryCard text={t('version.noVersions')} />
                ) : (
                  visibleVersions.map((version) => (
                    <HistoryCard
                      key={version.id}
                      actions={
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8"
                            onClick={() => {
                              setCompareVersionId(version.id);
                              setCompareOpen(true);
                              setHistoryOpen(false);
                            }}
                          >
                            {t('version.compare')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() => void handleRestore(version.id)}
                            disabled={isRestoringId === version.id}
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" />
                            {isRestoringId === version.id
                              ? t('version.restoring')
                              : t('version.restore')}
                          </Button>
                        </>
                      }
                      badge={t('version.milestone')}
                      currentLabel={t('version.current')}
                      current={currentSnapshotId === version.id}
                      subtitle={formatSnapshotTime(version.lockedAt, t)}
                      title={version.title}
                    />
                  ))
                )}
              </section>

              <section className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  {t('version.pinnedRecoveryPoints')}
                </div>
                {pinnedRecoveryPoints.length === 0 ? (
                  <EmptyHistoryCard text={t('version.noPinnedRecoveryPoints')} />
                ) : (
                  pinnedRecoveryPoints.map((snapshot) => (
                    <HistoryCard
                      key={snapshot.id}
                      actions={
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() => void handleRestore(snapshot.id)}
                            disabled={isRestoringId === snapshot.id}
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" />
                            {isRestoringId === snapshot.id
                              ? t('version.restoring')
                              : t('version.restore')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8"
                            onClick={() => void handleTogglePin(snapshot.id, false)}
                            disabled={isPinningId === snapshot.id}
                          >
                            {isPinningId === snapshot.id
                              ? t('common.saving')
                              : t('version.unpin')}
                          </Button>
                        </>
                      }
                      badge={t('version.pinnedBadge')}
                      currentLabel={t('version.current')}
                      current={currentSnapshotId === snapshot.id}
                      subtitle={formatSnapshotTime(snapshot.lockedAt, t)}
                      title={snapshot.title}
                    />
                  ))
                )}
              </section>

              <section className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  {t('version.temporaryRecoveryPoint')}
                </div>
                {temporaryRecoveryPoints.length === 0 ? (
                  <EmptyHistoryCard text={t('version.noTemporaryRecoveryPoint')} />
                ) : (
                  temporaryRecoveryPoints.map((snapshot) => (
                    <HistoryCard
                      key={snapshot.id}
                      actions={
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() => void handleRestore(snapshot.id)}
                            disabled={isRestoringId === snapshot.id}
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" />
                            {isRestoringId === snapshot.id
                              ? t('version.restoring')
                              : t('version.restore')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8"
                            onClick={() => void handleTogglePin(snapshot.id, true)}
                            disabled={pinSlotsFull || isPinningId === snapshot.id}
                          >
                            {isPinningId === snapshot.id
                              ? t('common.saving')
                              : pinSlotsFull
                                ? t('version.pinLimitReached')
                                : t('version.pin')}
                          </Button>
                        </>
                      }
                      badge={t('version.temporaryBadge')}
                      currentLabel={t('version.current')}
                      current={currentSnapshotId === snapshot.id}
                      subtitle={formatSnapshotTime(snapshot.lockedAt, t)}
                      title={snapshot.title}
                    />
                  ))
                )}
              </section>

              {pendingStagedChanges.length > 0 ? (
                <section className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                    {t('version.pendingStagedChanges')}
                  </div>
                  {pendingStagedChanges.map((changeSet) => (
                    <div
                      key={changeSet.id}
                      className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-3"
                    >
                      <div className="text-sm font-medium text-foreground">{changeSet.title}</div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {changeSet.summary}
                      </p>
                    </div>
                  ))}
                </section>
              ) : null}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

function HeaderStat({
  emphasized = false,
  label,
  value,
}: {
  emphasized?: boolean;
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={emphasized ? 'font-medium text-foreground' : 'font-medium'}>
        {value}
      </span>
    </span>
  );
}

function HeaderDivider() {
  return <span className="h-3 w-px bg-border/80" aria-hidden="true" />;
}

function HistoryCard({
  actions,
  badge,
  current,
  currentLabel,
  subtitle,
  title,
}: {
  actions: React.ReactNode;
  badge: string;
  current: boolean;
  currentLabel: string;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-medium text-foreground">{title}</div>
            <Badge variant="outline" className="text-[10px]">
              {badge}
            </Badge>
            {current ? (
              <Badge variant="secondary" className="text-[10px]">
                {currentLabel}
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
        </div>
        <div className="flex items-center gap-2">{actions}</div>
      </div>
    </div>
  );
}

function EmptyHistoryCard({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/80 px-4 py-5 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}

function VersionPane({
  label,
  text,
}: {
  label: string;
  text: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-muted/20">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="text-xs font-medium">{label}</div>
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="max-h-[460px] overflow-auto px-3 py-3 text-xs leading-6 text-foreground/90">
        <pre className="whitespace-pre-wrap break-words font-mono">{text}</pre>
      </div>
    </div>
  );
}

function DiffViewer({
  leftLabel,
  rightLabel,
  rows,
}: {
  leftLabel: string;
  rightLabel: string;
  rows: DiffRow[];
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-muted/20">
      <div className="grid grid-cols-2 border-b border-border bg-background/70">
        <div className="border-r border-border px-3 py-2 text-xs font-medium">{leftLabel}</div>
        <div className="px-3 py-2 text-xs font-medium">{rightLabel}</div>
      </div>

      <div className="max-h-[520px] overflow-auto">
        {rows.map((row, index) => (
          <div key={`${row.type}-${index}`} className="grid grid-cols-2 text-xs font-mono leading-6">
            <DiffCell side="left" text={row.left} type={row.type} />
            <DiffCell side="right" text={row.right} type={row.type} />
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffCell({
  side,
  text,
  type,
}: {
  side: 'left' | 'right';
  text: string;
  type: DiffRow['type'];
}) {
  const tone =
    type === 'change'
      ? 'bg-amber-500/10'
      : type === 'add' && side === 'right'
        ? 'bg-emerald-500/10'
        : type === 'remove' && side === 'left'
          ? 'bg-rose-500/10'
          : 'bg-transparent';

  return (
    <div
      className={`min-w-0 border-b border-border/50 px-3 py-1.5 ${side === 'left' ? 'border-r border-border/50' : ''} ${tone}`}
    >
      <pre className="whitespace-pre-wrap break-words">{text || ' '}</pre>
    </div>
  );
}

function getVersionPreviewText(version: DeliverableVersionData) {
  const primary = version.files.find((file) => file.isPrimary) || version.files[0];
  return normalizePreviewText(primary?.content || version.content);
}

function normalizePreviewText(content: string) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return plateToMarkdown(parsed);
    }

    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.files)) {
      const primary =
        parsed.files.find((file: { isPrimary?: boolean }) => file.isPrimary) ||
        parsed.files[0];
      if (primary?.content) {
        return normalizePreviewText(primary.content);
      }
    }
  } catch {
    // fall back to raw content
  }

  return content;
}

function formatSnapshotOptionLabel(
  snapshot: DeliverableVersionData,
  t: ReturnType<typeof useT>
) {
  const prefix = snapshot.visible ? t('version.milestone') : t('version.recoveryPoint');
  return `${prefix} · ${snapshot.title}`;
}

function formatSnapshotTime(
  value: Date | string,
  t: ReturnType<typeof useT>
) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  });

  return t('version.restoredAt', {
    time: formatter.format(new Date(value)),
  });
}

type DiffRow = {
  left: string;
  right: string;
  type: 'equal' | 'add' | 'remove' | 'change';
};

function buildDiffRows(leftText: string, rightText: string): DiffRow[] | null {
  const left = leftText.split('\n');
  const right = rightText.split('\n');

  if (left.length * right.length > 160000) {
    return null;
  }

  const lcs = Array.from({ length: left.length + 1 }, () =>
    Array.from({ length: right.length + 1 }, () => 0)
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      if (left[i] === right[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  const operations: Array<{ left: string; right: string; type: 'equal' | 'add' | 'remove' }> = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      operations.push({ left: left[i], right: right[j], type: 'equal' });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      operations.push({ left: left[i], right: '', type: 'remove' });
      i += 1;
    } else {
      operations.push({ left: '', right: right[j], type: 'add' });
      j += 1;
    }
  }

  while (i < left.length) {
    operations.push({ left: left[i], right: '', type: 'remove' });
    i += 1;
  }

  while (j < right.length) {
    operations.push({ left: '', right: right[j], type: 'add' });
    j += 1;
  }

  const rows: DiffRow[] = [];
  for (let index = 0; index < operations.length; index += 1) {
    const current = operations[index];
    const next = operations[index + 1];

    if (current.type === 'remove' && next?.type === 'add') {
      rows.push({
        left: current.left,
        right: next.right,
        type: 'change',
      });
      index += 1;
      continue;
    }

    rows.push({
      left: current.left,
      right: current.right,
      type: current.type,
    });
  }

  return rows;
}
