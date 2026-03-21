'use client';

import * as React from 'react';
import type { Value } from 'platejs';

import { parsePlateContent } from '@/canvas/document-canvas/document-canvas';
import { COMMENT_THREAD_FOCUS_EVENT } from '@/lib/comments/constants';
import { clearPendingPreviewStart } from '@/lib/workspace/preview-start-recovery';
import { generateWorkspacePlan } from '@/lib/workspace/plan-client';
import {
  readWorkspaceReviewThreads,
  readWorkspaceRuns,
  readWorkspaceView,
} from '@/lib/workspace/read-client';
import type {
  ChatMessageData,
  CommentThreadData,
  DeliverableType,
  WorkspaceRunData,
  WorkspaceViewData,
} from '@/types';

type WorkspaceRouteLocation = {
  conversationId?: string | null;
  fileId?: string | null;
  versionId?: string | null;
  workspaceId?: string | null;
};

type LoadedWorkspaceSurface = {
  content: string;
  fileId: string | null;
  versionId: string | null;
};

const PREVIEW_RUN_POLL_INTERVAL_MS = 3000;
const PREVIEW_RECOVERY_POLL_INTERVAL_MS = 500;
const PREVIEW_RECOVERY_POLL_TIMEOUT_MS = 5000;
const CONVERSATION_POLL_INTERVAL_MS = 3000;

