'use client';

import * as React from 'react';
import { Bot, CircleHelp, LoaderCircle } from 'lucide-react';

import { ExecutionJobDialog } from '@/components/execution/execution-job-dialog';
import { useT } from '@/components/providers/language-provider';
import { DeliverableVersionControls } from '@/components/workspace/deliverable-version-controls';
import { Button } from '@/components/ui/button';
import { requestSelectionCommentComposerOpen } from '@/lib/comments/constants';
import { cn } from '@/lib/utils';
import { alignWorkspaceVersion } from '@/lib/workspace/version-client';
import type {
  DeliverableVersionData,
  StagedChangeSetData,
  WorkspaceWorkflowStatusData,
  WorkspaceVersionData,
} from '@/types';
import { TaskComposerDialog } from '@/components/tasks/task-composer-dialog';
import { listTaskAgents, type TaskAgent } from '@/lib/tasks/client';

export function WorkspaceHeaderVersionControls({
  conversationId,
  currentDraftBaseVersionId,
  workflowStatus,
  currentText,
  currentVersionId,
  interactionsEnabled = true,
  isAssistantBusy,
  onContinueFromVersion,
  onCreateVersion,
  onRestoreVersion,
  onSelectVersion,
  onSwitchToVersionBranch,
  onTogglePin,
  stagedChangeSets = [],
  versions = [],
  projectId,
  sourceTitle,
  workspaceId,
}: {
  conversationId?: string | null;
  currentDraftBaseVersionId?: string | null;
  workflowStatus: WorkspaceWorkflowStatusData | null;
  currentText: string;
  currentVersionId?: string | null;
  interactionsEnabled?: boolean;
  isAssistantBusy: boolean;
  onContinueFromVersion?: (version: WorkspaceVersionData) => Promise<void> | void;
  onCreateVersion: () => void;
  onRestoreVersion: (versionId: string) => Promise<void> | void;
  onSelectVersion: (versionId: string | null) => void;
  onSwitchToVersionBranch?: (version: WorkspaceVersionData) => Promise<void> | void;
  onTogglePin: (versionId: string, pinned: boolean) => Promise<void> | void;
  stagedChangeSets?: StagedChangeSetData[];
  versions?: DeliverableVersionData[];
  projectId?: string | null;
  sourceTitle?: string | null;
  workspaceId: string;
}) {
  const t = useT();
  const [isExecutionDialogOpen, setIsExecutionDialogOpen] = React.useState(false);
  const [isAligning, setIsAligning] = React.useState(false);
  const [alignmentError, setAlignmentError] = React.useState<string | null>(null);
  const [alignedVersionIds, setAlignedVersionIds] = React.useState<Set<string>>(
    () => new Set(versions.filter((version) => version.aligned).map((version) => version.id))
  );
  const [isTaskComposerOpen, setIsTaskComposerOpen] = React.useState(false);
  const [taskAgents, setTaskAgents] = React.useState<TaskAgent[]>([]);
  const [isLoadingTaskAgents, setIsLoadingTaskAgents] = React.useState(false);
  const openTaskComposer = React.useCallback(async () => {
    setIsTaskComposerOpen(true);
    setIsLoadingTaskAgents(true);
    try {
      const result = await listTaskAgents();
      if (result.ok) setTaskAgents(result.data);
    } finally {
      setIsLoadingTaskAgents(false);
    }
  }, []);
  const statusActivelyRunning = Boolean(
    isAssistantBusy ||
      workflowStatus?.isAiWorking ||
      workflowStatus?.phase === 'implementing'
  );
  const selectedVersion = React.useMemo(
    () => versions.find((version) => version.id === currentVersionId) || null,
    [currentVersionId, versions]
  );
  const executionVersion = selectedVersion?.visible ? selectedVersion : null;
  const executionVersionId = executionVersion?.id ?? null;
  const selectedVersionAligned = Boolean(
    executionVersion &&
      (executionVersion.aligned || alignedVersionIds.has(executionVersion.id))
  );

  React.useEffect(() => {
    setAlignedVersionIds(
      new Set(versions.filter((version) => version.aligned).map((version) => version.id))
    );
  }, [versions]);

  React.useEffect(() => {
    setAlignmentError(null);
  }, [currentVersionId]);

  const handleAlign = React.useCallback(async () => {
    if (!executionVersion || isAligning) return;
    const requestedVersionId = executionVersion.id;
    setAlignmentError(null);
    setIsAligning(true);
    try {
      const result = await alignWorkspaceVersion({
        errorMessage: t('execution.alignmentFailed'),
        versionId: requestedVersionId,
        workspaceId,
      });
      if (
        result.version.id !== requestedVersionId ||
        result.version.aligned !== true ||
        result.version.visible !== true
      ) {
        throw new Error(t('execution.alignmentFailed'));
      }
      setAlignedVersionIds((current) => {
        const next = new Set(current);
        next.add(requestedVersionId);
        return next;
      });
    } catch (error) {
      setAlignmentError(
        error instanceof Error ? error.message : t('execution.alignmentFailed')
      );
    } finally {
      setIsAligning(false);
    }
  }, [executionVersion, isAligning, t, workspaceId]);

  return (
    <>
      {workflowStatus?.statusTitle || isAssistantBusy ? (
        <div
          aria-atomic="true"
          aria-live="polite"
          className={cn(
            'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium text-foreground',
            statusActivelyRunning && 'border-primary/20 bg-primary/5',
            workflowStatus?.phase === 'blocked' &&
              'border-amber-500/20 bg-amber-500/5',
            workflowStatus?.phase === 'finalized' &&
              'border-emerald-500/20 bg-emerald-500/5',
            !statusActivelyRunning &&
              workflowStatus?.phase !== 'blocked' &&
              workflowStatus?.phase !== 'finalized' &&
              'border-border bg-muted/20'
          )}
        >
          {statusActivelyRunning ? (
            <LoaderCircle
              aria-hidden="true"
              className="h-3.5 w-3.5 animate-spin text-primary motion-reduce:animate-none"
            />
          ) : (
            <span
              className={cn(
                'h-2 w-2 rounded-full bg-muted-foreground/70',
                workflowStatus?.phase === 'blocked' && 'bg-amber-500',
                workflowStatus?.phase === 'finalized' && 'bg-emerald-500',
                (workflowStatus?.phase === 'preview_ready' ||
                  workflowStatus?.phase === 'preview_running' ||
                  workflowStatus?.phase === 'reviewing') &&
                  'bg-primary/70'
              )}
            />
          )}
          <span className="truncate">
            {workflowStatus?.statusTitle || t('status.aiBusy')}
          </span>
        </div>
      ) : null}
      <Button
        aria-haspopup="dialog"
        size="sm"
        className="h-8 gap-1.5"
        onClick={() => setIsExecutionDialogOpen(true)}
        disabled={!workspaceId || !interactionsEnabled}
        data-testid="workspace-start-agent"
      >
        <Bot className="h-3.5 w-3.5" />
        {t('tasks.startAgent')}
      </Button>
      <span
        aria-live="polite"
        className="sr-only"
        data-testid="workspace-alignment-status"
      >
        {!executionVersionId
          ? t('execution.draftRequiresVersion')
          : selectedVersionAligned
            ? t('execution.aligned')
            : t('execution.notAligned')}
      </span>
      {!currentVersionId ? (
        <>
          <Button
            aria-busy={isLoadingTaskAgents}
            aria-haspopup="dialog"
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5"
            onClick={() => void openTaskComposer()}
            disabled={!workspaceId || !interactionsEnabled || isLoadingTaskAgents}
            data-testid="workspace-publish-task"
          >
            {isLoadingTaskAgents ? (
              <LoaderCircle
                aria-hidden="true"
                className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
              />
            ) : (
              <CircleHelp className="h-3.5 w-3.5" />
            )}
            {t('tasks.publishTask')}
          </Button>
          <TaskComposerDialog
            agents={taskAgents}
            defaultKind="help"
            onOpenChange={setIsTaskComposerOpen}
            open={isTaskComposerOpen}
            projectId={projectId}
            sourceTitle={sourceTitle}
            workspaceId={workspaceId}
          />
        </>
      ) : null}
      <ExecutionJobDialog
        alignedVersionId={
          selectedVersionAligned ? executionVersionId : null
        }
        conversationId={conversationId}
        documentVersionId={executionVersionId}
        isAligning={isAligning}
        onAlign={handleAlign}
        onCreateVersion={onCreateVersion}
        onOpenChange={setIsExecutionDialogOpen}
        open={isExecutionDialogOpen}
        projectId={projectId}
        sourceTitle={sourceTitle}
        workspaceId={workspaceId}
        alignmentError={alignmentError}
      />
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        onClick={() => requestSelectionCommentComposerOpen()}
        disabled={!workspaceId || !interactionsEnabled}
      >
        {t('workspace.reviewComment')}
      </Button>
      <DeliverableVersionControls
        currentDraftBaseVersionId={currentDraftBaseVersionId}
        currentVersionId={currentVersionId}
        currentText={currentText}
        interactionsEnabled={interactionsEnabled}
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
