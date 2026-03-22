'use client';

import * as React from 'react';
import { Combine, FileText, Globe, MessageSquareText } from 'lucide-react';

import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import {
  mapCreateIntentToDeliverableType,
  mapDeliverableTypeToCreateIntent,
  normalizeWorkspaceCreateIntentChoice,
  shouldClarifyWorkspaceCreateGoal,
  type WorkspaceCreateIntent,
  type WorkspaceCreateIntentChoice,
} from '@/lib/workspace/create-intent';
import type { DeliverableType, WorkflowPlaybookData } from '@/types';
import { useT } from '@/components/providers/language-provider';
import { WorkflowExtensionHints } from '@/components/workflow/workflow-extension-hints';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/framework/resilience';


type GoalComposerIntentOption = {
  description: string;
  detailPlaceholder: string;
  id: WorkspaceCreateIntentChoice;
  title: string;
};

export type GoalComposerValues = {
  constraints: string;
  createMode: WorkspaceCreateIntent | null;
  deliverableType?: DeliverableType | null;
  goal: string;
  projectParentPath: string;
  selectedIntent: WorkspaceCreateIntentChoice | null;
  selectedIntentNote: string;
  styleGuide: string;
  workflowPlaybookId: string;
};

const DEFAULT_VALUES: GoalComposerValues = {
  constraints: '',
  createMode: null,
  deliverableType: null,
  goal: '',
  projectParentPath: '',
  selectedIntent: null,
  selectedIntentNote: '',
  styleGuide: '',
  workflowPlaybookId: '',
};

const EMPTY_INTENT_NOTES: Record<WorkspaceCreateIntentChoice, string> = {
  both: '',
  document: '',
  other: '',
  web: '',
};

const INTENT_ICON: Record<
  WorkspaceCreateIntentChoice,
  React.ComponentType<{ className?: string }>
> = {
  both: Combine,
  document: FileText,
  other: MessageSquareText,
  web: Globe,
};

