'use client';

import * as React from 'react';
import { ArrowUpRight, GitBranch, GitCompareArrows, RotateCcw } from 'lucide-react';
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useT } from '@/components/providers/language-provider';
import { apiCall, safeJsonParse } from '@/framework/resilience';

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
  onSwitchToVersionBranch?: (version: WorkspaceVersionData) => Promise<void> | void;
  onTogglePin: (versionId: string, pinned: boolean) => Promise<void> | void;
  onSelectVersion: (versionId: string | null) => void;
  versions?: DeliverableVersionData[];
  stagedChangeSets?: StagedChangeSetData[];
  workspaceId: string;
}) {
  const t = useT();
  const [compareOpen, setCompareOpen] = React.useState(false);
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
                  {compareDraftAllowed ? (
                    <SelectItem value="draft">{t('version.currentDraft')}</SelectItem>
                  ) : null}
                  {compareSelectableVersions.map((version) => (
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
                  {compareDraftAllowed ? (
                    <SelectItem value="draft">{t('version.currentDraft')}</SelectItem>
                  ) : null}
                  {compareSelectableVersions.map((version) => (
                    <SelectItem key={version.id} value={version.id}>
                      {formatVersionOptionLabel(version, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col items-end gap-2 text-right">
              <div className="text-xs text-muted-foreground">
                {compareScopedToBranch
                  ? t('version.branchCompareDescription', {
                      title: compareBranch?.head.title || '',
                    })
                  : t('version.compareDescription')}
              </div>
              {compareBranch ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs"
                  data-testid="version-compare-scope-toggle"
                  onClick={() => setCompareCrossBranchMode((current) => !current)}
                >
                  {compareScopedToBranch
                    ? t('version.compareAcrossBranches')
                    : t('version.compareWithinBranch')}
                </Button>
              ) : null}
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
              {t('version.treeDescription')}
            </SheetDescription>
            <p className="text-xs leading-5 text-muted-foreground">
              {t('version.milestoneVsRecoveryHint')}
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              {t('version.restoreDescription')}
            </p>
          </SheetHeader>

          <ScrollArea className="min-h-0 flex-1 px-6 py-5">
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
        </SheetContent>
      </Sheet>
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

function EmptyHistoryCard({ text, testId }: { text: string; testId?: string }) {
  return (
    <div
      className="rounded-2xl border border-dashed border-border/80 px-4 py-5 text-center text-xs text-muted-foreground"
      data-testid={testId}
    >
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
  const parsed = safeJsonParse<unknown>(content, null);
  if (Array.isArray(parsed)) {
    return plateToMarkdown(parsed);
  }

  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { files?: unknown }).files)) {
    const files = (parsed as { files: Array<{ content?: string; isPrimary?: boolean }> }).files;
    const primary = files.find((file) => file.isPrimary) || files[0];
    if (primary?.content) {
      return normalizePreviewText(primary.content);
    }
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

type BranchWorkspaceSection = {
  node: VisibleVersionTreeNode;
  recoveryPoints: WorkspaceVersionData[];
};

type VisibleBranchWorkspace = {
  pinnedRecoveryCount: number;
  recoveryCount: number;
  sections: BranchWorkspaceSection[];
  temporaryRecoveryCount: number;
};

function isCompareSelectionAllowed(params: {
  allowDraft: boolean;
  selectableVersions: DeliverableVersionData[];
  value: string;
}) {
  if (params.value === 'draft') {
    return params.allowDraft;
  }

  return params.selectableVersions.some((version) => version.id === params.value);
}

function getFirstCompareSelection(params: {
  allowDraft: boolean;
  selectableVersions: DeliverableVersionData[];
}) {
  if (params.selectableVersions[0]) {
    return params.selectableVersions[0].id;
  }

  return params.allowDraft ? 'draft' : '';
}

function resolveDefaultCompareAnchor(params: {
  allowDraft: boolean;
  branch: VisibleVersionBranch | null;
  currentDraftBaseVersionId: string | null;
  selectableVersions: DeliverableVersionData[];
  selectedVersionId: string;
}) {
  if (params.selectedVersionId === 'draft') {
    if (
      params.currentDraftBaseVersionId &&
      params.selectableVersions.some((version) => version.id === params.currentDraftBaseVersionId)
    ) {
      return params.currentDraftBaseVersionId;
    }

    return params.selectableVersions[0]?.id || 'draft';
  }

  if (params.branch) {
    if (params.allowDraft && params.currentDraftBaseVersionId === params.selectedVersionId) {
      return 'draft';
    }

    const selectedIndex = params.branch.path.findIndex(
      (version) => version.id === params.selectedVersionId
    );
    if (selectedIndex > 0) {
      const parentVersionId = params.branch.path[selectedIndex - 1]?.id;
      if (
        parentVersionId &&
        params.selectableVersions.some((version) => version.id === parentVersionId)
      ) {
        return parentVersionId;
      }
    }
  }

  if (
    params.currentDraftBaseVersionId &&
    params.currentDraftBaseVersionId !== params.selectedVersionId &&
    params.selectableVersions.some((version) => version.id === params.currentDraftBaseVersionId)
  ) {
    return params.currentDraftBaseVersionId;
  }

  const fallback = params.selectableVersions.find(
    (version) => version.id !== params.selectedVersionId
  );
  if (fallback) {
    return fallback.id;
  }

  if (params.allowDraft) {
    return 'draft';
  }

  return params.selectedVersionId;
}

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

function mergeWorkspaceVersions(
  current: WorkspaceVersionData[],
  incoming: DeliverableVersionData[]
): WorkspaceVersionData[] {
  if (current.length === 0) {
    return incoming;
  }

  const mergedById = new Map(current.map((version) => [version.id, version]));
  let changed = false;

  for (const version of incoming) {
    if (mergedById.get(version.id) !== version) {
      mergedById.set(version.id, version);
      changed = true;
    }
  }

  return changed ? Array.from(mergedById.values()) : current;
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

function buildVisibleBranchWorkspace(params: {
  branch: VisibleVersionBranch;
  nodes: VisibleVersionTreeNode[];
  recoveryPoints: WorkspaceVersionData[];
  versionsById: Map<string, WorkspaceVersionData>;
  visibleIds: Set<string>;
}): VisibleBranchWorkspace {
  const branchIds = new Set(params.branch.path.map((version) => version.id));
  const sections: BranchWorkspaceSection[] = params.nodes
    .filter((node) => branchIds.has(node.version.id))
    .map((node) => ({
      node,
      recoveryPoints: [],
    }));
  const sectionsById = new Map(sections.map((section) => [section.node.version.id, section]));

  let pinnedRecoveryCount = 0;
  let temporaryRecoveryCount = 0;

  for (const version of params.recoveryPoints) {
    const branchAnchorId = findNearestVisibleAncestorId(
      version.parentVersionId,
      params.versionsById,
      params.visibleIds
    );
    if (!branchAnchorId || !branchIds.has(branchAnchorId)) {
      continue;
    }

    const section = sectionsById.get(branchAnchorId);
    if (!section) {
      continue;
    }

    section.recoveryPoints.push(version);
    if (version.pinned) {
      pinnedRecoveryCount += 1;
    } else {
      temporaryRecoveryCount += 1;
    }
  }

  for (const section of sections) {
    section.recoveryPoints.sort((left, right) => {
      if (left.pinned !== right.pinned) {
        return left.pinned ? -1 : 1;
      }
      return right.versionNum - left.versionNum;
    });
  }

  return {
    pinnedRecoveryCount,
    recoveryCount: pinnedRecoveryCount + temporaryRecoveryCount,
    sections,
    temporaryRecoveryCount,
  };
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
