'use client';

import * as React from 'react';
import type { Value } from 'platejs';
import {
  ArrowLeftRight,
  Code2,
  ExternalLink,
  LoaderCircle,
  Play,
  SlidersHorizontal,
  Square,
  Trash2,
} from 'lucide-react';

import { ChatPanel } from '@/components/chat/chat-panel';
import { CommentSidebar } from '@/components/comments/comment-sidebar';
import { WebSelectionCommentTrigger } from '@/components/comments/web-selection-comment-trigger';
import { EditorWrapper } from '@/components/editor/editor-wrapper';
import { KnowledgePanel } from '@/components/knowledge/knowledge-panel';
import { AppShell } from '@/components/layout/app-shell';
import { SplitView } from '@/components/layout/split-view';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { plateToMarkdown } from '@/lib/ai/serializer';
import { COMMENT_THREAD_FOCUS_EVENT, requestSelectionCommentComposerOpen } from '@/lib/comments/constants';
import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import { useT } from '@/components/providers/language-provider';
import { cn } from '@/lib/utils';
import {
  useAppParams,
  useAppRouter,
  useAppSearchParams,
} from '@/lib/app-router';
import {
  clearWorkspaceCreateRecovery,
  loadWorkspaceCreateRecovery,
  persistWorkspaceCreateRecovery,
  WORKSPACE_CREATE_IDEMPOTENCY_HEADER,
} from '@/lib/workspace/create-request';
import { detectWorkspacePreviewCapability } from '@/lib/workspace/preview';
import type {
  ChatMessageData,
  CommentThreadData,
  DeliverableType,
  WorkflowSummaryData,
  WorkspaceRunData,
  WorkspaceSnapshotData,
  WorkspaceViewData,
} from '@/types';
import { GoalComposerDialog, type GoalComposerValues } from '@/components/workspace/goal-composer-dialog';
import { DeliverableSidebar, type DeliverableOutlineItem } from '@/components/workspace/deliverable-sidebar';
import { AssistantRail } from '@/components/workspace/assistant-rail';
import { PlanPanel } from '@/components/workspace/plan-panel';
import { DeliverableVersionControls } from '@/components/workspace/deliverable-version-controls';

type PaneOrder = 'deliverable-left' | 'assistant-left';
type WorkspaceNoticeAction = {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'ghost' | 'outline';
};
type WorkspaceNotice = {
  actions?: WorkspaceNoticeAction[];
  tone: 'error' | 'info' | 'success';
  text: string;
};
type QueuedPrompt = {
  content: string;
  id: string;
  searchMode?: 'auto' | 'force';
};

const PANE_ORDER_STORAGE_KEY = 'workspace-pane-order';