function resolveInitialCreateMode(
  initialValues?: Partial<GoalComposerValues>
): WorkspaceCreateIntent | null {
  return (
    initialValues?.createMode ||
    mapDeliverableTypeToCreateIntent(initialValues?.deliverableType || null)
  );
}

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
  const [workflowPlaybooks, setWorkflowPlaybooks] = React.useState<WorkflowPlaybookData[]>(
    []
  );
  const resolvedInitialValues = React.useMemo(() => {
    const createMode = resolveInitialCreateMode(initialValues);
    const selectedIntent =
      normalizeWorkspaceCreateIntentChoice(initialValues?.selectedIntent) || createMode;

    return {
      ...DEFAULT_VALUES,
      ...initialValues,
      createMode,
      deliverableType:
        initialValues?.deliverableType ?? mapCreateIntentToDeliverableType(createMode),
      selectedIntent,
      selectedIntentNote: initialValues?.selectedIntentNote || '',
    } satisfies GoalComposerValues;
  }, [initialValues]);
  const [values, setValues] = React.useState<GoalComposerValues>(resolvedInitialValues);
  const [locationError, setLocationError] = React.useState<string | null>(null);
  const [intentClarifyPrompt, setIntentClarifyPrompt] = React.useState<string | null>(
    null
  );
  const [goalClarifyPrompt, setGoalClarifyPrompt] = React.useState<string | null>(null);
  const [intentOptions, setIntentOptions] = React.useState<GoalComposerIntentOption[]>([]);
  const [intentNotes, setIntentNotes] = React.useState(EMPTY_INTENT_NOTES);
  const [intentError, setIntentError] = React.useState<string | null>(null);
  const [isResolvingIntent, setIsResolvingIntent] = React.useState(false);

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
    setGoalClarifyPrompt(null);
    setLocationError(null);
    setIntentClarifyPrompt(null);
    setIntentOptions([]);
    setIntentError(null);
    setIntentNotes({
      ...EMPTY_INTENT_NOTES,
      ...(resolvedInitialValues.selectedIntent
        ? {
            [resolvedInitialValues.selectedIntent]: resolvedInitialValues.selectedIntentNote,
          }
        : {}),
    });
  }, [open, resolvedInitialValues]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const query = workflowContextId
      ? `?workspaceId=${encodeURIComponent(workflowContextId)}`
      : '';

    void apiFetch(`/api/workflows${query}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((items: WorkflowPlaybookData[]) => {
        if (!cancelled) {
          setWorkflowPlaybooks(
            Array.isArray(items) ? items.filter((item) => item?.status === 'active') : []
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
        projectTitle: currentProjectTitle?.trim() || t('workspace.untitledProject'),
      })
    : t('goal.description');
  const submitActionLabel = isDeliverableCreation
    ? t('goal.createDeliverable')
    : t('goal.createProject');
  const submittingActionLabel = isDeliverableCreation
    ? t('goal.creatingDeliverable')
    : t('goal.creatingProject');
  const showClarifyCards = intentOptions.length > 0;

  const submitResolvedValues = React.useCallback(
    async (nextValues: GoalComposerValues) => {
      setValues(nextValues);
      setIntentClarifyPrompt(null);
      setIntentOptions([]);
      setIntentError(null);
      await onSubmit(nextValues);
    },
    [onSubmit]
  );

  const resolveIntent = React.useCallback(
    async (selection?: WorkspaceCreateIntentChoice) => {
      if (shouldClarifyWorkspaceCreateGoal(values.goal)) {
        setGoalClarifyPrompt(t('goal.goalClarifyPrompt'));
        setIntentClarifyPrompt(null);
        setIntentOptions([]);
        setIntentError(null);
        return;
      }

      setGoalClarifyPrompt(null);
      const selectedIntent = selection || values.selectedIntent;
      const selectedIntentNote = selectedIntent ? intentNotes[selectedIntent] || '' : '';

      setIsResolvingIntent(true);
      setIntentError(null);

      try {
        const response = await apiFetch('/api/workspaces/intent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getStoredAISettingsHeader(),
          },
          body: JSON.stringify({
            constraints: values.constraints,
            goal: values.goal,
            selectedIntent,
            selectedIntentNote,
            styleGuide: values.styleGuide,
            workflowPlaybookId: values.workflowPlaybookId,
          }),
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload) {
          throw new Error(payload?.error || t('goal.intentResolveFailed'));
        }

        if (payload.status === 'resolved') {
          const nextCreateMode =
            payload.intent === 'document' ||
            payload.intent === 'web' ||
            payload.intent === 'both'
              ? payload.intent
              : null;

          if (!nextCreateMode) {
            throw new Error(t('goal.intentResolveFailed'));
          }

          const nextValues: GoalComposerValues = {
            ...values,
            createMode: nextCreateMode,
            deliverableType: mapCreateIntentToDeliverableType(nextCreateMode),
            selectedIntent: selectedIntent || nextCreateMode,
            selectedIntentNote,
          };
          await submitResolvedValues(nextValues);
          return;
        }

        const clarifyOptions = Array.isArray(payload.options)
          ? (payload.options.filter(
              (option: unknown): option is GoalComposerIntentOption => {
                if (!option || typeof option !== 'object') {
                  return false;
                }

                const candidate = option as Record<string, unknown>;
                return (
                  typeof candidate.description === 'string' &&
                  typeof candidate.detailPlaceholder === 'string' &&
                  typeof candidate.title === 'string' &&
                  normalizeWorkspaceCreateIntentChoice(candidate.id) !== null
                );
              }
            ) as GoalComposerIntentOption[])
          : [];

        setValues((current) => ({
          ...current,
          createMode: null,
          deliverableType: null,
          selectedIntent: selectedIntent || current.selectedIntent,
          selectedIntentNote,
        }));
        setIntentClarifyPrompt(
          typeof payload.prompt === 'string' ? payload.prompt : t('goal.intentClarifyPrompt')
        );
        setIntentOptions(clarifyOptions);
      } catch (error) {
        setIntentError(
          error instanceof Error ? error.message : t('goal.intentResolveFailed')
        );
      } finally {
        setIsResolvingIntent(false);
      }
    },
    [intentNotes, submitResolvedValues, t, values]
  );

  const submitDisabled =
    isSubmitting ||
    isResolvingIntent ||
    !values.goal.trim() ||
    (showProjectLocation && !values.projectParentPath.trim());

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isSubmitting || isResolvingIntent) {
          return;
        }

        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="sm:max-w-[640px]"
        onEscapeKeyDown={(event) => {
          if (isSubmitting || isResolvingIntent) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (isSubmitting || isResolvingIntent) {
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
              disabled={disableInputs || isSubmitting || isResolvingIntent}
              onChange={(event) => {
                setGoalClarifyPrompt(null);
                setValues((current) => ({ ...current, goal: event.target.value }));
              }}
              placeholder={t('goal.goalPlaceholder')}
              className="min-h-[120px]"
            />
            {goalClarifyPrompt ? (
              <div
                data-testid="goal-goal-clarify"
                className="rounded-[24px] border border-amber-500/25 bg-amber-500/5 px-4 py-3"
              >
                <div className="text-sm font-medium text-foreground">
                  {goalClarifyPrompt}
                </div>
                <div className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                  <p>- {t('goal.goalClarifyDeliverableHint')}</p>
                  <p>- {t('goal.goalClarifyAudienceHint')}</p>
                  <p>- {t('goal.goalClarifyOutcomeHint')}</p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="style-guide">{t('goal.styleTone')}</Label>
              <Textarea
                id="style-guide"
                value={values.styleGuide}
                disabled={disableInputs || isSubmitting || isResolvingIntent}
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
                    disabled={disableInputs || isSubmitting || isResolvingIntent}
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="constraints">{t('goal.constraints')}</Label>
            <Textarea
              id="constraints"
              value={values.constraints}
              disabled={disableInputs || isSubmitting || isResolvingIntent}
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
                  disabled={disableInputs || isSubmitting || isResolvingIntent}
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

          {showClarifyCards ? (
            <div
              data-testid="goal-intent-clarify"
              className="space-y-3 rounded-[28px] border border-border/70 bg-muted/10 p-4"
            >
              <div
                data-testid="goal-intent-clarify-prompt"
                className="text-sm leading-6 text-foreground"
              >
                {intentClarifyPrompt}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {intentOptions.map((option) => {
                  const Icon = INTENT_ICON[option.id];
                  const selected = values.selectedIntent === option.id;
                  return (
                    <div
                      key={option.id}
                      data-testid={`goal-intent-option-${option.id}`}
                      className={cn(
                        'rounded-3xl border bg-background/90 p-4 shadow-sm transition-colors',
                        selected
                          ? 'border-primary/40 bg-primary/5'
                          : 'border-border/70'
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className="rounded-2xl border border-border/70 bg-background p-2.5">
                          <Icon className="h-4 w-4 text-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-foreground">
                            {option.title}
                          </div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {option.description}
                          </p>
                        </div>
                      </div>
                      <Textarea
                        value={intentNotes[option.id] || ''}
                        disabled={disableInputs || isSubmitting || isResolvingIntent}
                        onChange={(event) => {
                          const nextNote = event.target.value;
                          setIntentNotes((current) => ({
                            ...current,
                            [option.id]: nextNote,
                          }));
                          setValues((current) => ({
                            ...current,
                            selectedIntent: option.id,
                            selectedIntentNote: nextNote,
                          }));
                        }}
                        placeholder={option.detailPlaceholder}
                        className="mt-3 min-h-[88px]"
                      />
                      <Button
                        type="button"
                        variant={selected ? 'default' : 'outline'}
                        className="mt-3 w-full"
                        disabled={disableInputs || isSubmitting || isResolvingIntent}
                        onClick={() => {
                          setValues((current) => ({
                            ...current,
                            selectedIntent: option.id,
                            selectedIntentNote: intentNotes[option.id] || '',
                          }));
                          void resolveIntent(option.id);
                        }}
                      >
                        {t('goal.intentSelect')}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {errorMessage || intentError ? (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm text-destructive">
            {errorMessage || intentError}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting || isResolvingIntent}
          >
            {t('common.cancel')}
          </Button>
          {!showClarifyCards ? (
            <Button
              onClick={() => void resolveIntent()}
              disabled={submitDisabled}
            >
              {isSubmitting
                ? submittingActionLabel
                : isResolvingIntent
                  ? t('goal.resolvingIntent')
                  : submitLabel || submitActionLabel}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
