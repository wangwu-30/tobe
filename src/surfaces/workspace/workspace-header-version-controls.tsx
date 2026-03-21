'use client';

import { LoaderCircle } from 'lucide-react';

import { useT } from '@/components/providers/language-provider';
import { DeliverableVersionControls } from '@/components/workspace/deliverable-version-controls';
import { Button } from '@/components/ui/button';
import { requestSelectionCommentComposerOpen } from '@/lib/comments/constants';
import { cn } from '@/lib/utils';
import type {
  DeliverableVersionData,
  StagedChangeSetData,
  WorkspaceCurrentStatusData,
  WorkspaceVersionData,
} from '@/types';

export function WorkspaceHeaderVersionControls({
  currentDraftBaseVersionId,
  currentStatus,
  currentText,
  currentVersionId,
  isAssistantBusy,
  onContinueFromVersion,
  onCreateVersion,
  onRestoreVersion,
  onSelectVersion,
  onSwitchToVersionBranch,
  onTogglePin,
  stagedChangeSets = [],
  versions = [],
  workspaceId,
}: {
  currentDraftBaseVersionId?: string | null;
  currentStatus: WorkspaceCurrentStatusData | null;
  currentText: string;
  currentVersionId?: string | null;
  isAssistantBusy: boolean;
  onContinueFromVersion?: (version: WorkspaceVersionData) => Promise<void> | void;
  onCreateVersion: () => void;
  onRestoreVersion: (versionId: string) => Promise<void> | void;
  onSelectVersion: (versionId: string | null) => void;
  onSwitchToVersionBranch?: (version: WorkspaceVersionData) => Promise<void> | void;
  onTogglePin: (versionId: string, pinned: boolean) => Promise<void> | void;
  stagedChangeSets?: StagedChangeSetData[];
  versions?: DeliverableVersionData[];
  workspaceId: string;
}) {
  const t = useT();
  const statusActivelyRunning = Boolean(
    isAssistantBusy ||
      currentStatus?.isAiWorking ||
      currentStatus?.phase === 'implementing'
  );

  return (
    <>
      {currentStatus?.statusTitle || isAssistantBusy ? (
        <div
          className={cn(
            'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium text-foreground',
            statusActivelyRunning && 'border-primary/20 bg-primary/5',
            currentStatus?.phase === 'blocked' &&
              'border-amber-500/20 bg-amber-500/5',
            currentStatus?.phase === 'finalized' &&
              'border-emerald-500/20 bg-emerald-500/5',
            !statusActivelyRunning &&
              currentStatus?.phase !== 'blocked' &&
              currentStatus?.phase !== 'finalized' &&
              'border-border bg-muted/20'
          )}
        >
          {statusActivelyRunning ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />
          ) : (
            <span
              className={cn(
                'h-2 w-2 rounded-full bg-muted-foreground/70',
                currentStatus?.phase === 'blocked' && 'bg-amber-500',
                currentStatus?.phase === 'finalized' && 'bg-emerald-500',
                (currentStatus?.phase === 'preview_ready' ||
                  currentStatus?.phase === 'preview_running' ||
                  currentStatus?.phase === 'reviewing') &&
                  'bg-primary/70'
              )}
            />
          )}
          <span className="truncate">
            {currentStatus?.statusTitle || t('status.aiBusy')}
          </span>
        </div>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        onClick={() => requestSelectionCommentComposerOpen()}
        disabled={!workspaceId}
      >
        {t('workspace.reviewComment')}
      </Button>
      <DeliverableVersionControls
        currentDraftBaseVersionId={currentDraftBaseVersionId}
        currentVersionId={currentVersionId}
        currentText={currentText}
        onContinueFromVersion={onContinueFromVersion}
        onCreateVersion={onCreateVersion}
        onRestoreVersion={onRestoreVersion}
        onSwitchToVersionBranch={onSwitchToVersionBranch}
        onTogglePin={onTogglePin}
        onSelectVersion={onSelectVersion}
        versions={versions}
        stagedChangeSets={stagedChangeSets}
        workspaceId={workspaceId}
      />
    </>
  );
}
