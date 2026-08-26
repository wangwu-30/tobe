'use client';

import * as React from 'react';
import { BookOpen } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { ProjectCard } from '@/components/layout/project-card';
import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import { useAppRouter, useAppSearchParams } from '@/lib/app-router';
import {
  buildCreatedWorkspaceLocation,
  buildWorkspaceCreateRecovery,
  clearWorkspaceCreateRecovery,
  getWorkspaceCreateErrorMessage,
  hasUnknownWorkspaceCreateOutcome,
  loadWorkspaceCreateRecovery,
  persistWorkspaceCreateRecovery,
  submitWorkspaceCreateRequest,
  type WorkspaceCreateContext,
  type WorkspaceCreateValues,
} from '@/lib/workspace/create-request';
import {
  GoalComposerDialog,
  type GoalComposerValues,
} from '@/components/workspace/goal-composer-dialog';
import { DeliverableSidebar } from '@/components/workspace/deliverable-sidebar';
import { useT } from '@/components/providers/language-provider';
import { buildWorkspaceRoute } from '@/lib/workspace/route';
import { HomeOnboardingChat } from '@/surfaces/home/home-onboarding-chat';
import { clearOnboardingConversationId } from '@/surfaces/home/onboarding-session';
import {
  WikiCreateConfirmationDialog,
  type WikiCreateConfirmationPayload,
} from '@/surfaces/home/wiki-create-confirmation-dialog';

