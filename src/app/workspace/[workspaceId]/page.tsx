'use client';

import * as React from 'react';
import type { Value } from 'platejs';
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Code2,
  ExternalLink,
  FilePlus2,
  LoaderCircle,
  Play,
  SlidersHorizontal,
  Square,
} from 'lucide-react';

import {
  buildDeliverablePanel,
  buildOutlineItems,
  normalizeDeliverableText,
  parsePlateContent,
} from '@/canvas/document-canvas/document-canvas';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { plateToMarkdown } from '@/lib/ai/serializer';
import {
  COMMENT_THREAD_FOCUS_EVENT,
  requestSelectionCommentComposerOpen,
} from '@/lib/comments/constants';
import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import { useT } from '@/components/providers/language-provider';
import { cn } from '@/lib/utils';
import {
  useAppParams,
  useAppRouter,
  useAppSearchParams,
} from '@/lib/app-router';
import {
  buildWorkspaceCreateRecovery,
  clearWorkspaceCreateRecovery,
  loadWorkspaceCreateRecovery,
  persistWorkspaceCreateRecovery,
  submitWorkspaceCreateRequest,
  WorkspaceCreateActionError,
  type WorkspaceCreateContext,
} from '@/lib/workspace/create-request';
import {
  buildPreviewBridgeUrl,
  WEB_PREVIEW_BRIDGE_CHANNEL,
} from '@/lib/workspace/preview-bridge';
import {
  clearPendingPreviewStart,
  loadPendingPreviewStart,
  persistPendingPreviewStart,
} from '@/lib/workspace/preview-start-recovery';
import { isPlateBackedWorkspaceFile } from '@/lib/workspace/file-presentation';
import { saveWorkspaceFileContent } from '@/lib/workspace/file-client';
import { getCanonicalDeliverableType } from '@/lib/workspace/deliverable-types';
import {
  generateWorkspacePlan,
  updateWorkspacePlanActiveWorkflow,
} from '@/lib/workspace/plan-client';
import {
  detectWorkspacePreviewCapability,
  resolveWebPreviewAnchorFile,
} from '@/lib/workspace/preview';
import {
  startWorkspacePreview,
  stopWorkspacePreview,
} from '@/lib/workspace/preview-client';
import {
  deleteWorkspaceProject,
  renameWorkspaceProject,
} from '@/lib/workspace/project-client';
import {
  createProjectTreeFolder,
  deleteProjectTreeDeliverable,
  deleteProjectTreeFolder,
  moveProjectTreeDeliverable,
  moveProjectTreeFolder,
  renameProjectTreeDeliverable,
  renameProjectTreeFolder,
  reorderProjectTreeDeliverable,
  reorderProjectTreeFolder,
} from '@/lib/workspace/project-tree-client';
import {
  readWorkspaceReviewThreads,
  readWorkspaceRuns,
  readWorkspaceView,
} from '@/lib/workspace/read-client';
import { listProjectFolderPath } from '@/lib/workspace/project-summary';
import {
  branchConversationFromMessage,
  continueWorkspaceConversationFromVersion,
  createWorkspaceVersion,
  restoreWorkspaceVersion,
  switchWorkspaceConversationToVersionBranch,
  toggleWorkspaceRecoveryPointPin,
} from '@/lib/workspace/version-client';
import {
  createWorkspaceSupportNode,
  deleteWorkspaceSupportFile,
  moveWorkspaceSupportFile,
  renameWorkspaceSupportFile,
} from '@/lib/workspace/support-files-client';
import type {
  ChatMessageData,
  CommentThreadData,
  DeliverableType,
  ProjectDeliverableItem,
  ProjectFolderItem,
  ResearchMode,
  WorkspaceCurrentStatusData,
  WorkspaceRunData,
  WorkspaceVersionData,
  WorkspaceViewData,
} from '@/types';
import { GoalComposerDialog, type GoalComposerValues } from '@/components/workspace/goal-composer-dialog';
import { DeliverableSidebar } from '@/components/workspace/deliverable-sidebar';
import { AssistantRail } from '@/components/workspace/assistant-rail';
import { DeliverableVersionControls } from '@/components/workspace/deliverable-version-controls';
import { AssistantPanelSurface } from '@/surfaces/assistant-panel/assistant-panel';
import { ContextPanelSurface } from '@/surfaces/context-panel/context-panel';
import { ReviewPanelSurface } from '@/surfaces/review-panel/review-panel';
import { StatusPanelSurface } from '@/surfaces/status-panel/status-panel';
import { WorkspaceScreen } from '@/surfaces/workspace/workspace-screen';

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
  researchMode?: ResearchMode;
};

const PANE_ORDER_STORAGE_KEY = 'workspace-pane-order';
const WORKSPACE_OUTLINE_SURFACE_SELECTOR = '[data-workspace-outline-surface="true"]';

function findOutlineScrollContainer(
  outlineSurface: HTMLElement,
  targetHeading: HTMLElement
) {
  let current: HTMLElement | null = targetHeading.parentElement;

  while (current && current !== outlineSurface) {
    const overflowY = window.getComputedStyle(current).overflowY;
    const isScrollable =
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      current.scrollHeight > current.clientHeight + 1;

    if (isScrollable) {
      return current;
    }

    current = current.parentElement;
  }

  const viewport =
    outlineSurface.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
  if (viewport && viewport.scrollHeight > viewport.clientHeight + 1) {
    return viewport;
  }

  return null;
}
const EMPTY_PROJECT_FOLDERS: WorkspaceViewData['projectFolders'] = [];
const EMPTY_PROJECT_DELIVERABLES: WorkspaceViewData['projectDeliverables'] = [];
const PROJECT_TREE_SORT_STEP = 1024;

type ProjectTreeSiblingNode = {
  id: string;
  nodeType: 'deliverable' | 'folder';
  parentFolderId: string | null;
  sortOrder: number;
  updatedAt: Date | string;
};

function compareProjectTreeSiblingNodes(
  left: ProjectTreeSiblingNode,
  right: ProjectTreeSiblingNode
) {
  if (left.sortOrder === right.sortOrder) {
    const updatedAtDiff =
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    if (updatedAtDiff !== 0) {
      return updatedAtDiff;
    }

    return left.id.localeCompare(right.id);
  }

  return left.sortOrder - right.sortOrder;
}

function buildProjectTreeSiblingNodes(args: {
  deliverables: ProjectDeliverableItem[];
  folders: ProjectFolderItem[];
  parentFolderId: string | null;
}) {
  return [
    ...args.folders
      .filter((folder) => folder.parentFolderId === args.parentFolderId)
      .map(
        (folder): ProjectTreeSiblingNode => ({
          id: folder.id,
          nodeType: 'folder',
          parentFolderId: folder.parentFolderId,
          sortOrder: folder.sortOrder,
          updatedAt: folder.updatedAt,
        })
      ),
    ...args.deliverables
      .filter((deliverable) => deliverable.projectFolderId === args.parentFolderId)
      .map(
        (deliverable): ProjectTreeSiblingNode => ({
          id: deliverable.id,
          nodeType: 'deliverable',
          parentFolderId: deliverable.projectFolderId,
          sortOrder: deliverable.sortOrder,
          updatedAt: deliverable.updatedAt,
        })
      ),
  ].sort(compareProjectTreeSiblingNodes);
}

