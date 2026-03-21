'use client';

import * as React from 'react';

import { updateWorkspacePlanActiveWorkflow } from '@/lib/workspace/plan-client';
import type { RenderAs, WorkspaceViewData } from '@/types';

type WorkspaceNoticeAction = {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'ghost' | 'outline';
};

type WorkspaceShellNotice = {
  actions?: WorkspaceNoticeAction[];
  text: string;
  tone: 'error' | 'info' | 'success';
};

type QueuedPrompt = {
  content: string;
  id: string;
};

type PaneOrder = 'deliverable-left' | 'assistant-left';

const NOTICE_DISMISS_DELAY_MS = 4000;
const PANE_ORDER_STORAGE_KEY = 'workspace-pane-order';

function buildFirstPassPrompt(params: {
  constraints: string | null;
  currentText: string;
  goal: string;
  renderAs: RenderAs;
  styleGuide: string | null;
}) {
  const lines = [
    'Take the first author pass for this deliverable.',
    'First inspect the current workspace context.',
    'Then render the first coherent draft directly into the live draft instead of stopping at staged changes.',
    params.renderAs === 'web'
      ? 'Keep the web draft React-based by default. Use a thin previewable index.html shell only as the mount entrypoint, put most page logic and structure in React source files, and start preview if the workspace supports it.'
      : params.renderAs === 'slides'
        ? 'Write into the main live draft file using slide_page blocks, keep one coherent slide per page, and preserve a presentation-ready deck instead of falling back to a plain article.'
      : 'Write into the main live draft file, keep the current structure coherent, and avoid hiding the result in chat only.',
    'Create a recovery point before the pass, keep only the recent recovery points, and mention the newest one in your summary.',
    'Use the main deliverable file when possible.',
    'After using tools, reply with a short summary of what you rendered or saved.',
    '',
    `Current result shape: ${params.renderAs}`,
    `Goal: ${params.goal}`,
  ];

  if (params.styleGuide?.trim()) {
    lines.push(`Style / tone: ${params.styleGuide.trim()}`);
  }

  if (params.constraints?.trim()) {
    lines.push(`Constraints: ${params.constraints.trim()}`);
  }

  if (params.currentText.trim()) {
    lines.push('', 'Current draft:', params.currentText.trim());
  }

  return lines.join('\n');
}

export function useWorkspaceShellController<
  TTranslate extends (...args: any[]) => string,
>({
  comparableDeliverableText,
  currentWorkspace,
  deliverable,
  isAssistantBusy,
  renderAs,
  setWorkspaceNotice,
  setWorkspaceView,
  t,
  workspaceBrief,
  workspaceNotice,
  workspaceId,
}: {
  comparableDeliverableText: string;
  currentWorkspace: WorkspaceViewData['workspace'] | null;
  deliverable: WorkspaceViewData['deliverable'] | null;
  isAssistantBusy: boolean;
  renderAs: RenderAs;
  setWorkspaceNotice: React.Dispatch<
    React.SetStateAction<WorkspaceShellNotice | null>
  >;
  setWorkspaceView: React.Dispatch<React.SetStateAction<WorkspaceViewData | null>>;
  t: TTranslate;
  workspaceBrief: WorkspaceViewData['workspacePlan'] | null;
  workspaceNotice: WorkspaceShellNotice | null;
  workspaceId: string;
}) {
  const [paneOrder, setPaneOrder] = React.useState<PaneOrder>('deliverable-left');
  const [queuedPrompt, setQueuedPrompt] = React.useState<QueuedPrompt | null>(null);

  React.useEffect(() => {
    const storedPaneOrder = window.localStorage.getItem(PANE_ORDER_STORAGE_KEY);
    if (storedPaneOrder === 'deliverable-left' || storedPaneOrder === 'assistant-left') {
      setPaneOrder(storedPaneOrder);
    }
  }, []);

  React.useEffect(() => {
    if (!workspaceNotice || workspaceNotice.actions?.length) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setWorkspaceNotice(null);
    }, NOTICE_DISMISS_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [setWorkspaceNotice, workspaceNotice]);

  const applyWorkflowPlaybook = React.useCallback(
    async (workflowPlaybookId: string | null) => {
      const payload = await updateWorkspacePlanActiveWorkflow({
        errorMessage: t('context.workflowApplyFailed'),
        workflowPlaybookId,
        workspaceId,
      });

      setWorkspaceView((current) =>
        current
          ? {
              ...current,
              workspacePlan: payload,
              workspace: current.workspace
                ? {
                    ...current.workspace,
                    workspacePlan: payload,
                  }
                : current.workspace,
            }
          : current
      );
      setWorkspaceNotice({
        tone: 'success',
        text: workflowPlaybookId
          ? t('context.workflowApplied')
          : t('context.workflowCleared'),
      });
    },
    [setWorkspaceNotice, setWorkspaceView, t, workspaceId]
  );

  const handleGenerateFirstPass = React.useCallback(() => {
    if (!currentWorkspace || isAssistantBusy) {
      return;
    }

    const nextPrompt: QueuedPrompt = {
      content: buildFirstPassPrompt({
        goal:
          workspaceBrief?.goal ||
          currentWorkspace.title ||
          deliverable?.title ||
          'Refine the current deliverable',
        constraints: workspaceBrief?.constraints || null,
        styleGuide: workspaceBrief?.styleGuide || null,
        currentText: comparableDeliverableText,
        renderAs,
      }),
      id: `${Date.now()}`,
    };

    setQueuedPrompt(nextPrompt);
    setWorkspaceNotice({
      tone: 'info',
      text: t('workspace.aiPreparingFirstPass'),
    });
  }, [
    comparableDeliverableText,
    currentWorkspace,
    deliverable?.title,
    isAssistantBusy,
    renderAs,
    setWorkspaceNotice,
    t,
    workspaceBrief,
  ]);

  const handleQueuedPromptHandled = React.useCallback((promptId: string) => {
    setQueuedPrompt((current) => (current?.id === promptId ? null : current));
  }, []);

  const togglePaneOrder = React.useCallback(() => {
    setPaneOrder((current) => {
      const next = current === 'deliverable-left' ? 'assistant-left' : 'deliverable-left';
      window.localStorage.setItem(PANE_ORDER_STORAGE_KEY, next);
      return next;
    });
  }, []);

  return {
    applyWorkflowPlaybook,
    handleGenerateFirstPass,
    handleQueuedPromptHandled,
    paneOrder,
    queuedPrompt,
    togglePaneOrder,
  };
}
