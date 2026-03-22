'use client';

import type { DeliverableType } from '@/types';
import { Check, ChevronDown } from 'lucide-react';

import { useT } from '@/components/providers/language-provider';
import {
  DeliverableTypeBadge,
  DeliverableTypeIcon,
} from '@/components/workspace/deliverable-type-badge';
import {
  GoalComposerDialog,
  type GoalComposerValues,
} from '@/components/workspace/goal-composer-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type WorkspaceTitleSwitchOption = {
  deliverableType: DeliverableType;
  id: string;
  projectPathLabel: string | null;
  title: string;
};

export function WorkspaceRouteTitle({
  currentTitle,
  currentDeliverableType,
  enabled,
  onSelectDeliverable,
  options,
  projectContextLabel,
  workspaceId,
}: {
  currentTitle: string | null;
  currentDeliverableType: DeliverableType;
  enabled: boolean;
  onSelectDeliverable: (deliverableId: string) => void;
  options: WorkspaceTitleSwitchOption[];
  projectContextLabel?: string | null;
  workspaceId: string;
}) {
  const t = useT();
  const resolvedTitle = currentTitle || t('workspace.untitledDeliverable');

  return (
    <div className="min-w-0">
      {projectContextLabel ? (
        <div
          className="mb-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
          data-testid="workspace-title-project-context"
        >
          <span className="rounded-full border border-border/70 bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground/80">
            {t('workspace.currentProjectLabel')}
          </span>
          <span className="truncate">{projectContextLabel}</span>
        </div>
      ) : null}

      {enabled ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto max-w-full justify-start gap-2 px-0 py-0 text-left hover:bg-transparent"
              data-testid="workspace-switch-deliverable"
            >
              <DeliverableTypeIcon
                className="h-4 w-4 shrink-0 text-muted-foreground"
                deliverableType={currentDeliverableType}
              />
              <span className="truncate text-sm font-semibold">{resolvedTitle}</span>
              <DeliverableTypeBadge
                className="shrink-0"
                deliverableType={currentDeliverableType}
                variant="secondary"
              />
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80">
            {options.map((option) => (
              <DropdownMenuItem
                key={option.id}
                className="gap-2 py-2"
                data-testid={`workspace-switch-deliverable-${option.id}`}
                disabled={option.id === workspaceId}
                onClick={() => onSelectDeliverable(option.id)}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {option.id === workspaceId ? <Check className="h-4 w-4" /> : null}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-sm font-medium">{option.title}</div>
                    <DeliverableTypeBadge
                      className="shrink-0"
                      deliverableType={option.deliverableType}
                    />
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {option.projectPathLabel || t('workspace.projectTitleFallback')}
                  </div>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div
          className="truncate text-sm font-semibold"
          data-testid="workspace-current-deliverable-title"
        >
          {resolvedTitle}
        </div>
      )}
    </div>
  );
}

export function WorkspaceGoalDialogSurface({
  createWorkspaceRecoveryActive,
  creationMode,
  currentProjectTitle,
  errorMessage,
  initialValues,
  isSubmitting,
  onClearTransientState,
  onOpenChange,
  onSubmit,
  open,
  workflowContextId,
}: {
  createWorkspaceRecoveryActive: boolean;
  creationMode: 'project' | 'deliverable';
  currentProjectTitle: string | null;
  errorMessage: string | null;
  initialValues?: Partial<GoalComposerValues> | null;
  isSubmitting: boolean;
  onClearTransientState: () => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: GoalComposerValues) => void | Promise<void>;
  open: boolean;
  workflowContextId: string;
}) {
  const t = useT();

  return (
    <GoalComposerDialog
      creationMode={creationMode}
      currentProjectTitle={currentProjectTitle}
      disableInputs={createWorkspaceRecoveryActive}
      errorMessage={errorMessage}
      initialValues={initialValues || undefined}
      isSubmitting={isSubmitting}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !createWorkspaceRecoveryActive) {
          onClearTransientState();
        }

        onOpenChange(nextOpen);
      }}
      onSubmit={onSubmit}
      open={open}
      submitLabel={
        createWorkspaceRecoveryActive ? t('goal.retryProjectCheck') : undefined
      }
      workflowContextId={workflowContextId}
    />
  );
}
