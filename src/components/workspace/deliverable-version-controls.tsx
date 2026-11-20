'use client';

import * as React from 'react';
import {
  GitBranch,
  GitCompareArrows,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useT } from '@/components/providers/language-provider';
import { apiCall } from '@/framework/resilience';
import { StagedChangeReviewDialog } from './deliverable-staged-review-dialog';
import { VersionCompareDialog } from './deliverable-version-compare-dialog';
import {
  buildDiffRows,
  buildVisibleBranchOverview,
  buildVisibleBranchWorkspace,
  buildVisibleVersionTree,
  formatVersionOptionLabel,
  formatVersionTime,
  getFirstCompareSelection,
  getVersionPreviewText,
  isCompareSelectionAllowed,
  mergeWorkspaceVersions,
  resolveDefaultCompareAnchor,
} from './deliverable-version-helpers';
import {
  BranchOverviewCard,
  EmptyHistoryCard,
  HeaderDivider,
  HeaderStat,
  HistoryCard,
} from './deliverable-version-views';

import type {
  DeliverableVersionData,
  StagedChangeSetData,
  WorkspaceVersionData,
} from '@/types';

export function DeliverableVersionControls({
  currentDraftBaseVersionId,
  currentVersionId,
  currentText,
  interactionsEnabled = true,
  onContinueFromVersion,
  onCreateVersion,
  onRestoreVersion,
  onStagedChangeDecided,
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
  interactionsEnabled?: boolean;
  onContinueFromVersion?: (version: WorkspaceVersionData) => Promise<void> | void;
  onCreateVersion: () => void;
  onRestoreVersion: (versionId: string) => Promise<void> | void;
  onStagedChangeDecided?: (action: 'apply' | 'discard') => Promise<void> | void;
  onSwitchToVersionBranch?: (version: WorkspaceVersionData) => Promise<void> | void;
  onTogglePin: (versionId: string, pinned: boolean) => Promise<void> | void;
  onSelectVersion: (versionId: string | null) => void;
  versions?: DeliverableVersionData[];
  stagedChangeSets?: StagedChangeSetData[];
  workspaceId: string;
}) {
  const t = useT();
  const [compareOpen, setCompareOpen] = React.useState(false);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [versionTreeOpen, setVersionTreeOpen] = React.useState(false);
  const [allVersions, setAllVersions] = React.useState<WorkspaceVersionData[]>([]);
  const [compareLeftId, setCompareLeftId] = React.useState<string>('draft');
  const [compareRightId, setCompareRightId] = React.useState<string>('draft');
  const [compareBranchHeadId, setCompareBranchHeadId] = React.useState<string | null>(null);
  const [compareCrossBranchMode, setCompareCrossBranchMode] = React.useState(false);
  const [versionTreeFocusedBranchHeadId, setVersionTreeFocusedBranchHeadId] =
    React.useState<string | null>(null);
  const [isContinuingId, setIsContinuingId] = React.useState<string | null>(null);
  const [isRestoringId, setIsRestoringId] = React.useState<string | null>(null);
  const [isSwitchingId, setIsSwitchingId] = React.useState<string | null>(null);
  const [isPinningId, setIsPinningId] = React.useState<string | null>(null);
  const [optimisticDraftBaseVersionId, setOptimisticDraftBaseVersionId] =
    React.useState<string | null>(null);

  const loadVersions = React.useCallback(async () => {
    const result = await apiCall<DeliverableVersionData[]>(
      `/api/workspaces/${workspaceId}/versions?scope=all`
    );
    if (!result.ok) {
      return;
    }

    setAllVersions(result.data || []);
  }, [workspaceId]);

  React.useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  React.useEffect(() => {
    if (versions.length === 0) {
      return;
    }

    setAllVersions((current) => mergeWorkspaceVersions(current, versions));
  }, [versions]);

  React.useEffect(() => {
    if (
      optimisticDraftBaseVersionId &&
      currentDraftBaseVersionId === optimisticDraftBaseVersionId
    ) {
      setOptimisticDraftBaseVersionId(null);
    }
  }, [currentDraftBaseVersionId, optimisticDraftBaseVersionId]);

  React.useEffect(() => {
    setOptimisticDraftBaseVersionId(null);
  }, [workspaceId]);

  const visibleVersions = React.useMemo(
    () => allVersions.filter((version) => version.visible),
    [allVersions]
  );
  const draftBaseVersionId = optimisticDraftBaseVersionId || currentDraftBaseVersionId || null;
  const visibleVersionIds = React.useMemo(
    () => new Set(visibleVersions.map((version) => version.id)),
    [visibleVersions]
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
        currentDraftBaseVersionId: draftBaseVersionId,
        versionsById,
        visibleVersions,
      }),
    [draftBaseVersionId, versionsById, visibleVersions]
  );
  const visibleBranchOverview = React.useMemo(
    () =>
      buildVisibleBranchOverview({
        currentDraftBaseVersionId: draftBaseVersionId,
        nodes: visibleVersionTree,
      }),
    [draftBaseVersionId, visibleVersionTree]
  );
  const focusedBranch = React.useMemo(
    () =>
      visibleBranchOverview.find((branch) => branch.head.id === versionTreeFocusedBranchHeadId) ||
      null,
    [versionTreeFocusedBranchHeadId, visibleBranchOverview]
  );
  const compareBranch = React.useMemo(
    () =>
      visibleBranchOverview.find((branch) => branch.head.id === compareBranchHeadId) || null,
    [compareBranchHeadId, visibleBranchOverview]
  );
  const compareBranchIds = React.useMemo(
    () => new Set(compareBranch?.path.map((version) => version.id) || []),
    [compareBranch]
  );
  const compareScopedToBranch = Boolean(compareBranch && !compareCrossBranchMode);
  const compareSelectableVersions = React.useMemo(() => {
    if (!compareScopedToBranch) {
      return visibleVersions;
    }

    return visibleVersions.filter((version) => compareBranchIds.has(version.id));
  }, [compareBranchIds, compareScopedToBranch, visibleVersions]);
  const compareDraftAllowed = React.useMemo(() => {
    if (!compareScopedToBranch) {
      return true;
    }

    return Boolean(draftBaseVersionId && compareBranchIds.has(draftBaseVersionId));
  }, [compareBranchIds, compareScopedToBranch, draftBaseVersionId]);
  const focusedBranchWorkspace = React.useMemo(() => {
    if (!focusedBranch) {
      return null;
    }

    return buildVisibleBranchWorkspace({
      branch: focusedBranch,
      nodes: visibleVersionTree,
      recoveryPoints,
      versionsById,
      visibleIds: visibleVersionIds,
    });
  }, [focusedBranch, recoveryPoints, versionsById, visibleVersionIds, visibleVersionTree]);
  const historyVisibleVersionTree = React.useMemo(() => {
    if (!focusedBranch) {
      return visibleVersionTree;
    }

    const branchIds = new Set(focusedBranch.path.map((version) => version.id));
    return visibleVersionTree.filter((node) => branchIds.has(node.version.id));
  }, [focusedBranch, visibleVersionTree]);

  React.useEffect(() => {
    if (!compareOpen) {
      return;
    }

    if (!compareBranchHeadId || compareBranch) {
      return;
    }

    setCompareBranchHeadId(null);
    setCompareCrossBranchMode(false);
  }, [compareBranch, compareBranchHeadId, compareOpen]);

  React.useEffect(() => {
    if (!compareOpen) {
      return;
    }

    if (compareSelectableVersions.length === 0 && !compareDraftAllowed) {
      return;
    }

    const leftSelectable = isCompareSelectionAllowed({
      allowDraft: compareDraftAllowed,
      selectableVersions: compareSelectableVersions,
      value: compareLeftId,
    });

    if (!leftSelectable) {
      const fallbackLeftId = getFirstCompareSelection({
        allowDraft: compareDraftAllowed,
        selectableVersions: compareSelectableVersions,
      });
      setCompareLeftId(fallbackLeftId);
      return;
    }

    const rightSelectable = isCompareSelectionAllowed({
      allowDraft: compareDraftAllowed,
      selectableVersions: compareSelectableVersions,
      value: compareRightId,
    });

    if (!rightSelectable || compareRightId === compareLeftId) {
      setCompareRightId(
        resolveDefaultCompareAnchor({
          allowDraft: compareDraftAllowed,
          branch: compareScopedToBranch ? compareBranch : null,
          currentDraftBaseVersionId: currentDraftBaseVersionId || null,
          selectableVersions: compareSelectableVersions,
          selectedVersionId: compareLeftId,
        })
      );
    }
  }, [
    compareBranch,
    compareDraftAllowed,
    compareLeftId,
    compareOpen,
    compareRightId,
    compareScopedToBranch,
    compareSelectableVersions,
    currentDraftBaseVersionId,
  ]);

  React.useEffect(() => {
    if (versionTreeOpen) {
      return;
    }

    setVersionTreeFocusedBranchHeadId(null);
  }, [versionTreeOpen]);

  React.useEffect(() => {
    if (!versionTreeFocusedBranchHeadId || focusedBranch) {
      return;
    }

    setVersionTreeFocusedBranchHeadId(null);
  }, [focusedBranch, versionTreeFocusedBranchHeadId]);

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
        await onContinueFromVersion(version);
        await loadVersions();
        setVersionTreeOpen(false);
      } finally {
        setIsContinuingId(null);
      }
    },
    [loadVersions, onContinueFromVersion]
  );

  const handleSwitchBranch = React.useCallback(
    async (version: WorkspaceVersionData) => {
      if (!onSwitchToVersionBranch) {
        return;
      }

      setIsSwitchingId(version.id);
      try {
        setOptimisticDraftBaseVersionId(version.id);
        await onSwitchToVersionBranch(version);
        await loadVersions();
        setVersionTreeOpen(false);
      } catch (error) {
        setOptimisticDraftBaseVersionId(null);
        throw error;
      } finally {
        setIsSwitchingId(null);
      }
    },
    [loadVersions, onSwitchToVersionBranch]
  );
  const openCompareFromVersion = React.useCallback(
    (
      versionId: string,
      options?: {
        branchHeadId?: string | null;
      }
    ) => {
      const scopedBranch =
        options?.branchHeadId
          ? visibleBranchOverview.find((branch) => branch.head.id === options.branchHeadId) || null
          : null;
      const scopedVersions =
        scopedBranch?.path.filter((version) => visibleVersionIds.has(version.id)) || visibleVersions;
      const allowDraft = Boolean(
        scopedBranch
          ? draftBaseVersionId &&
              scopedBranch.path.some((version) => version.id === draftBaseVersionId)
          : true
      );

      setCompareBranchHeadId(options?.branchHeadId || null);
      setCompareCrossBranchMode(false);
      setCompareLeftId(versionId);
      setCompareRightId(
        resolveDefaultCompareAnchor({
          allowDraft,
          branch: scopedBranch,
          currentDraftBaseVersionId: draftBaseVersionId,
          selectableVersions: scopedVersions,
          selectedVersionId: versionId,
        })
      );
      setCompareOpen(true);
      setVersionTreeOpen(false);
    },
    [draftBaseVersionId, visibleBranchOverview, visibleVersionIds, visibleVersions]
  );
  const openReadOnlyVersion = React.useCallback(
    (versionId: string) => {
      onSelectVersion(versionId);
      setVersionTreeOpen(false);
    },
    [onSelectVersion]
  );
  const renderMilestoneActions = React.useCallback(
    (
      version: WorkspaceVersionData,
      branchHead: boolean,
      compareScopeBranchHeadId?: string | null
    ) => (
      <>
        {onContinueFromVersion ? (
          <Button
            size="sm"
            className="h-8"
            data-testid={`version-continue-${version.id}`}
            onClick={() => void handleContinue(version)}
            title={t('version.continueHereHint')}
            disabled={
              isContinuingId === version.id || draftBaseVersionId === version.id
            }
          >
            {draftBaseVersionId === version.id
              ? t('version.currentDraftBase')
              : isContinuingId === version.id
                ? t('version.continueStarting')
                : t('version.continueHere')}
          </Button>
        ) : null}
        {onSwitchToVersionBranch && branchHead && draftBaseVersionId !== version.id ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            data-testid={`version-switch-branch-${version.id}`}
            onClick={() => void handleSwitchBranch(version)}
            disabled={isSwitchingId === version.id}
          >
            {isSwitchingId === version.id
              ? t('version.switchBranchStarting')
              : t('version.switchToBranch')}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="h-8"
          onClick={() =>
            openCompareFromVersion(version.id, {
              branchHeadId: compareScopeBranchHeadId || null,
            })
          }
        >
          {t('version.compare')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => void handleRestore(version.id)}
          title={t('version.restoreHint')}
          disabled={isRestoringId === version.id}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          {isRestoringId === version.id ? t('version.restoring') : t('version.restore')}
        </Button>
      </>
    ),
    [
      draftBaseVersionId,
      handleContinue,
      handleRestore,
      handleSwitchBranch,
      isContinuingId,
      isRestoringId,
      isSwitchingId,
      onContinueFromVersion,
      onSwitchToVersionBranch,
      openCompareFromVersion,
      t,
    ]
  );
  const renderRecoveryActions = React.useCallback(
    (version: WorkspaceVersionData) => (
      <>
        {onContinueFromVersion ? (
          <Button
            size="sm"
            className="h-8"
            data-testid={`version-continue-${version.id}`}
            onClick={() => void handleContinue(version)}
            title={t('version.continueHereHint')}
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
          title={t('version.restoreHint')}
          disabled={isRestoringId === version.id}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          {isRestoringId === version.id ? t('version.restoring') : t('version.restore')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8"
          onClick={() => void handleTogglePin(version.id, !version.pinned)}
          disabled={isPinningId === version.id || (!version.pinned && pinSlotsFull)}
        >
          {isPinningId === version.id
            ? t('common.saving')
            : version.pinned
              ? t('version.unpin')
              : pinSlotsFull
                ? t('version.pinLimitReached')
                : t('version.pin')}
        </Button>
      </>
    ),
    [
      handleContinue,
      handleRestore,
      handleTogglePin,
      isContinuingId,
      isPinningId,
      isRestoringId,
      onContinueFromVersion,
      pinSlotsFull,
      t,
    ]
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {pendingStagedChanges.length > 0 ? (
          <Button
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setReviewOpen(true)}
            data-testid="staged-review-trigger"
            disabled={!interactionsEnabled}
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-xs font-medium">{t('version.reviewChanges')}</span>
            <Badge variant="secondary" className="ml-0.5 h-5 px-1.5 text-[10px]">
              {pendingStagedChanges.length}
            </Badge>
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          onClick={() => setVersionTreeOpen(true)}
          data-testid="version-tree-button"
          disabled={!interactionsEnabled}
        >
          <GitBranch className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">{t('version.tree')}</span>
          {visibleVersions.length > 0 ? (
            <Badge variant="secondary" className="ml-0.5 h-5 px-1.5 text-[10px]">
              {visibleVersions.length}
            </Badge>
          ) : null}
        </Button>
        <Button size="sm" className="h-8" onClick={onCreateVersion} disabled={!interactionsEnabled}>
          {t('version.createVersion')}
        </Button>
      </div>

      <StagedChangeReviewDialog
        allVersions={allVersions}
        currentText={currentText}
        interactionsEnabled={interactionsEnabled}
        onLoadVersions={loadVersions}
        onOpenChange={setReviewOpen}
        onStagedChangeDecided={onStagedChangeDecided}
        open={reviewOpen}
        pendingStagedChanges={pendingStagedChanges}
        t={t}
        workspaceId={workspaceId}
      />

      <VersionCompareDialog
        compareBranch={compareBranch}
        compareDraftAllowed={compareDraftAllowed}
        compareLeftId={compareLeftId}
        compareLeftText={compareLeftText}
        compareLeftVersion={compareLeftVersion}
        compareRightId={compareRightId}
        compareRightText={compareRightText}
        compareRightVersion={compareRightVersion}
        compareScopedToBranch={compareScopedToBranch}
        compareSelectableVersions={compareSelectableVersions}
        diffRows={diffRows}
        onCompareLeftIdChange={setCompareLeftId}
        onCompareRightIdChange={setCompareRightId}
        onOpenChange={setCompareOpen}
        onToggleCrossBranchMode={() => setCompareCrossBranchMode((current) => !current)}
        open={compareOpen}
        t={t}
      />

      <Sheet open={versionTreeOpen} onOpenChange={setVersionTreeOpen}>
        <SheetContent
          side="right"
          className="w-full p-0 transition-none data-[state=open]:animate-none data-[state=closed]:animate-none sm:max-w-[980px]"
        >
          <SheetHeader className="gap-3 border-b px-6 py-5 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">
                {t('version.tree')}
              </Badge>
              <div
                className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                data-testid="version-tree-header-stats"
              >
                <HeaderStat
                  label={t('version.savedMilestonesStat')}
                  value={String(visibleVersions.length)}
                />
                <HeaderDivider />
                <HeaderStat
                  label={t('version.pinnedRecoveryStat')}
                  value={`${pinnedRecoveryPoints.length}/3`}
                />
                <HeaderDivider />
                <HeaderStat
                  label={t('version.latestTemporaryStat')}
                  value={String(temporaryRecoveryPoints.length)}
                  emphasized={temporaryRecoveryPoints.length > 0}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={selectedValue}
                onValueChange={(value) => onSelectVersion(value === 'draft' ? null : value)}
              >
                <SelectTrigger
                  aria-label={t('version.selectVersion')}
                  className="h-8 w-[200px] text-xs"
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
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => {
                  setCompareBranchHeadId(null);
                  setCompareCrossBranchMode(false);
                  setCompareOpen(true);
                }}
                disabled={visibleVersions.length === 0}
              >
                <GitCompareArrows className="mr-1 h-3.5 w-3.5" />
                {t('version.compare')}
              </Button>
            </div>
            <SheetTitle>{t('version.tree')}</SheetTitle>
            <SheetDescription className="text-xs leading-5">
              {t('version.milestoneVsRecoveryHint')}
            </SheetDescription>
            <div
              className="grid gap-2 pt-1 sm:grid-cols-3"
              data-testid="version-layers-summary"
            >
              <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                <div className="text-xs font-medium text-foreground">
                  {t('version.currentDraft')}
                </div>
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                  {t('version.currentDraftLayerHint')}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                <div className="text-xs font-medium text-foreground">
                  {t('version.milestone')}
                </div>
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                  {t('version.milestoneLayerHint')}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                <div className="text-xs font-medium text-foreground">
                  {t('version.recoverySafetyNet')}
                </div>
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                  {t('version.recoveryLayerHint')}
                </p>
              </div>
            </div>
          </SheetHeader>

          <ScrollArea
            className="min-h-0 flex-1 px-6 py-5"
            viewportProps={{
              'aria-label': t('version.tree'),
              tabIndex: 0,
            }}
          >
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
                            draftBaseVersionId !== branch.head.id ? (
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
                              variant={
                                versionTreeFocusedBranchHeadId === branch.head.id
                                  ? 'secondary'
                                  : 'ghost'
                              }
                              className="h-8"
                              data-testid={`version-branch-overview-focus-${branch.head.id}`}
                              onClick={() => setVersionTreeFocusedBranchHeadId(branch.head.id)}
                            >
                              {versionTreeFocusedBranchHeadId === branch.head.id
                                ? t('version.viewingBranch')
                                : t('version.viewBranch')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8"
                              onClick={() =>
                                openCompareFromVersion(branch.head.id, {
                                  branchHeadId: branch.head.id,
                                })
                              }
                            >
                              {t('version.compare')}
                            </Button>
                          </>
                        }
                        cardTestId={`version-branch-overview-card-${branch.head.id}`}
                        current={currentVersionId === branch.head.id}
                        currentBranch={draftBaseVersionId === branch.head.id}
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

              {focusedBranch ? (
                <section className="space-y-3">
                  <div
                    className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
                    data-testid="version-branch-focus-banner"
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">
                          {t('version.viewingBranch')}
                        </Badge>
                        <div className="text-sm font-medium text-foreground">
                          {t('version.branchFocusTitle', {
                            title: focusedBranch.head.title,
                          })}
                        </div>
                      </div>
                      <p className="text-xs leading-5 text-muted-foreground">
                        {t('version.branchFocusDescription')}
                      </p>
                      <div className="text-xs leading-5 text-muted-foreground">
                        <span className="font-medium text-foreground/80">
                          {t('version.branchLineage')}
                        </span>
                        {': '}
                        {focusedBranch.path.map((version) => version.title).join(' -> ')}
                      </div>
                      {focusedBranchWorkspace ? (
                        <div
                          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
                          data-testid="version-branch-workspace-stats"
                        >
                          <HeaderStat
                            label={t('version.savedMilestonesStat')}
                            value={String(focusedBranch.path.length)}
                          />
                          <HeaderDivider />
                          <HeaderStat
                            label={t('version.recoveryPointsStat')}
                            value={String(focusedBranchWorkspace.recoveryCount)}
                            emphasized={focusedBranchWorkspace.recoveryCount > 0}
                          />
                          <HeaderDivider />
                          <HeaderStat
                            label={t('version.pinnedRecoveryStat')}
                            value={String(focusedBranchWorkspace.pinnedRecoveryCount)}
                            emphasized={focusedBranchWorkspace.pinnedRecoveryCount > 0}
                          />
                          <HeaderDivider />
                          <HeaderStat
                            label={t('version.latestTemporaryStat')}
                            value={String(focusedBranchWorkspace.temporaryRecoveryCount)}
                            emphasized={focusedBranchWorkspace.temporaryRecoveryCount > 0}
                          />
                        </div>
                      ) : null}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0"
                      data-testid="version-branch-focus-clear"
                      onClick={() => setVersionTreeFocusedBranchHeadId(null)}
                    >
                      {t('version.showAllBranches')}
                    </Button>
                  </div>
                </section>
              ) : null}

              {focusedBranch && focusedBranchWorkspace ? (
                <section className="space-y-3" data-testid="version-branch-workspace">
                  <div className="space-y-1">
                    <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                      {t('version.branchWorkspace')}
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {t('version.branchWorkspaceDescription')}
                    </p>
                  </div>
                  {focusedBranchWorkspace.sections.map((section) => (
                    <div
                      key={section.node.version.id}
                      className="space-y-2"
                      data-testid={`version-branch-workspace-section-${section.node.version.id}`}
                    >
                      <HistoryCard
                        actions={renderMilestoneActions(
                          section.node.version,
                          section.node.branchHead,
                          focusedBranch.head.id
                        )}
                        badge={t('version.milestone')}
                        branchHead={section.node.branchHead}
                        branchHeadLabel={t('version.branchHead')}
                        branchHeadTestId={
                          section.node.branchHead
                            ? `version-branch-head-${section.node.version.id}`
                            : undefined
                        }
                        cardTestId={`version-history-card-${section.node.version.id}`}
                        current={currentVersionId === section.node.version.id}
                        currentLabel={t('version.current')}
                        depth={section.node.depth}
                        draftBase={draftBaseVersionId === section.node.version.id}
                        draftBaseLabel={t('version.currentDraftBase')}
                        draftBaseTestId={`version-draft-base-${section.node.version.id}`}
                        lineage={
                          section.node.visibleParentId &&
                          versionsById.get(section.node.visibleParentId)
                            ? t('version.basedOn', {
                                title: versionsById.get(section.node.visibleParentId)!.title,
                              })
                            : null
                        }
                        onOpen={() => openReadOnlyVersion(section.node.version.id)}
                        subtitle={formatVersionTime(section.node.version.lockedAt, t)}
                        title={section.node.version.title}
                      />
                      {section.recoveryPoints.map((version) => (
                        <HistoryCard
                          key={version.id}
                          actions={renderRecoveryActions(version)}
                          badge={
                            version.pinned
                              ? t('version.pinnedBadge')
                              : t('version.temporaryBadge')
                          }
                          branchHead={false}
                          branchHeadLabel={t('version.branchHead')}
                          cardTestId={`version-branch-recovery-${version.id}`}
                          current={currentVersionId === version.id}
                          currentLabel={t('version.current')}
                          depth={section.node.depth + 1}
                          draftBase={draftBaseVersionId === version.id}
                          draftBaseLabel={t('version.currentDraftBase')}
                          draftBaseTestId={`version-draft-base-${version.id}`}
                          lineage={t('version.basedOn', {
                            title: section.node.version.title,
                          })}
                          subtitle={formatVersionTime(version.lockedAt, t)}
                          title={version.title}
                        />
                      ))}
                    </div>
                  ))}
                  {focusedBranchWorkspace.recoveryCount === 0 ? (
                    <EmptyHistoryCard
                      text={t('version.noBranchRecoveryPoints')}
                      testId="version-branch-workspace-empty"
                    />
                  ) : null}
                </section>
              ) : (
                <>
                  <section className="space-y-2">
                    <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                      {t('version.milestone')}
                    </div>
                    {historyVisibleVersionTree.length === 0 ? (
                      <EmptyHistoryCard text={t('version.noVersions')} />
                    ) : (
                      historyVisibleVersionTree.map((node) => (
                        <HistoryCard
                          key={node.version.id}
                          actions={renderMilestoneActions(node.version, node.branchHead)}
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
                          draftBase={draftBaseVersionId === node.version.id}
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
                      {t('version.globalPinnedRecoveryPoints')}
                    </div>
                    {pinnedRecoveryPoints.length === 0 ? (
                      <EmptyHistoryCard text={t('version.noPinnedRecoveryPoints')} />
                    ) : (
                      pinnedRecoveryPoints.map((version) => (
                        <HistoryCard
                          key={version.id}
                          actions={renderRecoveryActions(version)}
                          badge={t('version.pinnedBadge')}
                          branchHead={false}
                          branchHeadLabel={t('version.branchHead')}
                          current={currentVersionId === version.id}
                          currentLabel={t('version.current')}
                          depth={0}
                          draftBase={draftBaseVersionId === version.id}
                          draftBaseLabel={t('version.currentDraftBase')}
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
                      {t('version.globalTemporaryRecoveryPoint')}
                    </div>
                    {temporaryRecoveryPoints.length === 0 ? (
                      <EmptyHistoryCard text={t('version.noTemporaryRecoveryPoint')} />
                    ) : (
                      temporaryRecoveryPoints.map((version) => (
                        <HistoryCard
                          key={version.id}
                          actions={renderRecoveryActions(version)}
                          badge={t('version.temporaryBadge')}
                          branchHead={false}
                          branchHeadLabel={t('version.branchHead')}
                          current={currentVersionId === version.id}
                          currentLabel={t('version.current')}
                          depth={0}
                          draftBase={draftBaseVersionId === version.id}
                          draftBaseLabel={t('version.currentDraftBase')}
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
                </>
              )}

            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}