export default function WorkspacePage() {
  const t = useT();
  const params = useAppParams<{ workspaceId: string }>();
  const router = useAppRouter();
  const searchParams = useAppSearchParams();
  const workspaceId = params.workspaceId as string;
  const requestedConversationId = searchParams.get('conversationId');
  const requestedFileId = searchParams.get('fileId');
  const requestedSnapshotId = searchParams.get('snapshotId');

  const [goalDialogOpen, setGoalDialogOpen] = React.useState(false);
  const [paneOrder, setPaneOrder] = React.useState<PaneOrder>('deliverable-left');
  const [workspaceView, setWorkspaceView] = React.useState<WorkspaceViewData | null>(null);
  const [initialMessages, setInitialMessages] = React.useState<ChatMessageData[]>([]);
  const [reviewThreads, setReviewThreads] = React.useState<CommentThreadData[]>([]);
  const [editorContent, setEditorContent] = React.useState<Value | null>(null);
  const [fileContent, setFileContent] = React.useState('');
  const [isCreatingWorkspace, setIsCreatingWorkspace] = React.useState(false);
  const [createWorkspaceError, setCreateWorkspaceError] = React.useState<string | null>(null);
  const [createWorkspaceRecoveryActive, setCreateWorkspaceRecoveryActive] =
    React.useState(false);
  const [createWorkspaceRecoveryValues, setCreateWorkspaceRecoveryValues] =
    React.useState<GoalComposerValues | null>(null);
  const [isSavingTextFile, setIsSavingTextFile] = React.useState(false);
  const [isStartingPreview, setIsStartingPreview] = React.useState(false);
  const [isStoppingPreview, setIsStoppingPreview] = React.useState(false);
  const [showImplementation, setShowImplementation] = React.useState(false);
  const [workspaceNotice, setWorkspaceNotice] = React.useState<WorkspaceNotice | null>(
    null
  );
  const [workspaceRuns, setWorkspaceRuns] = React.useState<WorkspaceRunData[]>([]);
  const [queuedPrompt, setQueuedPrompt] = React.useState<QueuedPrompt | null>(null);
  const [isAssistantBusy, setIsAssistantBusy] = React.useState(false);
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptedRecoveryPointRef = React.useRef<string | null>(null);
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
    setCreateWorkspaceError(t('goal.createProjectRetryUnknown'));
  }, [t]);

  const currentWorkspace = workspaceView?.workspace || null;
  const currentConversation = workspaceView?.currentConversation || null;
  const currentFile = workspaceView?.currentFile || null;
  const currentSnapshot = workspaceView?.currentSnapshot || null;
  const deliverable = workspaceView?.deliverable || null;
  const workspaceBrief = workspaceView?.workspacePlan || null;
  const workflowSummary = workspaceView?.workflowSummary || null;

  const deliverableType: DeliverableType = deliverable?.deliverableType || 'document';
  const isSnapshotView = Boolean(currentSnapshot);
  const isRichtextFile =
    currentFile?.nodeType === 'file' &&
    (currentFile.kind === 'richtext' ||
      (currentFile.kind === 'markdown' && currentFile.content.trim().startsWith('[')));
  const currentConversationId = currentConversation?.id || requestedConversationId || null;
  const currentFileId = currentFile?.id || requestedFileId || null;
  const currentSnapshotId = currentSnapshot?.id || requestedSnapshotId || null;
  const previewCapability = React.useMemo(
    () => {
      const nextFiles = currentSnapshot
        ? (workspaceView?.snapshotFiles || []).filter((file) => file.role === 'deliverable')
        : (workspaceView?.files || []).filter((file) => file.role === 'deliverable');
      return detectWorkspacePreviewCapability(nextFiles);
    },
    [currentSnapshot, workspaceView?.files, workspaceView?.snapshotFiles]
  );
  const activePreviewRun = React.useMemo(
    () =>
      workspaceRuns.find(
        (run) =>
          run.kind === 'preview' &&
          (run.status === 'pending' || run.status === 'running')
      ) || null,
    [workspaceRuns]
  );
  const comparableDeliverableText = React.useMemo(
    () => normalizeDeliverableText(fileContent),
    [fileContent]
  );
  const hasDeliverableContent = comparableDeliverableText.trim().length > 0;
  const commentContextContent = React.useMemo(() => {
    if (!currentFile) {
      return '';
    }

    if (isRichtextFile) {
      try {
        return plateToMarkdown(parsePlateContent(fileContent));
      } catch {
        return fileContent;
      }
    }

    return fileContent;
  }, [currentFile, fileContent, isRichtextFile]);
  const outlineItems = React.useMemo(
    () =>
      buildOutlineItems({
        currentFile,
        deliverableTitle:
          deliverable?.title ||
          currentWorkspace?.title ||
          t('workspace.untitledDeliverable'),
        deliverableType,
        text: comparableDeliverableText,
      }),
    [
      comparableDeliverableText,
      currentFile,
      currentWorkspace?.title,
      deliverable?.title,
      deliverableType,
      t,
    ]
  );
  const supportFiles = React.useMemo(
    () => (workspaceView?.files || []).filter((file) => file.role === 'support'),
    [workspaceView?.files]
  );

  const loadWorkspace = React.useCallback(async () => {
    const query = new URLSearchParams();
    if (requestedConversationId) query.set('conversationId', requestedConversationId);
    if (requestedFileId) query.set('fileId', requestedFileId);
    if (requestedSnapshotId) query.set('snapshotId', requestedSnapshotId);

    const response = await fetch(
      `/api/workspaces/${workspaceId}${query.size > 0 ? `?${query.toString()}` : ''}`
    );

    if (!response.ok) {
      return null;
    }

    const nextView = (await response.json()) as WorkspaceViewData;
    setWorkspaceView(nextView);
    setInitialMessages(nextView.currentConversation?.messages || []);

    const nextContent = nextView.currentFile?.content || '';
    setFileContent(nextContent);
    setEditorContent(parsePlateContent(nextContent));

    if (nextView.deliverable?.deliverableType === 'document') {
      setShowImplementation(false);
    }

    return nextView;
  }, [requestedConversationId, requestedFileId, requestedSnapshotId, workspaceId]);

  const loadRuns = React.useCallback(async () => {
    const response = await fetch(`/api/workspaces/${workspaceId}/runs`);
    if (!response.ok) return;

    setWorkspaceRuns((await response.json()) as WorkspaceRunData[]);
  }, [workspaceId]);

  const loadThreads = React.useCallback(async () => {
    const params = new URLSearchParams({ workspaceId });
    if (currentFileId) params.set('fileId', currentFileId);
    if (currentSnapshotId) params.set('snapshotId', currentSnapshotId);
    const response = await fetch(`/api/threads?${params.toString()}`);
    if (!response.ok) return;

    setReviewThreads((await response.json()) as CommentThreadData[]);
  }, [currentFileId, currentSnapshotId, workspaceId]);

  React.useEffect(() => {
    const storedPaneOrder = window.localStorage.getItem(PANE_ORDER_STORAGE_KEY);
    if (storedPaneOrder === 'deliverable-left' || storedPaneOrder === 'assistant-left') {
      setPaneOrder(storedPaneOrder);
    }
  }, []);

  React.useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  React.useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  React.useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  React.useEffect(() => {
    if (!activePreviewRun) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadRuns();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activePreviewRun, loadRuns]);

  React.useEffect(() => {
    const shouldPollConversation =
      Boolean(currentConversationId) &&
      Boolean(workflowSummary?.isAiWorking || isAssistantBusy);

    if (!shouldPollConversation) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadWorkspace();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentConversationId, isAssistantBusy, loadWorkspace, workflowSummary?.isAiWorking]);

  React.useEffect(() => {
    const handleFocus = () => {
      void loadThreads();
    };

    window.addEventListener(COMMENT_THREAD_FOCUS_EVENT, handleFocus);
    return () => {
      window.removeEventListener(COMMENT_THREAD_FOCUS_EVENT, handleFocus);
    };
  }, [loadThreads]);

  React.useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (!workspaceNotice) {
      return;
    }

    if (workspaceNotice.actions?.length) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setWorkspaceNotice(null);
    }, 4000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [workspaceNotice]);

  const syncLocation = React.useCallback(
    (next: {
      conversationId?: string | null;
      fileId?: string | null;
      snapshotId?: string | null;
      workspaceId?: string | null;
    }) => {
      const resolvedWorkspaceId = next.workspaceId || workspaceId;
      const params = new URLSearchParams();
      const conversationId = next.conversationId ?? currentConversationId;
      const fileId = next.fileId ?? currentFileId;
      const snapshotId =
        next.snapshotId !== undefined ? next.snapshotId : currentSnapshotId;

      if (conversationId) params.set('conversationId', conversationId);
      if (fileId) params.set('fileId', fileId);
      if (snapshotId) params.set('snapshotId', snapshotId);

      const href = `/workspace/${resolvedWorkspaceId}${
        params.size > 0 ? `?${params.toString()}` : ''
      }`;

      if (resolvedWorkspaceId !== workspaceId) {
        router.push(href);
      } else {
        router.replace(href);
      }
    },
    [currentConversationId, currentFileId, currentSnapshotId, router, workspaceId]
  );

  const saveCurrentFileContent = React.useCallback(
    (nextContent: string) => {
      if (!currentFileId || isSnapshotView) {
        return;
      }

      setFileContent(nextContent);
      setWorkspaceView((current) => {
        if (!current?.currentFile) {
          return current;
        }

        return {
          ...current,
          deliverable: current.deliverable
            ? { ...current.deliverable, content: nextContent }
            : current.deliverable,
          currentFile: {
            ...current.currentFile,
            content: nextContent,
          },
          files: current.files.map((file) =>
            file.id === currentFileId ? { ...file, content: nextContent } : file
          ),
          workspace: current.workspace
            ? {
                ...current.workspace,
                content:
                  current.files.find((file) => file.id === currentFileId)?.isPrimary
                    ? nextContent
                    : current.workspace.content,
              }
            : current.workspace,
        };
      });

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        setIsSavingTextFile(true);
        try {
          await fetch(`/api/workspaces/${workspaceId}/files/${currentFileId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: nextContent }),
          });
        } finally {
          setIsSavingTextFile(false);
        }
      }, 700);
    },
    [currentFileId, isSnapshotView, workspaceId]
  );

  const createVersion = React.useCallback(async () => {
    const response = await fetch(`/api/workspaces/${workspaceId}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: deliverable?.title || currentWorkspace?.title || t('version.defaultTitle'),
      }),
    });

    if (!response.ok) {
      setWorkspaceNotice({
        tone: 'error',
        text: t('workspace.visibleVersionFailed'),
      });
      return;
    }

    const version = (await response.json()) as WorkspaceSnapshotData;
    setWorkspaceNotice({
      tone: 'success',
      text: t('workspace.createdVersion', { versionNum: version.versionNum }),
    });
    await loadWorkspace();
    await loadThreads();
  }, [
    currentWorkspace?.title,
    deliverable?.title,
    loadThreads,
    loadWorkspace,
    t,
    workspaceId,
  ]);

  const toggleRecoveryPointPin = React.useCallback(
    async (snapshotId: string, pinned: boolean) => {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/versions/${snapshotId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pinned }),
        }
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setWorkspaceNotice({
          tone: 'error',
          text: payload?.error || t('workspace.recoveryPointActionFailed'),
        });
        return;
      }

      const snapshot = (await response.json()) as WorkspaceSnapshotData;
      promptedRecoveryPointRef.current = snapshot.id;
      await loadWorkspace();
      setWorkspaceNotice({
        tone: 'success',
        text: pinned
          ? t('workspace.pinnedRecoveryPoint', { title: snapshot.title })
          : t('workspace.unpinnedRecoveryPoint', { title: snapshot.title }),
      });
    },
    [loadWorkspace, t, workspaceId]
  );

  const restoreSnapshot = React.useCallback(
    async (snapshotId: string) => {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/versions/${snapshotId}/restore`,
        {
          method: 'POST',
        }
      );

      if (!response.ok) {
        setWorkspaceNotice({
          tone: 'error',
          text: t('workspace.restoreFailed'),
        });
        return;
      }

      const result = (await response.json()) as {
        restoredSnapshot: WorkspaceSnapshotData;
      };
      syncLocation({ snapshotId: null });
      setWorkspaceNotice({
        tone: 'success',
        text: t('workspace.restoredSnapshot', {
          title: result.restoredSnapshot.title,
        }),
      });
      await Promise.all([loadWorkspace(), loadRuns(), loadThreads()]);
    },
    [loadRuns, loadThreads, loadWorkspace, syncLocation, t, workspaceId]
  );

  const branchFromMessage = React.useCallback(
    async (messageId: string) => {
      if (!currentConversationId) {
        return;
      }

      const response = await fetch(
        `/api/conversations/${currentConversationId}/branch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId }),
        }
      );

      if (!response.ok) {
        return;
      }

      const result = await response.json();
      syncLocation({
        conversationId: result.conversation.id,
        snapshotId: result.baseSnapshot?.id || currentSnapshotId || null,
      });
    },
    [currentConversationId, currentSnapshotId, syncLocation]
  );

  const startPreview = React.useCallback(async () => {
    setIsStartingPreview(true);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/preview/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshotId: currentSnapshotId,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setWorkspaceNotice({
          tone: 'error',
          text: payload?.error || t('workspace.previewCouldNotStart'),
        });
        return;
      }

      await loadRuns();
      setWorkspaceNotice({
        tone: 'success',
        text: t('workspace.previewStarted'),
      });
    } finally {
      setIsStartingPreview(false);
    }
  }, [currentSnapshotId, loadRuns, t, workspaceId]);

  const stopPreview = React.useCallback(async () => {
    setIsStoppingPreview(true);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/preview/stop`, {
        method: 'POST',
      });

      if (!response.ok) {
        setWorkspaceNotice({
          tone: 'error',
          text: t('workspace.previewCouldNotStop'),
        });
        return;
      }

      await loadRuns();
      setWorkspaceNotice({
        tone: 'info',
        text: t('workspace.previewStopped'),
      });
    } finally {
      setIsStoppingPreview(false);
    }
  }, [loadRuns, t, workspaceId]);

  const createWorkspaceFromGoal = React.useCallback(
    async (values: GoalComposerValues) => {
      if (createWorkspaceInFlightRef.current) return;

      createWorkspaceInFlightRef.current = true;
      setCreateWorkspaceError(null);
      setIsCreatingWorkspace(true);

      if (!createWorkspaceRequestIdRef.current) {
        createWorkspaceRequestIdRef.current = crypto.randomUUID();
      }

      try {
        const response = await fetch('/api/workspaces', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [WORKSPACE_CREATE_IDEMPOTENCY_HEADER]: createWorkspaceRequestIdRef.current,
            ...getStoredAISettingsHeader(),
          },
          body: JSON.stringify(values),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          clearWorkspaceCreateRecovery();
          setCreateWorkspaceRecoveryActive(false);
          setCreateWorkspaceRecoveryValues(null);
          createWorkspaceRequestIdRef.current = null;
          setCreateWorkspaceError(payload?.error || t('goal.createProjectFailed'));
          return;
        }

        const result = await response.json();
        clearWorkspaceCreateRecovery();
        setCreateWorkspaceRecoveryActive(false);
        setCreateWorkspaceRecoveryValues(null);
        createWorkspaceRequestIdRef.current = null;
        setGoalDialogOpen(false);
        router.push(
          `/workspace/${result.workspace.id}?conversationId=${result.conversation.id}`
        );
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
    },
    [router, t]
  );

  const handleConversationComplete = React.useCallback(async () => {
    const [nextView] = await Promise.all([loadWorkspace(), loadRuns(), loadThreads()]);

    if (!nextView || !currentConversationId) {
      return;
    }

    const latestTemporaryRecoveryPoint =
      nextView.snapshots.find(
        (snapshot) =>
          snapshot.recoveryKind === 'temporary' &&
          snapshot.sourceConversationId === currentConversationId
      ) || null;

    if (
      !latestTemporaryRecoveryPoint ||
      promptedRecoveryPointRef.current === latestTemporaryRecoveryPoint.id
    ) {
      return;
    }

    promptedRecoveryPointRef.current = latestTemporaryRecoveryPoint.id;
    const pinnedCount = nextView.snapshots.filter(
      (snapshot) => snapshot.recoveryKind === 'pinned'
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
  }, [currentConversationId, loadRuns, loadThreads, loadWorkspace, t, toggleRecoveryPointPin]);

  const handleGenerateFirstPass = React.useCallback(() => {
    if (!workspaceId || !currentWorkspace || isAssistantBusy) {
      return;
    }

    const nextPrompt: QueuedPrompt = {
      content: buildFirstPassPrompt({
        deliverableType,
        goal:
          workspaceBrief?.goal ||
          currentWorkspace.title ||
          deliverable?.title ||
          'Refine the current deliverable',
        constraints: workspaceBrief?.constraints || null,
        styleGuide: workspaceBrief?.styleGuide || null,
        currentText: comparableDeliverableText,
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
    workspaceBrief,
    currentWorkspace,
    deliverable?.title,
    deliverableType,
    isAssistantBusy,
    t,
    workspaceId,
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

  const assistantRail = (
    <AssistantRail
      reviewCount={reviewThreads.filter((thread) => thread.status === 'open').length}
      plan={
        <PlanPanel
          canGenerateFirstPass={!hasDeliverableContent}
          isAssistantBusy={isAssistantBusy}
          onGenerateFirstPass={handleGenerateFirstPass}
          plan={workspaceBrief}
          workflowSummary={workflowSummary}
        />
      }
      review={
        <CommentSidebar
          className="border-0"
          documentId={workspaceId}
          documentContent={commentContextContent}
          embedded
          onOpenChange={() => undefined}
          refreshThreads={loadThreads}
          threads={reviewThreads}
        />
      }
      chat={
        <ChatPanel
          activeFileId={currentFileId}
          activeAssistantRun={workspaceView?.activeAssistantRun || null}
          baseSnapshotId={currentSnapshotId}
          branches={workspaceView?.conversationTree || []}
          conversationId={currentConversationId}
          conversationRuns={workspaceView?.conversationRuns || []}
          conversationTitle={currentConversation?.title || null}
          initialMessages={initialMessages}
          onBusyChange={setIsAssistantBusy}
          onBranchConversation={branchFromMessage}
          onConversationComplete={handleConversationComplete}
          onQueuedPromptHandled={handleQueuedPromptHandled}
          onSelectConversation={(conversationId) =>
            syncLocation({ conversationId, snapshotId: currentSnapshotId })
          }
          onWorkspaceChange={({ conversationId, workspaceId: nextWorkspaceId }) => {
            syncLocation({
              conversationId,
              workspaceId: nextWorkspaceId || workspaceId,
            });
          }}
          queuedPrompt={queuedPrompt}
          workflowSummary={workflowSummary}
          workspaceId={workspaceId}
        />
      }
      context={
        <KnowledgePanel
          embedded
          isOpen
          onClose={() => undefined}
          wikiId={workspaceId}
        />
      }
    />
  );

  const headerVersionControls = (
    <>
      {workflowSummary?.isAiWorking || isAssistantBusy ? (
        <div className="inline-flex h-8 items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 text-xs font-medium text-foreground">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />
          <span className="truncate">
            {workflowSummary?.statusTitle || t('plan.aiDrafting')}
          </span>
        </div>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        onClick={() => requestSelectionCommentComposerOpen()}
        disabled={!workspaceId}
      >
        {t('workspace.reviewComment')}
      </Button>
      <DeliverableVersionControls
        currentSnapshotId={currentSnapshotId}
        currentText={comparableDeliverableText}
        onCreateVersion={createVersion}
        onRestoreVersion={restoreSnapshot}
        onTogglePin={toggleRecoveryPointPin}
        onSelectVersion={(snapshotId) => syncLocation({ snapshotId })}
        snapshots={workspaceView?.snapshots || []}
        stagedChangeSets={workspaceView?.stagedChangeSets || []}
        workspaceId={workspaceId}
      />
    </>
  );

  const deliverablePanel = buildDeliverablePanel({
    commentContextContent,
    currentFile,
    currentSnapshot,
    currentText: comparableDeliverableText,
    deliverableTitle:
      deliverable?.title ||
      currentWorkspace?.title ||
      t('workspace.untitledDeliverable'),
    deliverableType,
    documentPlaceholder:
      !hasDeliverableContent &&
      workflowSummary?.phase === 'reviewing' &&
      workspaceView?.stagedChangeSets.some((changeSet) => changeSet.status === 'pending')
        ? workflowSummary.statusDescription
        : t('workspace.documentPlaceholder'),
    editorContent,
    fileContent,
    headerActions: headerVersionControls,
    isReadOnly: isSnapshotView,
    isSavingTextFile,
    isStartingPreview,
    isStoppingPreview,
    noDocumentDescription: t('workspace.askAiGenerateDocument'),
    noDocumentTitle: t('workspace.noDocumentYet'),
    openPreviewLabel: t('workspace.openPreview'),
    onChange: saveCurrentFileContent,
    onStartPreview: startPreview,
    onStopPreview: stopPreview,
    previewCapability,
    previewEmptyDescription: t('workspace.previewReadyDescription'),
    previewEmptyTitle: t('workspace.previewReadyTitle'),
    previewNotReadyTitle: t('workspace.previewNotReady'),
    previewUnavailableDescription: t('workspace.previewUnavailableReason'),
    previewUrl: activePreviewRun?.previewUrl || null,
    readOnlyLabel: currentSnapshot ? currentSnapshot.title : t('workspace.liveDraft'),
    onRestoreLatest:
      workflowSummary?.latestRestorableSnapshotId
        ? () => void restoreSnapshot(workflowSummary.latestRestorableSnapshotId!)
        : undefined,
    onThreadsChanged: loadThreads,
    savingLabel: t('common.saving'),
    showImplementation,
    startPreviewLabel: t('workspace.startPreview'),
    startingLabel: t('workspace.starting'),
    stopPreviewLabel: t('workspace.stopPreview'),
    stoppingLabel: t('workspace.stopping'),
    versionActionLabel: t('version.createVersion'),
    workflowSummary,
    workspaceId,
  });

  return (
    <AppShell
      currentWorkspaceId={workspaceId}
      renderSidebar={({ collapsed, onNavigate }) => (
        <DeliverableSidebar
          collapsed={collapsed}
          currentWorkspaceId={workspaceId}
          onCreateWorkspace={() => setGoalDialogOpen(true)}
          onDeleteWorkspace={async (targetWorkspaceId) => {
            const response = await fetch(`/api/workspaces/${targetWorkspaceId}`, {
              method: 'DELETE',
            });
            if (!response.ok) {
              setWorkspaceNotice({
                tone: 'error',
                text: t('workspace.deleteFailed'),
              });
              return;
            }
            if (targetWorkspaceId === workspaceId) {
              router.push('/');
            }
          }}
          onNavigate={onNavigate}
          onOpenWorkspace={(nextWorkspaceId) => router.push(`/workspace/${nextWorkspaceId}`)}
          supportFiles={supportFiles}
          outlineItems={outlineItems}
        />
      )}
      subtitle={describeWorkspaceState(deliverable, currentSnapshot, t)}
      title={currentWorkspace?.title || t('workspace.projectTitleFallback')}
      actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5">
                <SlidersHorizontal className="h-4 w-4" />
                {t('workspace.view')}
              </Button>
            </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {deliverableType !== 'document' ? (
              <DropdownMenuItem onClick={() => setShowImplementation((open) => !open)}>
                <Code2 className="h-4 w-4" />
                {showImplementation
                  ? t('workspace.showDeliverable')
                  : t('workspace.showImplementation')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={togglePaneOrder}>
              <ArrowLeftRight className="h-4 w-4" />
              {t('workspace.swapLayout')}
            </DropdownMenuItem>
            {previewCapability.canPreview && showImplementation ? (
              activePreviewRun ? (
                <>
                  <DropdownMenuItem onClick={() => void stopPreview()} disabled={isStoppingPreview}>
                    {isStoppingPreview ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                    {t('workspace.stopPreview')}
                  </DropdownMenuItem>
                  {activePreviewRun.previewUrl ? (
                    <DropdownMenuItem asChild>
                      <a href={activePreviewRun.previewUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" />
                        {t('workspace.openPreview')}
                      </a>
                    </DropdownMenuItem>
                  ) : null}
                </>
              ) : (
                <DropdownMenuItem onClick={() => void startPreview()} disabled={isStartingPreview}>
                  {isStartingPreview ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {t('workspace.startPreview')}
                </DropdownMenuItem>
              )
            ) : null}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={async () => {
                if (!window.confirm(t('sidebar.deleteProjectConfirm'))) {
                  return;
                }
                const response = await fetch(`/api/workspaces/${workspaceId}`, {
                  method: 'DELETE',
                });
                if (!response.ok) {
                  setWorkspaceNotice({
                    tone: 'error',
                    text: t('workspace.deleteFailed'),
                  });
                  return;
                }
                router.push('/');
              }}
            >
              <Trash2 className="h-4 w-4" />
              {t('sidebar.deleteProject')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {workspaceNotice ? (
          <div
            className={cn(
              'border-b px-4 py-2 text-sm',
              workspaceNotice.tone === 'error' &&
                'border-destructive/20 bg-destructive/5 text-destructive',
              workspaceNotice.tone === 'success' &&
                'border-emerald-500/20 bg-emerald-500/5 text-emerald-700',
              workspaceNotice.tone === 'info' &&
                'border-border bg-muted/20 text-foreground'
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">{workspaceNotice.text}</div>
              {workspaceNotice.actions?.length ? (
                <div className="flex shrink-0 items-center gap-2">
                  {workspaceNotice.actions.map((action) => (
                    <Button
                      key={action.label}
                      size="sm"
                      variant={action.variant || 'outline'}
                      className="h-7"
                      onClick={action.onClick}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <SplitView
          className="flex-1"
          defaultRatio={paneOrder === 'deliverable-left' ? 0.68 : 0.32}
          left={paneOrder === 'deliverable-left' ? deliverablePanel : assistantRail}
          resetKey={`${workspaceId}:${paneOrder}:${deliverableType}`}
          right={paneOrder === 'deliverable-left' ? assistantRail : deliverablePanel}
        />
      </div>

      <GoalComposerDialog
        disableInputs={createWorkspaceRecoveryActive}
        errorMessage={createWorkspaceError}
        initialValues={createWorkspaceRecoveryValues || undefined}
        isSubmitting={isCreatingWorkspace}
        onOpenChange={(open) => {
          if (!open) {
            if (!createWorkspaceRecoveryActive) {
              clearWorkspaceCreateRecovery();
              setCreateWorkspaceError(null);
              setCreateWorkspaceRecoveryValues(null);
              createWorkspaceRequestIdRef.current = null;
            }
          }

          setGoalDialogOpen(open);
        }}
        onSubmit={createWorkspaceFromGoal}
        open={goalDialogOpen}
        submitLabel={
          createWorkspaceRecoveryActive ? t('goal.retryProjectCheck') : undefined
        }
      />
    </AppShell>
  );
}

function buildDeliverablePanel(params: {
  commentContextContent: string;
  currentFile: WorkspaceViewData['currentFile'];
  currentSnapshot: WorkspaceViewData['currentSnapshot'];
  currentText: string;
  deliverableTitle: string;
  deliverableType: DeliverableType;
  documentPlaceholder: string;
  editorContent: Value | null;
  fileContent: string;
  headerActions: React.ReactNode;
  isReadOnly: boolean;
  isSavingTextFile: boolean;
  isStartingPreview: boolean;
  isStoppingPreview: boolean;
  noDocumentDescription: string;
  noDocumentTitle: string;
  openPreviewLabel: string;
  onChange: (content: string) => void;
  onStartPreview: () => void;
  onStopPreview: () => void;
  previewCapability: ReturnType<typeof detectWorkspacePreviewCapability>;
  previewEmptyDescription: string;
  previewEmptyTitle: string;
  previewNotReadyTitle: string;
  previewUnavailableDescription: string;
  previewUrl: string | null;
  readOnlyLabel: string;
  onRestoreLatest?: (() => void) | undefined;
  onThreadsChanged: () => Promise<void>;
  savingLabel: string;
  showImplementation: boolean;
  startPreviewLabel: string;
  startingLabel: string;
  stopPreviewLabel: string;
  stoppingLabel: string;
  versionActionLabel: string;
  workflowSummary: WorkflowSummaryData | null;
  workspaceId: string;
}) {
  if (
    params.deliverableType === 'document' &&
    params.currentFile?.nodeType === 'file' &&
    (params.currentFile.kind === 'richtext' ||
      (params.currentFile.kind === 'markdown' &&
        params.currentFile.content.trim().startsWith('[')))
  ) {
    return (
      <EditorWrapper
        commentSidebarOpen={false}
        documentId={params.workspaceId}
        documentContent={params.commentContextContent}
        fileId={params.currentFile.id}
        headerActions={params.headerActions}
        initialContent={params.editorContent}
        onContentChange={params.onChange}
        onLockVersion={() => undefined}
        onUnlock={() => undefined}
        placeholder={params.documentPlaceholder}
        primaryActionLabel={params.versionActionLabel}
        readOnly={params.isReadOnly}
        sessionId={`${params.workspaceId}:conversation`}
        showBottomVersionBar={false}
        showCommentAction={false}
        showVersionControls={false}
        snapshotId={params.currentSnapshot?.id || null}
        status={params.currentSnapshot ? 'locked' : 'draft'}
        title={params.deliverableTitle}
        emptyDescription={params.noDocumentDescription}
        emptyTitle={params.noDocumentTitle}
        workspaceId={params.workspaceId}
      />
    );
  }

  if (params.deliverableType === 'web' && !params.showImplementation) {
    return (
      <WebDeliverableCanvas
        actions={params.headerActions}
        isStartingPreview={params.isStartingPreview}
        isStoppingPreview={params.isStoppingPreview}
        onStartPreview={params.onStartPreview}
        onStopPreview={params.onStopPreview}
        previewCapability={params.previewCapability}
        previewEmptyDescription={params.previewEmptyDescription}
        previewEmptyTitle={params.previewEmptyTitle}
        previewNotReadyTitle={params.previewNotReadyTitle}
        previewUnavailableDescription={params.previewUnavailableDescription}
        previewUrl={params.previewUrl}
        documentContent={params.commentContextContent}
        fileId={params.currentFile?.id || null}
        onRestoreLatest={params.onRestoreLatest}
        onThreadsChanged={params.onThreadsChanged}
        snapshotId={params.currentSnapshot?.id || null}
        startPreviewLabel={params.startPreviewLabel}
        startingLabel={params.startingLabel}
        stopPreviewLabel={params.stopPreviewLabel}
        stoppingLabel={params.stoppingLabel}
        subtitle={params.readOnlyLabel}
        title={params.deliverableTitle}
        workflowSummary={params.workflowSummary}
        workspaceId={params.workspaceId}
      />
    );
  }

  return (
    <SourceDeliverableCanvas
      actions={params.headerActions}
      content={params.fileContent}
      isReadOnly={params.isReadOnly}
      isSaving={params.isSavingTextFile}
      onChange={params.onChange}
      savingLabel={params.savingLabel}
      subtitle={params.readOnlyLabel}
      title={params.currentFile?.name || params.deliverableTitle}
    />
  );
}

function WebDeliverableCanvas({
  actions,
  documentContent,
  fileId,
  isStartingPreview,
  isStoppingPreview,
  onStartPreview,
  onStopPreview,
  previewCapability,
  previewEmptyDescription,
  previewEmptyTitle,
  previewNotReadyTitle,
  previewUnavailableDescription,
  previewUrl,
  onRestoreLatest,
  onThreadsChanged,
  snapshotId,
  startPreviewLabel,
  startingLabel,
  stopPreviewLabel,
  stoppingLabel,
  subtitle,
  title,
  workflowSummary,
  workspaceId,
}: {
  actions: React.ReactNode;
  documentContent: string;
  fileId?: string | null;
  isStartingPreview: boolean;
  isStoppingPreview: boolean;
  onStartPreview: () => void;
  onStopPreview: () => void;
  previewCapability: ReturnType<typeof detectWorkspacePreviewCapability>;
  previewEmptyDescription: string;
  previewEmptyTitle: string;
  previewNotReadyTitle: string;
  previewUnavailableDescription: string;
  previewUrl: string | null;
  onRestoreLatest?: (() => void) | undefined;
  onThreadsChanged: () => Promise<void>;
  snapshotId?: string | null;
  startPreviewLabel: string;
  startingLabel: string;
  stopPreviewLabel: string;
  stoppingLabel: string;
  subtitle: string;
  title: string;
  workflowSummary: WorkflowSummaryData | null;
  workspaceId: string;
}) {
  const t = useT();
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const statusTitle =
    workflowSummary?.statusTitle ||
    (previewCapability.canPreview ? previewEmptyTitle : previewNotReadyTitle);
  const statusDescription =
    workflowSummary?.blockedReason ||
    workflowSummary?.statusDescription ||
    (previewCapability.canPreview
      ? previewEmptyDescription
      : previewUnavailableDescription);
  const showStartPreviewAction =
    !previewUrl &&
    previewCapability.canPreview &&
    workflowSummary?.primaryAction === 'start_preview';
  const showRestoreAction =
    !previewUrl &&
    workflowSummary?.primaryAction === 'restore_latest' &&
    onRestoreLatest;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {previewUrl ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={onStopPreview}
              disabled={isStoppingPreview}
            >
              {isStoppingPreview ? stoppingLabel : stopPreviewLabel}
            </Button>
          ) : null}
          {actions}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-muted/20">
        {previewUrl ? (
          <div className="relative h-full">
            <iframe
              ref={iframeRef}
              src={previewUrl}
              className="h-full w-full border-0 bg-white"
              title={title}
            />
            <WebSelectionCommentTrigger
              documentContent={documentContent}
              fileId={fileId}
              iframeRef={iframeRef}
              onThreadsChanged={onThreadsChanged}
              snapshotId={snapshotId}
              workspaceId={workspaceId}
            />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center text-sm text-muted-foreground">
            <div className="max-w-md">
              <p className="font-medium text-foreground">{statusTitle}</p>
              <p className="mt-2 leading-6">{statusDescription}</p>
              {showStartPreviewAction ? (
                <Button
                  size="sm"
                  className="mt-4"
                  onClick={onStartPreview}
                  disabled={isStartingPreview}
                >
                  {isStartingPreview ? startingLabel : startPreviewLabel}
                </Button>
              ) : null}
              {showRestoreAction ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-4"
                  onClick={onRestoreLatest}
                >
                  {t('version.restore')}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SourceDeliverableCanvas({
  actions,
  content,
  isReadOnly,
  isSaving,
  onChange,
  savingLabel,
  subtitle,
  title,
}: {
  actions: React.ReactNode;
  content: string;
  isReadOnly: boolean;
  isSaving: boolean;
  onChange: (content: string) => void;
  savingLabel: string;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {isSaving ? <span className="text-xs text-muted-foreground">{savingLabel}</span> : null}
          {actions}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-background">
        <Textarea
          value={content}
          onChange={(event) => onChange(event.target.value)}
          readOnly={isReadOnly}
          className="h-full min-h-full resize-none rounded-none border-0 px-4 py-4 font-mono text-sm shadow-none focus-visible:ring-0"
        />
      </div>
    </div>
  );
}

function parsePlateContent(content: string): Value {
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [{ type: 'p', children: [{ text: '' }] }];
  } catch {
    return [{ type: 'p', children: [{ text: '' }] }];
  }
}

function normalizeDeliverableText(content: string) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return plateToMarkdown(parsed);
    }
  } catch {
    // fall through
  }

  return content;
}

function buildOutlineItems(params: {
  currentFile: WorkspaceViewData['currentFile'];
  deliverableTitle: string;
  deliverableType: DeliverableType;
  text: string;
}): DeliverableOutlineItem[] {
  if (params.deliverableType !== 'document') {
    return [
      {
        depth: 0,
        id: params.currentFile?.id || 'deliverable',
        label: params.deliverableTitle,
      },
    ];
  }

  const headings = params.text
    .split('\n')
    .map((line, index) => {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (!match) {
        return null;
      }

      return {
        depth: Math.max(0, match[1].length - 1),
        id: `heading-${index}`,
        label: match[2].trim(),
      };
    })
    .filter((item): item is DeliverableOutlineItem => Boolean(item));

  if (headings.length === 0) {
    return [
      {
        depth: 0,
        id: params.currentFile?.id || 'deliverable',
        label: params.deliverableTitle,
      },
    ];
  }

  return headings;
}

function buildFirstPassPrompt(params: {
  constraints: string | null;
  currentText: string;
  deliverableType: DeliverableType;
  goal: string;
  styleGuide: string | null;
}) {
  const lines = [
    'Take the first author pass for this deliverable.',
    'First inspect the current workspace context.',
    'Then render the first coherent draft directly into the live draft instead of stopping at staged changes.',
    params.deliverableType === 'web'
      ? 'Keep the web draft React-based by default. Use a thin previewable index.html shell only as the mount entrypoint, put most page logic and structure in React source files, and start preview if the workspace supports it.'
      : 'Write into the main live draft file, keep the current structure coherent, and avoid hiding the result in chat only.',
    'Create a recovery point before the pass, keep only the recent recovery points, and mention the newest one in your summary.',
    'Use the main deliverable file when possible.',
    'After using tools, reply with a short summary of what you rendered or saved.',
    '',
    `Deliverable type: ${params.deliverableType}`,
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

function describeWorkspaceState(
  deliverable: WorkspaceViewData['deliverable'],
  currentSnapshot: WorkspaceViewData['currentSnapshot'],
  t: ReturnType<typeof useT>
) {
  if (!deliverable) {
    return t('workspace.openProjectToContinue');
  }

  if (currentSnapshot) {
    return `${currentSnapshot.title} · ${formatDeliverableTypeLabel(
      deliverable.deliverableType,
      t
    )}`;
  }

  return `${formatWorkspaceStatusLabel(deliverable.status, t)} · ${formatDeliverableTypeLabel(
    deliverable.deliverableType,
    t
  )}`;
}

function formatDeliverableTypeLabel(
  deliverableType: DeliverableType,
  t: ReturnType<typeof useT>
) {
  if (deliverableType === 'web') {
    return t('goal.webPage');
  }

  if (deliverableType === 'code') {
    return t('goal.codeDeliverable');
  }

  if (deliverableType === 'slides') {
    return t('goal.slides');
  }

  return t('goal.document');
}

function formatWorkspaceStatusLabel(status: string, t: ReturnType<typeof useT>) {
  if (status === 'draft') {
    return t('common.draft');
  }

  if (status === 'reviewing') {
    return t('common.reviewing');
  }

  return status;
}
