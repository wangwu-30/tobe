import { Prisma } from '@/generated/prisma/client';
import {
  createWorkspaceFile as createWorkspaceFileCommand,
  deleteWorkspaceFile as deleteWorkspaceFileCommand,
  ensureSupportUploadsFolder as ensureSupportUploadsFolderCommand,
  ensureWorkspaceFiles,
  rebuildDescendantPaths,
  updateWorkspaceFile as updateWorkspaceFileCommand,
} from '@/objects/file/commands';
import {
  buildWorkspacePath,
  getDefaultFileName,
  getInitialFileContent,
  inferFileKind,
  inferFileLanguage,
  makeUniqueChildName,
  mapWorkspaceFile,
  parseVersionFiles,
  resolveCurrentVersionFile,
  resolveCurrentWorkspaceFile,
  resolvePrimaryFile,
} from '@/objects/file/schema';
import {
  buildProjectFolders,
  buildProjectSummary,
  getNextProjectTreeSortOrder,
  listProjects,
  resolveWorkspaceProjectId,
  resolveWorkspaceProjectTitle,
} from '@/objects/project/queries';
import {
  createWorkspaceVersion as createWorkspaceVersionCommand,
  pruneWorkspaceRecoveryCheckpoints,
  replaceWorkspaceDraftWithVersionFiles,
  restoreWorkspaceVersion as restoreWorkspaceVersionCommand,
  setWorkspaceVersionPinned as setWorkspaceVersionPinnedCommand,
} from '@/objects/state/commands';
import {
  findNearestVersionBeforeMessage,
  resolveDraftBaseVersionIdForVersion,
} from '@/objects/state/queries';
import { normalizeWorkspaceVersionType } from '@/objects/state/schema';
import {
  buildReviewAnchorFingerprint,
  parseReviewAnchor,
} from '@/lib/comments/review-anchor';
import { normalizeCommentThreadStatus } from '@/lib/comments/status';
import { prisma } from '@/lib/db/prisma';
import { bindDraftThreadsToVersion } from '@/lib/comments/version-binding';
import { materializeWorkspaceMirror } from '@/lib/platform/mirror-manager';
import {
  listWorkspaceRuns,
  startWorkspacePreview,
} from '@/lib/platform/run-service';
import { recordSyncEvent } from '@/lib/platform/sync';
import { DEFAULT_APP_LANGUAGE, type AppLanguage } from '@/lib/i18n/language';
import { parseAssistantRunPayload } from '@/lib/workspace/assistant-run-payload';
import {
  parseCommentAgentBindings,
  parseCommentAgentMentionsJson,
} from '@/lib/comments/agents';
import { parseCommentResearchState } from '@/lib/comments/research';
import {
  isPinnedRecoveryVersionType,
  isRecoveryVersionType,
  buildDeliverable,
  getWorkspacePlan,
  hydrateWorkspacePlanForView,
  isVisibleVersion,
  listStagedChangeSets,
  mapWorkspacePlan,
} from '@/lib/workspace/planning';
import { detectWorkspacePreviewCapability } from '@/lib/workspace/preview';
import { deriveWorkflowSummary } from '@/lib/workspace/workflow';
import type {
  AssistantRunData,
  ChatAttachmentData,
  CommentMessageData,
  CommentThreadData,
  ConversationBranchSummary,
  ConversationData,
  ConversationMessageData,
  ConversationWithRelations,
  KnowledgeItemData,
  MemoryData,
  ProjectSummaryData,
  ReviewAnchorData,
  WorkspaceData,
  WorkspaceEditLockData,
  WorkspaceFileData,
  WorkspaceVersionData,
  WorkspaceVersionType,
  WorkspaceViewData,
  WorkspaceWithRelations,
} from '@/types';

type ActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

type LockConflict = {
  expiresAt: Date;
  userId: string;
  workspaceId: string;
};

export {
  getNextProjectTreeSortOrder,
  listProjects,
  PROJECT_TREE_SORT_STEP,
} from '@/objects/project/queries';
export {
  buildWorkspacePath,
  getDefaultFileName,
  getInitialFileContent,
  getParentWorkspacePath,
  getWorkspacePathDepth,
  inferFileKind,
  inferFileLanguage,
  makeUniqueChildName,
  mapWorkspaceFile,
  normalizeWorkspaceFileRole,
  parseVersionFiles,
} from '@/objects/file/schema';
export { WorkspaceRecoveryPinLimitError } from '@/objects/state/commands';

type SupportFileEnvelope = {
  base64?: string;
  encoding: 'base64';
  kind: 'binary';
  mimeType: string | null;
  originalName: string;
  sizeBytes: number | null;
};

export class WorkspaceLockConflictError extends Error {
  readonly detail: LockConflict;

  constructor(detail: LockConflict) {
    super('Workspace is locked by another user.');
    this.detail = detail;
  }
}

export const WikiLockConflictError = WorkspaceLockConflictError;

export const listWorkspaces = listProjects;

export async function createWorkspaceWithConversation(
  actor: ActorContext,
  input?: {
    content?: string;
    conversationTitle?: string;
    fileName?: string;
    fileKind?: 'richtext' | 'markdown' | 'text' | 'code';
    title?: string;
  }
) {
  const title = input?.title?.trim() || 'Untitled Project';
  const initialFileName =
    input?.fileName?.trim() || getDefaultFileName(input?.fileKind || 'richtext');
  const initialFileKind = input?.fileKind || inferFileKind(initialFileName);
  const content =
    input?.content !== undefined ? input.content : getInitialFileContent(initialFileKind);

  const result = await prisma.$transaction(async (tx) => {
    const conversation = await tx.session.create({
      data: {
        organizationId: actor.organizationId,
        title: input?.conversationTitle?.trim() || title,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
        sourceType: 'chat',
      },
    });

    let workspace = await tx.document.create({
      data: {
        organizationId: actor.organizationId,
        sessionId: conversation.id,
        title,
        content,
        status: 'draft',
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
    });

    workspace = await tx.document.update({
      where: { id: workspace.id },
      data: {
        projectId: workspace.id,
        projectTitle: title,
      },
    });

    const primaryFile = await tx.workspaceFile.create({
      data: {
        organizationId: actor.organizationId,
        documentId: workspace.id,
        name: initialFileName,
        path: initialFileName,
        type: 'file',
        kind: initialFileKind,
        role: 'deliverable',
        language: inferFileLanguage(initialFileName),
        content,
        isPrimary: true,
        sortOrder: 0,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
    });

    const updatedConversation = await tx.session.update({
      where: { id: conversation.id },
      data: {
        activeFileId: primaryFile.id,
        wikiId: workspace.id,
      },
    });

    return {
      conversation: updatedConversation,
      primaryFile,
      workspace,
    };
  });

  await Promise.all([
    recordSyncEvent({
      actorUserId: actor.userId,
      entityId: result.workspace.id,
      entityType: 'workspace',
      organizationId: actor.organizationId,
      originDeviceId: actor.deviceId,
      payload: {
        op: 'create',
        title: result.workspace.title,
      },
      revision: result.workspace.revision,
    }),
    recordSyncEvent({
      actorUserId: actor.userId,
      entityId: result.primaryFile.id,
      entityType: 'workspace_file',
      organizationId: actor.organizationId,
      originDeviceId: actor.deviceId,
      payload: {
        op: 'create',
        name: result.primaryFile.name,
        workspaceId: result.workspace.id,
      },
      revision: result.primaryFile.revision,
    }),
    recordSyncEvent({
      actorUserId: actor.userId,
      entityId: result.conversation.id,
      entityType: 'conversation',
      organizationId: actor.organizationId,
      originDeviceId: actor.deviceId,
      payload: {
        op: 'create',
        title: result.conversation.title,
        workspaceId: result.workspace.id,
      },
      revision: result.conversation.revision,
    }),
  ]);

  await materializeWorkspaceMirror({
    organizationId: actor.organizationId,
    workspaceId: result.workspace.id,
  });

  return {
    conversation: mapConversation(result.conversation),
    primaryFile: mapWorkspaceFile(result.primaryFile),
    workspace: mapWorkspace(result.workspace),
  };
}

export async function createConversationForWorkspace(
  actor: ActorContext,
  input: {
    activeFileId?: string | null;
    baseVersionId?: string | null;
    forkedFromMessageId?: string | null;
    parentConversationId?: string | null;
    sourceType?: string;
    title?: string;
    workspaceId: string;
  }
) {
  const workspace = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: input.workspaceId,
      organizationId: actor.organizationId,
    },
  });

  if (!workspace) {
    throw new Error('Workspace not found.');
  }

  const files = await ensureWorkspaceFiles(actor.organizationId, workspace.id);
  const primaryFile = resolvePrimaryFile(files);
  const sourceType = input.sourceType || 'chat';

  const conversation = await prisma.session.create({
    data: {
      organizationId: actor.organizationId,
      wikiId: workspace.id,
      title: input.title?.trim() || workspace.title,
      parentSessionId: input.parentConversationId || null,
      forkedFromMessageId: input.forkedFromMessageId || null,
      baseVersionId: input.baseVersionId || null,
      activeFileId: input.activeFileId || primaryFile?.id || null,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      sourceType,
    },
  });

  await recordSyncEvent({
    actorUserId: actor.userId,
    entityId: conversation.id,
    entityType: 'conversation',
    organizationId: actor.organizationId,
    originDeviceId: actor.deviceId,
    payload: {
      op: 'create',
        title: conversation.title,
        workspaceId: workspace.id,
        parentConversationId: input.parentConversationId || null,
        baseVersionId: input.baseVersionId || null,
        sourceType,
      },
      revision: conversation.revision,
    });

  return mapConversation(conversation);
}