export function useWorkspaceRouteController({
  activePreviewRun,
  currentConversationId,
  currentFileId,
  workflowStatusPrimaryAction,
  workflowStatusWorking,
  currentVersionId,
  deliverableType,
  isAssistantBusy,
  previewEnabled,
  pushRoute,
  replaceRoute,
  requestedConversationId,
  requestedFileId,
  requestedVersionId,
  setEditorContent,
  setFileContent,
  setInitialMessages,
  setReviewThreads,
  setShowImplementation,
  setWorkspaceRuns,
  setWorkspaceView,
  workspaceBriefStatus,
  workspaceId,
  workspaceReady,
}: {
  activePreviewRun: WorkspaceRunData | null;
  currentConversationId: string | null;
  currentFileId: string | null;
  workflowStatusPrimaryAction: string | null | undefined;
  workflowStatusWorking: boolean | null | undefined;
  currentVersionId: string | null;
  deliverableType: DeliverableType;
  isAssistantBusy: boolean;
  previewEnabled: boolean;
  pushRoute: (href: string) => void;
  replaceRoute: (href: string) => void;
  requestedConversationId: string | null;
  requestedFileId: string | null;
  requestedVersionId: string | null;
  setEditorContent: React.Dispatch<React.SetStateAction<Value | null>>;
  setFileContent: React.Dispatch<React.SetStateAction<string>>;
  setInitialMessages: React.Dispatch<React.SetStateAction<ChatMessageData[]>>;
  setReviewThreads: React.Dispatch<React.SetStateAction<CommentThreadData[]>>;
  setShowImplementation: React.Dispatch<React.SetStateAction<boolean>>;
  setWorkspaceRuns: React.Dispatch<React.SetStateAction<WorkspaceRunData[]>>;
  setWorkspaceView: React.Dispatch<React.SetStateAction<WorkspaceViewData | null>>;
  workspaceBriefStatus: string | null | undefined;
  workspaceId: string;
  workspaceReady: boolean;
}) {
  const pendingPlanGenerationRef = React.useRef<string | null>(null);
  const loadedSurfaceRef = React.useRef<LoadedWorkspaceSurface | null>(null);

  const loadWorkspaceView = React.useCallback(
    async (target?: {
      conversationId?: string | null;
      fileId?: string | null;
      versionId?: string | null;
      workspaceId?: string;
    }) => {
      const resolvedWorkspaceId = target?.workspaceId || workspaceId;
      const conversationId =
        target && 'conversationId' in target
          ? target.conversationId || null
          : requestedConversationId;
      const fileId =
        target && 'fileId' in target ? target.fileId || null : requestedFileId;
      const versionId =
        target && 'versionId' in target ? target.versionId || null : requestedVersionId;
      const nextView = await readWorkspaceView({
        conversationId,
        fileId,
        versionId,
        workspaceId: resolvedWorkspaceId,
      });
      if (!nextView) {
        return null;
      }

      setWorkspaceView(nextView);
      setInitialMessages(nextView.currentConversation?.messages || []);

      const nextContent = nextView.currentFile?.content || '';
      const nextSurface = {
        content: nextContent,
        fileId: nextView.currentFile?.id || null,
        versionId: nextView.selectedVersion?.id || null,
      };
      const shouldResetEditor =
        loadedSurfaceRef.current?.content !== nextSurface.content ||
        loadedSurfaceRef.current?.fileId !== nextSurface.fileId ||
        loadedSurfaceRef.current?.versionId !== nextSurface.versionId;

      if (shouldResetEditor) {
        setFileContent(nextContent);
        setEditorContent(parsePlateContent(nextContent));
      }
      loadedSurfaceRef.current = nextSurface;

      if (nextView.deliverable?.deliverableType === 'document') {
        setShowImplementation(false);
      }

      return nextView;
    },
    [
      requestedConversationId,
      requestedFileId,
      requestedVersionId,
      setEditorContent,
      setFileContent,
      setInitialMessages,
      setShowImplementation,
      setWorkspaceView,
      workspaceId,
    ]
  );

  const loadWorkspace = React.useCallback(async () => {
    return loadWorkspaceView();
  }, [loadWorkspaceView]);

  const loadRuns = React.useCallback(async () => {
    const nextRuns = await readWorkspaceRuns(workspaceId);
    if (!nextRuns) {
      return;
    }

    setWorkspaceRuns(nextRuns);
  }, [setWorkspaceRuns, workspaceId]);

  const loadThreads = React.useCallback(async () => {
    const nextThreads = await readWorkspaceReviewThreads({
      currentFileId,
      currentVersionId,
      deliverableType,
      workspaceId,
    });
    if (!nextThreads) {
      return;
    }

    setReviewThreads(nextThreads);
  }, [
    currentFileId,
    currentVersionId,
    deliverableType,
    setReviewThreads,
    workspaceId,
  ]);

  React.useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  React.useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  React.useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  const triggerPlanGeneration = React.useCallback(
    async (targetWorkspaceId: string) => {
      if (pendingPlanGenerationRef.current === targetWorkspaceId) {
        return;
      }

      pendingPlanGenerationRef.current = targetWorkspaceId;

      try {
        await generateWorkspacePlan(targetWorkspaceId);
      } finally {
        pendingPlanGenerationRef.current = null;
        if (targetWorkspaceId === workspaceId) {
          void loadWorkspace();
        }
      }
    },
    [loadWorkspace, workspaceId]
  );

  React.useEffect(() => {
    if (workspaceBriefStatus !== 'generating') {
      return;
    }

    void triggerPlanGeneration(workspaceId);
  }, [triggerPlanGeneration, workspaceBriefStatus, workspaceId]);

  React.useEffect(() => {
    if (!activePreviewRun) {
      return;
    }

    clearPendingPreviewStart(workspaceId);

    const intervalId = window.setInterval(() => {
      void loadRuns();
    }, PREVIEW_RUN_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activePreviewRun, loadRuns, workspaceId]);

  React.useEffect(() => {
    if (!workspaceReady || !previewEnabled || activePreviewRun) {
      return;
    }

    if (workflowStatusPrimaryAction !== 'start_preview') {
      return;
    }

    const navigationEntry = window.performance
      .getEntriesByType('navigation')
      .find(
        (entry): entry is PerformanceNavigationTiming =>
          entry instanceof PerformanceNavigationTiming
      );

    if (navigationEntry?.type !== 'reload') {
      return;
    }

    void loadRuns();

    const intervalId = window.setInterval(() => {
      void loadRuns();
    }, PREVIEW_RECOVERY_POLL_INTERVAL_MS);

    const timeoutId = window.setTimeout(() => {
      window.clearInterval(intervalId);
    }, PREVIEW_RECOVERY_POLL_TIMEOUT_MS);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [
    activePreviewRun,
    workflowStatusPrimaryAction,
    loadRuns,
    previewEnabled,
    workspaceReady,
  ]);

  React.useEffect(() => {
    const shouldPollConversation =
      Boolean(currentConversationId) && Boolean(workflowStatusWorking || isAssistantBusy);

    if (!shouldPollConversation) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadWorkspace();
    }, CONVERSATION_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentConversationId, workflowStatusWorking, isAssistantBusy, loadWorkspace]);

  React.useEffect(() => {
    const handleFocus = () => {
      void loadThreads();
    };

    window.addEventListener(COMMENT_THREAD_FOCUS_EVENT, handleFocus);
    return () => {
      window.removeEventListener(COMMENT_THREAD_FOCUS_EVENT, handleFocus);
    };
  }, [loadThreads]);

  const syncLocation = React.useCallback(
    (next: WorkspaceRouteLocation) => {
      const resolvedWorkspaceId = next.workspaceId || workspaceId;
      const params = new URLSearchParams();
      const conversationId =
        next.conversationId !== undefined ? next.conversationId : currentConversationId;
      const fileId = next.fileId !== undefined ? next.fileId : currentFileId;
      const versionId =
        next.versionId !== undefined ? next.versionId : currentVersionId;

      if (conversationId) {
        params.set('conversationId', conversationId);
      }
      if (fileId) {
        params.set('fileId', fileId);
      }
      if (versionId) {
        params.set('versionId', versionId);
      }

      const href = `/workspace/${resolvedWorkspaceId}${
        params.size > 0 ? `?${params.toString()}` : ''
      }`;

      if (resolvedWorkspaceId !== workspaceId) {
        pushRoute(href);
      } else {
        replaceRoute(href);
      }
    },
    [
      currentConversationId,
      currentFileId,
      currentVersionId,
      pushRoute,
      replaceRoute,
      workspaceId,
    ]
  );

  const handleOpenWorkspaceFile = React.useCallback(
    (fileId: string) => {
      syncLocation({
        fileId,
        versionId: null,
      });
    },
    [syncLocation]
  );

  return {
    handleOpenWorkspaceFile,
    loadRuns,
    loadThreads,
    loadWorkspace,
    loadWorkspaceView,
    syncLocation,
  };
}
