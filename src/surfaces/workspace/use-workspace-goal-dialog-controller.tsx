'use client';

import * as React from 'react';

import type { GoalComposerValues } from '@/components/workspace/goal-composer-dialog';
import { useT } from '@/components/providers/language-provider';
import { useAppRouter } from '@/lib/app-router';
import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import {
  buildCreatedWorkspaceLocation,
  buildWorkspaceCreateRecovery,
  clearWorkspaceCreateRecovery,
  loadWorkspaceCreateRecovery,
  persistWorkspaceCreateRecovery,
  submitWorkspaceCreateRequest,
  WorkspaceCreateActionError,
  type WorkspaceCreateContext,
} from '@/lib/workspace/create-request';
import type { WorkspaceViewData } from '@/types';

import { WorkspaceGoalDialogSurface } from './workspace-route-chrome';

type OpenProjectDeliverableComposerParams = {
  projectFolderId: string | null;
  workflowPlaybookId?: string | null;
};

export function useWorkspaceGoalDialogController({
  activeWorkflowPlaybookId,
  currentConversationId,
  currentProject,
  currentWorkspace,
  workspaceId,
}: {
  activeWorkflowPlaybookId: string | null;
  currentConversationId: string | null;
  currentProject: WorkspaceViewData['currentProject'] | null;
  currentWorkspace: WorkspaceViewData['workspace'] | null;
  workspaceId: string;
}) {
  const t = useT();
  const router = useAppRouter();
  const [goalDialogOpen, setGoalDialogOpen] = React.useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = React.useState(false);
  const [createWorkspaceError, setCreateWorkspaceError] = React.useState<string | null>(null);
  const [createWorkspaceRecoveryActive, setCreateWorkspaceRecoveryActive] =
    React.useState(false);
  const [createWorkspaceRecoveryValues, setCreateWorkspaceRecoveryValues] =
    React.useState<GoalComposerValues | null>(null);
  const [goalDialogSeedValues, setGoalDialogSeedValues] =
    React.useState<Partial<GoalComposerValues> | null>(null);
  const [workspaceCreateContext, setWorkspaceCreateContext] =
    React.useState<WorkspaceCreateContext | null>(null);
  const createWorkspaceRequestIdRef = React.useRef<string | null>(null);
  const createWorkspaceInFlightRef = React.useRef(false);

  React.useEffect(() => {
    const recovery = loadWorkspaceCreateRecovery();
    if (!recovery) {
      return;
    }

    createWorkspaceRequestIdRef.current = recovery.requestId;
    setCreateWorkspaceRecoveryActive(true);
    setCreateWorkspaceRecoveryValues(recovery.values);
    setWorkspaceCreateContext({
      conversationId: recovery.context?.conversationId || null,
      projectFolderId: recovery.context?.projectFolderId || null,
      projectId: recovery.context?.projectId || null,
      projectTitle: recovery.context?.projectTitle || null,
    });
    setCreateWorkspaceError(
      t(
        recovery.context?.projectId
          ? 'goal.createDeliverableRetryUnknown'
          : 'goal.createProjectRetryUnknown'
      )
    );
  }, [t]);

  const clearTransientDialogState = React.useCallback(() => {
    setCreateWorkspaceError(null);
    setGoalDialogSeedValues(null);
    setWorkspaceCreateContext(null);
    createWorkspaceRequestIdRef.current = null;
  }, []);

  const clearWorkspaceRecoveryState = React.useCallback(() => {
    clearWorkspaceCreateRecovery();
    setCreateWorkspaceRecoveryActive(false);
    setCreateWorkspaceRecoveryValues(null);
  }, []);

  const resetDialogState = React.useCallback(() => {
    clearWorkspaceRecoveryState();
    clearTransientDialogState();
  }, [clearTransientDialogState, clearWorkspaceRecoveryState]);

  const openWorkspaceCreateEntry = React.useCallback(
    (context: WorkspaceCreateContext | null) => {
      setWorkspaceCreateContext(
        context
          ? {
              ...context,
              conversationId:
                context.projectId || context.projectFolderId ? currentConversationId : null,
            }
          : null
      );

      if (createWorkspaceRecoveryActive) {
        setGoalDialogOpen(true);
        return;
      }

      setCreateWorkspaceError(null);
      setGoalDialogSeedValues(null);
      setGoalDialogOpen(true);
    },
    [createWorkspaceRecoveryActive, currentConversationId]
  );

  const openProjectDeliverableComposer = React.useCallback(
    (params: OpenProjectDeliverableComposerParams) => {
      setWorkspaceCreateContext({
        conversationId: currentConversationId,
        projectFolderId: params.projectFolderId,
        projectId:
          currentProject?.id ||
          currentWorkspace?.projectId ||
          currentWorkspace?.id ||
          null,
        projectTitle:
          currentProject?.title ||
          currentWorkspace?.projectTitle ||
          currentWorkspace?.title ||
          null,
      });

      if (createWorkspaceRecoveryActive) {
        setGoalDialogOpen(true);
        return;
      }

      setGoalDialogSeedValues({
        projectParentPath: '',
        workflowPlaybookId: params.workflowPlaybookId || '',
      });
      setGoalDialogOpen(true);
    },
    [
      createWorkspaceRecoveryActive,
      currentProject?.id,
      currentProject?.title,
      currentConversationId,
      currentWorkspace?.id,
      currentWorkspace?.projectId,
      currentWorkspace?.projectTitle,
      currentWorkspace?.title,
    ]
  );

  const createWorkspaceFromGoal = React.useCallback(
    async (values: GoalComposerValues) => {
      if (createWorkspaceInFlightRef.current) {
        return;
      }

      createWorkspaceInFlightRef.current = true;
      setCreateWorkspaceError(null);
      setIsCreatingWorkspace(true);

      const createFailureCopyKey = workspaceCreateContext?.projectId
        ? 'goal.createDeliverableFailed'
        : 'goal.createProjectFailed';
      const createRetryCopyKey = workspaceCreateContext?.projectId
        ? 'goal.createDeliverableRetryUnknown'
        : 'goal.createProjectRetryUnknown';
      const requestId = createWorkspaceRequestIdRef.current || crypto.randomUUID();
      createWorkspaceRequestIdRef.current = requestId;

      try {
        const result = await submitWorkspaceCreateRequest({
          context: workspaceCreateContext,
          errorMessage: t(createFailureCopyKey),
          headers: getStoredAISettingsHeader(),
          requestId,
          values,
        });

        resetDialogState();
        setGoalDialogOpen(false);
        router.push(
          buildCreatedWorkspaceLocation({
            conversationId: result.conversation.id,
            projectId: result.workspace.projectId || result.workspace.id,
            workspaceId: result.workspace.id,
          })
        );
      } catch (error) {
        if (error instanceof WorkspaceCreateActionError) {
          clearWorkspaceRecoveryState();
          createWorkspaceRequestIdRef.current = null;
          setCreateWorkspaceError(error.message);
          return;
        }

        const recovery = buildWorkspaceCreateRecovery({
          context: workspaceCreateContext,
          requestId,
          values,
        });

        createWorkspaceRequestIdRef.current = recovery.requestId;
        persistWorkspaceCreateRecovery(recovery);
        setCreateWorkspaceRecoveryActive(true);
        setCreateWorkspaceRecoveryValues(values);
        setCreateWorkspaceError(t(createRetryCopyKey));
      } finally {
        createWorkspaceInFlightRef.current = false;
        setIsCreatingWorkspace(false);
      }
    },
    [clearWorkspaceRecoveryState, resetDialogState, router, t, workspaceCreateContext]
  );

  const createNextDeliverableWithWorkflow = React.useCallback(() => {
    openProjectDeliverableComposer({
      projectFolderId: currentWorkspace?.projectFolderId || null,
      workflowPlaybookId: activeWorkflowPlaybookId || '',
    });
  }, [
    activeWorkflowPlaybookId,
    currentWorkspace?.projectFolderId,
    openProjectDeliverableComposer,
  ]);

  const goalDialog = (
    <WorkspaceGoalDialogSurface
      createWorkspaceRecoveryActive={createWorkspaceRecoveryActive}
      creationMode={workspaceCreateContext?.projectId ? 'deliverable' : 'project'}
      currentProjectTitle={workspaceCreateContext?.projectTitle || null}
      errorMessage={createWorkspaceError}
      initialValues={createWorkspaceRecoveryValues || goalDialogSeedValues}
      isSubmitting={isCreatingWorkspace}
      onClearTransientState={clearTransientDialogState}
      onOpenChange={setGoalDialogOpen}
      onSubmit={createWorkspaceFromGoal}
      open={goalDialogOpen}
      workflowContextId={workspaceId}
    />
  );

  return {
    createNextDeliverableWithWorkflow,
    goalDialog,
    openProjectDeliverableComposer,
    openWorkspaceCreateEntry,
  };
}
