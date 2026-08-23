'use client';

import * as React from 'react';
import type { Value } from 'platejs';

import { parsePlateContent } from '@/canvas/document-canvas/document-canvas';
import { createPollController } from '@/framework/resilience';
import { COMMENT_THREAD_FOCUS_EVENT } from '@/lib/comments/constants';
import { clearPendingPreviewStart } from '@/lib/workspace/preview-start-recovery';
import { generateWorkspacePlan } from '@/lib/workspace/plan-client';
import {
  readWorkspaceReviewThreads,
  readWorkspaceRuns,
  readWorkspaceView,
} from '@/lib/workspace/read-client';
import { buildWorkspaceRoute, type WorkspaceAssistantTab } from '@/lib/workspace/route';
import type {
  ChatMessageData,
  CommentThreadData,
  DeliverableType,
  WorkspaceRunData,
  WorkspaceViewData,
} from '@/types';

type WorkspaceRouteLocation = {
  assistant?: WorkspaceAssistantTab | null;
  conversationId?: string | null;
  fileId?: string | null;
  projectId?: string | null;
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

type WorkspaceRouteNotice = {
  actions?: Array<{
    label: string;
    onClick: () => void;
    variant?: 'default' | 'ghost' | 'outline';
  }>;
  text: string;
  tone: 'error' | 'info' | 'success';
};

export function useWorkspaceRouteController({
  activePreviewRun,
  assistant,
  currentConversationId,
  currentFileId,
  workflowStatusPrimaryAction,
  workflowStatusWorking,
  currentVersionId,
  deliverableType,
  isAssistantBusy,
  projectId,
  previewEnabled,
  pushRoute,
  replaceRoute,
  requestedConversationId,
  requestedFileId,
  requestedVersionId,
  routeProjectId,
  setEditorContent,
  setFileContent,
  setInitialMessages,
  setReviewThreads,
  setShowImplementation,
  setWorkspaceNotice,
  setWorkspaceRuns,
  setWorkspaceView,
  workspaceBriefStatus,
  workspaceId,
  workspaceReady,
}: {
  activePreviewRun: WorkspaceRunData | null;
  assistant: WorkspaceAssistantTab;
  currentConversationId: string | null;
  currentFileId: string | null;
  workflowStatusPrimaryAction: string | null | undefined;
  workflowStatusWorking: boolean | null | undefined;
  currentVersionId: string | null;
  deliverableType: DeliverableType;
  isAssistantBusy: boolean;
  projectId: string | null;
  previewEnabled: boolean;
  pushRoute: (href: string) => void;
  replaceRoute: (href: string) => void;
  requestedConversationId: string | null;
  requestedFileId: string | null;
  requestedVersionId: string | null;
  routeProjectId: string;
  setEditorContent: React.Dispatch<React.SetStateAction<Value | null>>;
  setFileContent: React.Dispatch<React.SetStateAction<string>>;
  setInitialMessages: React.Dispatch<React.SetStateAction<ChatMessageData[]>>;
  setReviewThreads: React.Dispatch<React.SetStateAction<CommentThreadData[]>>;
  setShowImplementation: React.Dispatch<React.SetStateAction<boolean>>;
  setWorkspaceNotice: React.Dispatch<React.SetStateAction<WorkspaceRouteNotice | null>>;
  setWorkspaceRuns: React.Dispatch<React.SetStateAction<WorkspaceRunData[]>>;
  setWorkspaceView: React.Dispatch<React.SetStateAction<WorkspaceViewData | null>>;
  workspaceBriefStatus: string | null | undefined;
  workspaceId: string;
  workspaceReady: boolean;
}) {
  const pendingPlanGenerationRef = React.useRef<string | null>(null);
  const loadedSurfaceRef = React.useRef<LoadedWorkspaceSurface | null>(null);
  const routeKey = [
    workspaceId,
    requestedConversationId || '',
    requestedFileId || '',
    requestedVersionId || '',
  ].join(':');
  const activeRouteKeyRef = React.useRef(routeKey);
  const viewRequestSequenceRef = React.useRef(0);
  const runsRequestSequenceRef = React.useRef(0);
  const threadsRequestSequenceRef = React.useRef(0);
  if (activeRouteKeyRef.current !== routeKey) {
    activeRouteKeyRef.current = routeKey;
    viewRequestSequenceRef.current += 1;
    runsRequestSequenceRef.current += 1;
    threadsRequestSequenceRef.current += 1;
  }
  const showLoadError = React.useCallback(
    (message: string) => {
      setWorkspaceNotice({
        text: message,
        tone: 'error',
      });
    },
    [setWorkspaceNotice]
  );

  const loadWorkspaceView = React.useCallback(
    async (target?: {
      conversationId?: string | null;
      fileId?: string | null;
      versionId?: string | null;
      workspaceId?: string;
    }) => {
      const requestRouteKey = routeKey;
      if (requestRouteKey !== activeRouteKeyRef.current) {
        return null;
      }
      const requestSequence = ++viewRequestSequenceRef.current;
      const resolvedWorkspaceId = target?.workspaceId || workspaceId;
      const conversationId =
        target && 'conversationId' in target
          ? target.conversationId || null
          : requestedConversationId;
      const fileId =
        target && 'fileId' in target ? target.fileId || null : requestedFileId;
      const versionId =
        target && 'versionId' in target ? target.versionId || null : requestedVersionId;
      const result = await readWorkspaceView({
        conversationId,
        fileId,
        versionId,
        workspaceId: resolvedWorkspaceId,
      });
      const requestOwnsView =
        requestRouteKey === activeRouteKeyRef.current &&
        requestSequence === viewRequestSequenceRef.current;
      if (!result.ok) {
        if (requestOwnsView) {
          showLoadError(result.error.message);
          throw new Error(result.error.message);
        }
        return null;
      }
      if (!result.data) {
        return null;
      }
      const nextView = result.data;
      if (!requestOwnsView || nextView.workspace?.id !== resolvedWorkspaceId) {
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
      showLoadError,
      setWorkspaceView,
      routeKey,
      workspaceId,
    ]
  );

  const loadWorkspace = React.useCallback(async () => {
    return loadWorkspaceView();
  }, [loadWorkspaceView]);

  const loadRuns = React.useCallback(async () => {
    const requestRouteKey = routeKey;
    if (requestRouteKey !== activeRouteKeyRef.current) {
      return [];
    }
    const requestSequence = ++runsRequestSequenceRef.current;
    const requestedWorkspaceId = workspaceId;
    const result = await readWorkspaceRuns(requestedWorkspaceId);
    const requestOwnsRuns =
      requestRouteKey === activeRouteKeyRef.current &&
      requestSequence === runsRequestSequenceRef.current;
    if (!result.ok) {
      if (requestOwnsRuns) {
        showLoadError(result.error.message);
        throw new Error(result.error.message);
      }
      return [];
    }

    if (requestOwnsRuns) {
      setWorkspaceRuns(result.data || []);
    }
    return result.data || [];
  }, [routeKey, setWorkspaceRuns, showLoadError, workspaceId]);

  const loadThreads = React.useCallback(async () => {
    const requestRouteKey = routeKey;
    if (requestRouteKey !== activeRouteKeyRef.current) {
      return [];
    }
    const requestSequence = ++threadsRequestSequenceRef.current;
    const requestedWorkspaceId = workspaceId;
    const result = await readWorkspaceReviewThreads({
      currentFileId,
      currentVersionId,
      deliverableType,
      workspaceId: requestedWorkspaceId,
    });
    const requestOwnsThreads =
      requestRouteKey === activeRouteKeyRef.current &&
      requestSequence === threadsRequestSequenceRef.current;
    if (!result.ok) {
      if (requestOwnsThreads) {
        showLoadError(result.error.message);
        throw new Error(result.error.message);
      }
      return [];
    }

    if (requestOwnsThreads) {
      setReviewThreads(result.data || []);
    }
    return result.data || [];
  }, [
    currentFileId,
    currentVersionId,
    deliverableType,
    routeKey,
    setReviewThreads,
    showLoadError,
    workspaceId,
  ]);

  React.useEffect(() => {
    loadWorkspace().catch(() => undefined);
  }, [loadWorkspace]);

  React.useEffect(() => {
    loadRuns().catch(() => undefined);
  }, [loadRuns]);

  React.useEffect(() => {
    loadThreads().catch(() => undefined);
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
          loadWorkspace().catch(() => undefined);
        }
      }
    },
    [loadWorkspace, workspaceId]
  );

  React.useEffect(() => {
    if (workspaceBriefStatus !== 'generating') {
      return;
    }

    triggerPlanGeneration(workspaceId).catch(() => undefined);
  }, [triggerPlanGeneration, workspaceBriefStatus, workspaceId]);

  React.useEffect(() => {
    if (!activePreviewRun) {
      return;
    }

    clearPendingPreviewStart(workspaceId);

    const controller = createPollController({
      baseInterval: PREVIEW_RUN_POLL_INTERVAL_MS,
      fn: loadRuns,
      maxInterval: 48_000,
    });
    controller.start();

    return () => {
      controller.stop();
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

    loadRuns().catch(() => undefined);

    const controller = createPollController({
      baseInterval: PREVIEW_RECOVERY_POLL_INTERVAL_MS,
      fn: loadRuns,
      maxInterval: PREVIEW_RECOVERY_POLL_INTERVAL_MS,
    });
    controller.start();

    const timeoutId = window.setTimeout(() => {
      controller.stop();
    }, PREVIEW_RECOVERY_POLL_TIMEOUT_MS);

    return () => {
      controller.stop();
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

    const controller = createPollController({
      baseInterval: CONVERSATION_POLL_INTERVAL_MS,
      fn: loadWorkspace,
      maxInterval: 48_000,
    });
    controller.start();

    return () => {
      controller.stop();
    };
  }, [currentConversationId, workflowStatusWorking, isAssistantBusy, loadWorkspace]);

  React.useEffect(() => {
    const handleFocus = () => {
      loadThreads().catch(() => undefined);
    };

    window.addEventListener(COMMENT_THREAD_FOCUS_EVENT, handleFocus);
    return () => {
      window.removeEventListener(COMMENT_THREAD_FOCUS_EVENT, handleFocus);
    };
  }, [loadThreads]);

  const syncLocation = React.useCallback(
    (next: WorkspaceRouteLocation) => {
      const resolvedWorkspaceId =
        next.workspaceId !== undefined ? next.workspaceId || null : workspaceId;
      const resolvedProjectId =
        next.projectId || projectId || routeProjectId || resolvedWorkspaceId || workspaceId;
      const conversationId =
        next.conversationId !== undefined ? next.conversationId : currentConversationId;
      const fileId = next.fileId !== undefined ? next.fileId : currentFileId;
      const versionId =
        next.versionId !== undefined ? next.versionId : currentVersionId;

      const href = buildWorkspaceRoute({
        assistant: next.assistant !== undefined ? next.assistant : assistant,
        conversationId,
        fileId,
        nodeId: resolvedWorkspaceId,
        projectId: resolvedProjectId,
        versionId,
      });

      if (resolvedProjectId !== routeProjectId) {
        pushRoute(href);
      } else {
        replaceRoute(href);
      }
    },
    [
      currentConversationId,
      currentFileId,
      currentVersionId,
      assistant,
      projectId,
      pushRoute,
      replaceRoute,
      routeProjectId,
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
