'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ArrowRight, Sparkles } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import { useAppRouter } from '@/lib/app-router';
import {
  clearWorkspaceCreateRecovery,
  loadWorkspaceCreateRecovery,
  persistWorkspaceCreateRecovery,
  WORKSPACE_CREATE_IDEMPOTENCY_HEADER,
} from '@/lib/workspace/create-request';
import {
  GoalComposerDialog,
  type GoalComposerValues,
} from '@/components/workspace/goal-composer-dialog';
import { WorkspaceStarterDialog } from '@/components/workspace/workspace-starter-dialog';
import { DeliverableSidebar } from '@/components/workspace/deliverable-sidebar';
import { useT } from '@/components/providers/language-provider';

export default function HomePage() {
  const t = useT();
  const router = useAppRouter();
  const [goalDialogOpen, setGoalDialogOpen] = React.useState(false);
  const [workspaceStarterOpen, setWorkspaceStarterOpen] = React.useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = React.useState(false);
  const [createWorkspaceError, setCreateWorkspaceError] = React.useState<string | null>(null);
  const [createWorkspaceRecoveryActive, setCreateWorkspaceRecoveryActive] =
    React.useState(false);
  const [createWorkspaceRecoveryValues, setCreateWorkspaceRecoveryValues] =
    React.useState<GoalComposerValues | null>(null);
  const [goalDialogSeedValues, setGoalDialogSeedValues] =
    React.useState<Partial<GoalComposerValues> | null>(null);
  const [workspaceInventoryLoaded, setWorkspaceInventoryLoaded] = React.useState(false);
  const [hasExistingWorkspace, setHasExistingWorkspace] = React.useState<boolean | null>(null);
  const [pendingCreateEntry, setPendingCreateEntry] = React.useState(false);
  const createWorkspaceRequestIdRef = React.useRef<string | null>(null);
  const createWorkspaceInFlightRef = React.useRef(false);

  React.useEffect(() => {
    const recovery = loadWorkspaceCreateRecovery();
    if (recovery) {
      createWorkspaceRequestIdRef.current = recovery.requestId;
      setCreateWorkspaceRecoveryActive(true);
      setCreateWorkspaceRecoveryValues(recovery.values);
      setCreateWorkspaceError(t('goal.createProjectRetryUnknown'));
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('newWorkspace') === '1') {
      setPendingCreateEntry(true);
    }
  }, [t]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadWorkspaceInventory() {
      try {
        const response = await fetch('/api/workspaces');
        if (!response.ok) {
          if (!cancelled) {
            setHasExistingWorkspace(null);
          }
          return;
        }

        const payload = await response.json();
        if (!cancelled) {
          setHasExistingWorkspace((payload.items || []).length > 0);
        }
      } catch {
        if (!cancelled) {
          setHasExistingWorkspace(null);
        }
      } finally {
        if (!cancelled) {
          setWorkspaceInventoryLoaded(true);
        }
      }
    }

    void loadWorkspaceInventory();

    return () => {
      cancelled = true;
    };
  }, []);

  const openWorkspaceCreateEntry = React.useCallback(() => {
    if (!workspaceInventoryLoaded) {
      setPendingCreateEntry(true);
      return;
    }

    if (!createWorkspaceRecoveryActive && hasExistingWorkspace === false) {
      setWorkspaceStarterOpen(true);
      return;
    }

    setGoalDialogSeedValues(null);
    setGoalDialogOpen(true);
  }, [createWorkspaceRecoveryActive, hasExistingWorkspace, workspaceInventoryLoaded]);

  React.useEffect(() => {
    if (!pendingCreateEntry || !workspaceInventoryLoaded) {
      return;
    }

    openWorkspaceCreateEntry();
    setPendingCreateEntry(false);
  }, [openWorkspaceCreateEntry, pendingCreateEntry, workspaceInventoryLoaded]);

  const createWorkspace = async (values: GoalComposerValues) => {
    if (createWorkspaceInFlightRef.current) return;

    createWorkspaceInFlightRef.current = true;
    setCreateWorkspaceError(null);
    setIsCreatingWorkspace(true);

    if (!createWorkspaceRequestIdRef.current) {
      createWorkspaceRequestIdRef.current = crypto.randomUUID();
    }

    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [WORKSPACE_CREATE_IDEMPOTENCY_HEADER]: createWorkspaceRequestIdRef.current,
          ...getStoredAISettingsHeader(),
        },
        body: JSON.stringify(values),
      });
      if (res.ok) {
        const workspace = await res.json();
        clearWorkspaceCreateRecovery();
        setCreateWorkspaceRecoveryActive(false);
        setCreateWorkspaceRecoveryValues(null);
        createWorkspaceRequestIdRef.current = null;
        setGoalDialogOpen(false);
        router.push(
          `/workspace/${workspace.workspace.id}?conversationId=${workspace.conversation.id}`
        );
        return;
      }

      const payload = await res.json().catch(() => null);
      clearWorkspaceCreateRecovery();
      setCreateWorkspaceRecoveryActive(false);
      setCreateWorkspaceRecoveryValues(null);
      createWorkspaceRequestIdRef.current = null;
      setCreateWorkspaceError(payload?.error || t('goal.createProjectFailed'));
    } catch {
      const recovery = {
        requestId: createWorkspaceRequestIdRef.current || crypto.randomUUID(),
        values,
      };
      createWorkspaceRequestIdRef.current = recovery.requestId;
      persistWorkspaceCreateRecovery(recovery);
      setCreateWorkspaceRecoveryActive(true);
      setCreateWorkspaceRecoveryValues(values);
      setCreateWorkspaceError(t('goal.createProjectRetryUnknown'));
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
        setGoalDialogSeedValues(null);
        createWorkspaceRequestIdRef.current = null;
      }
    }

    setGoalDialogOpen(open);
  }, [createWorkspaceRecoveryActive]);

  const handleWorkspaceStarterSelect = React.useCallback(
    (deliverableType: GoalComposerValues['deliverableType']) => {
      setWorkspaceStarterOpen(false);
      setGoalDialogSeedValues({ deliverableType });
      setGoalDialogOpen(true);
    },
    []
  );

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
                  onClick={openWorkspaceCreateEntry}
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

      <WorkspaceStarterDialog
        open={workspaceStarterOpen}
        onOpenChange={setWorkspaceStarterOpen}
        onSelect={handleWorkspaceStarterSelect}
      />

      <GoalComposerDialog
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
        onSubmit={(values) => createWorkspace(values)}
      />
    </AppShell>
  );
}
