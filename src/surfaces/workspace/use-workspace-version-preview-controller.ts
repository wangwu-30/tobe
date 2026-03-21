'use client';

import * as React from 'react';

import {
  clearPendingPreviewStart,
  loadPendingPreviewStart,
  persistPendingPreviewStart,
} from '@/lib/workspace/preview-start-recovery';
import {
  startWorkspacePreview,
  stopWorkspacePreview,
} from '@/lib/workspace/preview-client';
import {
  branchConversationFromMessage,
  continueWorkspaceConversationFromVersion,
  createWorkspaceVersion,
  restoreWorkspaceVersion,
  switchWorkspaceConversationToVersionBranch,
  toggleWorkspaceRecoveryPointPin,
} from '@/lib/workspace/version-client';
import type {
  WorkspaceRunData,
  WorkspaceVersionData,
  WorkspaceViewData,
} from '@/types';

type WorkspaceNoticeAction = {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'ghost' | 'outline';
};

type WorkspaceRouteNotice = {
  actions?: WorkspaceNoticeAction[];
  text: string;
  tone: 'error' | 'info' | 'success';
};

type WorkspaceLocationSync = {
  conversationId?: string | null;
  fileId?: string | null;
  versionId?: string | null;
  workspaceId?: string;
};

type PreviewStartOptions = {
  fromRecovery?: boolean;
  versionId?: string | null;
};

export function useWorkspaceVersionPreviewController<
  TTranslate extends (...args: any[]) => string,
