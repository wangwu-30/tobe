'use client';

import { GitCompareArrows } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  formatVersionOptionLabel,
  type DiffRow,
  type VersionTranslateFn,
  type VisibleVersionBranch,
} from './deliverable-version-helpers';
import { DiffViewer, VersionPane } from './deliverable-version-views';

import type { DeliverableVersionData } from '@/types';

export function VersionCompareDialog({
  compareBranch,
  compareDraftAllowed,
  compareLeftId,
  compareLeftText,
  compareLeftVersion,
  compareRightId,
  compareRightText,
  compareRightVersion,
  compareScopedToBranch,
  compareSelectableVersions,
  diffRows,
  onCompareLeftIdChange,
  onCompareRightIdChange,
  onOpenChange,
  onToggleCrossBranchMode,
  open,
  t,
}: {
  compareBranch: VisibleVersionBranch | null;
  compareDraftAllowed: boolean;
  compareLeftId: string;
  compareLeftText: string;
  compareLeftVersion: DeliverableVersionData | null;
  compareRightId: string;
  compareRightText: string;
  compareRightVersion: DeliverableVersionData | null;
  compareScopedToBranch: boolean;
  compareSelectableVersions: DeliverableVersionData[];
  diffRows: DiffRow[] | null;
  onCompareLeftIdChange: (value: string) => void;
  onCompareRightIdChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onToggleCrossBranchMode: () => void;
  open: boolean;
  t: VersionTranslateFn;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[960px]">
        <DialogHeader>
          <DialogTitle>{t('version.compareVersions')}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Select value={compareLeftId} onValueChange={onCompareLeftIdChange}>
              <SelectTrigger
                aria-label={t('version.compareLeftVersion')}
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
            <Select value={compareRightId} onValueChange={onCompareRightIdChange}>
              <SelectTrigger
                aria-label={t('version.compareRightVersion')}
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
                onClick={onToggleCrossBranchMode}
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
  );
}
