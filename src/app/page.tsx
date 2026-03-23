'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ArrowRight, Sparkles } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { ProjectCard } from '@/components/layout/project-card';
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
import { buildWorkspaceRoute } from '@/lib/workspace/route';

import type { ProjectSummaryData } from '@/types';

export default function HomePage() {
  const t = useT();
  const router = useAppRouter();
  const searchParams = useAppSearchParams();
  const [homeProjects, setHomeProjects] = React.useState<ProjectSummaryData[] | null>(null);
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
            conversationId: null,
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
          projectId: workspace.workspace.projectId || workspace.workspace.id,
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

  const openProject = React.useCallback(
    (project: ProjectSummaryData) => {
      router.push(
        buildWorkspaceRoute({
          nodeId: project.workspaceId,
          projectId: project.id,
        })
      );
    },
    [router]
  );

  const openProjectNextDeliverable = React.useCallback(
    (project: ProjectSummaryData) => {
      const params = new URLSearchParams({
        newDeliverableProjectId: project.id,
        newDeliverableProjectTitle: project.title,
      });
      router.push(`/?${params.toString()}`);
    },
    [router]
  );

  const showsProjectWall = Boolean(homeProjects && homeProjects.length > 0);

  return (
    <AppShell
      renderSidebar={({ collapsed, onNavigate }) => (
        <DeliverableSidebar
          collapsed={collapsed}
          currentWorkspaceId={null}
          onCreateWorkspace={openWorkspaceCreateEntry}
          onNavigate={onNavigate}
          onProjectsChange={setHomeProjects}
          outlineItems={[]}
        />
      )}
      title={t('home.title')}
      subtitle={t('home.subtitle')}
    >
      <main className="h-full overflow-y-auto px-6 py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          <div
            className={
              showsProjectWall
                ? 'rounded-[28px] border border-border/70 bg-muted/20 p-6 shadow-sm sm:p-8'
                : 'rounded-[28px] border border-border/70 bg-muted/20 p-8 shadow-sm sm:p-12'
            }
          >
            <div className={showsProjectWall ? 'max-w-5xl' : 'max-w-2xl'}>
              <div className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                {t('home.badge')}
              </div>
              <div
                className={
                  showsProjectWall
                    ? 'mt-4 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between'
                    : undefined
                }
              >
                <div className="min-w-0">
                  <h1
                    className={
                      showsProjectWall
                        ? 'text-2xl font-semibold tracking-tight sm:text-3xl'
                        : 'mt-4 text-3xl font-semibold tracking-tight sm:text-5xl'
                    }
                  >
                    {t('home.heroTitle')}
                  </h1>
                  <p
                    className={
                      showsProjectWall
                        ? 'mt-3 max-w-3xl text-sm leading-7 text-muted-foreground'
                        : 'mt-4 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base'
                    }
                  >
                    {t('home.heroDescription')}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
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
          </div>

          {showsProjectWall ? (
            <section className="space-y-4" data-testid="home-project-wall">
              <div className="grid gap-4 xl:grid-cols-3">
                {homeProjects?.map((project) => (
                  <ProjectCard
                    key={project.id}
                    onContinueCurrent={openProject}
                    onContinueNext={openProjectNextDeliverable}
                    project={project}
                  />
                ))}
              </div>
            </section>
          ) : (
            <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
              {[t('home.card1'), t('home.card2'), t('home.card3')].map((copy) => (
                <div
                  key={copy}
                  className="rounded-2xl border border-border/60 bg-background/60 px-4 py-4 leading-6"
                >
                  {copy}
                </div>
              ))}
            </div>
          )}
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