function getAdjacentProjectTreeSortOrder(args: {
  direction: 'up' | 'down';
  siblings: ProjectTreeSiblingNode[];
  targetId: string;
}) {
  const currentIndex = args.siblings.findIndex((node) => node.id === args.targetId);
  if (currentIndex < 0) {
    return null;
  }

  if (args.direction === 'up') {
    if (currentIndex === 0) {
      return null;
    }

    const previousNode = args.siblings[currentIndex - 1];
    const beforePreviousNode = currentIndex > 1 ? args.siblings[currentIndex - 2] : null;
    return beforePreviousNode
      ? (beforePreviousNode.sortOrder + previousNode.sortOrder) / 2
      : previousNode.sortOrder - PROJECT_TREE_SORT_STEP;
  }

  if (currentIndex >= args.siblings.length - 1) {
    return null;
  }

  const nextNode = args.siblings[currentIndex + 1];
  const afterNextNode =
    currentIndex < args.siblings.length - 2 ? args.siblings[currentIndex + 2] : null;
  return afterNextNode
    ? (nextNode.sortOrder + afterNextNode.sortOrder) / 2
    : nextNode.sortOrder + PROJECT_TREE_SORT_STEP;
}

export default function WorkspacePage() {
  const t = useT();
  const params = useAppParams<{ workspaceId: string }>();
  const router = useAppRouter();
  const searchParams = useAppSearchParams();
  const workspaceId = params.workspaceId as string;
  const requestedConversationId = searchParams.get('conversationId');
  const requestedFileId = searchParams.get('fileId');
  const requestedVersionId = searchParams.get('versionId');

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
  const [goalDialogSeedValues, setGoalDialogSeedValues] =
    React.useState<Partial<GoalComposerValues> | null>(null);
  const [workspaceCreateContext, setWorkspaceCreateContext] =
    React.useState<WorkspaceCreateContext | null>(null);
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
  const [chatError, setChatError] = React.useState<{
    error: { detail: string; message: string; retryable: boolean; kind: string };
    retryFn?: () => void;
  } | null>(null);
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptedRecoveryPointRef = React.useRef<string | null>(null);
  const createWorkspaceRequestIdRef = React.useRef<string | null>(null);
  const createWorkspaceInFlightRef = React.useRef(false);
  const pendingPlanGenerationRef = React.useRef<string | null>(null);
  const loadedSurfaceRef = React.useRef<{
    content: string;
    fileId: string | null;
    versionId: string | null;
  } | null>(null);

  React.useEffect(() => {
    const recovery = loadWorkspaceCreateRecovery();
    if (!recovery) {
      return;
    }

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
  }, [t]);

  const currentWorkspace = workspaceView?.workspace || null;
  const currentProject = workspaceView?.currentProject || null;
  const projectFolders = React.useMemo(
    () => workspaceView?.projectFolders || EMPTY_PROJECT_FOLDERS,
    [workspaceView?.projectFolders]
  );
  const projectDeliverables = React.useMemo(
    () => workspaceView?.projectDeliverables || EMPTY_PROJECT_DELIVERABLES,
    [workspaceView?.projectDeliverables]
  );
  const currentConversation = workspaceView?.currentConversation || null;
  const currentFile = workspaceView?.currentFile || null;
  const currentVersion = workspaceView?.selectedVersion || null;
  const currentDraftBaseVersionId = React.useMemo(
    () => {
      const persistedDraftBaseVersionId = workspaceView?.workspace?.draftBaseVersionId || null;
      if (
        persistedDraftBaseVersionId &&
        (workspaceView?.versions || []).some((version) => version.id === persistedDraftBaseVersionId)
      ) {
        return persistedDraftBaseVersionId;
      }

      return (workspaceView?.visibleVersions || [])[0]?.id || null;
    },
    [workspaceView?.versions, workspaceView?.visibleVersions, workspaceView?.workspace?.draftBaseVersionId]
  );
  const currentConversationBaseVersion = React.useMemo(() => {
    const baseVersionId = currentConversation?.baseVersionId || null;
    if (!baseVersionId) {
      return null;
    }

    return (workspaceView?.versions || []).find((version) => version.id === baseVersionId) || null;
  }, [currentConversation?.baseVersionId, workspaceView?.versions]);
  const currentDraftBaseVersion = React.useMemo(() => {
    if (!currentDraftBaseVersionId) {
      return null;
    }

    return (workspaceView?.versions || []).find((version) => version.id === currentDraftBaseVersionId) || null;
  }, [currentDraftBaseVersionId, workspaceView?.versions]);
  const deliverable = workspaceView?.deliverable || null;
  const workspaceBrief = workspaceView?.workspacePlan || null;
  const currentStatus = workspaceView?.currentStatus || null;
  const currentProjectId = currentProject?.id || currentWorkspace?.projectId || null;
  const currentProjectTitle = React.useMemo(
    () => {
      if (currentProject?.title?.trim()) {
        return currentProject.title.trim();
      }

      if (currentWorkspace?.projectTitle?.trim()) {
        return currentWorkspace.projectTitle.trim();
      }

      return currentProjectId ? t('workspace.untitledProject') : null;
    },
    [currentProject?.title, currentProjectId, currentWorkspace?.projectTitle, t]
  );
  const currentProjectPathLabel = React.useMemo(
    () => {
      if (!currentProjectTitle) {
        return null;
      }

      const folderSegments = listProjectFolderPath(
        currentWorkspace?.projectFolderId || null,
        projectFolders
      );

      return [currentProjectTitle, ...folderSegments].join(' / ');
    },
    [currentProjectTitle, currentWorkspace?.projectFolderId, projectFolders]
  );
  const projectDeliverableSwitchOptions = React.useMemo(
    () =>
      projectDeliverables.map((item) => {
        const folderPathLabel = listProjectFolderPath(
          item.projectFolderId,
          projectFolders
        ).join(' / ');

        return {
          folderPathLabel,
          id: item.id,
          title: item.title,
        };
      }),
    [projectDeliverables, projectFolders]
  );

  const deliverableType: DeliverableType = deliverable?.deliverableType || 'document';
  const storedDeliverableType = deliverable?.storedDeliverableType || null;
  const isVersionView = Boolean(currentVersion);
  const isRichtextFile = isPlateBackedWorkspaceFile(currentFile);
  const currentConversationId = currentConversation?.id || requestedConversationId || null;
  const currentFileId = currentFile?.id || requestedFileId || null;
  const currentVersionId = currentVersion?.id || requestedVersionId || null;
  const currentConversationBaseVersionLabel = React.useMemo(() => {
    if (!currentConversationBaseVersion) {
      return null;
    }

    return t(
      currentConversationBaseVersion.visible
        ? 'chat.baseVersionLabel'
        : 'chat.baseCheckpointLabel',
      {
        title: currentConversationBaseVersion.title,
      }
    );
  }, [currentConversationBaseVersion, t]);
  const currentDeliverableFiles = React.useMemo(
    () =>
      currentVersion
        ? (workspaceView?.versionFiles || []).filter((file) => file.role === 'deliverable')
        : (workspaceView?.files || []).filter((file) => file.role === 'deliverable'),
    [currentVersion, workspaceView?.files, workspaceView?.versionFiles]
  );
  const previewCapability = React.useMemo(
    () => detectWorkspacePreviewCapability(currentDeliverableFiles),
    [currentDeliverableFiles]
  );
  const previewAnchorFileId = React.useMemo(
    () => resolveWebPreviewAnchorFile(currentDeliverableFiles, previewCapability)?.id || null,
    [currentDeliverableFiles, previewCapability]
  );
  const activePreviewRun = React.useMemo(
    () =>
      workspaceRuns.find(
        (run) =>
          run.kind === 'preview' &&
          (run.status === 'pending' || run.status === 'running')
      ) ||
      workspaceView?.activePreviewRun ||
      null,
    [workspaceRuns, workspaceView?.activePreviewRun]
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
    () =>
      (currentVersion ? workspaceView?.versionFiles || [] : workspaceView?.files || []).filter(
        (file) => file.role === 'support'
      ),
    [currentVersion, workspaceView?.files, workspaceView?.versionFiles]
  );
  const activeSupportFileId = currentFile?.role === 'support' ? currentFile.id : null;
  const currentWorkspaceStatusLabel = describeWorkspaceStatusLabel({
    selectedVersion: currentVersion,
    deliverable,
    t,
    currentStatus,
  });
  const currentWorkspaceStateLabel = React.useMemo(
    () =>
      describeWorkspaceState({
        selectedVersion: currentVersion,
        deliverable,
        t,
        currentStatus,
      }),
    [currentStatus, currentVersion, deliverable, t]
  );
  const workspaceSubtitle = React.useMemo(
    () =>
      [currentProjectPathLabel, currentWorkspaceStateLabel]
        .filter(Boolean)
        .join(' · '),
    [currentProjectPathLabel, currentWorkspaceStateLabel]
  );
  const canSwitchProjectDeliverable =
    !isVersionView && projectDeliverableSwitchOptions.length > 1;
  const canOpenOutline = outlineItems.some((item) => item.id.startsWith('heading-'));
  const workspaceTitleNode = canSwitchProjectDeliverable ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto max-w-full justify-start gap-1 px-0 py-0 text-left hover:bg-transparent"
          data-testid="workspace-switch-deliverable"
        >
          <span className="truncate text-sm font-semibold">
            {currentWorkspace?.title || t('workspace.projectTitleFallback')}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {projectDeliverableSwitchOptions.map((option) => (
          <DropdownMenuItem
            key={option.id}
            className="gap-2 py-2"
            data-testid={`workspace-switch-deliverable-${option.id}`}
            disabled={option.id === workspaceId}
            onClick={() => router.push(`/workspace/${option.id}`)}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {option.id === workspaceId ? <Check className="h-4 w-4" /> : null}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{option.title}</div>
              <div className="truncate text-xs text-muted-foreground">
                {option.folderPathLabel || t('workspace.projectTitleFallback')}
              </div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : undefined;

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
    [requestedConversationId, requestedFileId, requestedVersionId, workspaceId]
  );

  const loadWorkspace = React.useCallback(async () => {
    return loadWorkspaceView();
  }, [loadWorkspaceView]);

  const loadRuns = React.useCallback(async () => {
    const nextRuns = await readWorkspaceRuns(workspaceId);
    if (!nextRuns) return;

    setWorkspaceRuns(nextRuns);
  }, [workspaceId]);

  const loadThreads = React.useCallback(async () => {
    const nextThreads = await readWorkspaceReviewThreads({
      currentFileId,
      currentVersionId,
      deliverableType,
      workspaceId,
    });
    if (!nextThreads) return;

    setReviewThreads(nextThreads);
  }, [currentFileId, currentVersionId, deliverableType, workspaceId]);

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
    if (workspaceBrief?.status !== 'generating') {
      return;
    }

    void triggerPlanGeneration(workspaceId);
  }, [triggerPlanGeneration, workspaceBrief?.status, workspaceId]);

  React.useEffect(() => {
    if (!activePreviewRun) {
      return;
    }

    clearPendingPreviewStart(workspaceId);

    const intervalId = window.setInterval(() => {
      void loadRuns();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activePreviewRun, loadRuns, workspaceId]);

  React.useEffect(() => {
    if (!workspaceView || !previewCapability.canPreview || activePreviewRun) {
      return;
    }

    if (currentStatus?.primaryAction !== 'start_preview') {
      return;
    }

    const navigationEntry = window.performance
      .getEntriesByType('navigation')
      .find((entry): entry is PerformanceNavigationTiming => entry instanceof PerformanceNavigationTiming);

    if (navigationEntry?.type !== 'reload') {
      return;
    }

    void loadRuns();

    const intervalId = window.setInterval(() => {
      void loadRuns();
    }, 500);

    const timeoutId = window.setTimeout(() => {
      window.clearInterval(intervalId);
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [
    activePreviewRun,
    currentStatus?.primaryAction,
    loadRuns,
    previewCapability.canPreview,
    workspaceView,
  ]);

  React.useEffect(() => {
    const shouldPollConversation =
      Boolean(currentConversationId) &&
      Boolean(currentStatus?.isAiWorking || isAssistantBusy);

    if (!shouldPollConversation) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadWorkspace();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentConversationId, currentStatus?.isAiWorking, isAssistantBusy, loadWorkspace]);

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
      versionId?: string | null;
      workspaceId?: string | null;
    }) => {
      const resolvedWorkspaceId = next.workspaceId || workspaceId;
      const params = new URLSearchParams();
      const conversationId =
        next.conversationId !== undefined ? next.conversationId : currentConversationId;
      const fileId = next.fileId !== undefined ? next.fileId : currentFileId;
      const versionId =
        next.versionId !== undefined ? next.versionId : currentVersionId;

      if (conversationId) params.set('conversationId', conversationId);
      if (fileId) params.set('fileId', fileId);
      if (versionId) params.set('versionId', versionId);

      const href = `/workspace/${resolvedWorkspaceId}${
        params.size > 0 ? `?${params.toString()}` : ''
      }`;

      if (resolvedWorkspaceId !== workspaceId) {
        router.push(href);
      } else {
        router.replace(href);
      }
    },
    [currentConversationId, currentFileId, currentVersionId, router, workspaceId]
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

  const saveCurrentFileContent = React.useCallback(
    (nextContent: string) => {
      if (!currentFileId || isVersionView) {
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
          await saveWorkspaceFileContent({
            content: nextContent,
            fileId: currentFileId,
            workspaceId,
          });
        } finally {
          setIsSavingTextFile(false);
        }
      }, 700);
    },
    [currentFileId, isVersionView, workspaceId]
  );

  const createVersion = React.useCallback(async () => {
    try {
      const version = await createWorkspaceVersion({
        errorMessage: t('workspace.visibleVersionFailed'),
        title: deliverable?.title || currentWorkspace?.title || t('version.defaultTitle'),
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
    currentWorkspace?.title,
    deliverable?.title,
    loadThreads,
    loadWorkspace,
    syncLocation,
    t,
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
    [loadWorkspace, t, workspaceId]
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
    [loadRuns, loadThreads, loadWorkspace, syncLocation, t, workspaceId]
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
    [currentConversationId, currentFileId, loadWorkspaceView, syncLocation, t, workspaceId]
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
    [currentConversationId, currentFileId, loadWorkspaceView, syncLocation, t, workspaceId]
  );

  const startPreview = React.useCallback(async (options?: {
    fromRecovery?: boolean;
    versionId?: string | null;
  }) => {
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
  }, [currentVersionId, loadRuns, t, workspaceId]);

  React.useEffect(() => {
    const pendingPreviewStart = loadPendingPreviewStart(workspaceId);
    if (!pendingPreviewStart) {
      return;
    }

    if (activePreviewRun) {
      clearPendingPreviewStart(workspaceId);
      return;
    }

    if (!workspaceView || !previewCapability.canPreview) {
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
    previewCapability.canPreview,
    startPreview,
    workspaceId,
    workspaceView,
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
  }, [loadRuns, t, workspaceId]);

  const openWorkspaceCreateEntry = React.useCallback(
    (context: WorkspaceCreateContext | null) => {
      setWorkspaceCreateContext(context);

      if (createWorkspaceRecoveryActive) {
        setGoalDialogOpen(true);
        return;
      }

      setCreateWorkspaceError(null);
      setGoalDialogSeedValues(null);
      setGoalDialogOpen(true);
    },
    [createWorkspaceRecoveryActive]
  );
  const openProjectDeliverableComposer = React.useCallback(
    (params: {
      projectFolderId: string | null;
      workflowPlaybookId?: string | null;
    }) => {
      setWorkspaceCreateContext({
        projectFolderId: params.projectFolderId,
        projectId: currentProjectId || currentWorkspace?.projectId || currentWorkspace?.id || null,
        projectTitle:
          currentProject?.title || currentWorkspace?.projectTitle || currentWorkspace?.title || null,
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
      currentProject?.title,
      currentProjectId,
      currentWorkspace?.id,
      currentWorkspace?.projectId,
      currentWorkspace?.projectTitle,
      currentWorkspace?.title,
    ]
  );

  const createWorkspaceFromGoal = React.useCallback(
    async (values: GoalComposerValues) => {
      if (createWorkspaceInFlightRef.current) return;

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
        clearWorkspaceCreateRecovery();
        setCreateWorkspaceRecoveryActive(false);
        setCreateWorkspaceRecoveryValues(null);
        setGoalDialogSeedValues(null);
        setWorkspaceCreateContext(null);
        createWorkspaceRequestIdRef.current = null;
        setGoalDialogOpen(false);
        router.push(
          `/workspace/${result.workspace.id}?conversationId=${result.conversation.id}`
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
        setCreateWorkspaceError(t(createRetryCopyKey));
      } finally {
        createWorkspaceInFlightRef.current = false;
        setIsCreatingWorkspace(false);
      }
    },
    [router, t, workspaceCreateContext]
  );
  const createNextDeliverableWithWorkflow = React.useCallback(() => {
    openProjectDeliverableComposer({
      projectFolderId: currentWorkspace?.projectFolderId || null,
      workflowPlaybookId: workspaceBrief?.activeWorkflowPlaybookId || '',
    });
  }, [
    currentWorkspace?.projectFolderId,
    openProjectDeliverableComposer,
    workspaceBrief?.activeWorkflowPlaybookId,
  ]);
  const applyWorkflowPlaybook = React.useCallback(
    async (workflowPlaybookId: string | null) => {
      const payload = await updateWorkspacePlanActiveWorkflow({
        errorMessage: t('context.workflowApplyFailed'),
        workflowPlaybookId,
        workspaceId,
      });

      setWorkspaceView((current) =>
        current
          ? {
              ...current,
              workspacePlan: payload,
              workspace: current.workspace
                ? {
                    ...current.workspace,
                    workspacePlan: payload,
                  }
                : current.workspace,
            }
          : current
      );
      setWorkspaceNotice({
        tone: 'success',
        text: workflowPlaybookId
          ? t('context.workflowApplied')
          : t('context.workflowCleared'),
      });
    },
    [t, workspaceId]
  );
  const createSupportNode = React.useCallback(
    async (params: {
      kind?: 'markdown';
      name: string;
      nodeType?: 'file' | 'folder';
      parentId?: string | null;
    }) => {
      try {
        return await createWorkspaceSupportNode({
          errorMessage: t('sidebar.createSupportMaterialFailed'),
          kind: params.kind,
          name: params.name,
          nodeType: params.nodeType,
          parentId: params.parentId,
          workspaceId,
        });
      } catch (error) {
        setWorkspaceNotice({
          tone: 'error',
          text:
            error instanceof Error ? error.message : t('sidebar.createSupportMaterialFailed'),
        });
        return null;
      }
    },
    [t, workspaceId]
  );
  const createSupportFile = React.useCallback(
    async (parentId?: string | null) => {
      const payload = await createSupportNode({
        kind: 'markdown',
        name: t('sidebar.newSupportNoteDefaultName'),
        parentId,
      });

      if (!payload?.id) {
        return;
      }

      setWorkspaceNotice({
        tone: 'success',
        text: t('sidebar.createSupportMaterialSuccess'),
      });
      syncLocation({
        fileId: payload.id,
        versionId: null,
      });
    },
    [createSupportNode, syncLocation, t]
  );
  const createSupportFolder = React.useCallback(
    async (parentId?: string | null) => {
      const payload = await createSupportNode({
        name: t('sidebar.newSupportFolderDefaultName'),
        nodeType: 'folder',
        parentId,
      });

      if (!payload?.id) {
        return;
      }

      setWorkspaceNotice({
        tone: 'success',
        text: t('sidebar.createSupportMaterialSuccess'),
      });
      await loadWorkspace();
    },
    [createSupportNode, loadWorkspace, t]
  );
  const deleteSupportFile = React.useCallback(
    async (fileId: string) => {
      const target = supportFiles.find((file) => file.id === fileId) || null;
      try {
        await deleteWorkspaceSupportFile({
          errorMessage: t('sidebar.deleteSupportMaterialFailed'),
          fileId,
          workspaceId,
        });
      } catch (error) {
        setWorkspaceNotice({
          tone: 'error',
          text:
            error instanceof Error ? error.message : t('sidebar.deleteSupportMaterialFailed'),
        });
        return;
      }

      const deletedCurrentSupportFile =
        currentFile?.role === 'support' &&
        target &&
        (currentFile.id === target.id ||
          currentFile.path === target.path ||
          currentFile.path.startsWith(`${target.path}/`));

      if (deletedCurrentSupportFile || currentFileId === fileId) {
        setWorkspaceNotice({
          tone: 'success',
          text: t('sidebar.deleteSupportMaterialSuccess'),
        });
        syncLocation({ fileId: null });
        return;
      }

      setWorkspaceNotice({
        tone: 'success',
        text: t('sidebar.deleteSupportMaterialSuccess'),
      });
      await loadWorkspace();
    },
    [currentFile, currentFileId, loadWorkspace, supportFiles, syncLocation, t, workspaceId]
  );
  const renameSupportFile = React.useCallback(
    async (fileId: string, name: string) => {
      await renameWorkspaceSupportFile({
        errorMessage: t('sidebar.renameSupportMaterialFailed'),
        fileId,
        name,
        workspaceId,
      });

      await loadWorkspace();
      setWorkspaceNotice({
        tone: 'success',
        text: t('sidebar.renameSupportMaterialSuccess'),
      });
    },
    [loadWorkspace, t, workspaceId]
  );
  const moveSupportFile = React.useCallback(
    async (fileId: string, parentId: string | null, sortOrder?: number) => {
      await moveWorkspaceSupportFile({
        errorMessage: t('sidebar.moveSupportMaterialFailed'),
        fileId,
        parentId,
        sortOrder,
        workspaceId,
      });

      await loadWorkspace();
      setWorkspaceNotice({
        tone: 'success',
        text: t('sidebar.moveSupportMaterialSuccess'),
      });
    },
    [loadWorkspace, t, workspaceId]
  );
  const reorderSupportFile = React.useCallback(
    async (fileId: string, direction: 'up' | 'down') => {
      const target = supportFiles.find((file) => file.id === fileId) || null;
      if (!target) {
        return;
      }

      const siblings = supportFiles
        .filter((file) => file.parentId === target.parentId)
        .slice()
        .sort((left, right) => {
          if (left.sortOrder === right.sortOrder) {
            return left.path.localeCompare(right.path);
          }
          return left.sortOrder - right.sortOrder;
        });
      const currentIndex = siblings.findIndex((file) => file.id === fileId);
      if (currentIndex < 0) {
        return;
      }

      const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= siblings.length) {
        return;
      }

      await moveSupportFile(fileId, target.parentId, nextIndex);
    },
    [moveSupportFile, supportFiles]
  );

  const createProjectDeliverable = React.useCallback(
    (projectFolderId: string | null) => {
      openWorkspaceCreateEntry({
        projectFolderId,
        projectId: currentWorkspace?.projectId || currentWorkspace?.id || null,
        projectTitle:
          currentWorkspace?.projectTitle || currentProject?.title || currentWorkspace?.title || null,
      });
    },
    [
      currentProject?.title,
      currentWorkspace?.id,
      currentWorkspace?.projectId,
      currentWorkspace?.projectTitle,
      currentWorkspace?.title,
      openWorkspaceCreateEntry,
    ]
  );
  const createSiblingDeliverable = React.useCallback(
    (targetWorkspaceId: string) => {
      const target = projectDeliverables.find((item) => item.id === targetWorkspaceId) || null;
      createProjectDeliverable(target?.projectFolderId || null);
    },
    [createProjectDeliverable, projectDeliverables]
  );
  const createProjectFolder = React.useCallback(
    async (parentFolderId: string | null) => {
      const projectId = currentProjectId || currentWorkspace?.projectId || currentWorkspace?.id || null;
      if (!projectId) {
        return;
      }

      try {
        await createProjectTreeFolder({
          errorMessage: t('sidebar.createProjectFolderFailed'),
          parentId: parentFolderId,
          projectId,
          title: t('sidebar.newProjectFolderDefaultName'),
        });
      } catch (error) {
        setWorkspaceNotice({
          tone: 'error',
          text:
            error instanceof Error ? error.message : t('sidebar.createProjectFolderFailed'),
        });
        return;
      }

      await loadWorkspace();
    },
    [currentProjectId, currentWorkspace?.id, currentWorkspace?.projectId, loadWorkspace, t]
  );
  const deleteProject = React.useCallback(
    async (projectId: string) => {
      try {
        await deleteWorkspaceProject({
          errorMessage: t('workspace.deleteFailed'),
          projectId,
        });
      } catch (error) {
        setWorkspaceNotice({
          tone: 'error',
          text: error instanceof Error ? error.message : t('workspace.deleteFailed'),
        });
        return;
      }

      if (projectId === currentProjectId) {
        router.push('/');
      }
    },
    [currentProjectId, router, t]
  );
  const renameProject = React.useCallback(
    async (projectId: string, title: string) => {
      const payload = await renameWorkspaceProject({
        errorMessage: t('workspace.renameFailed'),
        projectId,
        title,
      });
      if (projectId !== currentProjectId) {
        return;
      }

      setWorkspaceView((current) =>
        current?.currentProject || current?.workspace
          ? {
              ...current,
              currentProject: current.currentProject
                ? {
                    ...current.currentProject,
                    title: payload?.title || title,
                  }
                : current.currentProject,
              workspace: current.workspace
                ? {
                    ...current.workspace,
                    projectTitle: payload?.title || title,
                  }
                : current.workspace,
            }
          : current
      );
    },
    [currentProjectId, t]
  );
  const renameProjectFolder = React.useCallback(
    async (folderId: string, title: string) => {
      const projectId = currentProjectId || currentWorkspace?.projectId || currentWorkspace?.id || null;
      if (!projectId) {
        throw new Error(t('sidebar.renameProjectFolderFailed'));
      }

      await renameProjectTreeFolder({
        errorMessage: t('sidebar.renameProjectFolderFailed'),
        folderId,
        projectId,
        title,
      });

      await loadWorkspace();
    },
    [currentProjectId, currentWorkspace?.id, currentWorkspace?.projectId, loadWorkspace, t]
  );
  const deleteProjectFolder = React.useCallback(
    async (folderId: string) => {
      const projectId = currentProjectId || currentWorkspace?.projectId || currentWorkspace?.id || null;
      if (!projectId) {
        return;
      }

      try {
        await deleteProjectTreeFolder({
          errorMessage: t('sidebar.deleteProjectFolderFailed'),
          folderId,
          projectId,
        });
      } catch (error) {
        setWorkspaceNotice({
          tone: 'error',
          text:
            error instanceof Error ? error.message : t('sidebar.deleteProjectFolderFailed'),
        });
        return;
      }

      await loadWorkspace();
    },
    [currentProjectId, currentWorkspace?.id, currentWorkspace?.projectId, loadWorkspace, t]
  );
  const renameDeliverable = React.useCallback(
    async (targetWorkspaceId: string, title: string) => {
      const payload = await renameProjectTreeDeliverable({
        errorMessage: t('workspace.renameDeliverableFailed'),
        title,
        workspaceId: targetWorkspaceId,
      });

      if (targetWorkspaceId === workspaceId) {
        await loadWorkspace();
        return;
      }

      setWorkspaceView((current) =>
        current
          ? {
              ...current,
              projectDeliverables: current.projectDeliverables.map((item) =>
                item.id === targetWorkspaceId
                  ? {
                      ...item,
                      title: payload?.title || title,
                    }
                  : item
              ),
            }
          : current
      );
    },
    [loadWorkspace, t, workspaceId]
  );
  const deleteDeliverable = React.useCallback(
    async (targetWorkspaceId: string) => {
      try {
        await deleteProjectTreeDeliverable({
          errorMessage: t('workspace.deleteDeliverableFailed'),
          workspaceId: targetWorkspaceId,
        });
      } catch (error) {
        setWorkspaceNotice({
          tone: 'error',
          text:
            error instanceof Error ? error.message : t('workspace.deleteDeliverableFailed'),
        });
        return;
      }

      if (targetWorkspaceId === workspaceId) {
        const nextWorkspace =
          projectDeliverables.find((item) => item.id !== targetWorkspaceId) || null;
        router.push(nextWorkspace ? `/workspace/${nextWorkspace.id}` : '/');
        return;
      }

      await loadWorkspace();
    },
    [loadWorkspace, projectDeliverables, router, t, workspaceId]
  );
  const moveDeliverable = React.useCallback(
    async (targetWorkspaceId: string, projectFolderId: string | null) => {
      await moveProjectTreeDeliverable({
        errorMessage: t('sidebar.moveDeliverableFailed'),
        projectFolderId,
        workspaceId: targetWorkspaceId,
      });

      await loadWorkspace();
    },
    [loadWorkspace, t]
  );
  const reorderDeliverable = React.useCallback(
    async (targetWorkspaceId: string, direction: 'up' | 'down') => {
      const deliverable =
        projectDeliverables.find((item) => item.id === targetWorkspaceId) || null;
      if (!deliverable) {
        return;
      }

      const nextTreeSortOrder = getAdjacentProjectTreeSortOrder({
        direction,
        siblings: buildProjectTreeSiblingNodes({
          deliverables: projectDeliverables,
          folders: projectFolders,
          parentFolderId: deliverable.projectFolderId,
        }),
        targetId: targetWorkspaceId,
      });
      if (nextTreeSortOrder === null) {
        return;
      }

      await reorderProjectTreeDeliverable({
        errorMessage: t('sidebar.moveDeliverableFailed'),
        treeSortOrder: nextTreeSortOrder,
        workspaceId: targetWorkspaceId,
      });

      await loadWorkspace();
    },
    [loadWorkspace, projectDeliverables, projectFolders, t]
  );
  const moveProjectFolder = React.useCallback(
    async (folderId: string, parentFolderId: string | null) => {
      const projectId = currentProjectId || currentWorkspace?.projectId || currentWorkspace?.id || null;
      if (!projectId) {
        throw new Error(t('sidebar.moveProjectFolderFailed'));
      }

      await moveProjectTreeFolder({
        errorMessage: t('sidebar.moveProjectFolderFailed'),
        folderId,
        parentId: parentFolderId,
        projectId,
      });

      await loadWorkspace();
    },
    [currentProjectId, currentWorkspace?.id, currentWorkspace?.projectId, loadWorkspace, t]
  );
  const reorderProjectFolder = React.useCallback(
    async (folderId: string, direction: 'up' | 'down') => {
      const projectId = currentProjectId || currentWorkspace?.projectId || currentWorkspace?.id || null;
      if (!projectId) {
        throw new Error(t('sidebar.moveProjectFolderFailed'));
      }

      const folder = projectFolders.find((item) => item.id === folderId) || null;
      if (!folder) {
        return;
      }

      const nextTreeSortOrder = getAdjacentProjectTreeSortOrder({
        direction,
        siblings: buildProjectTreeSiblingNodes({
          deliverables: projectDeliverables,
          folders: projectFolders,
          parentFolderId: folder.parentFolderId,
        }),
        targetId: folderId,
      });
      if (nextTreeSortOrder === null) {
        return;
      }

      await reorderProjectTreeFolder({
        errorMessage: t('sidebar.moveProjectFolderFailed'),
        folderId,
        projectId,
        treeSortOrder: nextTreeSortOrder,
      });

      await loadWorkspace();
    },
    [
      currentProjectId,
      currentWorkspace?.id,
      currentWorkspace?.projectId,
      loadWorkspace,
      projectDeliverables,
      projectFolders,
      t,
    ]
  );

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
      reviewCount={
        reviewThreads.filter(
          (thread) =>
            (thread.status === 'open' || thread.status === 'applied') &&
            (thread.scope === 'direct' || thread.inheritanceState === 'actionable')
        ).length
      }
      status={
        <StatusPanelSurface
          currentDraftBranchTitle={currentDraftBaseVersion?.title || null}
          isAssistantBusy={isAssistantBusy}
          onCreateNextDeliverable={createNextDeliverableWithWorkflow}
          plan={workspaceBrief}
          currentStatus={currentStatus}
        />
      }
      review={
        <ReviewPanelSurface
          allowSourceApply={!currentVersionId}
          className="border-0"
          documentId={workspaceId}
          documentContent={commentContextContent}
          files={workspaceView?.files || []}
          onOpenFile={handleOpenWorkspaceFile}
          onSourceContentApplied={async () => {
            await loadWorkspace();
          }}
          refreshThreads={loadThreads}
          threads={reviewThreads}
        />
      }
      chat={
        <AssistantPanelSurface
          activeFileId={currentFileId}
          activeAssistantRun={workspaceView?.activeAssistantRun || null}
          baseVersionLabel={currentConversationBaseVersionLabel}
          baseVersionId={currentConversation?.baseVersionId || null}
          branches={workspaceView?.conversationTree || []}
          conversationId={currentConversationId}
          conversationRuns={workspaceView?.conversationRuns || []}
          conversationTitle={currentConversation?.title || null}
          initialMessages={initialMessages}
          onBusyChange={setIsAssistantBusy}
          onBranchConversation={branchFromMessage}
          onConversationComplete={handleConversationComplete}
          onOpenFile={handleOpenWorkspaceFile}
          onQueuedPromptHandled={handleQueuedPromptHandled}
          onSelectConversation={(conversationId) => syncLocation({ conversationId })}
          onWorkspaceChange={({ conversationId, workspaceId: nextWorkspaceId }) => {
            syncLocation({
              conversationId,
              workspaceId: nextWorkspaceId || workspaceId,
            });
          }}
          onChatErrorChange={(error, retryFn) => setChatError(error ? { error, retryFn } : null)}
          queuedPrompt={queuedPrompt}
          workspaceId={workspaceId}
        />
      }
      context={
        <ContextPanelSurface
          activeWorkflowPlaybookId={workspaceBrief?.activeWorkflowPlaybookId || null}
          onApplyWorkflow={workspaceId ? applyWorkflowPlaybook : undefined}
          wikiId={workspaceId}
        />
      }
    />
  );

  const headerVersionControls = (
    <>
      {(() => {
        const statusActivelyRunning = Boolean(
          isAssistantBusy ||
            currentStatus?.isAiWorking ||
            currentStatus?.phase === 'implementing'
        );

        return currentStatus?.statusTitle || isAssistantBusy ? (
          <div
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium text-foreground',
              statusActivelyRunning && 'border-primary/20 bg-primary/5',
              currentStatus?.phase === 'blocked' &&
                'border-amber-500/20 bg-amber-500/5',
              currentStatus?.phase === 'finalized' &&
                'border-emerald-500/20 bg-emerald-500/5',
              !statusActivelyRunning &&
                currentStatus?.phase !== 'blocked' &&
                currentStatus?.phase !== 'finalized' &&
                'border-border bg-muted/20'
            )}
          >
            {statusActivelyRunning ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />
            ) : (
              <span
                className={cn(
                  'h-2 w-2 rounded-full bg-muted-foreground/70',
                  currentStatus?.phase === 'blocked' && 'bg-amber-500',
                  currentStatus?.phase === 'finalized' && 'bg-emerald-500',
                  (currentStatus?.phase === 'preview_ready' ||
                    currentStatus?.phase === 'preview_running' ||
                    currentStatus?.phase === 'reviewing') &&
                    'bg-primary/70'
                )}
              />
            )}
            <span className="truncate">
              {currentStatus?.statusTitle || t('status.aiBusy')}
            </span>
          </div>
        ) : null;
      })()}
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
        currentDraftBaseVersionId={currentDraftBaseVersionId}
        currentVersionId={currentVersionId}
        currentText={comparableDeliverableText}
        onContinueFromVersion={continueConversationFromVersion}
        onCreateVersion={createVersion}
        onRestoreVersion={restoreVersion}
        onSwitchToVersionBranch={switchConversationToVersionBranch}
        onTogglePin={toggleRecoveryPointPin}
        onSelectVersion={(versionId) => syncLocation({ versionId })}
        versions={workspaceView?.versions || []}
        stagedChangeSets={workspaceView?.stagedChangeSets || []}
        workspaceId={workspaceId}
      />
    </>
  );

  const deliverablePanel = buildDeliverablePanel({
    commentContextContent,
    currentFile,
    selectedVersion: currentVersion,
    currentText: comparableDeliverableText,
    deliverableTitle:
      deliverable?.title ||
      currentWorkspace?.title ||
      t('workspace.untitledDeliverable'),
    deliverableType,
    storedDeliverableType,
    documentPlaceholder:
      !hasDeliverableContent &&
      currentStatus?.phase === 'reviewing' &&
      workspaceView?.stagedChangeSets.some((changeSet) => changeSet.status === 'pending')
        ? currentStatus.statusDescription
        : t('workspace.documentPlaceholder'),
    editorContent,
    fileContent,
    headerActions: headerVersionControls,
    isAssistantBusy,
    isReadOnly: isVersionView,
    isSavingTextFile,
    isStartingPreview,
    isStoppingPreview,
    noDocumentDescription: t('workspace.askAiGenerateDocument'),
    noDocumentTitle: t('workspace.noDocumentYet'),
    openPreviewLabel: t('workspace.openPreview'),
    onChange: saveCurrentFileContent,
    onGenerateFirstPass: handleGenerateFirstPass,
    onStartPreview: startPreview,
    onStopPreview: stopPreview,
    previewCapability,
    previewAnchorFileId,
    previewEmptyDescription: t('workspace.previewReadyDescription'),
    previewEmptyTitle: t('workspace.previewReadyTitle'),
    previewNotReadyTitle: t('workspace.previewNotReady'),
    previewUnavailableDescription: t('workspace.previewUnavailableReason'),
    previewRunId: activePreviewRun?.id || null,
    previewUrl: activePreviewRun?.previewUrl || null,
    readOnlyLabel:
      currentFile?.role === 'support'
        ? t('sidebar.uploads')
        : currentVersion
          ? currentVersion.title
          : t('workspace.liveDraft'),
    onRestoreLatest:
      currentStatus?.latestRestorableVersionId
        ? () => void restoreVersion(currentStatus.latestRestorableVersionId!)
        : undefined,
    reviewThreads,
    onThreadsChanged: loadThreads,
    savingLabel: t('common.saving'),
    showImplementation,
    startPreviewLabel: t('workspace.startPreview'),
    startingLabel: t('workspace.starting'),
    stopPreviewLabel: t('workspace.stopPreview'),
    stoppingLabel: t('workspace.stopping'),
    supportMaterialLabel: t('sidebar.uploads'),
    versionActionLabel: t('version.createVersion'),
    currentStatus,
    chatError,
    t,
    draftRevision: currentWorkspace?.draftRevision || null,
    workspaceId,
  });

  const renderWorkspaceSidebar = ({
    collapsed,
    onNavigate,
  }: {
    collapsed: boolean;
    onNavigate?: () => void;
  }) => (
    <DeliverableSidebar
      activeSupportFileId={activeSupportFileId}
      collapsed={collapsed}
      currentProjectId={currentProjectId}
      currentWorkspaceId={workspaceId}
      currentWorkspaceStatusLabel={currentWorkspaceStatusLabel}
      onCreateWorkspace={() => openWorkspaceCreateEntry(null)}
      onCreateDeliverable={(context) =>
        void createProjectDeliverable(context?.projectFolderId || null)
      }
      onCreateProjectFolder={
        isVersionView ? undefined : (parentFolderId) => void createProjectFolder(parentFolderId || null)
      }
      onCreateSiblingDeliverable={(targetWorkspaceId) =>
        void createSiblingDeliverable(targetWorkspaceId)
      }
      onDeleteWorkspace={(projectId) => void deleteProject(projectId)}
      onCreateSupportFile={
        isVersionView ? undefined : (parentId) => void createSupportFile(parentId)
      }
      onCreateSupportFolder={
        isVersionView ? undefined : (parentId) => void createSupportFolder(parentId)
      }
      onDeleteSupportFile={isVersionView ? undefined : (fileId) => void deleteSupportFile(fileId)}
      onMoveSupportFile={
        isVersionView
          ? undefined
          : (fileId, parentId, sortOrder) => void moveSupportFile(fileId, parentId, sortOrder)
      }
      onReorderSupportFile={
        isVersionView
          ? undefined
          : (fileId, direction) => void reorderSupportFile(fileId, direction)
      }
      onRenameSupportFile={
        isVersionView ? undefined : (fileId, name) => void renameSupportFile(fileId, name)
      }
      onOpenDeliverable={(targetWorkspaceId) => router.push(`/workspace/${targetWorkspaceId}`)}
      onRenameWorkspace={(projectId, title) => renameProject(projectId, title)}
      onNavigate={onNavigate}
      onOpenOutline={canOpenOutline ? openOutline : undefined}
      onOpenSupportFile={(fileId) =>
        syncLocation({
          fileId,
          versionId: currentVersionId,
        })
      }
      onOpenWorkspace={(nextWorkspaceId) => router.push(`/workspace/${nextWorkspaceId}`)}
      onRenameDeliverable={
        isVersionView
          ? undefined
          : (targetWorkspaceId, title) => void renameDeliverable(targetWorkspaceId, title)
      }
      onDeleteDeliverable={
        isVersionView
          ? undefined
          : (targetWorkspaceId) => void deleteDeliverable(targetWorkspaceId)
      }
      onMoveDeliverable={
        isVersionView
          ? undefined
          : (targetWorkspaceId, projectFolderId) =>
              void moveDeliverable(targetWorkspaceId, projectFolderId)
      }
      onMoveProjectFolder={
        isVersionView
          ? undefined
          : (folderId, parentFolderId) => void moveProjectFolder(folderId, parentFolderId)
      }
      onReorderDeliverable={
        isVersionView
          ? undefined
          : (targetWorkspaceId, direction) =>
              void reorderDeliverable(targetWorkspaceId, direction)
      }
      onReorderProjectFolder={
        isVersionView
          ? undefined
          : (folderId, direction) => void reorderProjectFolder(folderId, direction)
      }
      onRenameProjectFolder={
        isVersionView ? undefined : (folderId, title) => void renameProjectFolder(folderId, title)
      }
      onDeleteProjectFolder={
        isVersionView ? undefined : (folderId) => void deleteProjectFolder(folderId)
      }
      projectFolders={projectFolders}
      projectDeliverables={projectDeliverables}
      supportFiles={supportFiles}
      outlineItems={outlineItems}
    />
  );

  const workspaceShellActions = (
    <>
      {currentWorkspace && !isVersionView ? (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          data-testid="workspace-new-sibling-deliverable"
          onClick={() =>
            openProjectDeliverableComposer({
              projectFolderId: currentWorkspace.projectFolderId || null,
            })
          }
        >
          <FilePlus2 className="h-4 w-4" />
          {t('sidebar.newSiblingDeliverable')}
        </Button>
      ) : null}
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
                <DropdownMenuItem
                  onClick={() => void stopPreview()}
                  disabled={isStoppingPreview}
                >
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
              <DropdownMenuItem
                onClick={() => void startPreview()}
                disabled={isStartingPreview}
              >
                {isStartingPreview ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {t('workspace.startPreview')}
              </DropdownMenuItem>
            )
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  const goalDialog = (
    <GoalComposerDialog
      creationMode={workspaceCreateContext?.projectId ? 'deliverable' : 'project'}
      currentProjectTitle={workspaceCreateContext?.projectTitle || null}
      disableInputs={createWorkspaceRecoveryActive}
      errorMessage={createWorkspaceError}
      initialValues={
        createWorkspaceRecoveryValues || goalDialogSeedValues || undefined
      }
      isSubmitting={isCreatingWorkspace}
      onOpenChange={(open) => {
        if (!open) {
          if (!createWorkspaceRecoveryActive) {
            clearWorkspaceCreateRecovery();
            setCreateWorkspaceError(null);
            setCreateWorkspaceRecoveryValues(null);
            setGoalDialogSeedValues(null);
            setWorkspaceCreateContext(null);
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
      workflowContextId={workspaceId}
    />
  );
  function openOutline(outlineId: string) {
    const match = outlineId.match(/^heading-(\d+)$/);
    if (!match) {
      return;
    }

    const headingIndex = Number.parseInt(match[1] || '', 10);
    if (!Number.isFinite(headingIndex)) {
      return;
    }

    const outlineSurface = document.querySelector(WORKSPACE_OUTLINE_SURFACE_SELECTOR);
    if (!(outlineSurface instanceof HTMLElement)) {
      return;
    }

    const headings = [
      ...outlineSurface.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'),
    ];
    const targetLabel = outlineItems.find((item) => item.id === outlineId)?.label?.trim();
    const targetHeading =
      (targetLabel
        ? headings.find((heading) => heading.textContent?.trim() === targetLabel)
        : null) || headings[headingIndex];
    if (!targetHeading) {
      return;
    }

    targetHeading.scrollIntoView({
      behavior: 'auto',
      block: 'start',
      inline: 'nearest',
    });

    window.requestAnimationFrame(() => {
      const scrollContainer =
        findOutlineScrollContainer(outlineSurface, targetHeading) ||
        outlineSurface.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
      if (!scrollContainer) {
        return;
      }

      const desiredOffset = 28;
      const relativeTop =
        targetHeading.getBoundingClientRect().top -
        scrollContainer.getBoundingClientRect().top;

      if (relativeTop <= desiredOffset + 4) {
        return;
      }

      scrollContainer.scrollBy({
        top: relativeTop - desiredOffset,
        behavior: 'auto',
      });
    });
  }

  return (
    <WorkspaceScreen
      actions={workspaceShellActions}
      assistantRail={assistantRail}
      currentVersionId={currentVersionId}
      deliverablePanel={deliverablePanel}
      deliverableType={deliverableType}
      goalDialog={goalDialog}
      paneOrder={paneOrder}
      renderSidebar={renderWorkspaceSidebar}
      subtitle={workspaceSubtitle}
      title={currentWorkspace?.title || t('workspace.projectTitleFallback')}
      titleNode={workspaceTitleNode}
      versionGuideDescription={t('guide.versionDescription')}
      versionGuideTitle={t('guide.versionTitle')}
      workspaceId={workspaceId}
      workspaceNotice={workspaceNotice}
    />
  );
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
    `Current result shape: ${getCanonicalDeliverableType(params.deliverableType)}`,
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

function describeWorkspaceState(params: {
  selectedVersion: WorkspaceViewData['selectedVersion'];
  deliverable: WorkspaceViewData['deliverable'];
  t: ReturnType<typeof useT>;
  currentStatus: WorkspaceCurrentStatusData | null;
}) {
  if (!params.deliverable) {
    return params.t('workspace.openProjectToContinue');
  }

  return describeWorkspaceStatusLabel(params);
}

function describeWorkspaceStatusLabel(params: {
  selectedVersion: WorkspaceViewData['selectedVersion'];
  deliverable: WorkspaceViewData['deliverable'];
  t: ReturnType<typeof useT>;
  currentStatus: WorkspaceCurrentStatusData | null;
}) {
  if (!params.deliverable) {
    return params.t('workspace.openProjectToContinue');
  }

  if (params.selectedVersion) {
    return params.selectedVersion.title;
  }

  return params.currentStatus?.statusTitle || params.t('workspace.liveDraft');
}