import type { ProjectSummaryData } from '@/types';

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
  const [homeProjects, setHomeProjects] = React.useState<ProjectSummaryData[] | null>(null);
  const [goalDialogOpen, setGoalDialogOpen] = React.useState(false);
  const [wikiDialogOpen, setWikiDialogOpen] = React.useState(false);
  const [wikiCreateProposal, setWikiCreateProposal] = React.useState<{
    conversationId: string | null;
    goal: string;
    title: string;
  } | null>(null);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = React.useState(false);
  const [createWorkspaceError, setCreateWorkspaceError] = React.useState<string | null>(null);
  const [createWorkspaceRecoveryActive, setCreateWorkspaceRecoveryActive] =
    React.useState(false);
  const [createWorkspaceRecoveryValues, setCreateWorkspaceRecoveryValues] =
    React.useState<WorkspaceCreateValues | null>(null);
  const [workspaceCreateContext, setWorkspaceCreateContext] =
    React.useState<WorkspaceCreateContext | null>(null);
  const [goalDialogSeedValues, setGoalDialogSeedValues] =
    React.useState<Partial<GoalComposerValues> | null>(null);
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
    (
      context: WorkspaceCreateContext | null = null,
      initialValues: Partial<GoalComposerValues> | null = null
    ) => {
      if (createWorkspaceRecoveryActive) {
        if (workspaceCreateContext?.projectId) {
          setGoalDialogOpen(true);
        } else {
          setWikiCreateProposal({
            conversationId: workspaceCreateContext?.conversationId || null,
            goal: createWorkspaceRecoveryValues?.goal || '',
            title:
              createWorkspaceRecoveryValues?.title?.trim() ||
              createWorkspaceRecoveryValues?.goal.trim() ||
              '',
          });
          setWikiDialogOpen(true);
        }
        return;
      }

      setWorkspaceCreateContext(context);
      setCreateWorkspaceError(null);
      if (context?.projectId) {
        setGoalDialogSeedValues(initialValues);
        setGoalDialogOpen(true);
        return;
      }

      setWikiCreateProposal({
        conversationId: context?.conversationId || null,
        goal: initialValues?.goal?.trim() || '',
        title: '',
      });
      setWikiDialogOpen(true);
    },
    [
      createWorkspaceRecoveryActive,
      createWorkspaceRecoveryValues,
      workspaceCreateContext,
    ]
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

  const createWorkspace = React.useCallback(
    async (
      values: WorkspaceCreateValues,
      context: WorkspaceCreateContext | null
    ) => {
      if (createWorkspaceInFlightRef.current) return;

      createWorkspaceInFlightRef.current = true;
      setCreateWorkspaceError(null);
      setIsCreatingWorkspace(true);

      const requestId = createWorkspaceRequestIdRef.current || crypto.randomUUID();
      createWorkspaceRequestIdRef.current = requestId;

      try {
        const workspace = await submitWorkspaceCreateRequest({
          context,
          errorMessage: t(
            context?.projectId
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
        setGoalDialogSeedValues(null);
        setWikiCreateProposal(null);
        createWorkspaceRequestIdRef.current = null;
        setGoalDialogOpen(false);
        setWikiDialogOpen(false);
        if (context?.conversationId) {
          clearOnboardingConversationId(context.conversationId);
        }
        router.push(
          buildCreatedWorkspaceLocation({
            conversationId: workspace.conversation.id,
            projectId: workspace.workspace.projectId || workspace.workspace.id,
            workspaceId: workspace.workspace.id,
          })
        );
      } catch (error) {
        if (!hasUnknownWorkspaceCreateOutcome(error)) {
          clearWorkspaceCreateRecovery();
          setCreateWorkspaceRecoveryActive(false);
          setCreateWorkspaceRecoveryValues(null);
          createWorkspaceRequestIdRef.current = null;
          setCreateWorkspaceError(
            getWorkspaceCreateErrorMessage(
              error,
              t(
                context?.projectId
                  ? 'goal.createDeliverableFailed'
                  : 'goal.createProjectFailed'
              )
            )
          );
          return;
        }

        const recovery = buildWorkspaceCreateRecovery({
          context,
          requestId,
          values,
        });
        createWorkspaceRequestIdRef.current = recovery.requestId;
        persistWorkspaceCreateRecovery(recovery);
        setCreateWorkspaceRecoveryActive(true);
        setCreateWorkspaceRecoveryValues(values);
        setCreateWorkspaceError(
          t(
            context?.projectId
              ? 'goal.createDeliverableRetryUnknown'
              : 'goal.createProjectRetryUnknown'
          )
        );
      } finally {
        createWorkspaceInFlightRef.current = false;
        setIsCreatingWorkspace(false);
      }
    },
    [router, t]
  );

  const handleGoalDialogOpenChange = React.useCallback((open: boolean) => {
    if (!open) {
      if (!createWorkspaceRecoveryActive) {
        clearWorkspaceCreateRecovery();
        setCreateWorkspaceError(null);
        setCreateWorkspaceRecoveryValues(null);
        setWorkspaceCreateContext(null);
        setGoalDialogSeedValues(null);
        createWorkspaceRequestIdRef.current = null;
      }
    }

    setGoalDialogOpen(open);
  }, [createWorkspaceRecoveryActive]);

  const handleWikiDialogOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open && !createWorkspaceRecoveryActive) {
        clearWorkspaceCreateRecovery();
        setCreateWorkspaceError(null);
        setCreateWorkspaceRecoveryValues(null);
        setWorkspaceCreateContext(null);
        setWikiCreateProposal(null);
        createWorkspaceRequestIdRef.current = null;
      }

      setWikiDialogOpen(open);
    },
    [createWorkspaceRecoveryActive]
  );

  const confirmWikiCreation = React.useCallback(
    async (payload: WikiCreateConfirmationPayload) => {
      const context = createWorkspaceRecoveryActive
        ? workspaceCreateContext
        : {
            conversationId: payload.conversationId,
            projectFolderId: null,
            projectId: null,
            projectTitle: null,
          };
      const values =
        createWorkspaceRecoveryActive && createWorkspaceRecoveryValues
          ? createWorkspaceRecoveryValues
          : {
              constraints: '',
              createMode: 'document' as const,
              deliverableType: 'document' as const,
              goal: payload.purpose,
              projectParentPath: '',
              selectedIntent: 'document' as const,
              selectedIntentNote: '',
              styleGuide: '',
              title: payload.title,
              workflowPlaybookId: '',
            };

      if (createWorkspaceRecoveryActive && (!context || !createWorkspaceRecoveryValues)) {
        setCreateWorkspaceError(t('goal.createProjectFailed'));
        return;
      }

      setWorkspaceCreateContext(context);
      await createWorkspace(values, context);
    },
    [
      createWorkspaceRecoveryActive,
      createWorkspaceRecoveryValues,
      createWorkspace,
      t,
      workspaceCreateContext,
    ]
  );

  const hasProjects = Boolean(homeProjects?.length);

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
          showEmptyProjectState={false}
        />
      )}
      title={t('home.title')}
      subtitle={t('home.subtitle')}
    >
      <main className="h-full overflow-y-auto px-4 py-5 sm:px-6 sm:py-7">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
          <HomeOnboardingChat
            onCreateWiki={({ conversationId, goal }) =>
              openWorkspaceCreateEntry(
                {
                  conversationId,
                  projectFolderId: null,
                  projectId: null,
                  projectTitle: null,
                },
                goal ? { goal } : null
              )
            }
          />

          {hasProjects ? (
            <section aria-labelledby="recent-wikis-title" data-testid="home-wiki-list">
              <div className="mb-2 flex items-center justify-between gap-3 px-2">
                <h2
                  className="flex items-center gap-2 text-sm font-medium text-muted-foreground"
                  id="recent-wikis-title"
                >
                  <BookOpen aria-hidden="true" className="h-4 w-4" />
                  {t('home.wikiSpaces')}
                </h2>
              </div>

              <div data-testid="home-project-list">
                {homeProjects?.slice(0, 6).map((project) => (
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
          ) : null}
        </div>
      </main>

      <GoalComposerDialog
        creationMode={workspaceCreateContext?.projectId ? 'deliverable' : 'project'}
        currentProjectTitle={workspaceCreateContext?.projectTitle || null}
        disableInputs={createWorkspaceRecoveryActive}
        open={goalDialogOpen}
        errorMessage={createWorkspaceError}
        initialValues={
          createWorkspaceRecoveryValues || goalDialogSeedValues || undefined
        }
        onOpenChange={handleGoalDialogOpenChange}
        isSubmitting={isCreatingWorkspace}
        submitLabel={
          createWorkspaceRecoveryActive ? t('goal.retryProjectCheck') : undefined
        }
        onSubmit={(values) => createWorkspace(values, workspaceCreateContext)}
        workflowContextId={null}
      />

      <WikiCreateConfirmationDialog
        confirmLabel={
          createWorkspaceRecoveryActive ? t('goal.retryProjectCheck') : undefined
        }
        conversationId={wikiCreateProposal?.conversationId || null}
        disableInputs={createWorkspaceRecoveryActive}
        errorMessage={createWorkspaceError}
        isSubmitting={isCreatingWorkspace}
        onConfirm={confirmWikiCreation}
        onOpenChange={handleWikiDialogOpenChange}
        open={wikiDialogOpen}
        suggestedGoal={wikiCreateProposal?.goal || ''}
        suggestedTitle={wikiCreateProposal?.title || ''}
      />
    </AppShell>
  );
}
