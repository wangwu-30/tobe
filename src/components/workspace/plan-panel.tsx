'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  CircleDot,
  LoaderCircle,
  Sparkles,
} from 'lucide-react';
import type { WorkspaceCurrentStatusData, WorkspacePlanData } from '@/types';
import { useT } from '@/components/providers/language-provider';
import { WorkflowExtensionHints } from '@/components/workflow/workflow-extension-hints';
import { useAppRouter } from '@/lib/app-router';
import { formatDeliverableTypeLabel } from '@/lib/workspace/deliverable-labels';

export function PlanPanel({
  currentDraftBranchTitle,
  currentStatus,
  isAssistantBusy = false,
  isSwitchingDeliverableIntent = false,
  onCreateNextDeliverable,
  onChangeDeliverableIntent,
  onRegenerateWithIntent,
  plan,
}: {
  currentDraftBranchTitle?: string | null;
  currentStatus?: WorkspaceCurrentStatusData | null;
  isAssistantBusy?: boolean;
  isSwitchingDeliverableIntent?: boolean;
  onCreateNextDeliverable?: () => void;
  onChangeDeliverableIntent?: (deliverableType: WorkspacePlanData['deliverableType']) => void;
  onRegenerateWithIntent?: () => void;
  plan?: WorkspacePlanData | null;
}) {
  const t = useT();
  const router = useAppRouter();
  const isPlanGenerating = !currentStatus && plan?.status === 'generating';
  const isPlanBlocked = !currentStatus && plan?.status === 'blocked';
  const isWorkflowBlocked = currentStatus?.phase === 'blocked';
  const aiWorking = Boolean(currentStatus?.isAiWorking || isAssistantBusy || isPlanGenerating);
  const currentStage =
    !isPlanGenerating && !isPlanBlocked
      ? plan?.stages.find((stage) => stage.id === plan.activeStageId) || plan?.stages[0] || null
      : null;
  const currentPhaseTitle =
    currentStatus?.statusTitle ||
    (isPlanGenerating
      ? t('plan.generatingTitle')
      : isPlanBlocked
        ? t('plan.blockedTitle')
        : currentStage?.title || t('status.noStatusTitle'));
  const progressNote =
    currentStatus?.blockedReason ||
    currentStatus?.statusDescription ||
    plan?.lastProgressNote ||
    (isPlanGenerating ? t('plan.generatingDescription') : null) ||
    null;
  const aiStatusValue = aiWorking ? t('status.aiBusy') : t('status.aiIdle');
  const canRegenerateWithDeliverableType = Boolean(
    onRegenerateWithIntent && currentStatus?.primaryAction !== 'generate_first_pass'
  );

  if (!plan && !currentStatus) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        <div>
          <Sparkles className="mx-auto mb-3 h-8 w-8 opacity-40" />
          <p>{t('status.noStatusTitle')}</p>
          <p className="mt-1 text-xs opacity-70">{t('status.noStatusDescription')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          <section className="rounded-2xl border border-border/70 bg-background px-4 py-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  {t('plan.currentPhase')}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {currentPhaseTitle}
                  </span>
                  {aiWorking ? (
                    <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                  ) : null}
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {progressNote || t('status.noStatusDescription')}
                </p>
              </div>
              <Badge variant="secondary">{t('assistant.status')}</Badge>
            </div>

            {plan ? (
              <div className="mt-4 rounded-2xl border border-border/70 bg-muted/15 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  {t('goal.deliverableType')}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(['document', 'slides', 'web'] as const).map((type) => (
                    <Button
                      key={type}
                      type="button"
                      size="sm"
                      variant={plan.deliverableType === type ? 'default' : 'outline'}
                      className="h-8 rounded-full px-3 text-xs"
                      disabled={isSwitchingDeliverableIntent}
                      onClick={() => onChangeDeliverableIntent?.(type)}
                    >
                      {formatDeliverableTypeLabel(type, t)}
                    </Button>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {t('plan.deliverableTypeDescription')}
                </p>
                {canRegenerateWithDeliverableType ? (
                  <div className="mt-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={isAssistantBusy || isSwitchingDeliverableIntent}
                      onClick={onRegenerateWithIntent}
                    >
                      {t('plan.regenerateWithDeliverableType')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {plan?.goal ? (
              <div className="mt-4 rounded-2xl border border-border/70 bg-muted/15 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  {t('plan.goal')}
                </div>
                <div className="mt-2 text-sm leading-6 text-foreground">{plan.goal}</div>
              </div>
            ) : null}

            {currentDraftBranchTitle ? (
              <div
                className="mt-4 rounded-2xl border border-border/70 bg-muted/15 px-3 py-3"
                data-testid="plan-current-branch-card"
              >
                <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  {t('plan.currentBranch')}
                </div>
                <div className="mt-2 text-sm font-medium text-foreground">
                  {currentDraftBranchTitle}
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t('plan.currentBranchDescription')}
                </p>
              </div>
            ) : null}

            {plan?.activeWorkflowPlaybook ? (
              <div className="mt-4 rounded-2xl border border-border/70 bg-muted/15 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  {t('plan.workflow')}
                </div>
                <div className="mt-2 text-sm font-medium text-foreground">
                  {plan.activeWorkflowPlaybook.title}
                </div>
                {plan.activeWorkflowPlaybook.summary ? (
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {plan.activeWorkflowPlaybook.summary}
                  </p>
                ) : null}
                <div className="mt-2">
                  <WorkflowExtensionHints hints={plan.activeWorkflowPlaybook.extensionHints} />
                </div>
                {plan.activeWorkflowPlaybook.steps.length > 0 ? (
                  <div className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                    {plan.activeWorkflowPlaybook.steps.slice(0, 3).map((step, index) => (
                      <p key={`${plan.activeWorkflowPlaybook?.id}-step-${index}`}>
                        {index + 1}. {step}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {(isWorkflowBlocked || isPlanBlocked) && progressNote ? (
              <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  {t('status.blockedReason')}
                </div>
                <div className="mt-2 text-sm leading-6 text-foreground">
                  {progressNote}
                </div>
                <div className="mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => router.push('/settings')}
                  >
                    {t('chat.openSettings')}
                  </Button>
                </div>
              </div>
            ) : null}

            {plan?.stages.length ? (
              <div className="mt-4 space-y-2">
                {plan.stages.map((stage) => (
                  <StageRow
                    key={stage.id}
                    animateActiveStage={aiWorking}
                    stage={stage}
                  />
                ))}
              </div>
            ) : null}

            {currentStatus?.phase === 'finalized' &&
            plan?.activeWorkflowPlaybook &&
            onCreateNextDeliverable ? (
              <div
                className="mt-4 rounded-2xl border border-primary/10 bg-primary/5 px-3 py-3"
                data-testid="plan-next-deliverable-card"
              >
                <div className="text-sm font-medium text-foreground">
                  {t('plan.nextDeliverableTitle')}
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t('plan.nextDeliverableDescription', {
                    workflow: plan.activeWorkflowPlaybook.title,
                  })}
                </p>
                <div className="mt-3">
                  <Button
                    size="sm"
                    className="h-8"
                    data-testid="plan-next-deliverable-action"
                    onClick={onCreateNextDeliverable}
                  >
                    {t('plan.nextDeliverableAction')}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="grid gap-3">
            <StatusStat
              label={t('status.ai')}
              value={aiStatusValue}
            />
            <StatusStat
              label={t('status.preview')}
              value={
                currentStatus?.phase === 'preview_running'
                  ? t('status.previewRunning')
                  : currentStatus?.phase === 'preview_ready' ||
                      currentStatus?.phase === 'finalized'
                    ? t('status.previewReady')
                    : currentStatus?.phase === 'blocked'
                      ? t('status.previewBlocked')
                      : t('status.previewPending')
              }
            />
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

function StageRow({
  animateActiveStage,
  stage,
}: {
  animateActiveStage: boolean;
  stage: WorkspacePlanData['stages'][number];
}) {
  const t = useT();
  const icon =
    stage.status === 'completed' ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
    ) : stage.status === 'in_progress' ? (
      animateActiveStage ? (
        <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
      ) : (
        <CircleDot className="h-4 w-4 text-primary" />
      )
    ) : stage.status === 'blocked' ? (
      <AlertCircle className="h-4 w-4 text-amber-600" />
    ) : (
      <Circle className="h-4 w-4 text-muted-foreground" />
    );

  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{icon}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium text-foreground">{stage.title}</div>
            {stage.checkpoint ? (
              <Badge variant="outline" className="text-[10px]">
                {t('plan.checkpoint')}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{stage.description}</p>
        </div>
      </div>
    </div>
  );
}

function StatusStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background px-3 py-3 shadow-sm">
      <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}
