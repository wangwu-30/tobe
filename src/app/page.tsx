'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ArrowRight, Sparkles } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import { useAppRouter, useAppSearchParams } from '@/lib/app-router';
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
import {
  GoalComposerDialog,
  type GoalComposerValues,
} from '@/components/workspace/goal-composer-dialog';
import { DeliverableSidebar } from '@/components/workspace/deliverable-sidebar';
import { useT } from '@/components/providers/language-provider';
import { OnboardingDialog } from '@/components/layout/onboarding-dialog';

export default function HomePage() {
  const t = useT();
  const router = useAppRouter();
  const searchParams = useAppSearchParams();
  const [goalDialogOpen, setGoalDialogOpen] = React.useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = React.useState(false);
  const [createWorkspaceError, setCreateWorkspaceError] = React.useState<string | null>(null);
  const [createWorkspaceRecoveryActive, setCreateWorkspaceRecoveryActive] =
    React.useState(false);
  const [createWorkspaceRecoveryValues, setCreateWorkspaceRecoveryValues] =
    React.useState<GoalComposerValues | null>(null);
  const [workspaceCreateContext, setWorkspaceCreateContext] =
    React.useState<WorkspaceCreateContext | null>(null);
  const [pendingCreateEntry, setPendingCreateEntry] = React.useState<
    WorkspaceCreateContext | 'workspace' | null
  >(null);
  const createWorkspaceRequestIdRef = React.useRef<string | null>(null);
  const createWorkspaceInFlightRef = React.useRef(false);

  React.useEffect(() => {
    const recovery = loadWorkspaceCreateRecovery();
    if (recovery) {
      createWorkspaceRequestIdRef.current = recovery.requestId;
      setCreateWorkspaceRecoveryActive(true);
      setCreateWorkspaceRecoveryValues(recovery.values);
      setWorkspaceCreateContext({
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
    }
  }, [t]);

  React.useEffect(() => {
    const projectId = searchParams.get('newDeliverableProjectId');
    const projectTitle = searchParams.get('newDeliverableProjectTitle');
    const shouldOpenWorkspace = searchParams.get('newWorkspace') === '1';

    if (!projectId && !shouldOpenWorkspace) {
      return;
    }

    setPendingCreateEntry(
      projectId
        ? {
            projectFolderId: null,
            projectId,
            projectTitle: projectTitle?.trim() || null,
          }
        : 'workspace'
    );
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.hash}`
    );
  }, [router, searchParams]);

  const openWorkspaceCreateEntry = React.useCallback(
    (context: WorkspaceCreateContext | null = null) => {
      setWorkspaceCreateContext(context);

      if (createWorkspaceRecoveryActive) {
        setGoalDialogOpen(true);
        return;
      }

      setCreateWorkspaceError(null);
      setGoalDialogOpen(true);
    },
    [createWorkspaceRecoveryActive]
  );

  React.useEffect(() => {
    if (!pendingCreateEntry) {
      return;
    }

    openWorkspaceCreateEntry(
      pendingCreateEntry === 'workspace' ? null : pendingCreateEntry
    );
    setPendingCreateEntry(null);
  }, [openWorkspaceCreateEntry, pendingCreateEntry]);

  const createWorkspace = async (values: GoalComposerValues) => {
    if (createWorkspaceInFlightRef.current) return;

    createWorkspaceInFlightRef.current = true;
    setCreateWorkspaceError(null);
    setIsCreatingWorkspace(true);

    const requestId = createWorkspaceRequestIdRef.current || crypto.randomUUID();
    createWorkspaceRequestIdRef.current = requestId;

    try {
      const workspace = await submitWorkspaceCreateRequest({
        context: workspaceCreateContext,
        errorMessage: t(
          workspaceCreateContext?.projectId
            ? 'goal.createDeliverableFailed'
            : 'goal.createProjectFailed'
        ),
        headers: getStoredAISettingsHeader(),
        requestId,
        values,
      });
      clearWorkspaceCreateRecovery();
      setCreateWorkspaceRecoveryActive(false);
      setCreateWorkspaceRecoveryValues(null);
      setWorkspaceCreateContext(null);
      createWorkspaceRequestIdRef.current = null;
      setGoalDialogOpen(false);
      router.push(
        buildCreatedWorkspaceLocation({
          autoStartFirstPass: true,
          conversationId: workspace.conversation.id,
          workspaceId: workspace.workspace.id,
        })
      );
    } catch (error) {
      if (error instanceof WorkspaceCreateActionError) {
        clearWorkspaceCreateRecovery();
        setCreateWorkspaceRecoveryActive(false);
        setCreateWorkspaceRecoveryValues(null);
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
      setCreateWorkspaceError(
        t(
          workspaceCreateContext?.projectId
            ? 'goal.createDeliverableRetryUnknown'
            : 'goal.createProjectRetryUnknown'
        )
      );
    } finally {
      createWorkspaceInFlightRef.current = false;
      setIsCreatingWorkspace(false);
    }
  };

  const handleGoalDialogOpenChange = React.useCallback((open: boolean) => {
    if (!open) {
      if (!createWorkspaceRecoveryActive) {
        clearWorkspaceCreateRecovery();
        setCreateWorkspaceError(null);
        setCreateWorkspaceRecoveryValues(null);
        setWorkspaceCreateContext(null);
        createWorkspaceRequestIdRef.current = null;
      }
    }

    setGoalDialogOpen(open);
  }, [createWorkspaceRecoveryActive]);

  return (
    <AppShell
      renderSidebar={({ collapsed, onNavigate }) => (
        <DeliverableSidebar
          collapsed={collapsed}
          currentWorkspaceId={null}
          onCreateWorkspace={openWorkspaceCreateEntry}
          onNavigate={onNavigate}
          outlineItems={[]}
        />
      )}
      title={t('home.title')}
      subtitle={t('home.subtitle')}
    >
      <main className="flex h-full items-center justify-center px-6 py-10">
        <div className="w-full max-w-3xl">
          <div className="rounded-[28px] border border-border/70 bg-muted/20 p-8 shadow-sm sm:p-12">
            <div className="max-w-2xl">
              <div className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                {t('home.badge')}
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">
                {t('home.heroTitle')}
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
                {t('home.heroDescription')}
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button
                  className="gap-2 rounded-xl px-5"
                  onClick={() => openWorkspaceCreateEntry()}
                >
                  <Sparkles className="h-4 w-4" />
                  {t('home.startWithGoal')}
                </Button>
                <Button
                  variant="ghost"
                  className="gap-2 rounded-xl"
                  onClick={() => router.push('/settings')}
                >
                  {t('home.configureModels')}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
            {[
              t('home.card1'),
              t('home.card2'),
              t('home.card3'),
            ].map(copy => (
              <div
                key={copy}
                className="rounded-2xl border border-border/60 bg-background/60 px-4 py-4 leading-6"
              >
                {copy}
              </div>
            ))}
          </div>
        </div>
      </main>

      <GoalComposerDialog
        creationMode={workspaceCreateContext?.projectId ? 'deliverable' : 'project'}
        currentProjectTitle={workspaceCreateContext?.projectTitle || null}
        disableInputs={createWorkspaceRecoveryActive}
        open={goalDialogOpen}
        errorMessage={createWorkspaceError}
        initialValues={createWorkspaceRecoveryValues || undefined}
        onOpenChange={handleGoalDialogOpenChange}
        isSubmitting={isCreatingWorkspace}
        submitLabel={
          createWorkspaceRecoveryActive ? t('goal.retryProjectCheck') : undefined
        }
        onSubmit={(values) => createWorkspace(values)}
        workflowContextId={null}
      />
      
      <OnboardingDialog />
    </AppShell>
  );
}
