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
import type {
  DeliverableVersionData,
  StagedChangeSetData,
  WorkspaceVersionData,
} from '@/types';

export function DeliverableVersionControls({
  currentDraftBaseVersionId,
  currentVersionId,
  currentText,
  onContinueFromVersion,
  onCreateVersion,
  onRestoreVersion,
  onSwitchToVersionBranch,
  onTogglePin,
  onSelectVersion,
  versions = [],
  stagedChangeSets = [],
  workspaceId,
}: {
  currentDraftBaseVersionId?: string | null;
  currentVersionId?: string | null;
  currentText: string;
  onContinueFromVersion?: (version: WorkspaceVersionData) => Promise<void> | void;
  onCreateVersion: () => void;
  onRestoreVersion: (versionId: string) => Promise<void> | void;
  onSwitchToVersionBranch?: (version: WorkspaceVersionData) => Promise<void> | void;
  onTogglePin: (versionId: string, pinned: boolean) => Promise<void> | void;
  onSelectVersion: (versionId: string | null) => void;
  versions?: DeliverableVersionData[];
  stagedChangeSets?: StagedChangeSetData[];
  workspaceId: string;
}) {
  const t = useT();
  const [compareOpen, setCompareOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [allVersions, setAllVersions] = React.useState<WorkspaceVersionData[]>([]);
  const [compareLeftId, setCompareLeftId] = React.useState<string>('draft');
  const [compareRightId, setCompareRightId] = React.useState<string>('draft');
  const [isContinuingId, setIsContinuingId] = React.useState<string | null>(null);
  const [isRestoringId, setIsRestoringId] = React.useState<string | null>(null);
  const [isSwitchingId, setIsSwitchingId] = React.useState<string | null>(null);
  const [isPinningId, setIsPinningId] = React.useState<string | null>(null);

  const loadVersions = React.useCallback(async () => {
    const response = await fetch(`/api/workspaces/${workspaceId}/versions?scope=all`);
    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as DeliverableVersionData[];
    setAllVersions(data);
  }, [workspaceId]);

  React.useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  React.useEffect(() => {
    if (versions.length > 0 || allVersions.length === 0) {
      setAllVersions(versions);
    }
  }, [allVersions.length, versions]);

  React.useEffect(() => {
    if (!compareOpen && !historyOpen) {
      return;
    }

    void loadVersions();
  }, [compareOpen, historyOpen, loadVersions]);

  const visibleVersions = React.useMemo(
    () => allVersions.filter((version) => version.visible),
    [allVersions]
  );
  const versionsById = React.useMemo(
    () => new Map(allVersions.map((version) => [version.id, version])),
    [allVersions]
  );
  const recoveryPoints = React.useMemo(
    () => allVersions.filter((version) => version.restorable && !version.visible),
    [allVersions]
  );
  const pinnedRecoveryPoints = React.useMemo(
    () => recoveryPoints.filter((version) => version.pinned),
    [recoveryPoints]
  );
  const temporaryRecoveryPoints = React.useMemo(
    () => recoveryPoints.filter((version) => version.recoveryKind === 'temporary'),
    [recoveryPoints]
  );
  const pendingStagedChanges = React.useMemo(
    () => stagedChangeSets.filter((changeSet) => changeSet.status === 'pending'),
    [stagedChangeSets]
  );
  const pinSlotsFull = pinnedRecoveryPoints.length >= 3;
  const visibleVersionTree = React.useMemo(
    () =>
      buildVisibleVersionTree({
        currentDraftBaseVersionId: currentDraftBaseVersionId || null,
        versionsById,
        visibleVersions,
      }),
    [currentDraftBaseVersionId, versionsById, visibleVersions]
  );
  const visibleBranchOverview = React.useMemo(
    () =>
      buildVisibleBranchOverview({
        currentDraftBaseVersionId: currentDraftBaseVersionId || null,
        nodes: visibleVersionTree,
      }),
    [currentDraftBaseVersionId, visibleVersionTree]
  );

  React.useEffect(() => {
    if (!compareOpen || visibleVersions.length === 0) {
      return;
    }

    if (compareLeftId === 'draft') {
      setCompareLeftId(visibleVersions[0].id);
    }

    if (compareRightId === compareLeftId && visibleVersions[1]) {
      setCompareRightId(visibleVersions[1].id);
    }
  }, [compareLeftId, compareOpen, compareRightId, visibleVersions]);

  const compareLeftVersion =
    visibleVersions.find((version) => version.id === compareLeftId) || null;
  const compareRightVersion =
    visibleVersions.find((version) => version.id === compareRightId) || null;
  const selectedValue = currentVersionId || 'draft';
  const compareLeftText = compareLeftVersion
    ? getVersionPreviewText(compareLeftVersion)
    : currentText;
  const compareRightText = compareRightVersion
    ? getVersionPreviewText(compareRightVersion)
    : currentText;
  const diffRows = React.useMemo(
    () => buildDiffRows(compareLeftText, compareRightText),
    [compareLeftText, compareRightText]
  );

  const handleRestore = React.useCallback(
    async (versionId: string) => {
      setIsRestoringId(versionId);
      try {
        await onRestoreVersion(versionId);
        await loadVersions();
      } finally {
        setIsRestoringId(null);
      }
    },
    [loadVersions, onRestoreVersion]
  );

  const handleTogglePin = React.useCallback(
    async (versionId: string, pinned: boolean) => {
      setIsPinningId(versionId);
      try {
        await onTogglePin(versionId, pinned);
        await loadVersions();
      } finally {
        setIsPinningId(null);
      }
    },
    [loadVersions, onTogglePin]
  );

  const handleContinue = React.useCallback(
    async (version: WorkspaceVersionData) => {
      if (!onContinueFromVersion) {
        return;
      }

      setIsContinuingId(version.id);
      try {
        setHistoryOpen(false);
        await onContinueFromVersion(version);
      } finally {
        setIsContinuingId(null);
      }
    },
    [onContinueFromVersion]
  );

  const handleSwitchBranch = React.useCallback(
    async (version: WorkspaceVersionData) => {
      if (!onSwitchToVersionBranch) {
        return;
      }

      setIsSwitchingId(version.id);
      try {
        setHistoryOpen(false);
        await onSwitchToVersionBranch(version);
      } finally {
        setIsSwitchingId(null);
      }
    },
    [onSwitchToVersionBranch]
  );
  const openCompareFromVersion = React.useCallback(
    (versionId: string) => {
      setCompareLeftId(versionId);
      setCompareRightId(
        currentDraftBaseVersionId && currentDraftBaseVersionId !== versionId
          ? currentDraftBaseVersionId
          : 'draft'
      );
      setCompareOpen(true);
      setHistoryOpen(false);
    },
    [currentDraftBaseVersionId]
  );
  const openReadOnlyVersion = React.useCallback(
    (versionId: string) => {
      onSelectVersion(versionId);
      setHistoryOpen(false);
    },
    [onSelectVersion]
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
                {formatVersionOptionLabel(version, t)}
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
          data-testid="version-history-button"
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
            <div className="flex items-center gap-3">
              <Select value={compareLeftId} onValueChange={setCompareLeftId}>
                <SelectTrigger
                  className="h-8 w-[240px] text-xs"
                  data-testid="version-compare-left-select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">{t('version.currentDraft')}</SelectItem>
                  {visibleVersions.map((version) => (
                    <SelectItem key={version.id} value={version.id}>
                      {formatVersionOptionLabel(version, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <GitCompareArrows className="h-3.5 w-3.5 text-muted-foreground" />
              <Select value={compareRightId} onValueChange={setCompareRightId}>
                <SelectTrigger
                  className="h-8 w-[240px] text-xs"
                  data-testid="version-compare-right-select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">{t('version.currentDraft')}</SelectItem>
                  {visibleVersions.map((version) => (
                    <SelectItem key={version.id} value={version.id}>
                      {formatVersionOptionLabel(version, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="text-xs text-muted-foreground">
              {t('version.compareDescription')}
            </div>
          </div>

          {diffRows ? (
            <DiffViewer
              leftLabel={
                compareLeftVersion
                  ? formatVersionOptionLabel(compareLeftVersion, t)
                  : t('version.currentDraft')
              }
              rightLabel={
                compareRightVersion
                  ? formatVersionOptionLabel(compareRightVersion, t)
                  : t('version.currentDraft')
              }
              rows={diffRows}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <VersionPane
                label={
                  compareLeftVersion
                    ? formatVersionOptionLabel(compareLeftVersion, t)
                    : t('version.currentDraft')
                }
                text={compareLeftText}
              />
              <VersionPane
                label={
                  compareRightVersion
                    ? formatVersionOptionLabel(compareRightVersion, t)
                    : t('version.currentDraft')
                }
                text={compareRightText}
              />
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
              {visibleBranchOverview.length > 0 ? (
                <section className="space-y-3">
                  <div className="space-y-1">
                    <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                      {t('version.branches')}
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {t('version.branchOverviewDescription')}
                    </p>
                  </div>
                  <div className="space-y-2">
                    {visibleBranchOverview.map((branch) => (
                      <BranchOverviewCard
                        key={branch.head.id}
                        actions={
                          <>
                            {onSwitchToVersionBranch &&
                            currentDraftBaseVersionId !== branch.head.id ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8"
                                data-testid={`version-branch-overview-switch-${branch.head.id}`}
                                onClick={() => void handleSwitchBranch(branch.head)}
                                disabled={isSwitchingId === branch.head.id}
                              >
                                {isSwitchingId === branch.head.id
                                  ? t('version.switchBranchStarting')
                                  : t('version.switchToBranch')}
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8"
                              onClick={() => openCompareFromVersion(branch.head.id)}
                            >
                              {t('version.compare')}
                            </Button>
                          </>
                        }
                        cardTestId={`version-branch-overview-card-${branch.head.id}`}
                        current={currentVersionId === branch.head.id}
                        currentBranch={currentDraftBaseVersionId === branch.head.id}
                        currentBranchLabel={t('version.currentBranch')}
                        currentBranchTestId={`version-branch-overview-current-${branch.head.id}`}
                        currentLabel={t('version.current')}
                        lineage={branch.path.map((version) => version.title).join(' -> ')}
                        lineageLabel={t('version.branchLineage')}
                        milestoneCountLabel={t('version.branchMilestonesCount', {
                          count: String(branch.path.length),
                        })}
                        onOpen={() => openReadOnlyVersion(branch.head.id)}
                        subtitle={formatVersionTime(branch.head.lockedAt, t)}
                        title={branch.head.title}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  {t('version.milestone')}
                </div>
                {visibleVersions.length === 0 ? (
                  <EmptyHistoryCard text={t('version.noVersions')} />
                ) : (
                  visibleVersionTree.map((node) => (
                    <HistoryCard
                      key={node.version.id}
                      actions={
                        <>
                          {onContinueFromVersion ? (
                            <Button
                              size="sm"
                              className="h-8"
                              data-testid={`version-continue-${node.version.id}`}
                              onClick={() => void handleContinue(node.version)}
                              disabled={
                                isContinuingId === node.version.id ||
                                currentDraftBaseVersionId === node.version.id
                              }
                            >
                              {currentDraftBaseVersionId === node.version.id
                                ? t('version.currentDraftBase')
                                : isContinuingId === node.version.id
                                ? t('version.continueStarting')
                                : t('version.continueHere')}
                            </Button>
                          ) : null}
                          {onSwitchToVersionBranch &&
                          node.branchHead &&
                          currentDraftBaseVersionId !== node.version.id ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8"
                              data-testid={`version-switch-branch-${node.version.id}`}
                              onClick={() => void handleSwitchBranch(node.version)}
                              disabled={isSwitchingId === node.version.id}
                            >
                              {isSwitchingId === node.version.id
                                ? t('version.switchBranchStarting')
                                : t('version.switchToBranch')}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8"
                            onClick={() => openCompareFromVersion(node.version.id)}
                          >
                            {t('version.compare')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() => void handleRestore(node.version.id)}
                            disabled={isRestoringId === node.version.id}
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" />
                            {isRestoringId === node.version.id
                              ? t('version.restoring')
                              : t('version.restore')}
                          </Button>
                        </>
                      }
                      badge={t('version.milestone')}
                      branchHead={node.branchHead}
                      branchHeadLabel={t('version.branchHead')}
                      branchHeadTestId={
                        node.branchHead ? `version-branch-head-${node.version.id}` : undefined
                      }
                      cardTestId={`version-history-card-${node.version.id}`}
                      current={currentVersionId === node.version.id}
                      currentLabel={t('version.current')}
                      depth={node.depth}
                      draftBase={currentDraftBaseVersionId === node.version.id}
                      draftBaseLabel={t('version.currentDraftBase')}
                      draftBaseTestId={`version-draft-base-${node.version.id}`}
                      lineage={
                        node.visibleParentId && versionsById.get(node.visibleParentId)
                          ? t('version.basedOn', {
                              title: versionsById.get(node.visibleParentId)!.title,
                            })
                          : null
                      }
                      onOpen={() => openReadOnlyVersion(node.version.id)}
                      subtitle={formatVersionTime(node.version.lockedAt, t)}
                      title={node.version.title}
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
                  pinnedRecoveryPoints.map((version) => (
                    <HistoryCard
                      key={version.id}
                      actions={
                        <>
                          {onContinueFromVersion ? (
                            <Button
                              size="sm"
                              className="h-8"
                              data-testid={`version-continue-${version.id}`}
                              onClick={() => void handleContinue(version)}
                              disabled={isContinuingId === version.id}
                            >
                              {isContinuingId === version.id
                                ? t('version.continueStarting')
                                : t('version.continueHere')}
                            </Button>
                          ) : null}
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
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8"
                            onClick={() => void handleTogglePin(version.id, false)}
                            disabled={isPinningId === version.id}
                          >
                            {isPinningId === version.id
                              ? t('common.saving')
                              : t('version.unpin')}
                          </Button>
                        </>
                      }
                      badge={t('version.pinnedBadge')}
                      branchHead={false}
                      branchHeadLabel={t('version.branchHead')}
                      draftBase={currentDraftBaseVersionId === version.id}
                      draftBaseLabel={t('version.currentDraftBase')}
                      currentLabel={t('version.current')}
                      current={currentVersionId === version.id}
                      depth={0}
                      draftBaseTestId={`version-draft-base-${version.id}`}
                      lineage={
                        version.parentVersionId && versionsById.get(version.parentVersionId)
                          ? t('version.basedOn', {
                              title: versionsById.get(version.parentVersionId)!.title,
                            })
                          : null
                      }
                      subtitle={formatVersionTime(version.lockedAt, t)}
                      title={version.title}
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
                  temporaryRecoveryPoints.map((version) => (
                    <HistoryCard
                      key={version.id}
                      actions={
                        <>
                          {onContinueFromVersion ? (
                            <Button
                              size="sm"
                              className="h-8"
                              data-testid={`version-continue-${version.id}`}
                              onClick={() => void handleContinue(version)}
                              disabled={isContinuingId === version.id}
                            >
                              {isContinuingId === version.id
                                ? t('version.continueStarting')
                                : t('version.continueHere')}
                            </Button>
                          ) : null}
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
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8"
                            onClick={() => void handleTogglePin(version.id, true)}
                            disabled={pinSlotsFull || isPinningId === version.id}
                          >
                            {isPinningId === version.id
                              ? t('common.saving')
                              : pinSlotsFull
                                ? t('version.pinLimitReached')
                                : t('version.pin')}
                          </Button>
                        </>
                      }
                      badge={t('version.temporaryBadge')}
                      branchHead={false}
                      branchHeadLabel={t('version.branchHead')}
                      draftBase={currentDraftBaseVersionId === version.id}
                      draftBaseLabel={t('version.currentDraftBase')}
                      currentLabel={t('version.current')}
                      current={currentVersionId === version.id}
                      depth={0}
                      draftBaseTestId={`version-draft-base-${version.id}`}
                      lineage={
                        version.parentVersionId && versionsById.get(version.parentVersionId)
                          ? t('version.basedOn', {
                              title: versionsById.get(version.parentVersionId)!.title,
                            })
                          : null
                      }
                      subtitle={formatVersionTime(version.lockedAt, t)}
                      title={version.title}
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

function BranchOverviewCard({
  actions,
  cardTestId,
  current,
  currentBranch,
  currentBranchLabel,
  currentBranchTestId,
  currentLabel,
  lineage,
  lineageLabel,
  milestoneCountLabel,
  onOpen,
  subtitle,
  title,
}: {
  actions: React.ReactNode;
  cardTestId?: string;
  current: boolean;
  currentBranch: boolean;
  currentBranchLabel: string;
  currentBranchTestId?: string;
  currentLabel: string;
  lineage: string;
  lineageLabel: string;
  milestoneCountLabel: string;
  onOpen?: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <div
      className={[
        'rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 shadow-sm',
        onOpen
          ? 'cursor-pointer transition-colors hover:border-foreground/20 hover:bg-muted/30 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
          : '',
      ].join(' ')}
      data-testid={cardTestId}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-sm font-medium text-foreground">{title}</div>
            {currentBranch ? (
              <Badge
                variant="secondary"
                className="text-[10px]"
                data-testid={currentBranchTestId}
              >
                {currentBranchLabel}
              </Badge>
            ) : null}
            {current ? (
              <Badge variant="outline" className="text-[10px]">
                {currentLabel}
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px] font-normal">
              {milestoneCountLabel}
            </Badge>
            <span>
              <span className="font-medium text-foreground/80">{lineageLabel}</span>
              {': '}
              {lineage}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
          {actions}
        </div>
      </div>
    </div>
  );
}

function HistoryCard({
  actions,
  badge,
  branchHead,
  branchHeadLabel,
  branchHeadTestId,
  cardTestId,
  current,
  currentLabel,
  depth,
  draftBase,
  draftBaseLabel,
  draftBaseTestId,
  lineage,
  onOpen,
  subtitle,
  title,
}: {
  actions: React.ReactNode;
  badge: string;
  branchHead: boolean;
  branchHeadLabel: string;
  branchHeadTestId?: string;
  cardTestId?: string;
  current: boolean;
  currentLabel: string;
  depth: number;
  draftBase: boolean;
  draftBaseLabel: string;
  draftBaseTestId?: string;
  lineage: string | null;
  onOpen?: () => void;
  subtitle: string;
  title: string;
}) {
  const indent = depth * 18;
  return (
    <div className="relative" style={indent > 0 ? { paddingLeft: `${indent}px` } : undefined}>
      {depth > 0 ? (
        <>
          <div
            className="pointer-events-none absolute bottom-0 top-0 w-px bg-border/60"
            style={{ left: `${indent - 10}px` }}
          />
          <div
            className="pointer-events-none absolute h-px w-3 bg-border/60"
            style={{ left: `${indent - 10}px`, top: '28px' }}
          />
        </>
      ) : null}
      <div
        className={[
          'rounded-2xl border border-border/70 bg-background px-4 py-3 shadow-sm',
          onOpen
            ? 'cursor-pointer transition-colors hover:border-foreground/20 hover:bg-muted/10 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
            : '',
        ].join(' ')}
        data-lineage-depth={depth}
        data-testid={cardTestId}
        onClick={onOpen}
        onKeyDown={
          onOpen
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpen();
                }
              }
            : undefined
        }
        role={onOpen ? 'button' : undefined}
        tabIndex={onOpen ? 0 : undefined}
      >
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
              {draftBase ? (
                <Badge
                  variant="secondary"
                  className="text-[10px]"
                  data-testid={draftBaseTestId}
                >
                  {draftBaseLabel}
                </Badge>
              ) : null}
              {branchHead ? (
                <Badge
                  variant="outline"
                  className="text-[10px]"
                  data-testid={branchHeadTestId}
                >
                  {branchHeadLabel}
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
            {lineage ? (
              <div className="mt-1 text-xs text-muted-foreground">{lineage}</div>
            ) : null}
          </div>
          <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
            {actions}
          </div>
        </div>
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

function formatVersionOptionLabel(
  version: DeliverableVersionData,
  t: ReturnType<typeof useT>
) {
  const prefix = version.visible ? t('version.milestone') : t('version.recoveryPoint');
  return `${prefix} · ${version.title}`;
}

function formatVersionTime(
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

type VisibleVersionTreeNode = {
  branchHead: boolean;
  depth: number;
  version: DeliverableVersionData;
  visibleParentId: string | null;
};

type VisibleVersionBranch = {
  head: DeliverableVersionData;
  path: DeliverableVersionData[];
};

function buildVisibleVersionTree(params: {
  currentDraftBaseVersionId: string | null;
  versionsById: Map<string, WorkspaceVersionData>;
  visibleVersions: DeliverableVersionData[];
}): VisibleVersionTreeNode[] {
  const visibleIds = new Set(params.visibleVersions.map((version) => version.id));
  const visibleParentById = new Map<string, string | null>();
  const childrenByParent = new Map<string | null, DeliverableVersionData[]>();

  for (const version of params.visibleVersions) {
    const visibleParentId = findNearestVisibleAncestorId(
      version.parentVersionId,
      params.versionsById,
      visibleIds
    );
    visibleParentById.set(version.id, visibleParentId);
    const siblings = childrenByParent.get(visibleParentId) || [];
    siblings.push(version);
    childrenByParent.set(visibleParentId, siblings);
  }

  const subtreeHasCurrent = new Map<string, boolean>();
  const visitCurrentSubtree = (versionId: string): boolean => {
    const cached = subtreeHasCurrent.get(versionId);
    if (cached !== undefined) {
      return cached;
    }

    const children = childrenByParent.get(versionId) || [];
    const result =
      versionId === params.currentDraftBaseVersionId ||
      children.some((child) => visitCurrentSubtree(child.id));
    subtreeHasCurrent.set(versionId, result);
    return result;
  };

  const sortSiblings = (left: DeliverableVersionData, right: DeliverableVersionData) => {
    const leftContainsCurrent = visitCurrentSubtree(left.id);
    const rightContainsCurrent = visitCurrentSubtree(right.id);
    if (leftContainsCurrent !== rightContainsCurrent) {
      return leftContainsCurrent ? -1 : 1;
    }
    return left.versionNum - right.versionNum;
  };

  for (const children of childrenByParent.values()) {
    children.sort(sortSiblings);
  }

  const ordered: VisibleVersionTreeNode[] = [];
  const roots = [...(childrenByParent.get(null) || [])].sort(sortSiblings);
  const walk = (version: DeliverableVersionData, depth: number) => {
    const children = childrenByParent.get(version.id) || [];
    ordered.push({
      branchHead:
        children.length === 0 && params.currentDraftBaseVersionId !== version.id,
      depth,
      version,
      visibleParentId: visibleParentById.get(version.id) || null,
    });
    for (const child of children) {
      walk(child, depth + 1);
    }
  };

  for (const root of roots) {
    walk(root, 0);
  }

  return ordered;
}

function buildVisibleBranchOverview(params: {
  currentDraftBaseVersionId: string | null;
  nodes: VisibleVersionTreeNode[];
}): VisibleVersionBranch[] {
  const nodesById = new Map(params.nodes.map((node) => [node.version.id, node]));
  const parentIds = new Set(
    params.nodes
      .map((node) => node.visibleParentId)
      .filter((value): value is string => Boolean(value))
  );
  const branches = params.nodes
    .filter((node) => !parentIds.has(node.version.id))
    .map((node) => {
      const path: DeliverableVersionData[] = [];
      let currentNode: VisibleVersionTreeNode | undefined = node;

      while (currentNode) {
        path.unshift(currentNode.version);
        currentNode = currentNode.visibleParentId
          ? nodesById.get(currentNode.visibleParentId)
          : undefined;
      }

      return {
        head: node.version,
        path,
      };
    });

  branches.sort((left, right) => {
    const leftIsCurrent = left.head.id === params.currentDraftBaseVersionId;
    const rightIsCurrent = right.head.id === params.currentDraftBaseVersionId;
    if (leftIsCurrent !== rightIsCurrent) {
      return leftIsCurrent ? -1 : 1;
    }
    return left.head.versionNum - right.head.versionNum;
  });

  return branches;
}

function findNearestVisibleAncestorId(
  parentVersionId: string | null,
  versionsById: Map<string, WorkspaceVersionData>,
  visibleIds: Set<string>
) {
  let currentId = parentVersionId;
  while (currentId) {
    const current = versionsById.get(currentId);
    if (!current) {
      return null;
    }
    if (visibleIds.has(current.id)) {
      return current.id;
    }
    currentId = current.parentVersionId;
  }
  return null;
}

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
