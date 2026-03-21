import { mapStateLabel } from '@/objects/label/schema';
import {
  mapWorkspaceFile,
  parseVersionFiles,
} from '@/objects/file/schema';
import {
  resolveWorkspaceProjectId,
  resolveWorkspaceProjectTitle,
} from '@/objects/project/queries';
import type { AppLanguage } from '@/lib/i18n/language';
import {
  buildDeliverable,
  hydrateWorkspacePlanForView,
} from '@/lib/workspace/planning';
import {
  detectWorkspacePreviewCapability,
} from '@/lib/workspace/preview';
import { deriveStatus } from '@/lib/workspace/workflow';
import { deriveWorkspaceStateSemantics } from '@/objects/state/schema';
import type {
  AssistantRunData,
  DeliverableData,
  StateLabelData,
  StagedChangeSetData,
  WorkspaceData,
  WorkspaceEditLockData,
  WorkspaceWorkflowStatusData,
  WorkspaceFileData,
  WorkspacePlanData,
  WorkspaceRunData,
  WorkspaceVersionData,
  WorkspaceWithRelations,
} from '@/types';

type WorkspaceRecord = {
  content: string;
  createdAt: Date;
  createdByUserId: string | null;
  currentVersion: number;
  draftBaseVersionId?: string | null;
  draftRevision?: number;
  deletedAt: Date | null;
  id: string;
  organizationId: string;
  originDeviceId: string | null;
  projectId?: string | null;
  projectFolderId?: string | null;
  projectRootPath?: string | null;
  projectTitle?: string | null;
  revision: number;
  sessionId: string;
  status: string;
  title: string;
  updatedAt: Date;
};

type WorkspaceVersionRecord = {
  content: string;
  createdByUserId: string | null;
  deletedAt: Date | null;
  documentId: string;
  id: string;
  lockedAt: Date;
  organizationId: string;
  originDeviceId: string | null;
  parentVersionId: string | null;
  revision: number;
  sourceMessageId: string | null;
  sourceSessionId: string | null;
  title: string;
  versionNum: number;
  labels?: Array<StateLabelData | Parameters<typeof mapStateLabel>[0]>;
};

type WorkspaceEditLockRecord = {
  createdAt: Date;
  documentId: string;
  expiresAt: Date;
  id: string;
  lockedVersionId: string | null;
  organizationId: string;
  originDeviceId: string;
  updatedAt: Date;
  userId: string;
};

type WorkspaceWithRelationsRecord = WorkspaceRecord & {
  deliverable?: WorkspaceWithRelations['deliverable'];
  files: Array<Parameters<typeof mapWorkspaceFile>[0]>;
  stagedChangeSets?: WorkspaceWithRelations['stagedChangeSets'];
  versions: WorkspaceVersionData[];
  workspacePlan?: WorkspaceWithRelations['workspacePlan'];
};

type WorkspaceRuntimeSeed = Pick<
  WorkspaceRecord,
  'content' | 'currentVersion' | 'id' | 'status' | 'title'
> & {
  workspacePlan?: {
    deliverableType: string;
  } | null;
};

