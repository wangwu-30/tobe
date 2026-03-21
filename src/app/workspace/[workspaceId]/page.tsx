'use client';

import * as React from 'react';
import type { Value } from 'platejs';

import {
  buildOutlineItems,
  normalizeDeliverableText,
  parsePlateContent,
} from '@/canvas/document-canvas/document-canvas';
import { plateToMarkdown } from '@/lib/ai/serializer';
import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import { useT } from '@/components/providers/language-provider';
import {
  useAppParams,
  useAppRouter,
  useAppSearchParams,
} from '@/lib/app-router';
import {
  buildPreviewBridgeUrl,
  WEB_PREVIEW_BRIDGE_CHANNEL,
} from '@/lib/workspace/preview-bridge';
import { isPlateBackedWorkspaceFile } from '@/lib/workspace/file-presentation';
import {
  detectWorkspacePreviewCapability,
  resolveWebPreviewAnchorFile,
} from '@/lib/workspace/preview';
import { listProjectFolderPath } from '@/lib/workspace/project-summary';
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
  const workspaceId = params.workspaceId as string;
  const requestedConversationId = searchParams.get('conversationId');
  const requestedFileId = searchParams.get('fileId');
  const requestedVersionId = searchParams.get('versionId');

  const [workspaceView, setWorkspaceView] = React.useState<WorkspaceViewData | null>(null);
  const [initialMessages, setInitialMessages] = React.useState<ChatMessageData[]>([]);
  const [reviewThreads, setReviewThreads] = React.useState<CommentThreadData[]>([]);
  const [editorContent, setEditorContent] = React.useState<Value | null>(null);
  const [fileContent, setFileContent] = React.useState('');
  const [isSavingTextFile, setIsSavingTextFile] = React.useState(false);
  const [isStartingPreview, setIsStartingPreview] = React.useState(false);
  const [isStoppingPreview, setIsStoppingPreview] = React.useState(false);
  const [showImplementation, setShowImplementation] = React.useState(false);
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

  const currentWorkspace = workspaceView?.workspace || null;
  const currentProject = workspaceView?.currentProject || null;
  const {
    createNextDeliverableWithWorkflow,
    goalDialog,
    openProjectDeliverableComposer,
    openWorkspaceCreateEntry,
  } = useWorkspaceGoalDialogController({
    activeWorkflowPlaybookId: workspaceView?.workspacePlan?.activeWorkflowPlaybookId || null,
    currentProject,
    currentWorkspace,
    workspaceId,
  });
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
  const workflowStatus = workspaceView?.workflowStatus || null;
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
  const canSwitchProjectDeliverable =
    !isVersionView && projectDeliverableSwitchOptions.length > 1;
  const canOpenOutline = outlineItems.some((item) => item.id.startsWith('heading-'));
  const { openOutline } = useWorkspaceOutlineNavigation({ outlineItems });
  const workspaceTitleNode = (
    <WorkspaceRouteTitle
      currentTitle={currentWorkspace?.title || null}
      enabled={canSwitchProjectDeliverable}
      onSelectDeliverable={(deliverableId) => router.push(`/workspace/${deliverableId}`)}
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
    previewEnabled: previewCapability.canPreview,
    pushRoute: router.push,
    replaceRoute: router.replace,
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
    workspaceBriefStatus: workspaceBrief?.status,
    workspaceId,
    workspaceReady: Boolean(workspaceView),
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
    workspaceId,
    workspaceReady: Boolean(workspaceView),
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
    onOpenWorkspaceRoute: (nextWorkspaceId) => router.push(`/workspace/${nextWorkspaceId}`),
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
      activeAssistantRun={workspaceView?.activeAssistantRun || null}
      activeFileId={currentFileId}
      activeWorkflowPlaybookId={workspaceBrief?.activeWorkflowPlaybookId || null}
      allowSourceApply={!currentVersionId}
      baseVersionId={currentConversation?.baseVersionId || null}
      baseVersionLabel={currentConversationBaseVersionLabel}
      branches={workspaceView?.conversationTree || []}
      conversationId={currentConversationId}
      conversationRuns={workspaceView?.conversationRuns || []}
      conversationTitle={currentConversation?.title || null}
      currentProjectId={currentProjectId}
      currentDraftBranchTitle={currentDraftBaseVersion?.title || null}
      workflowStatus={workflowStatus}
      documentContent={commentContextContent}
      files={workspaceView?.files || []}
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
      refreshThreads={loadThreads}
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
      isAssistantBusy={isAssistantBusy}
      onContinueFromVersion={continueConversationFromVersion}
      onCreateVersion={createVersion}
      onRestoreVersion={restoreVersion}
      onSelectVersion={(versionId) => syncLocation({ versionId })}
      onSwitchToVersionBranch={switchConversationToVersionBranch}
      onTogglePin={toggleRecoveryPointPin}
      stagedChangeSets={workspaceView?.stagedChangeSets || []}
      versions={workspaceView?.versions || []}
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
      isReadOnly={isVersionView}
      isSavingTextFile={isSavingTextFile}
      isStartingPreview={isStartingPreview}
      isStoppingPreview={isStoppingPreview}
      onChange={saveCurrentFileContent}
      onGenerateFirstPass={handleGenerateFirstPass}
      onRestoreVersion={restoreVersion}
      onStartPreview={startPreview}
      onStopPreview={stopPreview}
      onThreadsChanged={loadThreads}
      previewAnchorFileId={previewAnchorFileId}
      previewCapability={previewCapability}
      reviewThreads={reviewThreads}
      selectedVersion={currentVersion}
      showImplementation={showImplementation}
      stagedChangeSets={workspaceView?.stagedChangeSets || []}
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
      onCreateSiblingDeliverable={createSiblingDeliverable}
      onDeleteWorkspace={deleteProject}
      onCreateSupportFile={createSupportFile}
      onCreateSupportFolder={createSupportFolder}
      onDeleteSupportFile={deleteSupportFile}
      onMoveSupportFile={moveSupportFile}
      onReorderSupportFile={reorderSupportFile}
      onRenameSupportFile={renameSupportFile}
      onNavigate={onNavigate}
      onOpenOutline={openOutline}
      onOpenWorkspaceRoute={(nextWorkspaceId) => router.push(`/workspace/${nextWorkspaceId}`)}
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

  const workspaceShellActions = (
    <WorkspaceShellActions
      canCreateSiblingDeliverable={Boolean(currentWorkspace && !isVersionView)}
      canToggleImplementation={deliverableType !== 'document'}
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
      previewUrl={activePreviewRun?.previewUrl || null}
      showImplementation={showImplementation}
      showPreviewControls={previewCapability.canPreview && showImplementation}
    />
  );

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