export async function createConversationFromWorkspaceVersion(
  actor: ActorContext,
  input: {
    activeFileId?: string | null;
    parentConversationId?: string | null;
    title?: string;
    versionId: string;
    workspaceId: string;
  }
) {
  const version = await prisma.version.findFirst({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      id: input.versionId,
      organizationId: actor.organizationId,
    },
    select: {
      id: true,
    },
  });

  if (!version) {
    throw new Error('Version not found.');
  }

  return createConversationForWorkspace(actor, {
    activeFileId: input.activeFileId,
    baseVersionId: version.id,
    parentConversationId: input.parentConversationId,
    sourceType: 'version',
    title: input.title,
    workspaceId: input.workspaceId,
  });
}

export async function listConversations(params: {
  organizationId: string;
  workspaceId?: string | null;
}) {
  const conversations = await prisma.session.findMany({
    where: {
      deletedAt: null,
      organizationId: params.organizationId,
      ...(params.workspaceId ? { wikiId: params.workspaceId } : {}),
    },
    include: {
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return conversations.map((conversation) => ({
    ...mapConversation(conversation),
    messages: conversation.messages.map(mapConversationMessage),
  }));
}

export async function listConversationBranches(params: {
  organizationId: string;
  workspaceId: string;
}) {
  const conversations = await prisma.session.findMany({
    where: {
      deletedAt: null,
      organizationId: params.organizationId,
      wikiId: params.workspaceId,
    },
    include: {
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { updatedAt: 'asc' },
  });

  return buildConversationTree(
    conversations.map((conversation) => ({
      ...mapConversation(conversation),
      lastMessagePreview: conversation.messages[0]
        ? truncate(conversation.messages[0].content)
        : null,
    }))
  );
}

export async function createConversationMessage(
  actor: ActorContext,
  input: {
    activeFileId?: string | null;
    content: string;
    conversationId: string;
    model?: string | null;
    role: string;
    workspaceId?: string | null;
  }
) {
  const message = await prisma.chatMessage.create({
    data: {
      organizationId: actor.organizationId,
      sessionId: input.conversationId,
      role: input.role,
      content: input.content,
      documentId: input.workspaceId || null,
      model: input.model || null,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
    },
  });

  await prisma.session.update({
    where: { id: input.conversationId },
    data: {
      ...(input.activeFileId !== undefined ? { activeFileId: input.activeFileId } : {}),
      originDeviceId: actor.deviceId,
      revision: {
        increment: 1,
      },
      updatedAt: new Date(),
    },
  });

  await recordSyncEvent({
    actorUserId: actor.userId,
    entityId: message.id,
    entityType: 'conversation_message',
    organizationId: actor.organizationId,
    originDeviceId: actor.deviceId,
    payload: {
      op: 'create',
      conversationId: input.conversationId,
      role: input.role,
      workspaceId: input.workspaceId || null,
    },
    revision: message.revision,
  });

  return mapConversationMessage(message);
}

export async function listAssistantRuns(params: {
  conversationId?: string | null;
  organizationId: string;
  workspaceId?: string | null;
}) {
  const runs = await prisma.assistantRun.findMany({
    where: {
      deletedAt: null,
      organizationId: params.organizationId,
      ...(params.conversationId ? { sessionId: params.conversationId } : {}),
      ...(params.workspaceId ? { documentId: params.workspaceId } : {}),
    },
    orderBy: [{ startedAt: 'asc' }, { createdAt: 'asc' }],
  });

  return runs.map(mapAssistantRun);
}

export async function createAssistantRun(
  actor: ActorContext,
  input: {
    conversationId: string;
    mode: AssistantRunData['mode'];
    payloadJson?: string | null;
    requestMessageId?: string | null;
    title: string;
    workspaceId: string;
  }
) {
  const run = await prisma.assistantRun.create({
    data: {
      organizationId: actor.organizationId,
      sessionId: input.conversationId,
      documentId: input.workspaceId,
      requestMessageId: input.requestMessageId || null,
      mode: input.mode,
      title: input.title.trim(),
      status: 'queued',
      payloadJson: input.payloadJson || null,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
    },
  });

  return mapAssistantRun(run);
}

export async function updateAssistantRun(
  actor: ActorContext,
  input: {
    finishedAt?: Date | null;
    mode?: AssistantRunData['mode'];
    payloadJson?: string | null;
    runId: string;
    status?: AssistantRunData['status'];
    summary?: string | null;
  }
) {
  const existing = await prisma.assistantRun.findFirst({
    where: {
      deletedAt: null,
      id: input.runId,
      organizationId: actor.organizationId,
    },
  });

  if (!existing) {
    throw new Error('Assistant run not found.');
  }

  const run = await prisma.assistantRun.update({
    where: { id: existing.id },
    data: {
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.payloadJson !== undefined ? { payloadJson: input.payloadJson } : {}),
      ...(input.finishedAt !== undefined ? { finishedAt: input.finishedAt } : {}),
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      revision: {
        increment: 1,
      },
    },
  });

  return mapAssistantRun(run);
}

export async function storeMessageSupportAttachments(
  actor: ActorContext,
  input: {
    attachments: Array<{
      content: string;
      kind: ChatAttachmentData['kind'];
      mimeType: string | null;
      originalName: string;
      sizeBytes: number | null;
      source: ChatAttachmentData['source'];
      storageFormat: ChatAttachmentData['storageFormat'];
    }>;
    conversationId: string;
    messageId: string;
    workspaceId: string;
  }
) {
  const uploadRoot = await ensureSupportUploadsFolder(actor, input.workspaceId);
  const createdAttachments: ChatAttachmentData[] = [];

  for (const attachment of input.attachments) {
    const file = await createWorkspaceFile(actor, {
      kind: 'text',
      name: attachment.originalName,
      parentId: uploadRoot.id,
      role: 'support',
      workspaceId: input.workspaceId,
    });

    const updatedFile = await updateWorkspaceFile(actor, {
      content: attachment.content,
      fileId: file.id,
      role: 'support',
      workspaceId: input.workspaceId,
    });

    const created = await prisma.chatAttachment.create({
      data: {
        organizationId: actor.organizationId,
        sessionId: input.conversationId,
        messageId: input.messageId,
        documentId: input.workspaceId,
        fileId: updatedFile.id,
        kind: attachment.kind,
        source: attachment.source,
        storageFormat: attachment.storageFormat,
        mimeType: attachment.mimeType,
        originalName: attachment.originalName,
        sizeBytes: attachment.sizeBytes,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
      include: {
        file: {
          select: {
            path: true,
          },
        },
      },
    });

    createdAttachments.push(mapChatAttachment(created));
  }

  return createdAttachments;
}

export async function branchConversation(
  actor: ActorContext,
  input: {
    conversationId: string;
    messageId: string;
    title?: string;
  }
) {
  const conversation = await prisma.session.findFirst({
    where: {
      deletedAt: null,
      id: input.conversationId,
      organizationId: actor.organizationId,
    },
  });

  if (!conversation || !conversation.wikiId) {
    throw new Error('Conversation not found.');
  }

  const messages = await prisma.chatMessage.findMany({
    where: {
      deletedAt: null,
      organizationId: actor.organizationId,
      sessionId: conversation.id,
    },
    orderBy: { createdAt: 'asc' },
  });

  const forkIndex = messages.findIndex((message) => message.id === input.messageId);
  if (forkIndex === -1) {
    throw new Error('Message not found in conversation.');
  }

  const forkMessage = messages[forkIndex];
  const inheritedMessages = messages.slice(0, forkIndex + 1);
  const baseVersion = await findNearestVersionBeforeMessage({
    messageCreatedAt: forkMessage.createdAt,
    organizationId: actor.organizationId,
    workspaceId: conversation.wikiId,
  });

  const fallbackTitle = truncate(
    forkMessage.content.replace(/\s+/g, ' ').trim(),
    42
  ).trim();
  const title =
    input.title?.trim() ||
    fallbackTitle ||
    'New Conversation';

  const branchedConversation = await prisma.$transaction(async (tx) => {
    const nextConversation = await tx.session.create({
      data: {
        organizationId: actor.organizationId,
        wikiId: conversation.wikiId,
        title,
        parentSessionId: conversation.id,
        forkedFromMessageId: forkMessage.id,
        baseVersionId: baseVersion?.id || conversation.baseVersionId || null,
        activeFileId: conversation.activeFileId,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
        sourceType: 'branch',
      },
    });

    if (inheritedMessages.length > 0) {
      await tx.chatMessage.createMany({
        data: inheritedMessages.map((message) => ({
          organizationId: actor.organizationId,
          sessionId: nextConversation.id,
          role: message.role,
          content: message.content,
          documentId: message.documentId,
          model: message.model,
          createdByUserId: message.createdByUserId,
          originDeviceId: message.originDeviceId,
          createdAt: message.createdAt,
        })),
      });
    }

    return nextConversation;
  });

  await recordSyncEvent({
    actorUserId: actor.userId,
    entityId: branchedConversation.id,
    entityType: 'conversation_branch',
    organizationId: actor.organizationId,
    originDeviceId: actor.deviceId,
    payload: {
      op: 'branch',
      parentConversationId: conversation.id,
      forkedFromMessageId: forkMessage.id,
      baseVersionId: baseVersion?.id || conversation.baseVersionId || null,
      workspaceId: conversation.wikiId,
    },
    revision: branchedConversation.revision,
  });

  return {
    baseVersion: baseVersion ? mapWorkspaceVersion(baseVersion) : null,
    conversation: mapConversation(branchedConversation),
  };
}

export async function updateWorkspace(
  actor: ActorContext,
  input: {
    content?: string;
    projectFolderId?: string | null;
    treeSortOrder?: number;
    status?: string;
    title?: string;
    workspaceId: string;
  }
) {
  await ensureWorkspaceEditable(actor, input.workspaceId);
  const files = await ensureWorkspaceFiles(actor.organizationId, input.workspaceId);
  const primaryFile = resolvePrimaryFile(files);
  const workspaceRecord =
    input.projectFolderId !== undefined
      ? await prisma.document.findFirst({
          where: {
            deletedAt: null,
            id: input.workspaceId,
            organizationId: actor.organizationId,
          },
          select: { id: true, projectFolderId: true, projectId: true, treeSortOrder: true },
        })
      : null;

  if (input.projectFolderId !== undefined && !workspaceRecord) {
    throw new Error('Workspace not found.');
  }

  if (input.projectFolderId) {
    const projectFolder = await prisma.projectFolder.findFirst({
      where: {
        deletedAt: null,
        id: input.projectFolderId,
        organizationId: actor.organizationId,
        projectId: resolveWorkspaceProjectId(workspaceRecord!),
      },
      select: { id: true },
    });

    if (!projectFolder) {
      throw new Error('Project folder not found.');
    }
  }

  const nextTreeSortOrder =
    input.treeSortOrder !== undefined
      ? input.treeSortOrder
      : input.projectFolderId !== undefined &&
          workspaceRecord &&
          workspaceRecord.projectFolderId !== input.projectFolderId
        ? await getNextProjectTreeSortOrder({
            organizationId: actor.organizationId,
            parentFolderId: input.projectFolderId || null,
            projectId: resolveWorkspaceProjectId(workspaceRecord),
          })
        : undefined;

  if (input.content !== undefined && primaryFile) {
    await prisma.workspaceFile.update({
      where: { id: primaryFile.id },
      data: {
        content: input.content,
        originDeviceId: actor.deviceId,
        createdByUserId: actor.userId,
        revision: {
          increment: 1,
        },
      },
    });
  }

  const workspace = await prisma.document.update({
    where: { id: input.workspaceId },
    data: {
      ...(input.content !== undefined && { content: input.content }),
      ...(input.projectFolderId !== undefined && {
        projectFolderId: input.projectFolderId,
      }),
      ...(nextTreeSortOrder !== undefined && {
        treeSortOrder: nextTreeSortOrder,
      }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.title !== undefined && { title: input.title }),
      originDeviceId: actor.deviceId,
      createdByUserId: actor.userId,
      revision: {
        increment: 1,
      },
      updatedAt: new Date(),
    },
  });

  await recordSyncEvent({
    actorUserId: actor.userId,
    entityId: workspace.id,
    entityType: 'workspace',
    organizationId: actor.organizationId,
    originDeviceId: actor.deviceId,
    payload: {
      op: 'update',
      status: input.status,
      projectFolderId: input.projectFolderId,
      treeSortOrder: nextTreeSortOrder,
      title: input.title,
      hasContent: input.content !== undefined,
    },
    revision: workspace.revision,
  });

  if (input.content !== undefined) {
    await materializeWorkspaceMirror({
      organizationId: actor.organizationId,
      workspaceId: input.workspaceId,
    });
  }

  return mapWorkspace(workspace);
}

export async function listWorkspaceFiles(params: {
  organizationId: string;
  workspaceId: string;
}) {
  const files = await ensureWorkspaceFiles(params.organizationId, params.workspaceId);
  return files.map(mapWorkspaceFile);
}

export async function createWorkspaceFile(
  actor: ActorContext,
  input: {
    kind?: 'richtext' | 'markdown' | 'text' | 'code';
    name: string;
    nodeType?: 'file' | 'folder';
    parentId?: string | null;
    role?: 'deliverable' | 'support';
    workspaceId: string;
  }
) {
  return createWorkspaceFileCommand(actor, input, {
    ensureWorkspaceEditable,
  });
}

export async function updateWorkspaceFile(
  actor: ActorContext,
  input: {
    content?: string;
    fileId: string;
    kind?: 'richtext' | 'markdown' | 'text' | 'code';
    language?: string | null;
    name?: string;
    parentId?: string | null;
    role?: 'deliverable' | 'support';
    setPrimary?: boolean;
    sortOrder?: number;
    workspaceId: string;
  }
) {
  return updateWorkspaceFileCommand(actor, input, {
    ensureWorkspaceEditable,
  });
}

export async function deleteWorkspaceFile(
  actor: ActorContext,
  input: {
    fileId: string;
    workspaceId: string;
  }
) {
  return deleteWorkspaceFileCommand(actor, input, {
    ensureWorkspaceEditable,
  });
}

export async function listWorkspaceVersions(params: {
  organizationId: string;
  workspaceId: string;
}) {
  const versions = await prisma.version.findMany({
    where: {
      deletedAt: null,
      documentId: params.workspaceId,
      organizationId: params.organizationId,
    },
    orderBy: { versionNum: 'desc' },
  });

  return versions.map(mapWorkspaceVersion);
}

export async function createWorkspaceVersion(
  actor: ActorContext,
  input: {
    bindDraftThreads?: boolean;
    versionType?: WorkspaceVersionType;
    sourceConversationId?: string | null;
    sourceMessageId?: string | null;
    title?: string;
    workspaceId: string;
  }
) {
  const version = await createWorkspaceVersionCommand(actor, input, {
    bindDraftThreadsToVersion,
    ensureWorkspaceEditable,
    recordSyncEvent,
  });

  return mapWorkspaceVersion(version);
}

export async function setWorkspaceVersionPinned(
  actor: ActorContext,
  input: {
    pinned: boolean;
    versionId: string;
    workspaceId: string;
  }
) {
  const updated = await setWorkspaceVersionPinnedCommand(actor, input, {
    ensureWorkspaceEditable,
  });

  return mapWorkspaceVersion(updated);
}

export async function restoreWorkspaceVersion(
  actor: ActorContext,
  input: {
    versionId: string;
    workspaceId: string;
  }
) {
  const restored = await restoreWorkspaceVersionCommand(actor, input, {
    bindDraftThreadsToVersion,
    ensureWorkspaceEditable,
    listWorkspaceRuns,
    materializeWorkspaceMirror,
    recordSyncEvent,
    startWorkspacePreview,
  });

  return {
    restoredVersion: mapWorkspaceVersion(restored.restoredVersion),
    restartedPreview: restored.restartedPreview,
    safetyCheckpoint: mapWorkspaceVersion(restored.safetyCheckpoint),
  };
}

export async function continueWorkspaceFromVersion(
  actor: ActorContext,
  input: {
    activeFileId?: string | null;
    parentConversationId?: string | null;
    safetyCheckpointTitle?: string;
    title?: string;
    versionId: string;
    workspaceId: string;
  }
) {
  await ensureWorkspaceEditable(actor, input.workspaceId);

  const sourceVersion = await prisma.version.findFirst({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      id: input.versionId,
      organizationId: actor.organizationId,
    },
  });

  if (!sourceVersion) {
    throw new Error('Version not found.');
  }

  const safetyCheckpoint = await createWorkspaceVersion(actor, {
    bindDraftThreads: true,
    versionType: 'checkpoint',
    title: input.safetyCheckpointTitle || 'Safety Checkpoint before Continue',
    workspaceId: input.workspaceId,
  });

  const workspace = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: input.workspaceId,
      organizationId: actor.organizationId,
    },
    select: {
      currentVersion: true,
      id: true,
      title: true,
    },
  });

  if (!workspace) {
    throw new Error('Workspace not found.');
  }

  const branchTitle = input.title?.trim() || sourceVersion.title || workspace.title;
  const branchVersion = await prisma.$transaction(async (tx) => {
    const nextVersionNum = workspace.currentVersion + 1;
    const created = await tx.version.create({
      data: {
        organizationId: actor.organizationId,
        documentId: workspace.id,
        versionNum: nextVersionNum,
        content: sourceVersion.content,
        title: branchTitle,
        parentVersionId: sourceVersion.id,
        sourceSessionId: input.parentConversationId || null,
        sourceMessageId: null,
        versionType: 'manual',
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
    });

    await tx.document.update({
      where: { id: workspace.id },
      data: {
        currentVersion: nextVersionNum,
        originDeviceId: actor.deviceId,
        revision: {
          increment: 1,
        },
      },
    });

    return created;
  });

  await recordSyncEvent({
    actorUserId: actor.userId,
    entityId: branchVersion.id,
    entityType: 'workspace_version',
    organizationId: actor.organizationId,
    originDeviceId: actor.deviceId,
    payload: {
      op: 'create',
      versionNum: branchVersion.versionNum,
      workspaceId: workspace.id,
      sourceConversationId: input.parentConversationId || null,
      sourceMessageId: null,
    },
    revision: branchVersion.revision,
  });

  const { activeFileId } = await replaceWorkspaceDraftWithVersionFiles(
    actor,
    {
      draftBaseVersionId: branchVersion.id,
      hadActivePreview: (
        await listWorkspaceRuns({
          organizationId: actor.organizationId,
          workspaceId: input.workspaceId,
        })
      ).some(
        (run) =>
          run.kind === 'preview' &&
          (run.status === 'pending' || run.status === 'running')
      ),
      preferredActiveFileId: input.activeFileId || null,
      versionFiles: parseVersionFiles(branchVersion.content),
      workspaceId: input.workspaceId,
    },
    {
      materializeWorkspaceMirror,
      startWorkspacePreview,
    }
  );

  const conversation = await createConversationForWorkspace(actor, {
    activeFileId,
    baseVersionId: branchVersion.id,
    parentConversationId: input.parentConversationId,
    sourceType: 'version',
    title: branchTitle,
    workspaceId: input.workspaceId,
  });

  return {
    baseVersion: mapWorkspaceVersion(branchVersion),
    conversation,
    safetyCheckpoint,
  };
}

export async function switchWorkspaceToVersionBranch(
  actor: ActorContext,
  input: {
    activeFileId?: string | null;
    parentConversationId?: string | null;
    safetyCheckpointTitle?: string;
    title?: string;
    versionId: string;
    workspaceId: string;
  }
) {
  await ensureWorkspaceEditable(actor, input.workspaceId);

  const sourceVersion = await prisma.version.findFirst({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      id: input.versionId,
      organizationId: actor.organizationId,
    },
  });

  if (!sourceVersion) {
    throw new Error('Version not found.');
  }

  if (isRecoveryVersionType(normalizeWorkspaceVersionType(sourceVersion.versionType))) {
    throw new Error('Only visible branch heads can become the current draft base.');
  }

  const childVersions = await prisma.version.findMany({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      organizationId: actor.organizationId,
      parentVersionId: sourceVersion.id,
    },
    select: {
      versionType: true,
    },
  });

  if (
    childVersions.some(
      (version) => !isRecoveryVersionType(normalizeWorkspaceVersionType(version.versionType))
    )
  ) {
    throw new Error('Only visible branch heads can become the current draft base.');
  }

  const safetyCheckpoint = await createWorkspaceVersion(actor, {
    bindDraftThreads: true,
    versionType: 'checkpoint',
    title:
      input.safetyCheckpointTitle || 'Safety Checkpoint before Branch Switch',
    workspaceId: input.workspaceId,
  });

  const { activeFileId } = await replaceWorkspaceDraftWithVersionFiles(
    actor,
    {
      draftBaseVersionId: sourceVersion.id,
      hadActivePreview: (
        await listWorkspaceRuns({
          organizationId: actor.organizationId,
          workspaceId: input.workspaceId,
        })
      ).some(
        (run) =>
          run.kind === 'preview' &&
          (run.status === 'pending' || run.status === 'running')
      ),
      preferredActiveFileId: input.activeFileId || null,
      versionFiles: parseVersionFiles(sourceVersion.content),
      workspaceId: input.workspaceId,
    },
    {
      materializeWorkspaceMirror,
      startWorkspacePreview,
    }
  );

  const conversation = await createConversationForWorkspace(actor, {
    activeFileId,
    baseVersionId: sourceVersion.id,
    parentConversationId: input.parentConversationId,
    sourceType: 'version',
    title: input.title?.trim() || sourceVersion.title,
    workspaceId: input.workspaceId,
  });

  return {
    baseVersion: mapWorkspaceVersion(sourceVersion),
    conversation,
    safetyCheckpoint,
  };
}


