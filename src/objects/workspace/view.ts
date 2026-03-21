import { mapStateLabel } from '@/objects/label/schema';
import {
  mapWorkspaceFile,
  parseVersionFiles,
} from '@/objects/file/schema';
import {
  resolveWorkspaceProjectId,
  resolveWorkspaceProjectTitle,
} from '@/objects/project/queries';
import { deriveWorkspaceStateSemantics } from '@/objects/state/schema';
import type {
  KnowledgeItemData,
  MemoryData,
  StateLabelData,
  WorkspaceData,
  WorkspaceEditLockData,
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
  versionType?: string | null;
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

type KnowledgeItemRecord = {
  content: string;
  createdAt: Date;
  createdByUserId: string | null;
  deletedAt: Date | null;
  documentId: string | null;
  id: string;
  organizationId: string;
  originDeviceId: string | null;
  revision: number;
  sourceType: string;
  title: string;
  updatedAt: Date;
};

type MemoryRecord = {
  active: boolean;
  category: string;
  content: string;
  createdAt: Date;
  createdByUserId: string | null;
  deletedAt: Date | null;
  documentId: string | null;
  id: string;
  organizationId: string;
  originDeviceId: string | null;
  revision: number;
  sessionId: string | null;
  sourceThreadId: string | null;
  updatedAt: Date;
};

type WorkspaceWithRelationsRecord = WorkspaceRecord & {
  deliverable?: WorkspaceWithRelations['deliverable'];
  files: Array<Parameters<typeof mapWorkspaceFile>[0]>;
  knowledgeItems: KnowledgeItemRecord[];
  stagedChangeSets?: WorkspaceWithRelations['stagedChangeSets'];
  versions: WorkspaceVersionData[];
  workspacePlan?: WorkspaceWithRelations['workspacePlan'];
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

export function mapKnowledgeItem(item: KnowledgeItemRecord): KnowledgeItemData {
  return {
    id: item.id,
    organizationId: item.organizationId,
    workspaceId: item.documentId,
    wikiId: item.documentId,
    title: item.title,
    content: item.content,
    sourceType: item.sourceType,
    createdByUserId: item.createdByUserId,
    originDeviceId: item.originDeviceId,
    revision: item.revision,
    deletedAt: item.deletedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function mapMemory(memory: MemoryRecord): MemoryData {
  return {
    id: memory.id,
    organizationId: memory.organizationId,
    conversationId: memory.sessionId,
    workspaceId: memory.documentId,
    wikiId: memory.documentId,
    category: memory.category,
    content: memory.content,
    sourceThreadId: memory.sourceThreadId,
    active: memory.active,
    createdByUserId: memory.createdByUserId,
    originDeviceId: memory.originDeviceId,
    revision: memory.revision,
    deletedAt: memory.deletedAt,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

export function mapWorkspaceWithRelations(
  workspace: WorkspaceWithRelationsRecord
): WorkspaceWithRelations {
  return {
    ...mapWorkspace(workspace),
    deliverable: workspace.deliverable || null,
    files: workspace.files.map(mapWorkspaceFile),
    knowledgeItems: workspace.knowledgeItems.map(mapKnowledgeItem),
    stagedChangeSets: workspace.stagedChangeSets || [],
    versions: workspace.versions,
    workspacePlan: workspace.workspacePlan || null,
  };
}
