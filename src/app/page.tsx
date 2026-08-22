'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { ArrowRight, LayoutGrid, Map, Sparkles } from 'lucide-react';
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
import { cn } from '@/lib/utils';

const HomeCanvasLoader = dynamic(
  () =>
    import('@/canvas/home-canvas/home-canvas-loader').then((mod) => ({
      default: mod.HomeCanvasLoader,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        Loading canvas…
      </div>
    ),
  }
);

type HomeViewMode = 'list' | 'canvas';

function setStoredHomeViewMode(mode: HomeViewMode) {
  localStorage.setItem('home-view-mode', mode);
}

export default function HomePage() {
  return (
    <React.Suspense fallback={<div className="min-h-screen bg-background" />}>
      <HomePageContent />
    </React.Suspense>
  );
}

function HomePageContent() {
  const t = useT();
  const router = useAppRouter();
  const searchParams = useAppSearchParams();
  const requestedViewMode = searchParams.get('view');
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
  const [viewMode, setViewMode] = React.useState<HomeViewMode>(() =>
    requestedViewMode === 'canvas' || requestedViewMode === 'list'
      ? requestedViewMode
      : 'list'
  );
  const createWorkspaceRequestIdRef = React.useRef<string | null>(null);
  const createWorkspaceInFlightRef = React.useRef(false);

  React.useEffect(() => {
    const nextViewMode =
      requestedViewMode === 'canvas' || requestedViewMode === 'list'
        ? requestedViewMode
        : (localStorage.getItem('home-view-mode') as HomeViewMode) || 'list';
    setViewMode(nextViewMode);
  }, [requestedViewMode]);

  const selectViewMode = React.useCallback(
    (nextViewMode: HomeViewMode) => {
      setViewMode(nextViewMode);
      setStoredHomeViewMode(nextViewMode);
      const nextSearchParams = new URLSearchParams(searchParams.toString());
      if (nextViewMode === 'list') {
        nextSearchParams.delete('view');
      } else {
        nextSearchParams.set('view', nextViewMode);
      }
      const nextQuery = nextSearchParams.toString();
      router.push(`${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`);
    },
    [router, searchParams]
  );

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
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.delete('newDeliverableProjectId');
    nextSearchParams.delete('newDeliverableProjectTitle');
    nextSearchParams.delete('newWorkspace');
    const nextQuery = nextSearchParams.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`
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
      <main className="h-full overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          <div
            className={
              showsProjectWall
                ? 'rounded-[28px] border border-border/70 bg-muted/20 p-6 shadow-sm sm:p-8'
                : 'rounded-[28px] border border-border/70 bg-muted/20 p-8 shadow-sm sm:p-12'
            }
          >
            <div className={showsProjectWall ? 'max-w-5xl' : 'max-w-2xl'}>
              <div className="inline-flex rounded-full bg-foreground/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-foreground/60 ring-1 ring-border/40">
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
                        ? 'text-balance text-2xl font-semibold tracking-tight sm:text-3xl'
                        : 'mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl'
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
                  <Button asChild className="gap-2 rounded-xl" variant="ghost">
                    <a href="/settings">
                      {t('home.configureModels')}
                      <ArrowRight className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {showsProjectWall ? (
            <>
              <div className="flex items-center justify-between">
                <div className="inline-flex rounded-lg border bg-muted/50 p-0.5">
                  <button
                    type="button"
                    className={cn(
                      'inline-flex min-h-10 touch-manipulation items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:min-h-0',
                      viewMode === 'list'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    onClick={() => {
                      selectViewMode('list');
                    }}
                    data-testid="home-view-list"
                    aria-pressed={viewMode === 'list'}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    列表
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex min-h-10 touch-manipulation items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:min-h-0',
                      viewMode === 'canvas'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    onClick={() => {
                      selectViewMode('canvas');
                    }}
                    data-testid="home-view-canvas"
                    aria-pressed={viewMode === 'canvas'}
                  >
                    <Map className="h-3.5 w-3.5" />
                    画布
                  </button>
                </div>
              </div>

              {viewMode === 'list' ? (
                <section className="space-y-4" data-testid="home-project-wall">
                  <div className="grid gap-4 xl:grid-cols-3">
                    {homeProjects?.map((project) => (
                      <ProjectCard
                        currentHref={buildWorkspaceRoute({
                          nodeId: project.workspaceId,
                          projectId: project.id,
                        })}
                        key={project.id}
                        nextHref={`/?${new URLSearchParams({
                          newDeliverableProjectId: project.id,
                          newDeliverableProjectTitle: project.title,
                        }).toString()}`}
                        project={project}
                      />
                    ))}
                  </div>
                </section>
              ) : (
                <section
                  className="h-[500px] overflow-hidden rounded-2xl border border-border/60 bg-background/60"
                  data-testid="home-project-canvas"
                >
                  <HomeCanvasLoader
                    projects={homeProjects || []}
                    onDoubleClickProject={openProject}
                  />
                </section>
              )}
            </>
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
