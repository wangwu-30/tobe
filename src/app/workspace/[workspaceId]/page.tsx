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
  Sparkles,
  SlidersHorizontal,
  Square,
} from 'lucide-react';

import { ChatPanel } from '@/components/chat/chat-panel';
import { CommentSidebar } from '@/components/comments/comment-sidebar';
import { WebSelectionCommentTrigger } from '@/components/comments/web-selection-comment-trigger';
import { EditorWrapper } from '@/components/editor/editor-wrapper';
import { KnowledgePanel } from '@/components/knowledge/knowledge-panel';
import { AppShell } from '@/components/layout/app-shell';
import { FirstUseGuide } from '@/components/layout/first-use-guide';
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
import {
  getWorkspaceFileDisplayName,
  isPlateBackedWorkspaceFile,
} from '@/lib/workspace/file-presentation';
import { formatDeliverableTypeLabel } from '@/lib/workspace/deliverable-labels';
import { generateWorkspacePlan } from '@/lib/workspace/plan-client';
import { detectWorkspacePreviewCapability } from '@/lib/workspace/preview';
import { listProjectFolderPath } from '@/lib/workspace/project-summary';
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
import { DeliverableSidebar, type DeliverableOutlineItem } from '@/components/workspace/deliverable-sidebar';
import { AssistantRail } from '@/components/workspace/assistant-rail';
import { PlanPanel } from '@/components/workspace/plan-panel';
import { DeliverableVersionControls } from '@/components/workspace/deliverable-version-controls';
import { WorkspaceStarterDialog } from '@/components/workspace/workspace-starter-dialog';

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
type WorkspaceCreateContext = {
  projectFolderId: string | null;
  projectId: string | null;
  projectTitle: string | null;
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
  const [workspaceStarterOpen, setWorkspaceStarterOpen] = React.useState(false);
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
  const [isSwitchingDeliverableIntent, setIsSwitchingDeliverableIntent] =
    React.useState(false);
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
          deliverableTypeLabel: formatDeliverableTypeLabel(item.deliverableType, t),
          folderPathLabel,
          id: item.id,
          title: item.title,
        };
      }),
    [projectDeliverables, projectFolders, t]
  );

  const deliverableType: DeliverableType = deliverable?.deliverableType || 'document';
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
  const previewCapability = React.useMemo(
    () => {
      const nextFiles = currentVersion
        ? (workspaceView?.versionFiles || []).filter((file) => file.role === 'deliverable')
        : (workspaceView?.files || []).filter((file) => file.role === 'deliverable');
      return detectWorkspacePreviewCapability(nextFiles);
    },
    [currentVersion, workspaceView?.files, workspaceView?.versionFiles]
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
                {[option.folderPathLabel || null, option.deliverableTypeLabel]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : undefined;

  const loadWorkspace = React.useCallback(async () => {
    const query = new URLSearchParams();
    if (requestedConversationId) query.set('conversationId', requestedConversationId);
    if (requestedFileId) query.set('fileId', requestedFileId);
    if (requestedVersionId) query.set('versionId', requestedVersionId);

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
  }, [requestedConversationId, requestedFileId, requestedVersionId, workspaceId]);

  const loadRuns = React.useCallback(async () => {
    const response = await fetch(`/api/workspaces/${workspaceId}/runs`);
    if (!response.ok) return;

    setWorkspaceRuns((await response.json()) as WorkspaceRunData[]);
  }, [workspaceId]);

  const loadThreads = React.useCallback(async () => {
    const params = new URLSearchParams({ workspaceId });
    if (currentFileId) params.set('fileId', currentFileId);
    if (currentVersionId) {
      params.set('versionId', currentVersionId);
    } else {
      params.set('draftOnly', '1');
    }
    const response = await fetch(`/api/threads?${params.toString()}`);
    if (!response.ok) return;

    setReviewThreads((await response.json()) as CommentThreadData[]);
  }, [currentFileId, currentVersionId, workspaceId]);

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
    [currentFileId, isVersionView, workspaceId]
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

    const version = (await response.json()) as WorkspaceVersionData;
    syncLocation({ versionId: version.id });
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
    syncLocation,
    t,
    workspaceId,
  ]);

  const toggleRecoveryPointPin = React.useCallback(
    async (versionId: string, pinned: boolean) => {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/versions/${versionId}`,
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

      const version = (await response.json()) as WorkspaceVersionData;
      promptedRecoveryPointRef.current = version.id;
      await loadWorkspace();
      setWorkspaceNotice({
        tone: 'success',
        text: pinned
          ? t('workspace.pinnedRecoveryPoint', { title: version.title })
          : t('workspace.unpinnedRecoveryPoint', { title: version.title }),
      });
    },
    [loadWorkspace, t, workspaceId]
  );

  const restoreVersion = React.useCallback(
    async (versionId: string) => {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/versions/${versionId}/restore`,
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
        restoredVersion: WorkspaceVersionData;
      };
      syncLocation({ versionId: null });
      setWorkspaceNotice({
        tone: 'success',
        text: t('workspace.restoredVersion', {
          title: result.restoredVersion.title,
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
      });
    },
    [currentConversationId, syncLocation]
  );

  const continueConversationFromVersion = React.useCallback(
    async (version: WorkspaceVersionData) => {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/versions/${version.id}/continue`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            activeFileId: currentFileId,
            parentConversationId: currentConversationId,
            safetyCheckpointTitle: t('version.continueSafetyCheckpointTitle'),
            title: t('version.continueFromVersionTitle', {
              title: version.title,
            }),
          }),
        }
      );

      if (!response.ok) {
        setWorkspaceNotice({
          tone: 'error',
          text: t('version.continueFailed'),
        });
        return;
      }

      const nextState = (await response.json()) as {
        baseVersion: WorkspaceVersionData;
        conversation: { id: string };
      };
      syncLocation({
        conversationId: nextState.conversation.id,
        versionId: null,
      });
      setWorkspaceNotice({
        tone: 'success',
        text: t('workspace.continuedFromVersion', {
          title: nextState.baseVersion.title,
        }),
      });
    },
    [currentConversationId, currentFileId, syncLocation, t, workspaceId]
  );

  const switchConversationToVersionBranch = React.useCallback(
    async (version: WorkspaceVersionData) => {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/versions/${version.id}/switch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            activeFileId: currentFileId,
            parentConversationId: currentConversationId,
            safetyCheckpointTitle: t('version.switchBranchSafetyCheckpointTitle'),
            title: version.title,
          }),
        }
      );

      if (!response.ok) {
        setWorkspaceNotice({
          tone: 'error',
          text: t('version.switchBranchFailed'),
        });
        return;
      }

      const nextState = (await response.json()) as {
        baseVersion: WorkspaceVersionData;
        conversation: { id: string };
      };
      syncLocation({
        conversationId: nextState.conversation.id,
        versionId: null,
      });
      setWorkspaceNotice({
        tone: 'success',
        text: t('workspace.switchedToVersionHead', {
          title: nextState.baseVersion.title,
        }),
      });
    },
    [currentConversationId, currentFileId, syncLocation, t, workspaceId]
  );

  const startPreview = React.useCallback(async () => {
    setIsStartingPreview(true);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/preview/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          versionId: currentVersionId,
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
  }, [currentVersionId, loadRuns, t, workspaceId]);

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

  const openWorkspaceCreateEntry = React.useCallback(
    (context: WorkspaceCreateContext | null) => {
      setWorkspaceCreateContext(context);

      if (createWorkspaceRecoveryActive) {
        setGoalDialogSeedValues(null);
        setGoalDialogOpen(true);
        return;
      }

      setWorkspaceStarterOpen(true);
    },
    [createWorkspaceRecoveryActive]
  );
  const openProjectDeliverableComposer = React.useCallback(
    (params: {
      deliverableType?: DeliverableType;
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
        setGoalDialogSeedValues(null);
        setGoalDialogOpen(true);
        return;
      }

      setWorkspaceStarterOpen(false);
      setGoalDialogSeedValues({
        deliverableType: params.deliverableType || deliverableType,
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
      deliverableType,
    ]
  );

  const createWorkspaceFromGoal = React.useCallback(
    async (values: GoalComposerValues) => {
      if (createWorkspaceInFlightRef.current) return;

      createWorkspaceInFlightRef.current = true;
      setCreateWorkspaceError(null);
      setIsCreatingWorkspace(true);

      if (!createWorkspaceRequestIdRef.current) {
        createWorkspaceRequestIdRef.current = crypto.randomUUID();
      }

      const createFailureCopyKey = workspaceCreateContext?.projectId
        ? 'goal.createDeliverableFailed'
        : 'goal.createProjectFailed';
      const createRetryCopyKey = workspaceCreateContext?.projectId
        ? 'goal.createDeliverableRetryUnknown'
        : 'goal.createProjectRetryUnknown';

      try {
        const response = await fetch('/api/workspaces', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [WORKSPACE_CREATE_IDEMPOTENCY_HEADER]: createWorkspaceRequestIdRef.current,
            ...getStoredAISettingsHeader(),
          },
          body: JSON.stringify({
            ...values,
            ...(workspaceCreateContext
              ? {
                  projectFolderId: workspaceCreateContext.projectFolderId,
                  projectId: workspaceCreateContext.projectId,
                  projectTitle: workspaceCreateContext.projectTitle,
                }
              : {}),
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          clearWorkspaceCreateRecovery();
          setCreateWorkspaceRecoveryActive(false);
          setCreateWorkspaceRecoveryValues(null);
          createWorkspaceRequestIdRef.current = null;
          setCreateWorkspaceError(payload?.error || t(createFailureCopyKey));
          return;
        }

        const result = await response.json();
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
      } catch {
        const recovery = {
          context: workspaceCreateContext
            ? {
                projectFolderId: workspaceCreateContext.projectFolderId,
                projectId: workspaceCreateContext.projectId,
                projectTitle: workspaceCreateContext.projectTitle,
              }
            : undefined,
          requestId: createWorkspaceRequestIdRef.current || crypto.randomUUID(),
          values,
        };
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
      deliverableType,
      projectFolderId: currentWorkspace?.projectFolderId || null,
      workflowPlaybookId: workspaceBrief?.activeWorkflowPlaybookId || '',
    });
  }, [
    currentWorkspace?.projectFolderId,
    deliverableType,
    openProjectDeliverableComposer,
    workspaceBrief?.activeWorkflowPlaybookId,
  ]);
  const applyWorkflowPlaybook = React.useCallback(
    async (workflowPlaybookId: string | null) => {
      const response = await fetch(`/api/workspaces/${workspaceId}/plan`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          activeWorkflowPlaybookId: workflowPlaybookId,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload) {
        throw new Error(payload?.error || t('context.workflowApplyFailed'));
      }

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
      const response = await fetch(`/api/workspaces/${workspaceId}/files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          kind: params.kind,
          name: params.name,
          nodeType: params.nodeType,
          parentId: params.parentId,
          role: 'support',
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.id) {
        setWorkspaceNotice({
          tone: 'error',
          text: payload?.error || t('sidebar.createSupportMaterialFailed'),
        });
        return null;
      }

      return payload as { id: string };
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
      const response = await fetch(`/api/workspaces/${workspaceId}/files/${fileId}`, {
        method: 'DELETE',
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setWorkspaceNotice({
          tone: 'error',
          text: payload?.error || t('sidebar.deleteSupportMaterialFailed'),
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
      const response = await fetch(`/api/workspaces/${workspaceId}/files/${fileId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || t('sidebar.renameSupportMaterialFailed'));
      }

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
      const response = await fetch(`/api/workspaces/${workspaceId}/files/${fileId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parentId,
          sortOrder,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || t('sidebar.moveSupportMaterialFailed'));
      }

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

  const handleWorkspaceStarterSelect = React.useCallback(
    (deliverableType: GoalComposerValues['deliverableType']) => {
      setWorkspaceStarterOpen(false);
      setGoalDialogSeedValues({
        deliverableType,
        projectParentPath: '',
      });
      setGoalDialogOpen(true);
    },
    []
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

      const response = await fetch(`/api/projects/${projectId}/folders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parentId: parentFolderId,
          title: t('sidebar.newProjectFolderDefaultName'),
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setWorkspaceNotice({
          tone: 'error',
          text: payload?.error || t('sidebar.createProjectFolderFailed'),
        });
        return;
      }

      await loadWorkspace();
    },
    [currentProjectId, currentWorkspace?.id, currentWorkspace?.projectId, loadWorkspace, t]
  );
  const renameProjectFolder = React.useCallback(
    async (folderId: string, title: string) => {
      const projectId = currentProjectId || currentWorkspace?.projectId || currentWorkspace?.id || null;
      if (!projectId) {
        throw new Error(t('sidebar.renameProjectFolderFailed'));
      }

      const response = await fetch(`/api/projects/${projectId}/folders/${folderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || t('sidebar.renameProjectFolderFailed'));
      }

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

      const response = await fetch(`/api/projects/${projectId}/folders/${folderId}`, {
        method: 'DELETE',
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setWorkspaceNotice({
          tone: 'error',
          text: payload?.error || t('sidebar.deleteProjectFolderFailed'),
        });
        return;
      }

      await loadWorkspace();
    },
    [currentProjectId, currentWorkspace?.id, currentWorkspace?.projectId, loadWorkspace, t]
  );
  const renameDeliverable = React.useCallback(
    async (targetWorkspaceId: string, title: string) => {
      const response = await fetch(`/api/workspaces/${targetWorkspaceId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || t('workspace.renameDeliverableFailed'));
      }

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
      const response = await fetch(`/api/workspaces/${targetWorkspaceId}`, {
        method: 'DELETE',
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setWorkspaceNotice({
          tone: 'error',
          text: payload?.error || t('workspace.deleteDeliverableFailed'),
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
      const response = await fetch(`/api/workspaces/${targetWorkspaceId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectFolderId,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || t('sidebar.moveDeliverableFailed'));
      }

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

      const response = await fetch(`/api/workspaces/${targetWorkspaceId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          treeSortOrder: nextTreeSortOrder,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || t('sidebar.moveDeliverableFailed'));
      }

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

      const response = await fetch(`/api/projects/${projectId}/folders/${folderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parentId: parentFolderId,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || t('sidebar.moveProjectFolderFailed'));
      }

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

      const response = await fetch(`/api/projects/${projectId}/folders/${folderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          treeSortOrder: nextTreeSortOrder,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || t('sidebar.moveProjectFolderFailed'));
      }

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

  const handleChangeDeliverableIntent = React.useCallback(
    async (nextDeliverableType: DeliverableType) => {
      if (!workspaceId || nextDeliverableType === 'code') {
        return;
      }

      setIsSwitchingDeliverableIntent(true);
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/plan`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deliverableType: nextDeliverableType,
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || 'Could not change deliverable type.');
        }

        await loadWorkspace();
        setShowImplementation(false);
        setWorkspaceNotice({
          tone: 'info',
          text: t('workspace.deliverableTypeChanged', {
            label: formatDeliverableTypeLabel(nextDeliverableType, t),
          }),
        });
      } catch (error) {
        setWorkspaceNotice({
          tone: 'error',
          text:
            error instanceof Error
              ? error.message
              : 'Could not change deliverable type.',
        });
      } finally {
        setIsSwitchingDeliverableIntent(false);
      }
    },
    [loadWorkspace, t, workspaceId]
  );

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
        <PlanPanel
          currentDraftBranchTitle={currentDraftBaseVersion?.title || null}
          isAssistantBusy={isAssistantBusy}
          isSwitchingDeliverableIntent={isSwitchingDeliverableIntent}
          onChangeDeliverableIntent={handleChangeDeliverableIntent}
          onCreateNextDeliverable={createNextDeliverableWithWorkflow}
          onRegenerateWithIntent={handleGenerateFirstPass}
          plan={workspaceBrief}
          currentStatus={currentStatus}
        />
      }
      review={
        <CommentSidebar
          allowSourceApply={!currentVersionId}
          className="border-0"
          documentId={workspaceId}
          documentContent={commentContextContent}
          embedded
          files={workspaceView?.files || []}
          onOpenChange={() => undefined}
          onOpenFile={handleOpenWorkspaceFile}
          onSourceContentApplied={async () => {
            await loadWorkspace();
          }}
          refreshThreads={loadThreads}
          showHeader={false}
          threads={reviewThreads}
        />
      }
      chat={
        <ChatPanel
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
          showHeader={false}
          workspaceId={workspaceId}
        />
      }
      context={
        <KnowledgePanel
          activeWorkflowPlaybookId={workspaceBrief?.activeWorkflowPlaybookId || null}
          embedded
          isOpen
          onClose={() => undefined}
          onApplyWorkflow={workspaceId ? applyWorkflowPlaybook : undefined}
          showHeader={false}
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
    previewEmptyDescription: t('workspace.previewReadyDescription'),
    previewEmptyTitle: t('workspace.previewReadyTitle'),
    previewNotReadyTitle: t('workspace.previewNotReady'),
    previewUnavailableDescription: t('workspace.previewUnavailableReason'),
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
  const openOutline = React.useCallback((outlineId: string) => {
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
  }, [outlineItems]);

  return (
    <AppShell
      currentWorkspaceId={workspaceId}
      renderSidebar={({ collapsed, onNavigate }) => (
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
          onDeleteWorkspace={async (projectId) => {
            const response = await fetch(`/api/projects/${projectId}`, {
              method: 'DELETE',
            });
            if (!response.ok) {
              setWorkspaceNotice({
                tone: 'error',
                text: t('workspace.deleteFailed'),
              });
              return;
            }
            if (projectId === currentProjectId) {
              router.push('/');
            }
          }}
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
              : (fileId, parentId, sortOrder) =>
                  void moveSupportFile(fileId, parentId, sortOrder)
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
          onRenameWorkspace={async (projectId, title) => {
            const response = await fetch(`/api/projects/${projectId}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ title }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
              throw new Error(payload?.error || t('workspace.renameFailed'));
            }
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
          }}
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
      )}
      subtitle={workspaceSubtitle}
      title={currentWorkspace?.title || t('workspace.projectTitleFallback')}
      titleNode={workspaceTitleNode}
      actions={
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

        {currentVersionId ? (
          <div className="px-4 pt-4">
            <FirstUseGuide
              description={t('guide.versionDescription')}
              guideId="version-surface"
              testId="first-use-guide-version"
              title={t('guide.versionTitle')}
              variant="compact"
            />
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

      <WorkspaceStarterDialog
        open={workspaceStarterOpen}
        onOpenChange={setWorkspaceStarterOpen}
        onSelect={handleWorkspaceStarterSelect}
      />

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
    </AppShell>
  );
}

function buildDeliverablePanel(params: {
  commentContextContent: string;
  currentFile: WorkspaceViewData['currentFile'];
  selectedVersion: WorkspaceViewData['selectedVersion'];
  currentText: string;
  draftRevision: number | null;
  deliverableTitle: string;
  deliverableType: DeliverableType;
  documentPlaceholder: string;
  editorContent: Value | null;
  fileContent: string;
  headerActions: React.ReactNode;
  isAssistantBusy: boolean;
  isReadOnly: boolean;
  isSavingTextFile: boolean;
  isStartingPreview: boolean;
  isStoppingPreview: boolean;
  noDocumentDescription: string;
  noDocumentTitle: string;
  openPreviewLabel: string;
  onChange: (content: string) => void;
  onGenerateFirstPass: () => void;
  onStartPreview: () => void;
  onStopPreview: () => void;
  previewCapability: ReturnType<typeof detectWorkspacePreviewCapability>;
  previewEmptyDescription: string;
  previewEmptyTitle: string;
  previewNotReadyTitle: string;
  previewUnavailableDescription: string;
  previewUrl: string | null;
  readOnlyLabel: string;
  supportMaterialLabel: string;
  onRestoreLatest?: (() => void) | undefined;
  onThreadsChanged: () => Promise<void>;
  savingLabel: string;
  showImplementation: boolean;
  startPreviewLabel: string;
  startingLabel: string;
  stopPreviewLabel: string;
  stoppingLabel: string;
  versionActionLabel: string;
  currentStatus: WorkspaceCurrentStatusData | null;
  chatError: {
    error: { detail: string; message: string; retryable: boolean; kind: string };
    retryFn?: () => void;
  } | null;
  t: ReturnType<typeof useT>;
  workspaceId: string;
}) {
  const isSupportFile = params.currentFile?.role === 'support';
  const richtextLikeFile = isPlateBackedWorkspaceFile(params.currentFile);
  const isErrorState = !params.selectedVersion && !!params.chatError;
  const statusTitle = isErrorState
    ? params.chatError!.error.message
    : params.currentStatus?.statusTitle || params.noDocumentTitle;
  const statusDescription = isErrorState
    ? params.chatError!.error.detail
    : params.currentStatus?.statusDescription || params.noDocumentDescription;
  const errorAction = isErrorState && params.chatError?.retryFn ? (
    <Button size="sm" onClick={params.chatError.retryFn}>
      {params.t ? params.t('chat.retry') : 'Retry'}
    </Button>
  ) : undefined;

  const showIntentCanvas =
    !isSupportFile &&
    !params.showImplementation &&
    (params.deliverableType === 'slides' || params.deliverableType === 'web');
  const editorStatusTone = params.selectedVersion
    ? 'locked'
    : params.currentStatus?.phase === 'blocked'
      ? 'blocked'
      : params.currentStatus?.phase === 'reviewing' ||
          params.currentStatus?.phase === 'preview_ready' ||
          params.currentStatus?.phase === 'preview_running' ||
          params.currentStatus?.phase === 'finalized'
        ? 'reviewing'
        : 'draft';
  const editorStatusLabel = params.selectedVersion
    ? undefined
    : params.currentStatus?.statusTitle || undefined;
  const surfaceTitle =
    isSupportFile && params.currentFile
      ? getWorkspaceFileDisplayName(params.currentFile)
      : params.deliverableTitle;
  const showActivitySurface =
    !isSupportFile &&
    !params.selectedVersion &&
    !params.currentText.trim() &&
    (params.currentStatus?.phase === 'planning' || params.currentStatus?.phase === 'implementing');
  const canStartFirstPass =
    !isErrorState &&
    !params.selectedVersion &&
    params.currentStatus?.primaryAction === 'generate_first_pass';
  const activityVariant =
    params.currentStatus?.phase === 'implementing' || params.isAssistantBusy
      ? 'working'
      : 'idle';
  const firstPassAction = canStartFirstPass ? (
    <Button size="sm" onClick={params.onGenerateFirstPass} disabled={params.isAssistantBusy}>
      {params.isAssistantBusy ? params.t('plan.aiDrafting') : params.t('plan.firstPassAction')}
    </Button>
  ) : undefined;

  if (showIntentCanvas && params.deliverableType === 'web') {
    return (
      <WebDeliverableCanvas
        actions={params.headerActions}
        currentStatus={params.currentStatus}
        draftRevision={params.draftRevision}
        documentContent={params.commentContextContent}
        fileId={params.currentFile?.id || null}
        isAssistantBusy={params.isAssistantBusy}
        isStartingPreview={params.isStartingPreview}
        isStoppingPreview={params.isStoppingPreview}
        onGenerateFirstPass={params.onGenerateFirstPass}
        onStartPreview={params.onStartPreview}
        onStopPreview={params.onStopPreview}
        previewCapability={params.previewCapability}
        previewEmptyDescription={params.previewEmptyDescription}
        previewEmptyTitle={params.previewEmptyTitle}
        previewNotReadyTitle={params.previewNotReadyTitle}
        previewUnavailableDescription={params.previewUnavailableDescription}
        previewUrl={params.previewUrl}
        onRestoreLatest={params.onRestoreLatest}
        onThreadsChanged={params.onThreadsChanged}
        versionId={params.selectedVersion?.id || null}
        startPreviewLabel={params.startPreviewLabel}
        startingLabel={params.startingLabel}
        stopPreviewLabel={params.stopPreviewLabel}
        stoppingLabel={params.stoppingLabel}
        subtitle={params.readOnlyLabel}
        title={params.deliverableTitle}
        workspaceId={params.workspaceId}
        chatError={params.chatError}
      />
    );
  }

  if (showIntentCanvas && params.deliverableType === 'slides') {
    return (
      <SlidesDeliverableCanvas
        actions={params.headerActions}
        currentStatus={params.currentStatus}
        isAssistantBusy={params.isAssistantBusy}
        onGenerateFirstPass={params.onGenerateFirstPass}
        text={params.currentText}
        subtitle={params.readOnlyLabel}
        title={params.deliverableTitle}
      />
    );
  }

  if (richtextLikeFile && params.currentFile) {
    if (showActivitySurface || isErrorState) {
      return (
        <RenderingDeliverableCanvas
          actions={params.headerActions}
          action={errorAction || firstPassAction}
          statusDescription={statusDescription}
          statusTitle={statusTitle}
          subtitle={params.readOnlyLabel}
          title={surfaceTitle}
          variant={isErrorState ? 'idle' : activityVariant}
        />
      );
    }

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
        showCommentAction={false}
        showVersionControls={false}
        versionId={params.selectedVersion?.id || null}
        draftRevision={params.selectedVersion ? null : params.draftRevision}
        status={params.selectedVersion ? 'locked' : 'draft'}
        statusLabel={editorStatusLabel}
        statusTone={editorStatusTone}
        title={surfaceTitle}
        emptyDescription={params.noDocumentDescription}
        emptyTitle={params.noDocumentTitle}
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
      subtitle={isSupportFile ? params.supportMaterialLabel : params.readOnlyLabel}
      title={getWorkspaceFileDisplayName(params.currentFile) || params.deliverableTitle}
    />
  );
}

function RenderingDeliverableCanvas({
  actions,
  action,
  statusDescription,
  statusTitle,
  subtitle,
  title,
  variant = 'working',
}: {
  actions: React.ReactNode;
  action?: React.ReactNode;
  statusDescription: string;
  statusTitle: string;
  subtitle: string;
  title: string;
  variant?: 'idle' | 'working';
}) {
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-testid="rendering-deliverable-canvas"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div>
      </div>

      <DeliverableActivityState
        action={action}
        description={statusDescription}
        title={statusTitle}
        variant={variant}
      />
    </div>
  );
}

function SlidesDeliverableCanvas({
  actions,
  currentStatus,
  isAssistantBusy,
  onGenerateFirstPass,
  subtitle,
  text,
  title,
}: {
  actions: React.ReactNode;
  currentStatus: WorkspaceCurrentStatusData | null;
  isAssistantBusy: boolean;
  onGenerateFirstPass: () => void;
  subtitle: string;
  text: string;
  title: string;
}) {
  const t = useT();
  const slides = React.useMemo(() => buildSlidesPreviewCards(text, title), [text, title]);
  const hasSlides = slides.length > 0;
  const statusTitle = hasSlides
    ? currentStatus?.statusTitle || t('workspace.slidesPreviewTitle')
    : currentStatus?.statusTitle || t('workspace.slidesEmptyTitle');
  const statusDescription = hasSlides
    ? currentStatus?.statusDescription || t('workspace.slidesPreviewDescription')
    : currentStatus?.statusDescription || t('workspace.slidesEmptyDescription');
  const showGenerateFirstPassAction = currentStatus?.primaryAction === 'generate_first_pass';

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-testid="slides-deliverable-canvas"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div>
      </div>

      {hasSlides ? (
        <div className="min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.06),_transparent_55%)] px-5 py-5">
          <div className="mx-auto flex max-w-6xl flex-col gap-4">
            <div className="rounded-[28px] border border-primary/15 bg-background/95 px-5 py-5 shadow-[0_24px_70px_-40px_rgba(15,23,42,0.45)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-primary/15 bg-primary/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-primary/80">
                  {t('goal.slides')}
                </span>
                <span className="text-sm font-medium text-foreground">{statusTitle}</span>
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                {statusDescription}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {slides.map((slide, index) => (
                <section
                  key={slide.id}
                  className="flex min-h-64 flex-col rounded-[28px] border border-border/70 bg-background/95 px-5 py-5 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)]"
                >
                  <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                    {t('workspace.slideCardLabel', { index: index + 1 })}
                  </div>
                  <h3 className="mt-4 text-xl font-semibold leading-tight text-foreground">
                    {slide.title}
                  </h3>
                  <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
                    {slide.body.length > 0 ? (
                      slide.body.map((paragraph, paragraphIndex) => (
                        <p key={`${slide.id}-${paragraphIndex}`}>{paragraph}</p>
                      ))
                    ) : (
                      <p>{t('workspace.slidesCardEmpty')}</p>
                    )}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <DeliverableActivityState
          action={
            showGenerateFirstPassAction ? (
              <Button size="sm" onClick={onGenerateFirstPass} disabled={isAssistantBusy}>
                {isAssistantBusy ? t('plan.aiDrafting') : t('plan.firstPassAction')}
              </Button>
            ) : undefined
          }
          description={statusDescription}
          title={statusTitle}
          variant={showGenerateFirstPassAction ? 'idle' : 'working'}
        />
      )}
    </div>
  );
}

function WebDeliverableCanvas({
  actions,
  currentStatus,
  draftRevision,
  documentContent,
  fileId,
  isAssistantBusy,
  isStartingPreview,
  isStoppingPreview,
  onGenerateFirstPass,
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
  versionId,
  startPreviewLabel,
  startingLabel,
  stopPreviewLabel,
  stoppingLabel,
  subtitle,
  title,
  workspaceId,
  chatError,
}: {
  actions: React.ReactNode;
  currentStatus: WorkspaceCurrentStatusData | null;
  draftRevision?: number | null;
  documentContent: string;
  fileId?: string | null;
  isAssistantBusy: boolean;
  isStartingPreview: boolean;
  isStoppingPreview: boolean;
  onGenerateFirstPass: () => void;
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
  versionId?: string | null;
  startPreviewLabel: string;
  startingLabel: string;
  stopPreviewLabel: string;
  stoppingLabel: string;
  subtitle: string;
  title: string;
  workspaceId: string;
  chatError: {
    error: { detail: string; message: string; retryable: boolean; kind: string };
    retryFn?: () => void;
  } | null;
}) {
  const t = useT();
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const isErrorState = !!chatError;
  const statusTitle = isErrorState
    ? chatError!.error.message
    : currentStatus?.statusTitle ||
      (previewCapability.canPreview ? previewEmptyTitle : previewNotReadyTitle);
  const statusDescription = isErrorState
    ? chatError!.error.detail
    : currentStatus?.blockedReason ||
      currentStatus?.statusDescription ||
      (previewCapability.canPreview
        ? previewEmptyDescription
        : previewUnavailableDescription);
  const showStartPreviewAction =
    !isErrorState &&
    !previewUrl &&
    previewCapability.canPreview &&
    currentStatus?.primaryAction === 'start_preview';
  const showGenerateFirstPassAction =
    !isErrorState &&
    !previewUrl &&
    currentStatus?.primaryAction === 'generate_first_pass';
  const showRestoreAction =
    !isErrorState &&
    !previewUrl &&
    currentStatus?.primaryAction === 'restore_latest' &&
    onRestoreLatest;
  const errorAction = isErrorState && chatError?.retryFn ? (
    <Button size="sm" onClick={chatError.retryFn}>{t('chat.retry')}</Button>
  ) : null;

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="web-deliverable-canvas"
    >
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
              draftRevision={draftRevision}
              documentContent={documentContent}
              fileId={fileId}
              iframeRef={iframeRef}
              onThreadsChanged={onThreadsChanged}
              versionId={versionId}
              workspaceId={workspaceId}
            />
          </div>
        ) : (
          <DeliverableActivityState
            action={
              errorAction ? errorAction : showStartPreviewAction ? (
                <Button
                  size="sm"
                  onClick={onStartPreview}
                  disabled={isStartingPreview}
                >
                  {isStartingPreview ? startingLabel : startPreviewLabel}
                </Button>
              ) : showGenerateFirstPassAction ? (
                <Button size="sm" onClick={onGenerateFirstPass} disabled={isAssistantBusy}>
                  {isAssistantBusy ? t('plan.aiDrafting') : t('plan.firstPassAction')}
                </Button>
              ) : showRestoreAction ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onRestoreLatest}
                >
                  {t('version.restore')}
                </Button>
              ) : null
            }
            description={statusDescription}
            title={statusTitle}
            variant={showGenerateFirstPassAction ? 'idle' : 'working'}
          />
        )}
      </div>
    </div>
  );
}

function DeliverableActivityState({
  action,
  description,
  title,
  variant = 'working',
}: {
  action?: React.ReactNode;
  description: string;
  title: string;
  variant?: 'idle' | 'working';
}) {
  return (
    <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.06),_transparent_55%)] px-8 py-10">
      <div className="w-full max-w-2xl rounded-[32px] border border-primary/15 bg-background/95 p-8 shadow-[0_24px_70px_-40px_rgba(15,23,42,0.45)]">
        <div className="flex flex-col items-center text-center">
          <div className="relative flex h-16 w-16 items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-primary/15" />
            {variant === 'working' ? (
              <>
                <div className="absolute inset-0 rounded-full border border-primary/25 animate-ping [animation-duration:2.8s]" />
                <div className="absolute inset-2 rounded-full bg-primary/8 animate-pulse" />
                <LoaderCircle className="relative h-7 w-7 animate-spin text-primary" />
              </>
            ) : (
              <>
                <div className="absolute inset-2 rounded-full bg-primary/8" />
                <Sparkles className="relative h-7 w-7 text-primary" />
              </>
            )}
          </div>
          <p className="mt-5 text-lg font-semibold text-foreground">{title}</p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
          {action && variant === 'idle' ? (
            <div className="mt-6 flex justify-center">{action}</div>
          ) : null}
        </div>

        <div className="mt-8 space-y-3">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="overflow-hidden rounded-2xl border border-border/70 bg-muted/25 px-4 py-4"
            >
              <div
                className={cn(
                  'h-2.5 rounded-full',
                  variant === 'working'
                    ? 'bg-gradient-to-r from-primary/10 via-primary/30 to-primary/10 animate-pulse'
                    : 'bg-muted-foreground/10'
                )}
                style={{
                  animationDelay: `${index * 180}ms`,
                  width: `${92 - index * 14}%`,
                }}
              />
              <div
                className={cn(
                  'mt-3 h-2 rounded-full bg-muted-foreground/10',
                  variant === 'working' && 'animate-pulse'
                )}
                style={{
                  animationDelay: `${index * 220 + 120}ms`,
                  width: `${70 - index * 8}%`,
                }}
              />
            </div>
          ))}
        </div>

        {action && variant === 'working' ? (
          <div className="mt-6 flex justify-center">{action}</div>
        ) : null}
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
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="source-deliverable-canvas"
    >
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

type SlidePreviewCard = {
  body: string[];
  id: string;
  title: string;
};

function buildSlidesPreviewCards(text: string, fallbackTitle: string): SlidePreviewCard[] {
  const slides: SlidePreviewCard[] = [];
  let current: { body: string[]; title: string } | null = null;

  const commitCurrent = () => {
    if (!current) {
      return;
    }

    const normalizedBody = current.body
      .map((line) => normalizeSlidesPreviewLine(line))
      .filter(Boolean);
    const normalizedTitle = normalizeSlidesPreviewLine(current.title) || fallbackTitle;

    if (!normalizedTitle && normalizedBody.length === 0) {
      current = null;
      return;
    }

    slides.push({
      body: normalizedBody,
      id: `slide-${slides.length}`,
      title: normalizedTitle || fallbackTitle,
    });
    current = null;
  };

  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      commitCurrent();
      current = {
        body: [],
        title: headingMatch[2].trim(),
      };
      continue;
    }

    if (!current) {
      current = {
        body: [],
        title: fallbackTitle,
      };
    }

    current.body.push(trimmed);
  }

  commitCurrent();

  return slides;
}

function normalizeSlidesPreviewLine(line: string) {
  return line
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^>\s+/, '')
    .trim();
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
  const shouldParseHeadings =
    params.deliverableType === 'document' || params.currentFile?.role === 'support';

  if (!shouldParseHeadings) {
    return [
      {
        depth: 0,
        id: params.currentFile?.id || 'deliverable',
        label: getWorkspaceFileDisplayName(params.currentFile) || params.deliverableTitle,
      },
    ];
  }

  const headings = params.text
    .split('\n')
    .map((line) => {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (!match) {
        return null;
      }

      return {
        depth: Math.max(0, match[1].length - 1),
        label: match[2].trim(),
      };
    })
    .filter((item): item is Omit<DeliverableOutlineItem, 'id'> => Boolean(item))
    .map((item, index) => ({
      ...item,
      id: `heading-${index}`,
    }));

  if (headings.length === 0) {
    return [
      {
        depth: 0,
        id: params.currentFile?.id || 'deliverable',
        label: getWorkspaceFileDisplayName(params.currentFile) || params.deliverableTitle,
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

function describeWorkspaceState(params: {
  selectedVersion: WorkspaceViewData['selectedVersion'];
  deliverable: WorkspaceViewData['deliverable'];
  t: ReturnType<typeof useT>;
  currentStatus: WorkspaceCurrentStatusData | null;
}) {
  if (!params.deliverable) {
    return params.t('workspace.openProjectToContinue');
  }

  return `${describeWorkspaceStatusLabel(params)} · ${formatDeliverableTypeLabel(
    params.deliverable.deliverableType,
    params.t
  )}`;
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
