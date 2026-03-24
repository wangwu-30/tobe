'use client';

import * as React from 'react';
import type { Value } from 'platejs';
import dynamic from 'next/dynamic';

import {
  buildOutlineItems,
  normalizeDeliverableText,
  parsePlateContent,
} from '@/canvas/document-canvas/document-canvas';
import { plateToMarkdown } from '@/lib/ai/serializer';
import { useT } from '@/components/providers/language-provider';
import {
  useAppParams,
  useAppRouter,
  useAppSearchParams,
} from '@/lib/app-router';
import { isPlateBackedWorkspaceFile } from '@/lib/workspace/file-presentation';
import {
  detectWorkspacePreviewCapability,
  resolveWebPreviewAnchorFile,
} from '@/lib/workspace/preview';
import { listProjectFolderPath } from '@/lib/workspace/project-summary';
import {
  buildWorkspaceRoute,
  WORKSPACE_AUTO_START_FIRST_PASS_PARAM,
  WORKSPACE_NODE_SEARCH_PARAM,
} from '@/lib/workspace/route';
import type {
  ChatMessageData,
  CommentThreadData,
  DeliverableType,
  WorkspaceWorkflowStatusData,
  WorkspaceRunData,
  WorkspaceViewData,
} from '@/types';
import { WorkspaceAssistantRail } from '@/surfaces/workspace/workspace-assistant-rail';
import { WorkspaceDeliverablePanel } from '@/surfaces/workspace/workspace-deliverable-panel';
import { useWorkspaceFileSaveController } from '@/surfaces/workspace/use-workspace-file-save-controller';
import { useWorkspaceGoalDialogController } from '@/surfaces/workspace/use-workspace-goal-dialog-controller';
import { WorkspaceHeaderVersionControls } from '@/surfaces/workspace/workspace-header-version-controls';
import { useWorkspaceOutlineNavigation } from '@/surfaces/workspace/use-workspace-outline-navigation';
import { useWorkspaceRouteController } from '@/surfaces/workspace/use-workspace-route-controller';
import { useWorkspaceShellController } from '@/surfaces/workspace/use-workspace-shell-controller';
import { WorkspaceRouteTitle } from '@/surfaces/workspace/workspace-route-chrome';
import { WorkspaceRouteSidebar } from '@/surfaces/workspace/workspace-route-sidebar';
import { useWorkspaceSidebarActions } from '@/surfaces/workspace/use-workspace-sidebar-actions';
import { useWorkspaceVersionPreviewController } from '@/surfaces/workspace/use-workspace-version-preview-controller';
import { WorkspaceShellActions } from '@/surfaces/workspace/workspace-shell-actions';
import { WorkspaceScreen } from '@/surfaces/workspace/workspace-screen';

type SurfaceMode = 'editor' | 'overview';

