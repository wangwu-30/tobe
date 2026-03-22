'use client';

import * as React from 'react';

import { AppShell } from '@/components/layout/app-shell';
import { FirstUseGuide } from '@/components/layout/first-use-guide';
import { SplitView } from '@/components/layout/split-view';
import { Button } from '@/components/ui/button';
import { ZoneErrorBoundary } from '@/framework/resilience';
import { cn } from '@/lib/utils';
import type { DeliverableType } from '@/types';

type WorkspacePaneOrder = 'deliverable-left' | 'assistant-left';

type WorkspaceScreenNoticeAction = {
  label: string;
  onClick: () => void;
  variant?: React.ComponentProps<typeof Button>['variant'];
};

type WorkspaceScreenNotice = {
  actions?: WorkspaceScreenNoticeAction[];
  tone: 'error' | 'info' | 'success';
  text: string;
};

export function WorkspaceScreen({
  actions,
  assistantRail,
  currentVersionId,
  deliverablePanel,
  deliverableType,
  goalDialog,
  paneOrder,
  renderSidebar,
  subtitle,
  title,
  titleNode,
  versionGuideDescription,
  versionGuideTitle,
  workspaceId,
  workspaceNotice,
}: {
  actions?: React.ReactNode;
  assistantRail: React.ReactNode;
  currentVersionId?: string | null;
  deliverablePanel: React.ReactNode;
  deliverableType: DeliverableType;
  goalDialog?: React.ReactNode;
  paneOrder: WorkspacePaneOrder;
  renderSidebar: NonNullable<React.ComponentProps<typeof AppShell>['renderSidebar']>;
  subtitle?: string;
  title: string;
  titleNode?: React.ReactNode;
  versionGuideDescription: string;
  versionGuideTitle: string;
  workspaceId: string;
  workspaceNotice: WorkspaceScreenNotice | null;
}) {
  return (
    <AppShell
      actions={actions}
      currentWorkspaceId={workspaceId}
      renderSidebar={(props) => (
        <ZoneErrorBoundary level="recoverable" zone="workspace-sidebar">
          {renderSidebar(props)}
        </ZoneErrorBoundary>
      )}
      subtitle={subtitle}
      title={title}
      titleNode={titleNode}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {workspaceNotice ? (
          <div
            className={cn(
              'border-b px-4 py-2 text-sm',
              workspaceNotice.tone === 'error' &&
                'border-destructive/20 bg-destructive/5 text-destructive',
              workspaceNotice.tone === 'success' &&
                'border-emerald-500/20 bg-emerald-500/5 text-emerald-700',
              workspaceNotice.tone === 'info' &&
                'border-border bg-muted/20 text-foreground'
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">{workspaceNotice.text}</div>
              {workspaceNotice.actions?.length ? (
                <div className="flex shrink-0 items-center gap-2">
                  {workspaceNotice.actions.map((action) => (
                    <Button
                      key={action.label}
                      size="sm"
                      variant={action.variant || 'outline'}
                      className="h-7"
                      onClick={action.onClick}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {currentVersionId ? (
          <div className="px-4 pt-4">
            <FirstUseGuide
              description={versionGuideDescription}
              guideId="version-surface"
              testId="first-use-guide-version"
              title={versionGuideTitle}
              variant="compact"
            />
          </div>
        ) : null}

        <SplitView
          className="flex-1"
          defaultRatio={paneOrder === 'deliverable-left' ? 0.68 : 0.32}
          left={
            paneOrder === 'deliverable-left' ? (
              <ZoneErrorBoundary level="critical" zone="workspace-deliverable">
                {deliverablePanel}
              </ZoneErrorBoundary>
            ) : (
              <ZoneErrorBoundary level="recoverable" zone="workspace-assistant">
                {assistantRail}
              </ZoneErrorBoundary>
            )
          }
          resetKey={`${workspaceId}:${paneOrder}:${deliverableType}`}
          right={
            paneOrder === 'deliverable-left' ? (
              <ZoneErrorBoundary level="recoverable" zone="workspace-assistant">
                {assistantRail}
              </ZoneErrorBoundary>
            ) : (
              <ZoneErrorBoundary level="critical" zone="workspace-deliverable">
                {deliverablePanel}
              </ZoneErrorBoundary>
            )
          }
        />
      </div>

      {goalDialog}
    </AppShell>
  );
}
