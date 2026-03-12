'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  LoaderCircle,
  Sparkles,
} from 'lucide-react';
import type { WorkflowSummaryData, WorkspacePlanData } from '@/types';
import { useT } from '@/components/providers/language-provider';

export function PlanPanel({
  canGenerateFirstPass = false,
  isAssistantBusy = false,
  onGenerateFirstPass,
  plan,
  workflowSummary,
}: {
  canGenerateFirstPass?: boolean;
  isAssistantBusy?: boolean;
  onGenerateFirstPass?: () => void;
  plan?: WorkspacePlanData | null;
  workflowSummary?: WorkflowSummaryData | null;
}) {
  const t = useT();
  const aiWorking = Boolean(workflowSummary?.isAiWorking || isAssistantBusy);
  const currentStage =
    plan?.stages.find((stage) => stage.id === plan.activeStageId) || plan?.stages[0] || null;
  const progressNote =
    workflowSummary?.blockedReason ||
    plan?.lastProgressNote ||
    workflowSummary?.statusDescription ||
    null;

  if (!plan && !workflowSummary) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        <div>
          <Sparkles className="mx-auto mb-3 h-8 w-8 opacity-40" />
          <p>{t('plan.noPlanTitle')}</p>
          <p className="mt-1 text-xs opacity-70">{t('plan.noPlanDescription')}</p>
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
                    {currentStage?.title || workflowSummary?.statusTitle || t('plan.noPlanTitle')}
                  </span>
                  {aiWorking ? (
                    <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                  ) : null}
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {progressNote || t('plan.noPlanDescription')}
                </p>
              </div>
              <Badge variant="secondary">{t('assistant.plan')}</Badge>
            </div>

            {plan?.goal ? (
              <div className="mt-4 rounded-2xl border border-border/70 bg-muted/15 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  {t('plan.goal')}
                </div>
                <div className="mt-2 text-sm leading-6 text-foreground">{plan.goal}</div>
              </div>
            ) : null}

            {workflowSummary?.blockedReason ? (
              <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  {t('status.blockedReason')}
                </div>
                <div className="mt-2 text-sm leading-6 text-foreground">
                  {workflowSummary.blockedReason}
                </div>
              </div>
            ) : null}

            {plan?.stages.length ? (
              <div className="mt-4 space-y-2">
                {plan.stages.map((stage) => (
                  <StageRow key={stage.id} stage={stage} />
                ))}
              </div>
            ) : null}

            {canGenerateFirstPass ? (
              <div className="mt-4 rounded-2xl border border-primary/10 bg-primary/5 px-3 py-3">
                <div className="text-sm font-medium text-foreground">
                  {t('plan.firstPassTitle')}
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t('plan.firstPassDescription')}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={onGenerateFirstPass}
                    disabled={isAssistantBusy}
                  >
                    {isAssistantBusy ? t('plan.aiDrafting') : t('plan.firstPassAction')}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="grid gap-3">
            <StatusStat
              label={t('status.ai')}
              value={aiWorking ? t('status.aiBusy') : t('status.aiIdle')}
            />
            <StatusStat
              label={t('status.preview')}
              value={
                workflowSummary?.phase === 'preview_running'
                  ? t('status.previewRunning')
                  : workflowSummary?.phase === 'preview_ready' ||
                      workflowSummary?.phase === 'finalized'
                    ? t('status.previewReady')
                    : workflowSummary?.phase === 'blocked'
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
  stage,
}: {
  stage: WorkspacePlanData['stages'][number];
}) {
  const t = useT();
  const icon =
    stage.status === 'completed' ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
    ) : stage.status === 'in_progress' ? (
      <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
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