export async function getActiveWorkspaceLock(
  organizationId: string,
  workspaceId: string
): Promise<WorkspaceEditLockData | null> {
  const lock = await prisma.wikiEditLock.findFirst({
    where: {
      documentId: workspaceId,
      expiresAt: {
        gt: new Date(),
      },
      organizationId,
    },
  });

  return lock ? mapWorkspaceEditLock(lock) : null;
}

export async function acquireWorkspaceLock(
  actor: ActorContext,
  input: {
    lockedVersionId?: string | null;
    ttlMinutes?: number;
    workspaceId: string;
  }
) {
  const existing = await prisma.wikiEditLock.findUnique({
    where: { documentId: input.workspaceId },
  });

  const expiresAt = new Date(Date.now() + (input.ttlMinutes || 15) * 60_000);

  if (existing && existing.expiresAt > new Date() && existing.userId !== actor.userId) {
    throw new WorkspaceLockConflictError({
      expiresAt: existing.expiresAt,
      userId: existing.userId,
      workspaceId: input.workspaceId,
    });
  }

  let lock;
  if (existing) {
    lock = await prisma.wikiEditLock.update({
      where: { documentId: input.workspaceId },
      data: {
        expiresAt,
        lockedVersionId: input.lockedVersionId || null,
        originDeviceId: actor.deviceId,
        organizationId: actor.organizationId,
        userId: actor.userId,
      },
    });
  } else {
    try {
      lock = await prisma.wikiEditLock.create({
        data: {
          organizationId: actor.organizationId,
          documentId: input.workspaceId,
          expiresAt,
          lockedVersionId: input.lockedVersionId || null,
          originDeviceId: actor.deviceId,
          userId: actor.userId,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const racedLock = await prisma.wikiEditLock.findUnique({
          where: { documentId: input.workspaceId },
        });

        if (
          racedLock &&
          racedLock.expiresAt > new Date() &&
          racedLock.userId !== actor.userId
        ) {
          throw new WorkspaceLockConflictError({
            expiresAt: racedLock.expiresAt,
            userId: racedLock.userId,
            workspaceId: input.workspaceId,
          });
        }

        lock = await prisma.wikiEditLock.update({
          where: { documentId: input.workspaceId },
          data: {
            expiresAt,
            lockedVersionId: input.lockedVersionId || null,
            originDeviceId: actor.deviceId,
            organizationId: actor.organizationId,
            userId: actor.userId,
          },
        });
      } else {
        throw error;
      }
    }
  }

  return mapWorkspaceEditLock(lock);
}

export async function releaseWorkspaceLock(actor: ActorContext, workspaceId: string) {
  const existing = await prisma.wikiEditLock.findUnique({
    where: { documentId: workspaceId },
  });

  if (!existing) {
    return { released: false };
  }

  if (existing.userId !== actor.userId) {
    throw new WorkspaceLockConflictError({
      expiresAt: existing.expiresAt,
      userId: existing.userId,
      workspaceId,
    });
  }

  await prisma.wikiEditLock.delete({
    where: { documentId: workspaceId },
  });

  return { released: true };
}

export async function getWorkspaceView(params: {
  conversationId?: string | null;
  fileId?: string | null;
  language?: AppLanguage | null;
  organizationId: string;
  versionId?: string | null;
  workspaceId: string;
}): Promise<WorkspaceViewData> {
  const workspace = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: params.workspaceId,
      organizationId: params.organizationId,
    },
    include: {
      knowledgeItems: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
      },
      workspacePlan: {
        select: {
          deliverableType: true,
        },
      },
    },
  });

  if (!workspace) {
    return {
      workspace: null,
      currentProject: null,
      projectFolders: [],
      projectDeliverables: [],
      deliverable: null,
      files: [],
      versions: [],
      visibleVersions: [],
      versionFiles: [],
      currentFile: null,
      currentConversation: null,
      latestConversation: null,
      conversationTree: [],
      conversationRuns: [],
      activeAssistantRun: null,
      activePreviewRun: null,
      selectedVersion: null,
      stagedChangeSets: [],
      workspacePlan: null,
      currentStatus: null,
      activeLock: null,
    };
  }

  const [
    files,
    versions,
    conversations,
    assistantRunRecords,
    activeLock,
    workspacePlan,
    projectDocuments,
    projectFolders,
    stagedChangeSets,
    workspaceRuns,
  ] = await Promise.all([
    ensureWorkspaceFiles(params.organizationId, workspace.id),
    listWorkspaceVersions({
      organizationId: params.organizationId,
      workspaceId: workspace.id,
    }),
    prisma.session.findMany({
      where: {
        deletedAt: null,
        organizationId: params.organizationId,
        wikiId: workspace.id,
      },
      include: {
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'asc' },
    }),
    prisma.assistantRun.findMany({
      where: {
        deletedAt: null,
        documentId: workspace.id,
        organizationId: params.organizationId,
      },
      orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
    }),
    getActiveWorkspaceLock(params.organizationId, workspace.id),
    getWorkspacePlan({
      organizationId: params.organizationId,
      workspaceId: workspace.id,
    }),
    prisma.document.findMany({
      where: {
        deletedAt: null,
        organizationId: params.organizationId,
        OR: [
          { id: resolveWorkspaceProjectId(workspace) },
          { projectId: resolveWorkspaceProjectId(workspace) },
        ],
      },
      include: {
        files: {
          where: {
            deletedAt: null,
            isPrimary: true,
            role: 'deliverable',
          },
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
        workspacePlan: true,
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.projectFolder.findMany({
      where: {
        deletedAt: null,
        organizationId: params.organizationId,
        projectId: resolveWorkspaceProjectId(workspace),
      },
      orderBy: { updatedAt: 'desc' },
    }),
    listStagedChangeSets({
      organizationId: params.organizationId,
      workspaceId: workspace.id,
    }),
    listWorkspaceRuns({
      organizationId: params.organizationId,
      workspaceId: workspace.id,
    }),
  ]);

  const currentConversationRecord = params.conversationId
    ? await prisma.session.findFirst({
        where: {
          deletedAt: null,
          id: params.conversationId,
          organizationId: params.organizationId,
          wikiId: workspace.id,
        },
        include: {
          messages: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
            include: {
              attachments: {
                where: { deletedAt: null },
                include: {
                  file: {
                    select: {
                      content: true,
                      path: true,
                    },
                  },
                },
                orderBy: { createdAt: 'asc' },
              },
            },
          },
        },
      })
    : null;

  const latestConversationRecord =
    currentConversationRecord ||
    (await prisma.session.findFirst({
      where: {
        deletedAt: null,
        organizationId: params.organizationId,
        wikiId: workspace.id,
      },
      include: {
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: {
            attachments: {
              where: { deletedAt: null },
                include: {
                  file: {
                    select: {
                      content: true,
                      path: true,
                    },
                  },
                },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    }));

  const selectedVersion =
    versions.find((version) => version.id === params.versionId) || null;
  const versionFiles = selectedVersion ? selectedVersion.files : [];

  const workspaceFiles = files.map(mapWorkspaceFile);
  const deliverableFiles = workspaceFiles.filter((file) => file.role === 'deliverable');
  const deliverable = buildDeliverable({
    currentVersion: workspace.currentVersion,
    files: workspaceFiles,
    plan: workspacePlan,
    storedDeliverableType: workspace.workspacePlan?.deliverableType || null,
    workspace,
  });
  const previewCapability = detectWorkspacePreviewCapability(deliverableFiles);
  const activePreviewRun =
    workspaceRuns.find(
      (run) =>
        run.kind === 'preview' &&
        (run.status === 'pending' || run.status === 'running')
    ) || null;
  const pendingChangeSetsByConversation = new Map<string, number>();
  stagedChangeSets
    .filter((changeSet) => changeSet.status === 'pending' && changeSet.conversationId)
    .forEach((changeSet) => {
      const conversationId = changeSet.conversationId!;
      pendingChangeSetsByConversation.set(
        conversationId,
        (pendingChangeSetsByConversation.get(conversationId) || 0) + 1
      );
    });
  const currentConversation = currentConversationRecord
    ? mapConversationWithRelations(
        currentConversationRecord,
        workspace,
        pendingChangeSetsByConversation
      )
    : latestConversationRecord
      ? mapConversationWithRelations(
          latestConversationRecord,
          workspace,
          pendingChangeSetsByConversation
        )
      : null;
  const latestConversation = latestConversationRecord
    ? mapConversationWithRelations(
        latestConversationRecord,
        workspace,
        pendingChangeSetsByConversation
      )
    : null;
  const conversationRuns = assistantRunRecords
    .filter((run) => run.sessionId === currentConversation?.id)
    .map(mapAssistantRun)
    .sort(
      (left, right) =>
        new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime()
    );
  const activeAssistantRun =
    assistantRunRecords
      .find((run) =>
        run.status === 'queued' || run.status === 'planning' || run.status === 'running'
      ) || null;

  const activeFile =
    selectedVersion && versionFiles.length > 0
      ? resolveCurrentVersionFile({
          fileId: params.fileId || currentConversation?.activeFileId || null,
          files: versionFiles,
        })
      : resolveCurrentWorkspaceFile({
          fileId:
            params.fileId || currentConversation?.activeFileId || resolvePrimaryFile(files)?.id || null,
          files: workspaceFiles,
        });
  const currentStatus = deriveWorkflowSummary({
    activePreviewRun,
    activeAssistantRun: activeAssistantRun ? mapAssistantRun(activeAssistantRun) : null,
    currentFiles: deliverableFiles,
    deliverable,
    language: params.language || DEFAULT_APP_LANGUAGE,
    previewCapability,
    versions,
    stagedChangeSets,
  });
  const hydratedWorkspacePlan = hydrateWorkspacePlanForView({
    activeAssistantRun: activeAssistantRun ? mapAssistantRun(activeAssistantRun) : null,
    currentStatus,
    plan: workspacePlan,
  });
  const currentProject = buildProjectSummary(projectDocuments, workspace);
  const mappedProjectFolders = buildProjectFolders(projectFolders);
  const projectDeliverables = buildProjectDeliverables(projectDocuments);

  return {
    workspace: mapWorkspaceWithRelations({
      ...workspace,
      deliverable,
      files,
      knowledgeItems: workspace.knowledgeItems,
      stagedChangeSets,
      versions,
      workspacePlan: hydratedWorkspacePlan,
    }),
    currentProject,
    projectFolders: mappedProjectFolders,
    projectDeliverables,
    deliverable,
    files: workspaceFiles,
    versions,
    visibleVersions: versions.filter(isVisibleVersion),
    versionFiles,
    currentFile: activeFile,
    currentConversation,
    latestConversation,
    conversationTree: buildConversationTree(
      conversations.map((conversation) => ({
        ...mapConversation(conversation, pendingChangeSetsByConversation),
        lastMessagePreview: conversation.messages[0]
          ? truncate(conversation.messages[0].content)
          : null,
      }))
    ),
    conversationRuns,
    activeAssistantRun: activeAssistantRun ? mapAssistantRun(activeAssistantRun) : null,
    activePreviewRun,
    selectedVersion,
    stagedChangeSets,
    workspacePlan: hydratedWorkspacePlan,
    currentStatus,
    activeLock,
  };
}

export async function getConversationWorkspace(params: {
  conversationId: string;
  organizationId: string;
}) {
  const conversation = await prisma.session.findFirst({
    where: {
      deletedAt: null,
      id: params.conversationId,
      organizationId: params.organizationId,
    },
    include: {
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      },
      wiki: true,
    },
  });

  if (!conversation || !conversation.wiki) {
    return null;
  }

  const view = await getWorkspaceView({
    conversationId: conversation.id,
    organizationId: params.organizationId,
    workspaceId: conversation.wiki.id,
  });

  return {
    conversation: view.currentConversation,
    workspace: view.workspace,
  };
}

function buildProjectDeliverables(
  projectDocuments: Array<{
    content: string;
    currentVersion: number;
    files: Array<Parameters<typeof mapWorkspaceFile>[0]>;
    id: string;
    projectId: string | null;
    projectFolderId?: string | null;
    treeSortOrder: number;
    status: string;
    title: string;
    updatedAt: Date;
    workspacePlan: Parameters<typeof mapWorkspacePlan>[0] | null;
  }>
): WorkspaceViewData['projectDeliverables'] {
  return projectDocuments
    .map((workspace) => {
      const deliverable = buildDeliverable({
        currentVersion: workspace.currentVersion,
        files: workspace.files.map(mapWorkspaceFile),
        plan: workspace.workspacePlan ? mapWorkspacePlan(workspace.workspacePlan) : null,
        storedDeliverableType: workspace.workspacePlan?.deliverableType || null,
        workspace,
      });

      return {
        id: workspace.id,
        projectId: resolveWorkspaceProjectId(workspace),
        projectFolderId: workspace.projectFolderId || null,
        sortOrder: workspace.treeSortOrder,
        title: workspace.title,
        deliverableType: deliverable.deliverableType,
        updatedAt: workspace.updatedAt,
      };
    })
    .sort((left, right) => {
      if (left.sortOrder === right.sortOrder) {
        const updatedAtDiff =
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
        if (updatedAtDiff !== 0) {
          return updatedAtDiff;
        }

        return left.id.localeCompare(right.id);
      }

      return left.sortOrder - right.sortOrder;
    });
}

export function mapConversation(session: {
  activeFileId: string | null;
  baseVersionId: string | null;
  createdAt: Date;
  createdByUserId: string | null;
  deletedAt: Date | null;
  forkedFromMessageId: string | null;
  id: string;
  organizationId: string;
  originDeviceId: string | null;
  parentSessionId: string | null;
  revision: number;
  sourceType: string;
  title: string;
  updatedAt: Date;
  wikiId: string | null;
}, pendingChangeSetsByConversation?: Map<string, number>): ConversationData {
  return {
    id: session.id,
    organizationId: session.organizationId,
    workspaceId: session.wikiId,
    wikiId: session.wikiId,
    parentConversationId: session.parentSessionId,
    forkedFromMessageId: session.forkedFromMessageId,
    baseVersionId: session.baseVersionId,
    activeFileId: session.activeFileId,
    hasPendingChanges:
      (pendingChangeSetsByConversation?.get(session.id) || 0) > 0,
    scopeFilter: session.activeFileId,
    title: session.title,
    sourceType: session.sourceType,
    createdByUserId: session.createdByUserId,
    originDeviceId: session.originDeviceId,
    revision: session.revision,
    deletedAt: session.deletedAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function mapConversationMessage(message: {
  attachments?: Array<{
    createdAt: Date;
    createdByUserId: string | null;
    deletedAt: Date | null;
    documentId: string;
    file: {
      path: string;
    };
    fileId: string;
    id: string;
    kind: string;
    messageId: string;
    mimeType: string | null;
    organizationId: string;
    originalName: string;
    originDeviceId: string | null;
    revision: number;
    sessionId: string;
    sizeBytes: number | null;
    source: string;
    storageFormat: string;
    updatedAt?: Date;
  }>;
  content: string;
  createdAt: Date;
  createdByUserId: string | null;
  deletedAt: Date | null;
  documentId: string | null;
  id: string;
  model: string | null;
  organizationId: string;
  originDeviceId: string | null;
  revision: number;
  role: string;
  sessionId: string;
}): ConversationMessageData {
  return {
    id: message.id,
    organizationId: message.organizationId,
    conversationId: message.sessionId,
    role: message.role,
    content: message.content,
    attachments: (message.attachments || []).map(mapChatAttachment),
    workspaceId: message.documentId,
    wikiId: message.documentId,
    model: message.model,
    createdByUserId: message.createdByUserId,
    originDeviceId: message.originDeviceId,
    revision: message.revision,
    deletedAt: message.deletedAt,
    createdAt: message.createdAt,
  };
}

export function mapChatAttachment(attachment: {
  createdAt: Date;
  createdByUserId: string | null;
  deletedAt: Date | null;
  documentId: string;
  file: {
    content?: string | null;
    path: string;
  };
  fileId: string;
  id: string;
  kind: string;
  messageId: string;
  mimeType: string | null;
  organizationId: string;
  originalName: string;
  originDeviceId: string | null;
  revision: number;
  sessionId: string;
  sizeBytes: number | null;
  source: string;
    storageFormat: string;
    updatedAt?: Date;
}): ChatAttachmentData {
  return {
    id: attachment.id,
    organizationId: attachment.organizationId,
    conversationId: attachment.sessionId,
    messageId: attachment.messageId,
    workspaceId: attachment.documentId,
    workspaceFileId: attachment.fileId,
    filePath: attachment.file.path,
    kind: normalizeAttachmentKind(attachment.kind),
    source: normalizeAttachmentSource(attachment.source),
    storageFormat: normalizeAttachmentStorageFormat(attachment.storageFormat),
    mimeType: attachment.mimeType,
    originalName: attachment.originalName,
    sizeBytes: attachment.sizeBytes,
    previewUrl: buildAttachmentPreviewUrl(
      normalizeAttachmentKind(attachment.kind),
      attachment.file.content,
      attachment.mimeType
    ),
    createdByUserId: attachment.createdByUserId,
    originDeviceId: attachment.originDeviceId,
    revision: attachment.revision,
    deletedAt: attachment.deletedAt,
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
  };
}

export function mapAssistantRun(run: {
  createdAt: Date;
  createdByUserId: string | null;
  deletedAt: Date | null;
  documentId: string;
  finishedAt: Date | null;
  id: string;
  mode: string;
  organizationId: string;
  originDeviceId: string | null;
  payloadJson: string | null;
  requestMessageId: string | null;
  revision: number;
  sessionId: string;
  startedAt: Date;
  status: string;
  summary: string | null;
  title: string;
  updatedAt: Date;
}): AssistantRunData {
  const payload = parseAssistantRunPayload(run.payloadJson);
  return {
    id: run.id,
    organizationId: run.organizationId,
    conversationId: run.sessionId,
    workspaceId: run.documentId,
    requestMessageId: run.requestMessageId,
    mode: normalizeAssistantRunMode(run.mode),
    title: run.title,
    status: normalizeAssistantRunStatus(run.status),
    summary: run.summary,
    planProposal: payload.planProposal,
    researchPlanProposal: payload.researchPlanProposal,
    researchProgress: payload.researchProgress,
    createdByUserId: run.createdByUserId,
    originDeviceId: run.originDeviceId,
    revision: run.revision,
    deletedAt: run.deletedAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export function mapWorkspace(document: {
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
  parentDocumentId?: string | null;
  projectId?: string | null;
  projectFolderId?: string | null;
  projectRootPath?: string | null;
  projectTitle?: string | null;
  revision: number;
  sessionId: string;
  status: string;
  title: string;
  updatedAt: Date;
}): WorkspaceData {
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

export function mapWorkspaceVersion(version: {
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
}): WorkspaceVersionData {
  const versionType = normalizeWorkspaceVersionType(version.versionType);
  const visible = !isRecoveryVersionType(versionType);
  const pinned = isPinnedRecoveryVersionType(versionType);

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
    versionType,
    createdByUserId: version.createdByUserId,
    originDeviceId: version.originDeviceId,
    revision: version.revision,
    deletedAt: version.deletedAt,
    lockedAt: version.lockedAt,
    visible,
    restorable: true,
    pinned,
    recoveryKind: visible ? null : pinned ? 'pinned' : 'temporary',
  };
}

export function mapKnowledgeItem(item: {
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
}): KnowledgeItemData {
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

export function mapMemory(memory: {
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
}): MemoryData {
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

export function mapCommentMessage(message: {
  content: string;
  createdAt: Date;
  createdByUserId: string | null;
  deletedAt: Date | null;
  agentId?: string | null;
  agentLabel?: string | null;
  id: string;
  mentionedAgentsJson?: string | null;
  model: string | null;
  organizationId: string;
  originDeviceId: string | null;
  revision: number;
  role: string;
  threadId: string;
}): CommentMessageData {
  return {
    id: message.id,
    organizationId: message.organizationId,
    threadId: message.threadId,
    role: message.role,
    content: message.content,
    model: message.model,
    mentionedAgents: parseCommentAgentMentionsJson(message.mentionedAgentsJson),
    agentId: message.agentId || null,
    agentLabel: message.agentLabel || null,
    createdByUserId: message.createdByUserId,
    originDeviceId: message.originDeviceId,
    revision: message.revision,
    deletedAt: message.deletedAt,
    createdAt: message.createdAt,
  };
}

export function mapCommentThread(thread: {
  anchorText: string;
  createdAt: Date;
  createdByUserId: string | null;
  deletedAt: Date | null;
  documentId: string;
  draftRevision: number | null;
  fileId: string | null;
  id: string;
  agentBindingsJson?: string | null;
  researchStateJson?: string | null;
  messages: Array<Parameters<typeof mapCommentMessage>[0]>;
  organizationId: string;
  originDeviceId: string | null;
  resolvedAt: Date | null;
  revision: number;
  selectionAnchor: string | null;
  status: string;
  updatedAt: Date;
  version: Parameters<typeof mapWorkspaceVersion>[0] | null;
  versionId: string | null;
}): CommentThreadData {
  const reviewAnchor = parseReviewAnchor(thread.selectionAnchor);
  const anchorFingerprint = buildCommentAnchorFingerprint({
    anchorText: thread.anchorText,
    fileId: thread.fileId,
    selectionAnchor: thread.selectionAnchor,
  });

  return {
    id: thread.id,
    organizationId: thread.organizationId,
    workspaceId: thread.documentId,
    wikiId: thread.documentId,
    fileId: thread.fileId,
    versionId: thread.versionId,
    sourceVersionId: thread.versionId,
    anchorFingerprint,
    scope: 'direct',
    inheritanceState: null,
    isInherited: false,
    inheritedFromVersionId: null,
    inheritedFromVersionTitle: null,
    draftRevision: thread.draftRevision,
    anchorText: thread.anchorText,
    selectionAnchor: thread.selectionAnchor,
    reviewAnchor,
    status: normalizeCommentThreadStatus(thread.status),
    messages: thread.messages.map(mapCommentMessage),
    agentBindings: parseCommentAgentBindings(thread.agentBindingsJson),
    researchState: parseCommentResearchState(thread.researchStateJson),
    resolvedAt: thread.resolvedAt,
    version: thread.version ? mapWorkspaceVersion(thread.version) : null,
    createdByUserId: thread.createdByUserId,
    originDeviceId: thread.originDeviceId,
    revision: thread.revision,
    deletedAt: thread.deletedAt,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

export const listWikis = listWorkspaces;
export const getWikiWorkspace = async (params: {
  conversationId?: string | null;
  organizationId: string;
  wikiId: string;
}) => {
  const view = await getWorkspaceView({
    conversationId: params.conversationId,
    organizationId: params.organizationId,
    workspaceId: params.wikiId,
  });

  return {
    currentConversation: view.currentConversation,
    latestConversation: view.latestConversation,
    wiki: view.workspace,
  };
};
export const createWikiWithConversation = createWorkspaceWithConversation;
export const createConversationForWiki = (actor: ActorContext, input: {
  title?: string;
  wikiId: string;
}) =>
  createConversationForWorkspace(actor, {
    title: input.title,
    workspaceId: input.wikiId,
  });
export const updateWiki = (actor: ActorContext, input: {
  content?: string;
  status?: string;
  title?: string;
  wikiId: string;
}) =>
  updateWorkspace(actor, {
    content: input.content,
    status: input.status,
    title: input.title,
    workspaceId: input.wikiId,
  });
export const listWikiVersions = (params: {
  organizationId: string;
  wikiId: string;
}) =>
  listWorkspaceVersions({
    organizationId: params.organizationId,
    workspaceId: params.wikiId,
  });
export const createWikiVersion = (actor: ActorContext, wikiId: string) =>
  createWorkspaceVersion(actor, { workspaceId: wikiId });
export const getActiveWikiLock = getActiveWorkspaceLock;
export const acquireWikiLock = (actor: ActorContext, input: {
  lockedVersionId?: string | null;
  ttlMinutes?: number;
  wikiId: string;
}) =>
  acquireWorkspaceLock(actor, {
    lockedVersionId: input.lockedVersionId,
    ttlMinutes: input.ttlMinutes,
    workspaceId: input.wikiId,
  });
export const releaseWikiLock = (actor: ActorContext, wikiId: string) =>
  releaseWorkspaceLock(actor, wikiId);
export const mapWiki = mapWorkspace;
export const mapWikiVersion = mapWorkspaceVersion;

async function ensureWorkspaceEditable(actor: ActorContext, workspaceId: string) {
  const existing = await prisma.wikiEditLock.findUnique({
    where: { documentId: workspaceId },
  });

  if (!existing || existing.expiresAt <= new Date()) {
    await acquireWorkspaceLock(actor, { workspaceId });
    return;
  }

  if (existing.userId !== actor.userId) {
    throw new WorkspaceLockConflictError({
      expiresAt: existing.expiresAt,
      userId: existing.userId,
      workspaceId,
    });
  }

  if (existing.originDeviceId !== actor.deviceId) {
    await prisma.wikiEditLock.update({
      where: { documentId: workspaceId },
      data: {
        expiresAt: new Date(Date.now() + 15 * 60_000),
        originDeviceId: actor.deviceId,
      },
    });
  }
}

function buildConversationTree(
  conversations: Array<ConversationData & { lastMessagePreview: string | null }>
): ConversationBranchSummary[] {
  const nodes = new Map<string, ConversationBranchSummary>();

  conversations.forEach((conversation) => {
    nodes.set(conversation.id, {
      ...conversation,
      children: [],
    });
  });

  const roots: ConversationBranchSummary[] = [];
  nodes.forEach((node) => {
    if (node.parentConversationId) {
      const parent = nodes.get(node.parentConversationId);
      if (parent) {
        parent.children.push(node);
        return;
      }
    }

    roots.push(node);
  });

  const sortNode = (node: ConversationBranchSummary) => {
    node.children.sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
    node.children.forEach(sortNode);
  };

  roots.sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
  roots.forEach(sortNode);

  return roots;
}

function mapConversationWithRelations(
  session: {
    activeFileId: string | null;
    baseVersionId: string | null;
    createdAt: Date;
    createdByUserId: string | null;
    deletedAt: Date | null;
    forkedFromMessageId: string | null;
    id: string;
    messages: Array<Parameters<typeof mapConversationMessage>[0]>;
    organizationId: string;
    originDeviceId: string | null;
    parentSessionId: string | null;
    revision: number;
    sourceType: string;
    title: string;
    updatedAt: Date;
    wikiId: string | null;
  },
  workspace: Parameters<typeof mapWorkspace>[0] | null,
  pendingChangeSetsByConversation?: Map<string, number>
): ConversationWithRelations {
  return {
    ...mapConversation(session, pendingChangeSetsByConversation),
    workspace: workspace ? mapWorkspace(workspace) : null,
    messages: session.messages.map(mapConversationMessage),
  };
}

function mapWorkspaceWithRelations(workspace: {
  content: string;
  createdAt: Date;
  createdByUserId: string | null;
  currentVersion: number;
  deletedAt: Date | null;
  deliverable?: WorkspaceWithRelations['deliverable'];
  files: Array<Parameters<typeof mapWorkspaceFile>[0]>;
  id: string;
  knowledgeItems: Array<Parameters<typeof mapKnowledgeItem>[0]>;
  organizationId: string;
  originDeviceId: string | null;
  parentDocumentId?: string | null;
  projectId?: string | null;
  projectTitle?: string | null;
  revision: number;
  sessionId: string;
  stagedChangeSets?: WorkspaceWithRelations['stagedChangeSets'];
  status: string;
  title: string;
  updatedAt: Date;
  versions: WorkspaceVersionData[];
  workspacePlan?: WorkspaceWithRelations['workspacePlan'];
}): WorkspaceWithRelations {
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

function mapWorkspaceEditLock(lock: {
  createdAt: Date;
  documentId: string;
  expiresAt: Date;
  id: string;
  lockedVersionId: string | null;
  organizationId: string;
  originDeviceId: string;
  updatedAt: Date;
  userId: string;
}): WorkspaceEditLockData {
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

function buildAttachmentPreviewUrl(
  kind: ChatAttachmentData['kind'],
  storedContent?: string | null,
  mimeType?: string | null
) {
  if (kind !== 'image' || !storedContent) {
    return null;
  }

  try {
    const parsed = JSON.parse(storedContent) as SupportFileEnvelope;
    if (parsed.kind !== 'binary' || parsed.encoding !== 'base64' || !parsed.base64) {
      return null;
    }

    const resolvedMimeType = mimeType || parsed.mimeType || 'application/octet-stream';
    return `data:${resolvedMimeType};base64,${parsed.base64}`;
  } catch {
    return null;
  }
}

function buildCommentAnchorFingerprint(params: {
  anchorText: string;
  fileId: string | null;
  selectionAnchor: string | null;
}) {
  return buildReviewAnchorFingerprint({
    anchorText: params.anchorText,
    fileId: params.fileId,
    reviewAnchor: null,
    selectionAnchor: params.selectionAnchor,
  });
}

function normalizeAttachmentKind(kind?: string | null): ChatAttachmentData['kind'] {
  if (kind === 'image' || kind === 'text') {
    return kind;
  }

  return 'file';
}

function normalizeAttachmentSource(
  source?: string | null
): ChatAttachmentData['source'] {
  return source === 'clipboard' ? 'clipboard' : 'upload';
}

function normalizeAttachmentStorageFormat(
  storageFormat?: string | null
): ChatAttachmentData['storageFormat'] {
  return storageFormat === 'base64-envelope' ? 'base64-envelope' : 'text';
}

function normalizeAssistantRunMode(mode?: string | null): AssistantRunData['mode'] {
  if (mode === 'first_pass' || mode === 'question' || mode === 'replan') {
    return mode;
  }

  return 'revision';
}

function normalizeAssistantRunStatus(
  status?: string | null
): AssistantRunData['status'] {
  if (
    status === 'queued' ||
    status === 'planning' ||
    status === 'running' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled'
  ) {
    return status;
  }

  return 'queued';
}

async function ensureSupportUploadsFolder(
  actor: ActorContext,
  workspaceId: string
) {
  return ensureSupportUploadsFolderCommand(actor, workspaceId, {
    ensureWorkspaceEditable,
  });
}

function truncate(value: string, max = 120) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
