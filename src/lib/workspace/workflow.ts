import { translate } from '@/lib/i18n/copy';
import type { AppLanguage } from '@/lib/i18n/language';
import type {
  AssistantRunData,
  DeliverableData,
  StagedChangeSetData,
  WorkflowSummaryData,
  WorkspaceFileData,
  WorkspaceRunData,
  WorkspaceSnapshotData,
} from '@/types';
import type { WorkspacePreviewCapability } from '@/lib/workspace/preview';

type DeriveWorkflowSummaryParams = {
  activeAssistantRun: AssistantRunData | null;
  activePreviewRun: WorkspaceRunData | null;
  currentFiles: WorkspaceFileData[];
  deliverable: DeliverableData | null;
  language: AppLanguage;
  previewCapability: WorkspacePreviewCapability;
  snapshots: WorkspaceSnapshotData[];
  stagedChangeSets: StagedChangeSetData[];
};

export function deriveWorkflowSummary(
  params: DeriveWorkflowSummaryParams
): WorkflowSummaryData | null {
  if (!params.deliverable) {
    return null;
  }

  const latestRestorableSnapshot =
    params.snapshots.find((snapshot) => snapshot.restorable && !snapshot.visible) || null;
  const latestVisibleSnapshot =
    params.snapshots.find((snapshot) => snapshot.visible) || null;
  const isAiWorking = isAssistantRunActive(params.activeAssistantRun);
  const hasVisibleVersion = Boolean(latestVisibleSnapshot);
  const hasLiveContent = hasMeaningfulDeliverableContent(
    resolvePrimaryLiveContent(params.currentFiles, params.deliverable.content)
  );
  const liveDraftMatchesVisibleVersion = latestVisibleSnapshot
    ? doFilesMatchSnapshot(params.currentFiles, latestVisibleSnapshot)
    : false;

  const summary =
    params.deliverable.deliverableType === 'web'
      ? deriveWebWorkflowSummary({
          activePreviewRun: params.activePreviewRun,
          hasLiveContent,
          hasVisibleVersion,
          isAiWorking,
          language: params.language,
          latestRestorableSnapshot,
          latestVisibleSnapshot,
          liveDraftMatchesVisibleVersion,
          previewCapability: params.previewCapability,
        })
      : deriveDraftWorkflowSummary({
          hasLiveContent,
          hasVisibleVersion,
          isAiWorking,
          language: params.language,
          latestRestorableSnapshot,
          latestVisibleSnapshot,
          liveDraftMatchesVisibleVersion,
          stagedChangeSets: params.stagedChangeSets,
        });

  return {
    ...summary,
    isAiWorking,
    latestRestorableSnapshotId: latestRestorableSnapshot?.id || null,
    latestRestorableSnapshotTitle: latestRestorableSnapshot?.title || null,
  };
}

function deriveWebWorkflowSummary(params: {
  activePreviewRun: WorkspaceRunData | null;
  hasLiveContent: boolean;
  hasVisibleVersion: boolean;
  isAiWorking: boolean;
  language: AppLanguage;
  latestRestorableSnapshot: WorkspaceSnapshotData | null;
  latestVisibleSnapshot: WorkspaceSnapshotData | null;
  liveDraftMatchesVisibleVersion: boolean;
  previewCapability: WorkspacePreviewCapability;
}): Omit<WorkflowSummaryData, 'isAiWorking' | 'latestRestorableSnapshotId' | 'latestRestorableSnapshotTitle'> {
  if (params.isAiWorking) {
    return {
      blockedReason: null,
      phase: 'implementing',
      primaryAction: 'wait_for_ai',
      statusDescription: translate(params.language, 'workflow.implementingDescription'),
      statusTitle: translate(params.language, 'workflow.implementingTitle'),
    };
  }

  if (
    params.hasVisibleVersion &&
    params.liveDraftMatchesVisibleVersion &&
    params.latestVisibleSnapshot
  ) {
    return {
      blockedReason: null,
      phase: 'finalized',
      primaryAction: params.latestRestorableSnapshot ? 'restore_latest' : 'none',
      statusDescription: translate(params.language, 'workflow.finalizedDescription'),
      statusTitle: translate(params.language, 'workflow.finalizedTitle'),
    };
  }

  if (params.hasLiveContent && !params.previewCapability.canPreview) {
    return {
      blockedReason: translate(params.language, 'workspace.previewUnavailableReason'),
      phase: 'blocked',
      primaryAction: params.latestRestorableSnapshot ? 'restore_latest' : 'none',
      statusDescription: translate(params.language, 'workflow.blockedDescription'),
      statusTitle: translate(params.language, 'workflow.blockedTitle'),
    };
  }

  if (params.hasLiveContent && params.activePreviewRun?.previewUrl) {
    return {
      blockedReason: null,
      phase: 'preview_running',
      primaryAction: 'none',
      statusDescription: translate(params.language, 'workflow.previewRunningDescription'),
      statusTitle: translate(params.language, 'workflow.previewRunningTitle'),
    };
  }

  if (params.hasLiveContent && params.previewCapability.canPreview) {
    return {
      blockedReason: null,
      phase: 'preview_ready',
      primaryAction: 'start_preview',
      statusDescription: translate(params.language, 'workflow.previewReadyDescription'),
      statusTitle: translate(params.language, 'workflow.previewReadyTitle'),
    };
  }

  return {
    blockedReason: null,
    phase: 'planning',
    primaryAction: 'wait_for_ai',
    statusDescription: translate(params.language, 'workflow.planDescription'),
    statusTitle: translate(params.language, 'workflow.planTitle'),
  };
}

