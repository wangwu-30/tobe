'use client';

import type { Value } from 'platejs';

import { useT } from '@/components/providers/language-provider';
import { buildDeliverablePanel } from '@/canvas/document-canvas/document-canvas';
import { detectWorkspacePreviewCapability } from '@/lib/workspace/preview';
import type { WorkspaceRunData, WorkspaceViewData } from '@/types';

type DeliverablePanelParams = Parameters<typeof buildDeliverablePanel>[0];

export function WorkspaceDeliverablePanel({
  activePreviewRun,
  chatError,
  commentContextContent,
  currentFile,
  currentStatus,
  currentText,
  deliverable,
  draftRevision,
  editorContent,
  fileContent,
  headerActions,
  isAssistantBusy,
  isReadOnly,
  isSavingTextFile,
  isStartingPreview,
  isStoppingPreview,
  onChange,
  onGenerateFirstPass,
  onRestoreVersion,
  onStartPreview,
  onStopPreview,
  onThreadsChanged,
  previewAnchorFileId,
  previewCapability,
  reviewThreads,
  selectedVersion,
  showImplementation,
  stagedChangeSets = [],
  workspaceId,
  workspaceTitle,
}: {
  activePreviewRun: WorkspaceRunData | null;
  chatError: DeliverablePanelParams['chatError'];
  commentContextContent: DeliverablePanelParams['commentContextContent'];
  currentFile: DeliverablePanelParams['currentFile'];
  currentStatus: DeliverablePanelParams['currentStatus'];
  currentText: DeliverablePanelParams['currentText'];
  deliverable: WorkspaceViewData['deliverable'];
  draftRevision: DeliverablePanelParams['draftRevision'];
  editorContent: Value | null;
  fileContent: DeliverablePanelParams['fileContent'];
  headerActions: DeliverablePanelParams['headerActions'];
  isAssistantBusy: DeliverablePanelParams['isAssistantBusy'];
  isReadOnly: DeliverablePanelParams['isReadOnly'];
  isSavingTextFile: DeliverablePanelParams['isSavingTextFile'];
  isStartingPreview: DeliverablePanelParams['isStartingPreview'];
  isStoppingPreview: DeliverablePanelParams['isStoppingPreview'];
  onChange: DeliverablePanelParams['onChange'];
  onGenerateFirstPass: DeliverablePanelParams['onGenerateFirstPass'];
  onRestoreVersion: (versionId: string) => Promise<void> | void;
  onStartPreview: DeliverablePanelParams['onStartPreview'];
  onStopPreview: DeliverablePanelParams['onStopPreview'];
  onThreadsChanged: DeliverablePanelParams['onThreadsChanged'];
  previewAnchorFileId: DeliverablePanelParams['previewAnchorFileId'];
  previewCapability: ReturnType<typeof detectWorkspacePreviewCapability>;
  reviewThreads: DeliverablePanelParams['reviewThreads'];
  selectedVersion: DeliverablePanelParams['selectedVersion'];
  showImplementation: DeliverablePanelParams['showImplementation'];
  stagedChangeSets?: WorkspaceViewData['stagedChangeSets'];
  workspaceId: string;
  workspaceTitle: string | null;
}) {
  const t = useT();
  const deliverableType = deliverable?.deliverableType || 'document';
  const storedDeliverableType = deliverable?.storedDeliverableType || null;
  const deliverableTitle =
    deliverable?.title || workspaceTitle || t('workspace.untitledDeliverable');
  const hasDeliverableContent = currentText.trim().length > 0;

  return buildDeliverablePanel({
    chatError,
    commentContextContent,
    currentFile,
    currentStatus,
    currentText,
    deliverableTitle,
    deliverableType,
    storedDeliverableType,
    documentPlaceholder:
      !hasDeliverableContent &&
      currentStatus?.phase === 'reviewing' &&
      stagedChangeSets.some((changeSet) => changeSet.status === 'pending')
        ? currentStatus.statusDescription
        : t('workspace.documentPlaceholder'),
    draftRevision,
    editorContent,
    fileContent,
    headerActions,
    isAssistantBusy,
    isReadOnly,
    isSavingTextFile,
    isStartingPreview,
    isStoppingPreview,
    noDocumentDescription: t('workspace.askAiGenerateDocument'),
    noDocumentTitle: t('workspace.noDocumentYet'),
    openPreviewLabel: t('workspace.openPreview'),
    onChange,
    onGenerateFirstPass,
    onRestoreLatest:
      currentStatus?.latestRestorableVersionId
        ? () => void onRestoreVersion(currentStatus.latestRestorableVersionId!)
        : undefined,
    onStartPreview,
    onStopPreview,
    onThreadsChanged,
    previewAnchorFileId,
    previewCapability,
    previewEmptyDescription: t('workspace.previewReadyDescription'),
    previewEmptyTitle: t('workspace.previewReadyTitle'),
    previewNotReadyTitle: t('workspace.previewNotReady'),
    previewRunId: activePreviewRun?.id || null,
    previewUnavailableDescription: t('workspace.previewUnavailableReason'),
    previewUrl: activePreviewRun?.previewUrl || null,
    readOnlyLabel:
      currentFile?.role === 'support'
        ? t('sidebar.uploads')
        : selectedVersion
          ? selectedVersion.title
          : t('workspace.liveDraft'),
    reviewThreads,
    savingLabel: t('common.saving'),
    selectedVersion,
    showImplementation,
    startPreviewLabel: t('workspace.startPreview'),
    startingLabel: t('workspace.starting'),
    stopPreviewLabel: t('workspace.stopPreview'),
    stoppingLabel: t('workspace.stopping'),
    supportMaterialLabel: t('sidebar.uploads'),
    t,
    versionActionLabel: t('version.createVersion'),
    workspaceId,
  });
}