>({
  activePreviewRun,
  currentConversationId,
  currentFileId,
  currentVersionId,
  isStartingPreview,
  loadRuns,
  loadThreads,
  loadWorkspace,
  loadWorkspaceView,
  previewEnabled,
  promptedRecoveryPointRef,
  setIsStartingPreview,
  setIsStoppingPreview,
  setWorkspaceNotice,
  setWorkspaceRuns,
  syncLocation,
  t,
  versionTitle,
  workspaceId,
  workspaceReady,
}: {
  activePreviewRun: WorkspaceRunData | null;
  currentConversationId: string | null;
  currentFileId: string | null;
  currentVersionId: string | null;
  isStartingPreview: boolean;
  loadRuns: () => Promise<unknown>;
  loadThreads: () => Promise<unknown>;
  loadWorkspace: () => Promise<WorkspaceViewData | null>;
  loadWorkspaceView: (target?: WorkspaceLocationSync) => Promise<WorkspaceViewData | null>;
  previewEnabled: boolean;
  promptedRecoveryPointRef: React.MutableRefObject<string | null>;
  setIsStartingPreview: React.Dispatch<React.SetStateAction<boolean>>;
  setIsStoppingPreview: React.Dispatch<React.SetStateAction<boolean>>;
  setWorkspaceNotice: React.Dispatch<React.SetStateAction<WorkspaceRouteNotice | null>>;
  setWorkspaceRuns: React.Dispatch<React.SetStateAction<WorkspaceRunData[]>>;
  syncLocation: (next: WorkspaceLocationSync) => void;
  t: TTranslate;
  versionTitle: string;
  workspaceId: string;
  workspaceReady: boolean;
}) {
  const createVersion = React.useCallback(async () => {
    try {
      const version = await createWorkspaceVersion({
        errorMessage: t('workspace.visibleVersionFailed'),
        title: versionTitle,
        workspaceId,
      });

      syncLocation({ versionId: version.id });
      setWorkspaceNotice({
        tone: 'success',
        text: t('workspace.createdVersion', { versionNum: version.versionNum }),
      });
      await loadWorkspace();
      await loadThreads();
    } catch (error) {
      setWorkspaceNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : t('workspace.visibleVersionFailed'),
      });
    }
  }, [
    loadThreads,
    loadWorkspace,
    setWorkspaceNotice,
    syncLocation,
    t,
    versionTitle,
    workspaceId,
  ]);

  const toggleRecoveryPointPin = React.useCallback(
    async (versionId: string, pinned: boolean) => {
      try {
        const version = await toggleWorkspaceRecoveryPointPin({
          errorMessage: t('workspace.recoveryPointActionFailed'),
          pinned,
          versionId,
          workspaceId,
        });

        promptedRecoveryPointRef.current = version.id;
        await loadWorkspace();
        setWorkspaceNotice({
          tone: 'success',
          text: pinned
            ? t('workspace.pinnedRecoveryPoint', { title: version.title })
            : t('workspace.unpinnedRecoveryPoint', { title: version.title }),
        });
      } catch (error) {
        setWorkspaceNotice({
          tone: 'error',
          text:
            error instanceof Error
              ? error.message
              : t('workspace.recoveryPointActionFailed'),
        });
      }
    },
    [loadWorkspace, promptedRecoveryPointRef, setWorkspaceNotice, t, workspaceId]
  );

  const restoreVersion = React.useCallback(
    async (versionId: string) => {
      try {
        const result = await restoreWorkspaceVersion({
          errorMessage: t('workspace.restoreFailed'),
          versionId,
          workspaceId,
        });

        syncLocation({ versionId: null });
        setWorkspaceNotice({
          tone: 'success',
          text: t('workspace.restoredVersion', {
            title: result.restoredVersion.title,
          }),
        });
        await Promise.all([loadWorkspace(), loadRuns(), loadThreads()]);
      } catch (error) {
        setWorkspaceNotice({
          tone: 'error',
          text: error instanceof Error ? error.message : t('workspace.restoreFailed'),
        });
      }
    },
    [loadRuns, loadThreads, loadWorkspace, setWorkspaceNotice, syncLocation, t, workspaceId]
  );

  const branchFromMessage = React.useCallback(
    async (messageId: string) => {
      if (!currentConversationId) {
        return;
      }

      const result = await branchConversationFromMessage({
        conversationId: currentConversationId,
        messageId,
      });

      if (!result) {
        return;
      }

      syncLocation({
        conversationId: result.conversation.id,
      });
    },
    [currentConversationId, syncLocation]
  );

  const continueConversationFromVersion = React.useCallback(
    async (version: WorkspaceVersionData) => {
      try {
        const nextState = await continueWorkspaceConversationFromVersion({
          activeFileId: currentFileId,
          errorMessage: t('version.continueFailed'),
          parentConversationId: currentConversationId,
          safetyCheckpointTitle: t('version.continueSafetyCheckpointTitle'),
          title: t('version.continueFromVersionTitle', {
            title: version.title,
          }),
          versionId: version.id,
          workspaceId,
        });

        const nextView = await loadWorkspaceView({
          conversationId: nextState.conversation.id,
          fileId: null,
          versionId: null,
        });
        syncLocation({
          conversationId: nextState.conversation.id,
          fileId: nextView?.currentFile?.id || null,
          versionId: null,
        });
        setWorkspaceNotice({
          tone: 'success',
          text: t('workspace.continuedFromVersion', {
            title: nextState.baseVersion.title,
          }),
        });
      } catch (error) {
        setWorkspaceNotice({
          tone: 'error',
          text: error instanceof Error ? error.message : t('version.continueFailed'),
        });
      }
    },
    [
      currentConversationId,
      currentFileId,
      loadWorkspaceView,
      setWorkspaceNotice,
      syncLocation,
      t,
      workspaceId,
    ]
  );

  const switchConversationToVersionBranch = React.useCallback(
    async (version: WorkspaceVersionData) => {
      try {
        const nextState = await switchWorkspaceConversationToVersionBranch({
          activeFileId: currentFileId,
          errorMessage: t('version.switchBranchFailed'),
          parentConversationId: currentConversationId,
          safetyCheckpointTitle: t('version.switchBranchSafetyCheckpointTitle'),
          title: version.title,
          versionId: version.id,
          workspaceId,
        });

        const nextView = await loadWorkspaceView({
          conversationId: nextState.conversation.id,
          fileId: null,
          versionId: null,
        });
        syncLocation({
          conversationId: nextState.conversation.id,
          fileId: nextView?.currentFile?.id || null,
          versionId: null,
        });
        setWorkspaceNotice({
          tone: 'success',
          text: t('workspace.switchedToVersionHead', {
            title: nextState.baseVersion.title,
          }),
        });
      } catch (error) {
        setWorkspaceNotice({
          tone: 'error',
          text: error instanceof Error ? error.message : t('version.switchBranchFailed'),
        });
      }
    },
    [
      currentConversationId,
      currentFileId,
      loadWorkspaceView,
      setWorkspaceNotice,
      syncLocation,
      t,
      workspaceId,
    ]
  );

  const startPreview = React.useCallback(
    async (options?: PreviewStartOptions) => {
      const targetVersionId =
        options && 'versionId' in options ? options.versionId || null : currentVersionId;

      if (!options?.fromRecovery) {
        persistPendingPreviewStart({
          versionId: targetVersionId,
          workspaceId,
        });
      }

      setIsStartingPreview(true);
      try {
        const startedRun = await startWorkspacePreview({
          errorMessage: t('workspace.previewCouldNotStart'),
          versionId: targetVersionId,
          workspaceId,
        });

        clearPendingPreviewStart(workspaceId);
        if (startedRun?.id) {
          setWorkspaceRuns((currentRuns) => [
            startedRun,
            ...currentRuns.filter((run) => run.id !== startedRun.id),
          ]);
        }

        await loadRuns();
        setWorkspaceNotice({
          tone: 'success',
          text: t('workspace.previewStarted'),
        });
      } catch (error) {
        clearPendingPreviewStart(workspaceId);
        setWorkspaceNotice({
          tone: 'error',
          text: error instanceof Error ? error.message : t('workspace.previewCouldNotStart'),
        });
      } finally {
        setIsStartingPreview(false);
      }
    },
    [
      currentVersionId,
      loadRuns,
      setIsStartingPreview,
      setWorkspaceNotice,
      setWorkspaceRuns,
      t,
      workspaceId,
    ]
  );

  React.useEffect(() => {
    const pendingPreviewStart = loadPendingPreviewStart(workspaceId);
    if (!pendingPreviewStart) {
      return;
    }

    if (activePreviewRun) {
      clearPendingPreviewStart(workspaceId);
      return;
    }

    if (!workspaceReady || !previewEnabled) {
      return;
    }

    const pollIntervalId = window.setInterval(() => {
      void loadRuns();
    }, 500);

    const recoveryTimeoutId = window.setTimeout(() => {
      if (isStartingPreview || activePreviewRun) {
        return;
      }

      void startPreview({
        fromRecovery: true,
        versionId: pendingPreviewStart.versionId,
      });
    }, 1500);

    return () => {
      window.clearInterval(pollIntervalId);
      window.clearTimeout(recoveryTimeoutId);
    };
  }, [
    activePreviewRun,
    isStartingPreview,
    loadRuns,
    previewEnabled,
    startPreview,
    workspaceId,
    workspaceReady,
  ]);

  const stopPreview = React.useCallback(async () => {
    setIsStoppingPreview(true);
    try {
      await stopWorkspacePreview({
        errorMessage: t('workspace.previewCouldNotStop'),
        workspaceId,
      });

      await loadRuns();
      setWorkspaceNotice({
        tone: 'info',
        text: t('workspace.previewStopped'),
      });
    } catch (error) {
      setWorkspaceNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : t('workspace.previewCouldNotStop'),
      });
    } finally {
      setIsStoppingPreview(false);
    }
  }, [loadRuns, setIsStoppingPreview, setWorkspaceNotice, t, workspaceId]);

  const handleConversationComplete = React.useCallback(async () => {
    const [nextView] = await Promise.all([loadWorkspace(), loadRuns(), loadThreads()]);

    if (!nextView || !currentConversationId) {
      return;
    }

    const latestTemporaryRecoveryPoint =
      nextView.versions.find(
        (version) =>
          version.recoveryKind === 'temporary' &&
          version.sourceConversationId === currentConversationId
      ) || null;

    if (
      !latestTemporaryRecoveryPoint ||
      promptedRecoveryPointRef.current === latestTemporaryRecoveryPoint.id
    ) {
      return;
    }

    promptedRecoveryPointRef.current = latestTemporaryRecoveryPoint.id;
    const pinnedCount = nextView.versions.filter(
      (version) => version.recoveryKind === 'pinned'
    ).length;

    setWorkspaceNotice({
      tone: 'info',
      text:
        pinnedCount >= 3
          ? t('workspace.pinRecoveryPromptFull', {
              title: latestTemporaryRecoveryPoint.title,
            })
          : t('workspace.pinRecoveryPrompt', {
              title: latestTemporaryRecoveryPoint.title,
            }),
      actions:
        pinnedCount >= 3
          ? [
              {
                label: t('workspace.keepTemporary'),
                onClick: () => setWorkspaceNotice(null),
                variant: 'ghost',
              },
            ]
          : [
              {
                label: t('version.pin'),
                onClick: () =>
                  void toggleRecoveryPointPin(latestTemporaryRecoveryPoint.id, true),
              },
              {
                label: t('workspace.keepTemporary'),
                onClick: () => setWorkspaceNotice(null),
                variant: 'ghost',
              },
            ],
    });
  }, [
    currentConversationId,
    loadRuns,
    loadThreads,
    loadWorkspace,
    promptedRecoveryPointRef,
    setWorkspaceNotice,
    t,
    toggleRecoveryPointPin,
  ]);

  return {
    branchFromMessage,
    continueConversationFromVersion,
    createVersion,
    handleConversationComplete,
    restoreVersion,
    startPreview,
    stopPreview,
    switchConversationToVersionBranch,
    toggleRecoveryPointPin,
  };
}