const ProjectCanvasLoader = dynamic(
  () =>
    import('@/canvas/project-canvas/project-canvas-loader').then((mod) => ({
      default: mod.ProjectCanvasLoader,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
        Loading canvas...
      </div>
    ),
  }
);

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
const EMPTY_PROJECT_FOLDERS: WorkspaceViewData['projectFolders'] = [];
const EMPTY_PROJECT_DELIVERABLES: WorkspaceViewData['projectDeliverables'] = [];

export default function WorkspacePage() {
  const t = useT();
  const params = useAppParams<{ workspaceId: string }>();
  const router = useAppRouter();
  const searchParams = useAppSearchParams();
  const routeProjectId = params.workspaceId as string;
  const requestedNodeId = searchParams.get(WORKSPACE_NODE_SEARCH_PARAM);
  const workspaceId = requestedNodeId || routeProjectId;
  const requestedConversationId = searchParams.get('conversationId');
  const requestedFileId = searchParams.get('fileId');
  const requestedVersionId = searchParams.get('versionId');
  const shouldAutoStartFirstPass =
    searchParams.get(WORKSPACE_AUTO_START_FIRST_PASS_PARAM) === '1';

  const [workspaceView, setWorkspaceView] = React.useState<WorkspaceViewData | null>(null);
  const [initialMessages, setInitialMessages] = React.useState<ChatMessageData[]>([]);
  const [reviewThreads, setReviewThreads] = React.useState<CommentThreadData[]>([]);
  const [editorContent, setEditorContent] = React.useState<Value | null>(null);
  const [fileContent, setFileContent] = React.useState('');
  const [isSavingTextFile, setIsSavingTextFile] = React.useState(false);
  const [isStartingPreview, setIsStartingPreview] = React.useState(false);
  const [isStoppingPreview, setIsStoppingPreview] = React.useState(false);
  const [showImplementation, setShowImplementation] = React.useState(false);
  const [surfaceMode, setSurfaceMode] = React.useState<SurfaceMode>('editor');
  const [workspaceNotice, setWorkspaceNotice] = React.useState<WorkspaceNotice | null>(
    null
  );
  const [workspaceRuns, setWorkspaceRuns] = React.useState<WorkspaceRunData[]>([]);
  const [isAssistantBusy, setIsAssistantBusy] = React.useState(false);
  const [chatError, setChatError] = React.useState<{
    error: { detail: string; message: string; retryable: boolean; kind: string };
    retryFn?: () => void;
  } | null>(null);
  const promptedRecoveryPointRef = React.useRef<string | null>(null);
  const autoStartedFirstPassRef = React.useRef<string | null>(null);

  const routeWorkspaceView = React.useMemo(
    () =>
      workspaceView?.workspace?.id === workspaceId
        ? workspaceView
        : null,
    [workspaceId, workspaceView]
  );
  const currentWorkspace = routeWorkspaceView?.workspace || null;
  const currentProject = routeWorkspaceView?.currentProject || null;
  const currentConversation = routeWorkspaceView?.currentConversation || null;
  const {
    createNextDeliverableWithWorkflow,
    goalDialog,
    openProjectDeliverableComposer,
    openWorkspaceCreateEntry,
  } = useWorkspaceGoalDialogController({
    activeWorkflowPlaybookId:
      routeWorkspaceView?.workspacePlan?.activeWorkflowPlaybookId || null,
    currentConversationId:
      routeWorkspaceView?.currentConversation?.id || requestedConversationId || null,
    currentProject,
    currentWorkspace,
    workspaceId,
  });
  const projectFolders = React.useMemo(
    () => routeWorkspaceView?.projectFolders || EMPTY_PROJECT_FOLDERS,
    [routeWorkspaceView?.projectFolders]
  );
  const projectDeliverables = React.useMemo(
    () => routeWorkspaceView?.projectDeliverables || EMPTY_PROJECT_DELIVERABLES,
    [routeWorkspaceView?.projectDeliverables]
  );
  const currentFile = routeWorkspaceView?.currentFile || null;
  const currentVersion = routeWorkspaceView?.selectedVersion || null;
  const currentDraftBaseVersionId = React.useMemo(
    () => {
      const persistedDraftBaseVersionId =
        routeWorkspaceView?.workspace?.draftBaseVersionId || null;
      if (
        persistedDraftBaseVersionId &&
        (routeWorkspaceView?.versions || []).some(
          (version) => version.id === persistedDraftBaseVersionId
        )
      ) {
        return persistedDraftBaseVersionId;
      }

      return (routeWorkspaceView?.visibleVersions || [])[0]?.id || null;
    },
    [
      routeWorkspaceView?.versions,
      routeWorkspaceView?.visibleVersions,
      routeWorkspaceView?.workspace?.draftBaseVersionId,
    ]
  );
  const currentConversationBaseVersion = React.useMemo(() => {
    const baseVersionId = currentConversation?.baseVersionId || null;
    if (!baseVersionId) {
      return null;
    }

    return (
      (routeWorkspaceView?.versions || []).find((version) => version.id === baseVersionId) ||
      null
    );
  }, [currentConversation?.baseVersionId, routeWorkspaceView?.versions]);
  const currentDraftBaseVersion = React.useMemo(() => {
    if (!currentDraftBaseVersionId) {
      return null;
    }

    return (
      (routeWorkspaceView?.versions || []).find(
        (version) => version.id === currentDraftBaseVersionId
      ) || null
    );
  }, [currentDraftBaseVersionId, routeWorkspaceView?.versions]);
  const deliverable = routeWorkspaceView?.deliverable || null;
  const workspaceBrief = routeWorkspaceView?.workspacePlan || null;
  const workflowStatus = routeWorkspaceView?.workflowStatus || null;
  const renderAs = deliverable?.renderAs || 'document';
  const currentProjectId = currentProject?.id || currentWorkspace?.projectId || null;
  const currentProjectTitleValue = currentProject?.title || null;
  const currentWorkspaceProjectTitle = currentWorkspace?.projectTitle || null;
  const currentProjectTitle = React.useMemo(
    () => {
      if (currentProjectTitleValue?.trim()) {
        return currentProjectTitleValue.trim();
      }

      if (currentWorkspaceProjectTitle?.trim()) {
        return currentWorkspaceProjectTitle.trim();
      }

      return currentProjectId ? t('workspace.untitledProject') : null;
    },
    [currentProjectId, currentProjectTitleValue, currentWorkspaceProjectTitle, t]
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
  const showProjectContextInHeader = React.useMemo(() => {
    if (!currentProjectPathLabel) {
      return false;
    }

    const currentTitle = currentWorkspace?.title?.trim() || null;
    const hasDistinctProjectTitle =
      Boolean(currentProjectTitle?.trim()) &&
      currentProjectTitle?.trim() !== currentTitle;

    return hasDistinctProjectTitle || projectFolders.length > 0 || projectDeliverables.length > 1;
  }, [
    currentProjectPathLabel,
    currentProjectTitle,
    currentWorkspace?.title,
    projectDeliverables.length,
    projectFolders.length,
  ]);
  const projectDeliverableSwitchOptions = React.useMemo(
    () =>
      projectDeliverables.map((item) => {
        const folderSegments = listProjectFolderPath(
          item.projectFolderId,
          projectFolders
        );

        return {
          deliverableType: item.deliverableType,
          projectPathLabel:
            currentProjectTitle || folderSegments.length > 0
              ? [currentProjectTitle, ...folderSegments].filter(Boolean).join(' / ')
              : null,
          id: item.id,
          title: item.title,
        };
      }),
    [currentProjectTitle, projectDeliverables, projectFolders]
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
  const currentDeliverableFiles = React.useMemo(
    () =>
      currentVersion
        ? (routeWorkspaceView?.versionFiles || []).filter(
            (file) => file.role === 'deliverable'
          )
        : (routeWorkspaceView?.files || []).filter((file) => file.role === 'deliverable'),
    [currentVersion, routeWorkspaceView?.files, routeWorkspaceView?.versionFiles]
  );
  const previewCapability = React.useMemo(
    () => detectWorkspacePreviewCapability(currentDeliverableFiles),
    [currentDeliverableFiles]
  );
  const previewAnchorFileId = React.useMemo(
    () => resolveWebPreviewAnchorFile(currentDeliverableFiles, previewCapability)?.id || null,
    [currentDeliverableFiles, previewCapability]
  );
  const previewAutoStartKey =
    !previewCapability.canPreview || currentDeliverableFiles.length === 0
      ? null
      : (() => {
          const routeNodeId = requestedNodeId || routeProjectId;
          const fileSignature = currentDeliverableFiles
            .filter((file) => file.nodeType === 'file')
            .map((file) => `${file.id || file.path}:${file.revision}:${file.content.length}`)
            .join('|');

          return fileSignature
            ? `${routeNodeId}:${currentVersionId || 'draft'}:${previewCapability.entryPath}:${fileSignature}`
            : null;
        })();
  const activePreviewRun = React.useMemo(
    () =>
      workspaceRuns.find(
        (run) =>
          run.kind === 'preview' &&
          (run.status === 'pending' || run.status === 'running')
      ) ||
      routeWorkspaceView?.activePreviewRun ||
      null,
    [workspaceRuns, routeWorkspaceView?.activePreviewRun]
  );
  const comparableDeliverableText = React.useMemo(
    () => normalizeDeliverableText(fileContent),
    [fileContent]
  );
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
      (
        currentVersion
          ? routeWorkspaceView?.versionFiles || []
          : routeWorkspaceView?.files || []
      ).filter((file) => file.role === 'support'),
    [currentVersion, routeWorkspaceView?.files, routeWorkspaceView?.versionFiles]
  );
  const activeSupportFileId = currentFile?.role === 'support' ? currentFile.id : null;
  const currentWorkspaceStatusLabel = describeWorkspaceStatusLabel({
    selectedVersion: currentVersion,
    deliverable,
    t,
    workflowStatus,
  });
  const currentWorkspaceStateLabel = React.useMemo(
    () =>
      describeWorkspaceState({
        selectedVersion: currentVersion,
        deliverable,
        t,
        workflowStatus,
      }),
    [workflowStatus, currentVersion, deliverable, t]
  );
  const workspaceSubtitle = React.useMemo(
    () => currentWorkspaceStateLabel || undefined,
    [currentWorkspaceStateLabel]
  );
  const canonicalWorkspaceHref =
    !currentWorkspace?.id || !currentProjectId
      ? null
      : buildWorkspaceRoute({
          autoStartFirstPass: shouldAutoStartFirstPass,
          conversationId: requestedConversationId,
          fileId: requestedFileId,
          nodeId: currentWorkspace.id,
          projectId: currentProjectId,
          versionId: requestedVersionId,
        });
  const currentWorkspaceHref = buildWorkspaceRoute({
    autoStartFirstPass: shouldAutoStartFirstPass,
    conversationId: requestedConversationId,
    fileId: requestedFileId,
    nodeId: requestedNodeId,
    projectId: routeProjectId,
    versionId: requestedVersionId,
  });
  const routeIsCanonical =
    !canonicalWorkspaceHref || canonicalWorkspaceHref === currentWorkspaceHref;
  const canSwitchProjectDeliverable =
    !isVersionView && projectDeliverableSwitchOptions.length > 1;
  const canOpenOutline = outlineItems.some((item) => item.id.startsWith('heading-'));
  const { openOutline } = useWorkspaceOutlineNavigation({ outlineItems });
  const openWorkspaceRoute = React.useCallback(
    (nextWorkspaceId: string) => {
      router.push(
        buildWorkspaceRoute({
          conversationId: currentConversationId,
          nodeId: nextWorkspaceId,
          projectId: currentProjectId || routeProjectId,
        })
      );
    },
    [currentConversationId, currentProjectId, routeProjectId, router]
  );
  const workspaceTitleNode = (
    <WorkspaceRouteTitle
      currentTitle={currentWorkspace?.title || null}
      currentDeliverableType={deliverableType}
      enabled={canSwitchProjectDeliverable}
      onSelectDeliverable={openWorkspaceRoute}
      options={projectDeliverableSwitchOptions}
      projectContextLabel={
        showProjectContextInHeader ? currentProjectPathLabel || currentProjectTitle : null
      }
      workspaceId={workspaceId}
    />
  );
  const {
    handleOpenWorkspaceFile,
    loadRuns,
    loadThreads,
    loadWorkspace,
    loadWorkspaceView,
    syncLocation,
  } = useWorkspaceRouteController({
    activePreviewRun,
    currentConversationId,
    currentFileId,
    workflowStatusPrimaryAction: workflowStatus?.primaryAction,
    workflowStatusWorking: workflowStatus?.isAiWorking,
    currentVersionId,
    deliverableType,
    isAssistantBusy,
    projectId: currentProjectId || routeProjectId,
    previewEnabled: previewCapability.canPreview,
    pushRoute: router.push,
    replaceRoute: router.replace,
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
    workspaceBriefStatus: workspaceBrief?.status,
    workspaceId,
    workspaceReady: Boolean(routeWorkspaceView),
  });
  const {
    applyWorkflowPlaybook,
    handleGenerateFirstPass,
    handleQueuedPromptHandled,
    paneOrder,
    queuedPrompt,
    togglePaneOrder,
  } = useWorkspaceShellController({
    comparableDeliverableText,
    currentWorkspace,
    deliverable,
    isAssistantBusy,
    renderAs,
    setWorkspaceNotice,
    setWorkspaceView,
    t,
    workspaceBrief,
    workspaceNotice,
    workspaceId,
  });

  React.useEffect(() => {
    if (!canonicalWorkspaceHref) {
      return;
    }

    if (canonicalWorkspaceHref !== currentWorkspaceHref) {
      router.replace(canonicalWorkspaceHref);
    }
  }, [
    canonicalWorkspaceHref,
    currentWorkspaceHref,
    router,
  ]);

  React.useEffect(() => {
    if (
      !shouldAutoStartFirstPass ||
      currentVersion ||
      isAssistantBusy ||
      queuedPrompt ||
      workflowStatus?.primaryAction !== 'generate_first_pass'
    ) {
      return;
    }

    const autoStartKey = `${workspaceId}:${currentConversationId || 'default'}`;
    if (autoStartedFirstPassRef.current === autoStartKey) {
      return;
    }

    autoStartedFirstPassRef.current = autoStartKey;
    handleGenerateFirstPass();

    router.replace(
      buildWorkspaceRoute({
        conversationId: requestedConversationId,
        fileId: requestedFileId,
        nodeId: currentWorkspace?.id || requestedNodeId || workspaceId,
        projectId: currentProjectId || routeProjectId,
        versionId: requestedVersionId,
      })
    );
  }, [
    currentProjectId,
    currentConversationId,
    currentWorkspace?.id,
    currentVersion,
    handleGenerateFirstPass,
    isAssistantBusy,
    queuedPrompt,
    router,
    requestedConversationId,
    requestedFileId,
    requestedNodeId,
    requestedVersionId,
    routeProjectId,
    shouldAutoStartFirstPass,
    workflowStatus?.primaryAction,
    workspaceId,
  ]);

  const { saveCurrentFileContent } = useWorkspaceFileSaveController({
    currentFileId,
    isVersionView,
    setFileContent,
    setIsSavingTextFile,
    setWorkspaceView,
    workspaceId,
  });

  const {
    branchFromMessage,
    continueConversationFromVersion,
    createVersion,
    handleConversationComplete,
    restoreVersion,
    startPreview,
    stopPreview,
    switchConversationToVersionBranch,
    toggleRecoveryPointPin,
  } = useWorkspaceVersionPreviewController({
    activePreviewRun,
    currentConversationId,
    currentFileId,
    currentVersionId,
    isStartingPreview,
    loadRuns,
    loadThreads,
    loadWorkspace,
    loadWorkspaceView,
    previewAutoStartKey,
    previewEnabled: previewCapability.canPreview,
    promptedRecoveryPointRef,
    setIsStartingPreview,
    setIsStoppingPreview,
    setWorkspaceNotice,
    setWorkspaceRuns,
    syncLocation,
    t,
    versionTitle:
      deliverable?.title || currentWorkspace?.title || t('version.defaultTitle'),
    workflowStatusPrimaryAction: workflowStatus?.primaryAction,
    workspaceId,
    workspaceReady: Boolean(routeWorkspaceView),
  });
  const {
    createProjectDeliverable,
    createProjectFolder,
    createSiblingDeliverable,
    createSupportFile,
    createSupportFolder,
    deleteDeliverable,
    deleteProject,
    deleteProjectFolder,
    deleteSupportFile,
    moveDeliverable,
    moveProjectFolder,
    moveSupportFile,
    renameDeliverable,
    renameProject,
    renameProjectFolder,
    renameSupportFile,
    reorderDeliverable,
    reorderProjectFolder,
    reorderSupportFile,
  } = useWorkspaceSidebarActions({
    currentFile,
    currentFileId,
    currentProject,
    currentProjectId,
    currentWorkspace,
    loadWorkspace,
    onNavigateHome: () => router.push('/'),
    onOpenWorkspaceRoute: openWorkspaceRoute,
    openWorkspaceCreateEntry,
    projectDeliverables,
    projectFolders,
    setWorkspaceNotice,
    setWorkspaceView,
    supportFiles,
    syncLocation,
    t,
    workspaceId,
  });

  const assistantRail = (
    <WorkspaceAssistantRail
      activeAssistantRun={routeWorkspaceView?.activeAssistantRun || null}
      activeFileId={currentFileId}
      activeWorkflowPlaybookId={workspaceBrief?.activeWorkflowPlaybookId || null}
      allowSourceApply={!currentVersionId}
      baseVersionId={currentConversation?.baseVersionId || null}
      baseVersionLabel={currentConversationBaseVersionLabel}
      branches={routeWorkspaceView?.conversationTree || []}
      conversationId={currentConversationId}
      conversationRuns={routeWorkspaceView?.conversationRuns || []}
      conversationTitle={currentConversation?.title || null}
      currentProjectId={currentProjectId}
      currentDraftBranchTitle={currentDraftBaseVersion?.title || null}
      draftRevision={currentWorkspace?.draftRevision || null}
      versionId={currentVersionId}
      workflowStatus={workflowStatus}
      documentContent={commentContextContent}
      files={routeWorkspaceView?.files || []}
      initialMessages={initialMessages}
      isAssistantBusy={isAssistantBusy}
      onApplyWorkflow={workspaceId ? applyWorkflowPlaybook : undefined}
      onBranchConversation={branchFromMessage}
      onBusyChange={setIsAssistantBusy}
      onChatErrorChange={(error, retryFn) => setChatError(error ? { error, retryFn } : null)}
      onConversationComplete={handleConversationComplete}
      onCreateNextDeliverable={createNextDeliverableWithWorkflow}
      onOpenFile={handleOpenWorkspaceFile}
      onQueuedPromptHandled={handleQueuedPromptHandled}
      onSelectConversation={(conversationId) => syncLocation({ conversationId })}
      onSourceContentApplied={async () => {
        await loadWorkspace();
      }}
      onWorkspaceChange={({ conversationId, workspaceId: nextWorkspaceId }) => {
        syncLocation({
          conversationId,
          workspaceId: nextWorkspaceId || workspaceId,
        });
      }}
      plan={workspaceBrief}
      queuedPrompt={queuedPrompt}
      refreshThreads={async () => {
        await loadThreads();
      }}
      reviewThreads={reviewThreads}
      wikiId={workspaceId}
      workspaceId={workspaceId}
    />
  );

  const headerVersionControls = (
    <WorkspaceHeaderVersionControls
      currentDraftBaseVersionId={currentDraftBaseVersionId}
      workflowStatus={workflowStatus}
      currentText={comparableDeliverableText}
      currentVersionId={currentVersionId}
      interactionsEnabled={routeIsCanonical}
      isAssistantBusy={isAssistantBusy}
      onContinueFromVersion={continueConversationFromVersion}
      onCreateVersion={createVersion}
      onRestoreVersion={restoreVersion}
      onSelectVersion={(versionId) => syncLocation({ versionId })}
      onSwitchToVersionBranch={switchConversationToVersionBranch}
      onTogglePin={toggleRecoveryPointPin}
      stagedChangeSets={routeWorkspaceView?.stagedChangeSets || []}
      versions={routeWorkspaceView?.versions || []}
      workspaceId={workspaceId}
    />
  );

  const deliverablePanel = (
    <WorkspaceDeliverablePanel
      activePreviewRun={activePreviewRun}
      chatError={chatError}
      commentContextContent={commentContextContent}
      currentFile={currentFile}
      workflowStatus={workflowStatus}
      currentText={comparableDeliverableText}
      deliverable={deliverable}
      draftRevision={currentWorkspace?.draftRevision || null}
      editorContent={editorContent}
      fileContent={fileContent}
      headerActions={headerVersionControls}
      isAssistantBusy={isAssistantBusy}
      isFirstPassQueued={Boolean(queuedPrompt)}
      isReadOnly={isVersionView}
      isSavingTextFile={isSavingTextFile}
      isStartingPreview={isStartingPreview}
      isStoppingPreview={isStoppingPreview}
      onChange={saveCurrentFileContent}
      onGenerateFirstPass={handleGenerateFirstPass}
      onRestoreVersion={restoreVersion}
      onStartPreview={startPreview}
      onStopPreview={stopPreview}
      onThreadsChanged={async () => {
        await loadThreads();
      }}
      previewAnchorFileId={previewAnchorFileId}
      previewCapability={previewCapability}
      reviewThreads={reviewThreads}
      selectedVersion={currentVersion}
      showImplementation={showImplementation}
      stagedChangeSets={routeWorkspaceView?.stagedChangeSets || []}
      workspaceId={workspaceId}
      workspaceTitle={currentWorkspace?.title || null}
    />
  );

  const renderWorkspaceSidebar = ({
    collapsed,
    onNavigate,
  }: {
    collapsed: boolean;
    onNavigate?: () => void;
  }) => (
    <WorkspaceRouteSidebar
      activeSupportFileId={activeSupportFileId}
      canOpenOutline={canOpenOutline}
      collapsed={collapsed}
      createProjectDeliverable={createProjectDeliverable}
      currentProjectId={currentProjectId}
      currentProjectTitle={currentProjectTitle}
      currentVersionId={currentVersionId}
      currentWorkspaceId={workspaceId}
      currentWorkspaceStatusLabel={currentWorkspaceStatusLabel}
      isVersionView={isVersionView}
      onCreateProjectFolder={createProjectFolder}
      onCreateSiblingDeliverable={routeIsCanonical ? createSiblingDeliverable : undefined}
      onDeleteWorkspace={deleteProject}
      onCreateSupportFile={createSupportFile}
      onCreateSupportFolder={createSupportFolder}
      onDeleteSupportFile={deleteSupportFile}
      onMoveSupportFile={moveSupportFile}
      onReorderSupportFile={reorderSupportFile}
      onRenameSupportFile={renameSupportFile}
      onNavigate={onNavigate}
      onOpenOutline={openOutline}
      onOpenWorkspaceRoute={openWorkspaceRoute}
      onRenameWorkspace={renameProject}
      onRenameDeliverable={renameDeliverable}
      onDeleteDeliverable={deleteDeliverable}
      onMoveDeliverable={moveDeliverable}
      onMoveProjectFolder={moveProjectFolder}
      onReorderDeliverable={reorderDeliverable}
      onReorderProjectFolder={reorderProjectFolder}
      onRenameProjectFolder={renameProjectFolder}
      onDeleteProjectFolder={deleteProjectFolder}
      onSyncSupportFileLocation={syncLocation}
      openWorkspaceCreateEntry={openWorkspaceCreateEntry}
      projectFolders={projectFolders}
      projectDeliverables={projectDeliverables}
      supportFiles={supportFiles}
      outlineItems={outlineItems}
    />
  );

  const hasMultipleNodes = projectDeliverables.length > 1;
  const workspaceShellActions = (
    <WorkspaceShellActions
      canCreateSiblingDeliverable={Boolean(currentWorkspace && !isVersionView && routeIsCanonical)}
      canToggleImplementation={deliverableType !== 'document'}
      canToggleSurfaceMode={hasMultipleNodes && !isVersionView}
      isStartingPreview={isStartingPreview}
      isStoppingPreview={isStoppingPreview}
      onCreateSiblingDeliverable={() =>
        openProjectDeliverableComposer({
          projectFolderId: currentWorkspace?.projectFolderId || null,
        })
      }
      onStartPreview={() => void startPreview()}
      onStopPreview={() => void stopPreview()}
      onToggleImplementation={() => setShowImplementation((open) => !open)}
      onTogglePaneOrder={togglePaneOrder}
      onToggleSurfaceMode={() => setSurfaceMode((m) => (m === 'editor' ? 'overview' : 'editor'))}
      previewUrl={activePreviewRun?.previewUrl || null}
      showImplementation={showImplementation}
      showPreviewControls={previewCapability.canPreview && showImplementation}
      surfaceMode={surfaceMode}
    />
  );

  const canvasPanel = surfaceMode === 'overview' && currentProjectId ? (
    <ProjectCanvasLoader
      currentNodeId={workspaceId}
      onDeleteNode={(nodeId) => {
        void deleteDeliverable(nodeId);
      }}
      onDoubleClickNode={(nodeId) => {
        setSurfaceMode('editor');
        openWorkspaceRoute(nodeId);
      }}
      onNewNode={() => {
        openProjectDeliverableComposer({ projectFolderId: null });
      }}
      onRenameNode={(nodeId, newTitle) => {
        void renameDeliverable(nodeId, newTitle);
      }}
      projectId={currentProjectId}
    />
  ) : null;

  return (
    <WorkspaceScreen
      actions={workspaceShellActions}
      assistantRail={assistantRail}
      currentVersionId={currentVersionId}
      deliverablePanel={canvasPanel || deliverablePanel}
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

function describeWorkspaceState(params: {
  selectedVersion: WorkspaceViewData['selectedVersion'];
  deliverable: WorkspaceViewData['deliverable'];
  t: ReturnType<typeof useT>;
  workflowStatus: WorkspaceWorkflowStatusData | null;
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
  workflowStatus: WorkspaceWorkflowStatusData | null;
}) {
  if (!params.deliverable) {
    return params.t('workspace.openProjectToContinue');
  }

  if (params.selectedVersion) {
    return params.selectedVersion.title;
  }

  return params.workflowStatus?.statusTitle || params.t('workspace.liveDraft');
}
