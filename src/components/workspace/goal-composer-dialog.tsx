'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DeliverableType, WorkflowPlaybookData } from '@/types';
import { useT } from '@/components/providers/language-provider';
import { WorkflowExtensionHints } from '@/components/workflow/workflow-extension-hints';
import { formatDeliverableTypeLabel } from '@/lib/workspace/deliverable-labels';

export type GoalComposerValues = {
  constraints: string;
  deliverableType: DeliverableType;
  goal: string;
  projectParentPath: string;
  styleGuide: string;
  workflowPlaybookId: string;
};

const DEFAULT_VALUES: GoalComposerValues = {
  constraints: '',
  deliverableType: 'document',
  goal: '',
  projectParentPath: '',
  styleGuide: '',
  workflowPlaybookId: '',
};

export function GoalComposerDialog({
  creationMode = 'project',
  currentProjectTitle = null,
  disableInputs = false,
  errorMessage = null,
  initialValues,
  isSubmitting = false,
  onOpenChange,
  onSubmit,
  submitLabel,
  workflowContextId,
  open,
}: {
  creationMode?: 'project' | 'deliverable';
  currentProjectTitle?: string | null;
  disableInputs?: boolean;
  errorMessage?: string | null;
  initialValues?: Partial<GoalComposerValues>;
  isSubmitting?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: GoalComposerValues) => void | Promise<void>;
  open: boolean;
  submitLabel?: string;
  workflowContextId?: string | null;
}) {
  const t = useT();
  const [isDesktop, setIsDesktop] = React.useState(false);
  const [workflowPlaybooks, setWorkflowPlaybooks] = React.useState<WorkflowPlaybookData[]>([]);
  const resolvedInitialValues = React.useMemo(
    () => ({
      ...DEFAULT_VALUES,
      ...initialValues,
    }),
    [initialValues]
  );
  const [values, setValues] = React.useState<GoalComposerValues>(resolvedInitialValues);
  const [locationError, setLocationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setIsDesktop(Boolean(window.daoDesktop?.isDesktop));
  }, []);

  const pickProjectLocation = React.useCallback(async () => {
    const pickLocation = window.daoDesktop?.projects?.pickLocation;
    if (!pickLocation) {
      setLocationError(t('goal.projectLocationUnavailable'));
      return;
    }

    const pickedPath = await pickLocation();
    if (!pickedPath) {
      return;
    }

    setLocationError(null);
    setValues((current) => ({
      ...current,
      projectParentPath: pickedPath,
    }));
  }, [t]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    setValues(resolvedInitialValues);
    setLocationError(null);
  }, [open, resolvedInitialValues]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const query = workflowContextId
      ? `?workspaceId=${encodeURIComponent(workflowContextId)}`
      : '';

    void fetch(`/api/workflows${query}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((items: WorkflowPlaybookData[]) => {
        if (!cancelled) {
          setWorkflowPlaybooks(
            Array.isArray(items)
              ? items.filter((item) => item?.status === 'active')
              : []
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkflowPlaybooks([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, workflowContextId]);

  const selectedWorkflow =
    workflowPlaybooks.find((item) => item.id === values.workflowPlaybookId) || null;
  const hasWorkflowChoices = workflowPlaybooks.length > 0;
  const isDeliverableCreation = creationMode === 'deliverable';
  const showProjectLocation = isDesktop && !isDeliverableCreation;
  const dialogDescription = isDeliverableCreation
    ? t('goal.deliverableDescription', {
        projectTitle:
          currentProjectTitle?.trim() || t('workspace.untitledProject'),
      })
    : t('goal.description');
  const submitActionLabel = isDeliverableCreation
    ? t('goal.createDeliverable')
    : t('goal.createProject');
  const submittingActionLabel = isDeliverableCreation
    ? t('goal.creatingDeliverable')
    : t('goal.creatingProject');

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isSubmitting) {
          return;
        }

        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="sm:max-w-[560px]"
        onEscapeKeyDown={(event) => {
          if (isSubmitting) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (isSubmitting) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('goal.startWithGoal')}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="goal">{t('goal.goal')}</Label>
            <Textarea
              id="goal"
              value={values.goal}
              disabled={disableInputs || isSubmitting}
              onChange={(event) =>
                setValues((current) => ({ ...current, goal: event.target.value }))
              }
              placeholder={t('goal.goalPlaceholder')}
              className="min-h-[120px]"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('goal.deliverableType')}</Label>
              <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/10 px-3 py-3">
                <div
                  data-testid="goal-deliverable-pill"
                  className="inline-flex items-center rounded-full border border-border/70 bg-background px-3 py-1.5 text-sm font-medium text-foreground"
                >
                  {formatDeliverableTypeLabel(values.deliverableType, t)}
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {t('goal.deliverableTypeLockedHint')}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="style-guide">{t('goal.styleTone')}</Label>
              <Textarea
                id="style-guide"
                value={values.styleGuide}
                disabled={disableInputs || isSubmitting}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    styleGuide: event.target.value,
                  }))
                }
                placeholder={t('goal.stylePlaceholder')}
                className="min-h-[88px]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('goal.workflow')}</Label>
            {hasWorkflowChoices ? (
              <>
                <Select
                  value={values.workflowPlaybookId || 'none'}
                  onValueChange={(value) =>
                    setValues((current) => ({
                      ...current,
                      workflowPlaybookId: value === 'none' ? '' : value,
                    }))
                  }
                  disabled={disableInputs || isSubmitting}
                >
                    <SelectTrigger>
                      <SelectValue placeholder={t('goal.selectWorkflow')} />
                    </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('goal.noWorkflow')}</SelectItem>
                    {workflowPlaybooks.map((workflow) => (
                      <SelectItem key={workflow.id} value={workflow.id}>
                        {workflow.builtin
                          ? `${workflow.title} · ${t('goal.workflowBuiltinBadge')}`
                          : workflow.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs leading-5 text-muted-foreground">
                  {selectedWorkflow?.summary || t('goal.workflowDescription')}
                </p>
                {selectedWorkflow ? (
                  <WorkflowExtensionHints
                    hints={selectedWorkflow.extensionHints}
                    testIdPrefix="goal-workflow-extension"
                  />
                ) : null}
              </>
            ) : (
              <div
                data-testid="goal-workflow-empty-state"
                className="rounded-2xl border border-dashed border-border/70 bg-muted/10 px-3 py-3"
              >
                <div className="text-sm font-medium text-foreground">
                  {t('goal.noWorkflowAvailableTitle')}
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t('goal.noWorkflowAvailableDescription')}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="constraints">{t('goal.constraints')}</Label>
            <Textarea
              id="constraints"
              value={values.constraints}
              disabled={disableInputs || isSubmitting}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  constraints: event.target.value,
                }))
              }
              placeholder={t('goal.constraintsPlaceholder')}
              className="min-h-[88px]"
            />
          </div>

          {showProjectLocation ? (
            <div className="space-y-2">
              <Label htmlFor="project-location">{t('goal.projectLocation')}</Label>
              <div className="flex gap-2">
                <Input
                  id="project-location"
                  value={values.projectParentPath}
                  readOnly
                  placeholder={t('goal.projectLocationPlaceholder')}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void pickProjectLocation()}
                  disabled={disableInputs || isSubmitting}
                >
                  {values.projectParentPath
                    ? t('goal.changeProjectLocation')
                    : t('goal.chooseProjectLocation')}
                </Button>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                {t('goal.projectLocationDescription')}
              </p>
              {locationError ? (
                <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {locationError}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {errorMessage ? (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => void onSubmit(values)}
            disabled={
              isSubmitting ||
              !values.goal.trim() ||
              (showProjectLocation && !values.projectParentPath.trim())
            }
          >
            {isSubmitting
              ? submittingActionLabel
              : submitLabel || submitActionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