function deriveDraftWorkflowSummary(params: {
  hasLiveContent: boolean;
  hasVisibleVersion: boolean;
  isAiWorking: boolean;
  language: AppLanguage;
  latestRestorableSnapshot: WorkspaceSnapshotData | null;
  latestVisibleSnapshot: WorkspaceSnapshotData | null;
  liveDraftMatchesVisibleVersion: boolean;
  stagedChangeSets: StagedChangeSetData[];
}): Omit<WorkflowSummaryData, 'isAiWorking' | 'latestRestorableSnapshotId' | 'latestRestorableSnapshotTitle'> {
  const pendingChangeSets = params.stagedChangeSets.filter(
    (changeSet) => changeSet.status === 'pending'
  );

  if (params.isAiWorking) {
    return {
      blockedReason: null,
      phase: 'implementing',
      primaryAction: 'wait_for_ai',
      statusDescription: translate(params.language, 'workflow.implementingDescription'),
      statusTitle: translate(params.language, 'workflow.implementingTitle'),
    };
  }

  if (
    params.hasVisibleVersion &&
    params.liveDraftMatchesVisibleVersion &&
    params.latestVisibleSnapshot
  ) {
    return {
      blockedReason: null,
      phase: 'finalized',
      primaryAction: params.latestRestorableSnapshot ? 'restore_latest' : 'none',
      statusDescription: translate(params.language, 'workflow.finalizedDescription'),
      statusTitle: translate(params.language, 'workflow.finalizedTitle'),
    };
  }

  if (pendingChangeSets.length > 0 && !params.hasLiveContent) {
    return {
      blockedReason: null,
      phase: 'reviewing',
      primaryAction: 'wait_for_ai',
      statusDescription: translate(params.language, 'workflow.stagedDraftReadyDescription'),
      statusTitle: translate(params.language, 'workflow.stagedDraftReadyTitle'),
    };
  }

  if (params.hasLiveContent || pendingChangeSets.length > 0) {
    return {
      blockedReason: null,
      phase: 'reviewing',
      primaryAction: 'create_version',
      statusDescription: translate(params.language, 'workflow.reviewingDescription'),
      statusTitle: translate(params.language, 'workflow.reviewingTitle'),
    };
  }

  return {
    blockedReason: null,
    phase: 'planning',
    primaryAction: 'wait_for_ai',
    statusDescription: translate(params.language, 'workflow.planDescription'),
    statusTitle: translate(params.language, 'workflow.planTitle'),
  };
}

function isAssistantRunActive(activeAssistantRun: AssistantRunData | null) {
  return Boolean(
    activeAssistantRun &&
      (activeAssistantRun.status === 'queued' ||
        activeAssistantRun.status === 'planning' ||
        activeAssistantRun.status === 'running')
  );
}

function resolvePrimaryLiveContent(
  currentFiles: WorkspaceFileData[],
  fallbackContent: string
) {
  const primaryFile =
    currentFiles.find((file) => file.nodeType === 'file' && file.isPrimary) ||
    currentFiles.find((file) => file.nodeType === 'file') ||
    null;

  return primaryFile?.content || fallbackContent;
}

function hasMeaningfulDeliverableContent(content: string) {
  const normalized = content.trim();
  if (!normalized) {
    return false;
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    return hasMeaningfulStructuredContent(parsed);
  } catch {
    return normalized.length > 0;
  }
}

function hasMeaningfulStructuredContent(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulStructuredContent(item));
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.files)) {
    return record.files.some((file) => hasMeaningfulStructuredContent(file));
  }

  if (typeof record.text === 'string' && record.text.trim().length > 0) {
    return true;
  }

  if (Array.isArray(record.children)) {
    return record.children.some((child) => hasMeaningfulStructuredContent(child));
  }

  return Object.values(record).some((item) => hasMeaningfulStructuredContent(item));
}

function doFilesMatchSnapshot(
  currentFiles: WorkspaceFileData[],
  snapshot: WorkspaceSnapshotData
) {
  const currentComparable = currentFiles
    .filter((file) => file.nodeType === 'file')
    .map((file) => ({
      content: file.content,
      isPrimary: file.isPrimary,
      kind: file.kind,
      path: file.path,
    }))
    .sort(compareComparableFiles);
  const snapshotComparable = snapshot.files
    .filter((file) => file.nodeType === 'file')
    .map((file) => ({
      content: file.content,
      isPrimary: file.isPrimary,
      kind: file.kind,
      path: file.path,
    }))
    .sort(compareComparableFiles);

  return JSON.stringify(currentComparable) === JSON.stringify(snapshotComparable);
}

function compareComparableFiles(
  left: { path: string; isPrimary: boolean },
  right: { path: string; isPrimary: boolean }
) {
  if (left.isPrimary !== right.isPrimary) {
    return left.isPrimary ? -1 : 1;
  }

  return left.path.localeCompare(right.path);
}
