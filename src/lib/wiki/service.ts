import {
  WorkspaceLockConflictError,
  acquireWorkspaceLock,
  branchConversation,
  createConversationForWorkspace,
  createConversationMessage as createWorkspaceConversationMessage,
  createWorkspaceVersion,
  createWorkspaceWithConversation,
  getActiveWorkspaceLock,
  getConversationWorkspace as getWorkspaceConversation,
  getWorkspaceView,
  listConversationBranches,
  listConversations as listWorkspaceConversations,
  listWorkspaceVersions,
  listWorkspaces,
  mapCommentMessage,
  mapCommentThread,
  mapConversation,
  mapConversationMessage,
  mapKnowledgeItem,
  mapMemory,
  mapWorkspace,
  mapWorkspaceVersion,
  releaseWorkspaceLock,
  updateWorkspace,
} from '@/lib/workspace/service';

type ActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

export const WikiLockConflictError = WorkspaceLockConflictError;

export const listWikis = listWorkspaces;
export const mapWiki = mapWorkspace;
export const mapWikiVersion = mapWorkspaceVersion;
export {
  branchConversation,
  listConversationBranches,
  mapCommentMessage,
  mapCommentThread,
  mapConversation,
  mapConversationMessage,
  mapKnowledgeItem,
  mapMemory,
};

export async function createWikiWithConversation(
  actor: ActorContext,
  input?: {
    content?: string;
    conversationTitle?: string;
    title?: string;
  }
) {
  const result = await createWorkspaceWithConversation(actor, input);
  return {
    conversation: result.conversation,
    primaryFile: result.primaryFile,
    wiki: result.workspace,
    workspace: result.workspace,
  };
}

export async function createConversationForWiki(
  actor: ActorContext,
  input: {
    activeFileId?: string | null;
    baseVersionId?: string | null;
    forkedFromMessageId?: string | null;
    parentConversationId?: string | null;
    title?: string;
    wikiId: string;
  }
) {
  return createConversationForWorkspace(actor, {
    activeFileId: input.activeFileId,
    baseVersionId: input.baseVersionId,
    forkedFromMessageId: input.forkedFromMessageId,
    parentConversationId: input.parentConversationId,
    title: input.title,
    workspaceId: input.wikiId,
  });
}

export async function listConversations(params: {
  organizationId: string;
  wikiId?: string | null;
}) {
  return listWorkspaceConversations({
    organizationId: params.organizationId,
    workspaceId: params.wikiId,
  });
}

export async function createConversationMessage(
  actor: ActorContext,
  input: {
    activeFileId?: string | null;
    content: string;
    conversationId: string;
    model?: string | null;
    role: string;
    wikiId?: string | null;
  }
) {
  return createWorkspaceConversationMessage(actor, {
    activeFileId: input.activeFileId,
    content: input.content,
    conversationId: input.conversationId,
    model: input.model,
    role: input.role,
    workspaceId: input.wikiId,
  });
}

export async function getWikiWorkspace(params: {
  conversationId?: string | null;
  organizationId: string;
  wikiId: string;
}) {
  const view = await getWorkspaceView({
    conversationId: params.conversationId,
    organizationId: params.organizationId,
    workspaceId: params.wikiId,
  });

  return {
    activeLock: view.activeLock || null,
    conversationTree: view.conversationTree,
    currentConversation: view.currentConversation,
    currentFile: view.currentFile,
    selectedVersion: view.selectedVersion,
    files: view.files,
    latestConversation: view.latestConversation,
    versionFiles: view.versionFiles,
    versions: view.versions,
    wiki: view.workspace,
    workspace: view.workspace,
  };
}

export async function getConversationWorkspace(params: {
  conversationId: string;
  organizationId: string;
}) {
  const result = await getWorkspaceConversation(params);
  if (!result) {
    return null;
  }

  return {
    conversation: result.conversation,
    wiki: result.workspace,
    workspace: result.workspace,
  };
}

export async function updateWiki(
  actor: ActorContext,
  input: {
    content?: string;
    status?: string;
    title?: string;
    wikiId: string;
  }
) {
  return updateWorkspace(actor, {
    content: input.content,
    status: input.status,
    title: input.title,
    workspaceId: input.wikiId,
  });
}

export async function listWikiVersions(params: {
  organizationId: string;
  wikiId: string;
}) {
  return listWorkspaceVersions({
    organizationId: params.organizationId,
    workspaceId: params.wikiId,
  });
}

export async function createWikiVersion(actor: ActorContext, wikiId: string) {
  return createWorkspaceVersion(actor, {
    workspaceId: wikiId,
  });
}

export async function getActiveWikiLock(organizationId: string, wikiId: string) {
  return getActiveWorkspaceLock(organizationId, wikiId);
}

export async function acquireWikiLock(
  actor: ActorContext,
  input: {
    lockedVersionId?: string | null;
    ttlMinutes?: number;
    wikiId: string;
  }
) {
  return acquireWorkspaceLock(actor, {
    lockedVersionId: input.lockedVersionId,
    ttlMinutes: input.ttlMinutes,
    workspaceId: input.wikiId,
  });
}

export async function releaseWikiLock(actor: ActorContext, wikiId: string) {
  return releaseWorkspaceLock(actor, wikiId);
}