export function mapWorkspace(document: WorkspaceRecord): WorkspaceData {
  return {
    id: document.id,
    organizationId: document.organizationId,
    primaryConversationId: document.sessionId,
    sessionId: document.sessionId,
    projectId: resolveWorkspaceProjectId(document),
    projectFolderId: document.projectFolderId || null,
    draftBaseVersionId: document.draftBaseVersionId || null,
    projectTitle: resolveWorkspaceProjectTitle(document),
    title: document.title,
    content: document.content,
    projectRootPath: document.projectRootPath || null,
    persistedStatus: document.status,
    currentVersion: document.currentVersion,
    draftRevision: document.draftRevision || 0,
    createdByUserId: document.createdByUserId,
    originDeviceId: document.originDeviceId,
    revision: document.revision,
    deletedAt: document.deletedAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export function mapWorkspaceVersion(
  version: WorkspaceVersionRecord
): WorkspaceVersionData {
  const labels = (version.labels || []).map((label) =>
    'stateId' in label ? label : mapStateLabel(label)
  );
  const stateSemantics = deriveWorkspaceStateSemantics({
    labels,
  });

  return {
    id: version.id,
    organizationId: version.organizationId,
    workspaceId: version.documentId,
    versionNum: version.versionNum,
    title: version.title,
    content: version.content,
    files: parseVersionFiles(version.content).map((file) => ({
      ...file,
      versionId: file.versionId || version.id,
    })),
    parentVersionId: version.parentVersionId,
    sourceConversationId: version.sourceSessionId,
    sourceMessageId: version.sourceMessageId,
    versionType: stateSemantics.versionType,
    createdByUserId: version.createdByUserId,
    originDeviceId: version.originDeviceId,
    revision: version.revision,
    deletedAt: version.deletedAt,
    lockedAt: version.lockedAt,
    labels,
    visible: stateSemantics.visible,
    restorable: stateSemantics.restorable,
    pinned: stateSemantics.pinned,
    recoveryKind: stateSemantics.recoveryKind,
  };
}

export function mapWorkspaceEditLock(
  lock: WorkspaceEditLockRecord
): WorkspaceEditLockData {
  return {
    id: lock.id,
    organizationId: lock.organizationId,
    workspaceId: lock.documentId,
    wikiId: lock.documentId,
    userId: lock.userId,
    originDeviceId: lock.originDeviceId,
    lockedVersionId: lock.lockedVersionId,
    expiresAt: lock.expiresAt,
    createdAt: lock.createdAt,
    updatedAt: lock.updatedAt,
  };
}

export function mapWorkspaceWithRelations(
  workspace: WorkspaceWithRelationsRecord
): WorkspaceWithRelations {
  return {
    ...mapWorkspace(workspace),
    deliverable: workspace.deliverable || null,
    files: workspace.files.map(mapWorkspaceFile),
    stagedChangeSets: workspace.stagedChangeSets || [],
    versions: workspace.versions,
    workspacePlan: workspace.workspacePlan || null,
  };
}

export function buildWorkspaceRuntimeSurface(params: {
  activeAssistantRun: AssistantRunData | null;
  language: AppLanguage;
  stagedChangeSets: StagedChangeSetData[];
  versions: WorkspaceVersionData[];
  workspace: WorkspaceRuntimeSeed;
  workspaceFiles: WorkspaceFileData[];
  workspacePlan: WorkspacePlanData | null;
  workspaceRuns: WorkspaceRunData[];
}): {
  activePreviewRun: WorkspaceRunData | null;
  workflowStatus: WorkspaceWorkflowStatusData | null;
  deliverable: DeliverableData;
  workspacePlan: WorkspacePlanData | null;
} {
  const deliverableFiles = params.workspaceFiles.filter(
    (file) => file.role === 'deliverable'
  );
  const deliverable = buildDeliverable({
    currentVersion: params.workspace.currentVersion,
    files: params.workspaceFiles,
    plan: params.workspacePlan,
    storedDeliverableType: params.workspace.workspacePlan?.deliverableType || null,
    workspace: params.workspace,
  });
  const previewCapability = detectWorkspacePreviewCapability(deliverableFiles);
  const activePreviewRun =
    params.workspaceRuns.find(
      (run) =>
        run.kind === 'preview' &&
        (run.status === 'pending' || run.status === 'running')
    ) || null;
  const workflowStatus = deriveStatus({
    activePreviewRun,
    activeAssistantRun: params.activeAssistantRun,
    currentFiles: deliverableFiles,
    deliverable,
    language: params.language,
    previewCapability,
    versions: params.versions,
    stagedChangeSets: params.stagedChangeSets,
  });

  return {
    activePreviewRun,
    workflowStatus,
    deliverable,
    workspacePlan: hydrateWorkspacePlanForView({
      activeAssistantRun: params.activeAssistantRun,
      workflowStatus,
      plan: params.workspacePlan,
    }),
  };
}
