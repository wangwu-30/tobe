import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/prisma';
import { bindResolvedThreadsToVersion } from '@/lib/comments/version-binding';
import { materializeWorkspaceMirror } from '@/lib/platform/mirror-manager';
import { listWorkspaceRuns, startWorkspacePreview } from '@/lib/platform/run-service';
import { recordSyncEvent } from '@/lib/platform/sync';
import { DEFAULT_APP_LANGUAGE, type AppLanguage } from '@/lib/i18n/language';
import { parseAssistantRunPayload } from '@/lib/workspace/assistant-run-payload';
import {
  buildDeliverable,
  getWorkspacePlan,
  hydrateWorkspacePlanForView,
  isPinnedRecoverySnapshotType,
  isRecoverySnapshotType,
  isVisibleVersion,
  listStagedChangeSets,
} from '@/lib/workspace/planning';
import { detectWorkspacePreviewCapability } from '@/lib/workspace/preview';
import { deriveWorkflowSummary } from '@/lib/workspace/workflow';
import type { Value } from 'platejs';
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
  WorkspaceData,
  WorkspaceEditLockData,
  WorkspaceFileData,
  WorkspaceSidebarItem,
  WorkspaceSnapshotData,
  WorkspaceSnapshotFileData,
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

type SnapshotPayload = {
  files: WorkspaceSnapshotFileData[];
  workspaceTitle?: string;
};

type SupportFileEnvelope = {
  base64?: string;
  encoding: 'base64';
  kind: 'binary';
  mimeType: string | null;
  originalName: string;
  sizeBytes: number | null;
};

const MAX_PINNED_RECOVERY_POINTS = 3;
const MAX_TEMPORARY_RECOVERY_POINTS = 1;
const SUPPORT_UPLOADS_ROOT = 'Uploads';

export class WorkspaceLockConflictError extends Error {
  readonly detail: LockConflict;

  constructor(detail: LockConflict) {
    super('Workspace is locked by another user.');
    this.detail = detail;
  }
}

export const WikiLockConflictError = WorkspaceLockConflictError;

export class WorkspaceRecoveryPinLimitError extends Error {
  constructor() {
    super('Pinned recovery points are limited to 3.');
  }
}

export async function listWorkspaces(
  organizationId: string
): Promise<WorkspaceSidebarItem[]> {
  const workspaces = await prisma.document.findMany({
    where: {
      deletedAt: null,
      organizationId,
    },
    include: {
      conversations: {
        where: { deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 1,
        include: {
          messages: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
      files: {
        where: {
          deletedAt: null,
          isPrimary: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return workspaces.map((workspace) => ({
    id: workspace.id,
    title: workspace.title,
    preview:
      workspace.conversations[0]?.messages[0]?.content?.replace(/\s+/g, ' ').trim() ||
      workspace.files[0]?.name ||
      workspace.title ||
      'Open this project',
    updatedAt: workspace.updatedAt,
  }));
}

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

    const workspace = await tx.document.create({
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
    baseSnapshotId?: string | null;
    forkedFromMessageId?: string | null;
    parentConversationId?: string | null;
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

  const conversation = await prisma.session.create({
    data: {
      organizationId: actor.organizationId,
      wikiId: workspace.id,
      title: input.title?.trim() || workspace.title,
      parentSessionId: input.parentConversationId || null,
      forkedFromMessageId: input.forkedFromMessageId || null,
      baseVersionId: input.baseSnapshotId || null,
      activeFileId: input.activeFileId || primaryFile?.id || null,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      sourceType: 'chat',
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
      baseSnapshotId: input.baseSnapshotId || null,
    },
    revision: conversation.revision,
  });

  return mapConversation(conversation);
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
  const baseSnapshot = await findNearestSnapshotBeforeMessage({
    messageCreatedAt: forkMessage.createdAt,
    organizationId: actor.organizationId,
    workspaceId: conversation.wikiId,
  });

  const title =
    input.title?.trim() ||
    `Branch: ${truncate(forkMessage.content.replace(/\s+/g, ' ').trim(), 42)}`;

  const branchedConversation = await prisma.$transaction(async (tx) => {
    const nextConversation = await tx.session.create({
      data: {
        organizationId: actor.organizationId,
        wikiId: conversation.wikiId,
        title,
        parentSessionId: conversation.id,
        forkedFromMessageId: forkMessage.id,
        baseVersionId: baseSnapshot?.id || conversation.baseVersionId || null,
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
      baseSnapshotId: baseSnapshot?.id || conversation.baseVersionId || null,
      workspaceId: conversation.wikiId,
    },
    revision: branchedConversation.revision,
  });

  return {
    baseSnapshot: baseSnapshot ? mapWorkspaceSnapshot(baseSnapshot) : null,
    conversation: mapConversation(branchedConversation),
  };
}

export async function updateWorkspace(
  actor: ActorContext,
  input: {
    content?: string;
    status?: string;
    title?: string;
    workspaceId: string;
  }
) {
  await ensureWorkspaceEditable(actor, input.workspaceId);
  const files = await ensureWorkspaceFiles(actor.organizationId, input.workspaceId);
  const primaryFile = resolvePrimaryFile(files);

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
  await ensureWorkspaceEditable(actor, input.workspaceId);
  await ensureWorkspaceFiles(actor.organizationId, input.workspaceId);

  const parent = input.parentId
    ? await prisma.workspaceFile.findFirst({
        where: {
          deletedAt: null,
          id: input.parentId,
          documentId: input.workspaceId,
          organizationId: actor.organizationId,
        },
      })
    : null;

  const siblings = await prisma.workspaceFile.findMany({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      organizationId: actor.organizationId,
      parentId: input.parentId || null,
    },
    orderBy: { sortOrder: 'asc' },
  });

  const safeName = makeUniqueChildName(input.name.trim() || 'Untitled', siblings);
  const path = buildWorkspacePath(parent?.path || null, safeName);
  const nodeType = input.nodeType || 'file';
  const file = await prisma.workspaceFile.create({
    data: {
      organizationId: actor.organizationId,
      documentId: input.workspaceId,
      parentId: input.parentId || null,
      name: safeName,
      path,
      type: nodeType,
      kind: nodeType === 'folder' ? 'text' : input.kind || inferFileKind(safeName),
      role: input.role || 'deliverable',
      language: nodeType === 'folder' ? null : inferFileLanguage(safeName),
      content: nodeType === 'folder' ? '' : getInitialFileContent(input.kind || inferFileKind(safeName)),
      sortOrder: siblings.length,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      isPrimary: false,
    },
  });

  await recordSyncEvent({
    actorUserId: actor.userId,
    entityId: file.id,
    entityType: 'workspace_file',
    organizationId: actor.organizationId,
    originDeviceId: actor.deviceId,
    payload: {
      op: 'create',
      parentId: input.parentId || null,
      path,
      workspaceId: input.workspaceId,
    },
    revision: file.revision,
  });

  await materializeWorkspaceMirror({
    organizationId: actor.organizationId,
    workspaceId: input.workspaceId,
  });

  return mapWorkspaceFile(file);
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
    workspaceId: string;
  }
) {
  await ensureWorkspaceEditable(actor, input.workspaceId);

  const existing = await prisma.workspaceFile.findFirst({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      id: input.fileId,
      organizationId: actor.organizationId,
    },
  });

  if (!existing) {
    throw new Error('Workspace file not found.');
  }

  const nextParent = input.parentId
    ? await prisma.workspaceFile.findFirst({
        where: {
          deletedAt: null,
          documentId: input.workspaceId,
          id: input.parentId,
          organizationId: actor.organizationId,
        },
      })
    : null;

  const siblings = await prisma.workspaceFile.findMany({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      organizationId: actor.organizationId,
      parentId: input.parentId === undefined ? existing.parentId : input.parentId,
      id: { not: existing.id },
    },
  });

  const nextName =
    input.name !== undefined
      ? makeUniqueChildName(input.name.trim() || existing.name, siblings)
      : existing.name;
  const nextParentId = input.parentId === undefined ? existing.parentId : input.parentId;
  const nextPath =
    input.name !== undefined || input.parentId !== undefined
      ? buildWorkspacePath(nextParent?.path || null, nextName)
      : existing.path;

  const file = await prisma.workspaceFile.update({
    where: { id: existing.id },
    data: {
      ...(input.content !== undefined && { content: input.content }),
      ...(input.kind !== undefined && { kind: input.kind }),
      ...(input.role !== undefined && { role: input.role }),
      ...(input.language !== undefined && { language: input.language }),
      ...(input.name !== undefined && { name: nextName }),
      ...(input.parentId !== undefined && { parentId: nextParentId }),
      ...(nextPath !== existing.path && { path: nextPath }),
      originDeviceId: actor.deviceId,
      createdByUserId: actor.userId,
      revision: {
        increment: 1,
      },
      updatedAt: new Date(),
    },
  });

  if (nextPath !== existing.path) {
    await rebuildDescendantPaths({
      fileId: file.id,
      oldPath: existing.path,
      organizationId: actor.organizationId,
      workspaceId: input.workspaceId,
    });
  }

  if (input.setPrimary) {
    await prisma.$transaction([
      prisma.workspaceFile.updateMany({
        where: {
          deletedAt: null,
          documentId: input.workspaceId,
          organizationId: actor.organizationId,
          isPrimary: true,
          id: { not: existing.id },
        },
        data: {
          isPrimary: false,
          revision: {
            increment: 1,
          },
        },
      }),
      prisma.workspaceFile.update({
        where: { id: existing.id },
        data: {
          isPrimary: true,
          revision: {
            increment: 1,
          },
        },
      }),
      prisma.document.update({
        where: { id: input.workspaceId },
        data: {
          content: input.content !== undefined ? input.content : existing.content,
          originDeviceId: actor.deviceId,
          revision: {
            increment: 1,
          },
        },
      }),
    ]);
  } else if (file.isPrimary && input.content !== undefined) {
    await prisma.document.update({
      where: { id: input.workspaceId },
      data: {
        content: input.content,
        originDeviceId: actor.deviceId,
        revision: {
          increment: 1,
        },
      },
    });
  }

  await materializeWorkspaceMirror({
    organizationId: actor.organizationId,
    workspaceId: input.workspaceId,
  });

  return mapWorkspaceFile(
    (await prisma.workspaceFile.findUnique({ where: { id: file.id } })) || file
  );
}

export async function deleteWorkspaceFile(
  actor: ActorContext,
  input: {
    fileId: string;
    workspaceId: string;
  }
) {
  await ensureWorkspaceEditable(actor, input.workspaceId);

  const existing = await prisma.workspaceFile.findFirst({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      id: input.fileId,
      organizationId: actor.organizationId,
    },
  });

  if (!existing) {
    throw new Error('Workspace file not found.');
  }

  const descendants = await prisma.workspaceFile.findMany({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      organizationId: actor.organizationId,
      OR: [{ id: existing.id }, { path: { startsWith: `${existing.path}/` } }],
    },
  });

  const deletedAt = new Date();
  await prisma.$transaction([
    prisma.workspaceFile.updateMany({
      where: {
        id: {
          in: descendants.map((file) => file.id),
        },
      },
      data: {
        deletedAt,
        revision: {
          increment: 1,
        },
      },
    }),
    prisma.commentThread.updateMany({
      where: {
        deletedAt: null,
        organizationId: actor.organizationId,
        fileId: {
          in: descendants.map((file) => file.id),
        },
      },
      data: {
        deletedAt,
        revision: {
          increment: 1,
        },
      },
    }),
  ]);

  if (existing.isPrimary) {
    const replacement = await prisma.workspaceFile.findFirst({
      where: {
        deletedAt: null,
        documentId: input.workspaceId,
        organizationId: actor.organizationId,
        id: { notIn: descendants.map((file) => file.id) },
        type: 'file',
      },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    if (replacement) {
      await prisma.$transaction([
        prisma.workspaceFile.update({
          where: { id: replacement.id },
          data: {
            isPrimary: true,
            revision: {
              increment: 1,
            },
          },
        }),
        prisma.document.update({
          where: { id: input.workspaceId },
          data: {
            content: replacement.content,
            originDeviceId: actor.deviceId,
            revision: {
              increment: 1,
            },
          },
        }),
      ]);
    }
  }

  await prisma.session.updateMany({
    where: {
      activeFileId: {
        in: descendants.map((file) => file.id),
      },
      deletedAt: null,
      organizationId: actor.organizationId,
      wikiId: input.workspaceId,
    },
    data: {
      activeFileId: null,
      revision: {
        increment: 1,
      },
    },
  });

  await materializeWorkspaceMirror({
    organizationId: actor.organizationId,
    workspaceId: input.workspaceId,
  });

  return { deleted: true };
}

export async function listWorkspaceSnapshots(params: {
  organizationId: string;
  workspaceId: string;
}) {
  const snapshots = await prisma.version.findMany({
    where: {
      deletedAt: null,
      documentId: params.workspaceId,
      organizationId: params.organizationId,
    },
    orderBy: { versionNum: 'desc' },
  });

  return snapshots.map(mapWorkspaceSnapshot);
}

export async function createWorkspaceSnapshot(
  actor: ActorContext,
  input: {
    snapshotType?: string;
    sourceConversationId?: string | null;
    sourceMessageId?: string | null;
    title?: string;
    workspaceId: string;
  }
) {
  await ensureWorkspaceEditable(actor, input.workspaceId);
  const snapshotType = input.snapshotType || 'manual';

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
  const mappedFiles = files.map(mapWorkspaceFile);
  const primaryFile = resolvePrimaryFile(files);
  const [latestSnapshot, latestVisibleSnapshot] = await Promise.all([
    prisma.version.findFirst({
      where: {
        deletedAt: null,
        documentId: workspace.id,
        organizationId: actor.organizationId,
      },
      orderBy: { versionNum: 'desc' },
    }),
    snapshotType === 'checkpoint'
      ? Promise.resolve(null)
      : prisma.version.findFirst({
          where: {
            deletedAt: null,
            documentId: workspace.id,
            organizationId: actor.organizationId,
            snapshotType: {
              not: 'checkpoint',
            },
          },
          orderBy: { versionNum: 'desc' },
        }),
  ]);

  const nextVersion = workspace.currentVersion + 1;
  const snapshotContent = serializeWorkspaceSnapshot({
    files: mappedFiles.map(mapWorkspaceFileToSnapshot),
    workspaceTitle: input.title?.trim() || workspace.title,
  });

  const [snapshot] = await prisma.$transaction([
    prisma.version.create({
      data: {
        organizationId: actor.organizationId,
        documentId: workspace.id,
        versionNum: nextVersion,
        content: snapshotContent,
        title: input.title?.trim() || workspace.title,
        parentVersionId:
          snapshotType === 'checkpoint'
            ? latestSnapshot?.id || null
            : latestVisibleSnapshot?.id || null,
        sourceSessionId: input.sourceConversationId || null,
        sourceMessageId: input.sourceMessageId || null,
        snapshotType,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
    }),
    prisma.document.update({
      where: { id: workspace.id },
      data: {
        currentVersion: nextVersion,
        originDeviceId: actor.deviceId,
        revision: {
          increment: 1,
        },
        ...(primaryFile ? { content: primaryFile.content } : {}),
      },
    }),
  ]);

  await bindResolvedThreadsToVersion(workspace.id, snapshot.id);

  await recordSyncEvent({
    actorUserId: actor.userId,
    entityId: snapshot.id,
    entityType: 'workspace_snapshot',
    organizationId: actor.organizationId,
    originDeviceId: actor.deviceId,
    payload: {
      op: 'create',
      versionNum: snapshot.versionNum,
      workspaceId: workspace.id,
      sourceConversationId: input.sourceConversationId || null,
      sourceMessageId: input.sourceMessageId || null,
    },
    revision: snapshot.revision,
  });

  if (snapshotType === 'checkpoint') {
    await pruneWorkspaceRecoveryCheckpoints({
      organizationId: actor.organizationId,
      workspaceId: workspace.id,
    });
  }

  return mapWorkspaceSnapshot(snapshot);
}

export async function setWorkspaceSnapshotPinned(
  actor: ActorContext,
  input: {
    pinned: boolean;
    snapshotId: string;
    workspaceId: string;
  }
) {
  await ensureWorkspaceEditable(actor, input.workspaceId);

  const snapshot = await prisma.version.findFirst({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      id: input.snapshotId,
      organizationId: actor.organizationId,
    },
  });

  if (!snapshot) {
    throw new Error('Snapshot not found.');
  }

  if (!isRecoverySnapshotType(snapshot.snapshotType)) {
    throw new Error('Only recovery points can be pinned.');
  }

  if (input.pinned && !isPinnedRecoverySnapshotType(snapshot.snapshotType)) {
    const pinnedCount = await prisma.version.count({
      where: {
        deletedAt: null,
        documentId: input.workspaceId,
        organizationId: actor.organizationId,
        snapshotType: 'checkpoint_pinned',
      },
    });

    if (pinnedCount >= MAX_PINNED_RECOVERY_POINTS) {
      throw new WorkspaceRecoveryPinLimitError();
    }
  }

  const updated = await prisma.version.update({
    where: {
      id: snapshot.id,
    },
    data: {
      revision: {
        increment: 1,
      },
      snapshotType: input.pinned ? 'checkpoint_pinned' : 'checkpoint',
    },
  });

  await pruneWorkspaceRecoveryCheckpoints({
    organizationId: actor.organizationId,
    workspaceId: input.workspaceId,
  });

  return mapWorkspaceSnapshot(updated);
}

export async function restoreWorkspaceSnapshot(
  actor: ActorContext,
  input: {
    snapshotId: string;
    workspaceId: string;
  }
) {
  await ensureWorkspaceEditable(actor, input.workspaceId);

  const snapshot = await prisma.version.findFirst({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      id: input.snapshotId,
      organizationId: actor.organizationId,
    },
  });

  if (!snapshot) {
    throw new Error('Snapshot not found.');
  }

  const hadActivePreview =
    (
      await listWorkspaceRuns({
        organizationId: actor.organizationId,
        workspaceId: input.workspaceId,
      })
    ).some(
      (run) =>
        run.kind === 'preview' &&
        (run.status === 'pending' || run.status === 'running')
    );
  const safetyCheckpoint = await createWorkspaceSnapshot(actor, {
    snapshotType: 'checkpoint',
    title: 'Safety Checkpoint before Restore',
    workspaceId: input.workspaceId,
  });
  const snapshotFiles = parseSnapshotFiles(snapshot.content);
  const existingFiles = await ensureWorkspaceFiles(actor.organizationId, input.workspaceId);
  const existingByPath = new Map(existingFiles.map((file) => [file.path, file]));
  const deletedFileIds = existingFiles
    .filter((file) => !snapshotFiles.some((snapshotFile) => snapshotFile.path === file.path))
    .map((file) => file.id);
  const orderedSnapshotFiles = [...snapshotFiles].sort((left, right) => {
    const depthDelta = getWorkspacePathDepth(left.path) - getWorkspacePathDepth(right.path);
    if (depthDelta !== 0) {
      return depthDelta;
    }

    if (left.nodeType === right.nodeType) {
      return left.path.localeCompare(right.path);
    }

    return left.nodeType === 'folder' ? -1 : 1;
  });
  const fileIdsByPath = new Map<string, string>();

  await prisma.$transaction(async (tx) => {
    if (deletedFileIds.length > 0) {
      await tx.workspaceFile.updateMany({
        where: {
          id: { in: deletedFileIds },
        },
        data: {
          deletedAt: new Date(),
          revision: {
            increment: 1,
          },
        },
      });
    }

    for (const snapshotFile of orderedSnapshotFiles) {
      const parentPath = getParentWorkspacePath(snapshotFile.path);
      const parentId = parentPath ? fileIdsByPath.get(parentPath) || null : null;
      const existing = existingByPath.get(snapshotFile.path);

      if (existing) {
        const updated = await tx.workspaceFile.update({
          where: { id: existing.id },
          data: {
            content: snapshotFile.content,
            createdByUserId: actor.userId,
            deletedAt: null,
            isPrimary: snapshotFile.isPrimary,
            kind: snapshotFile.kind,
            language: snapshotFile.language,
            name: snapshotFile.name,
            originDeviceId: actor.deviceId,
            parentId,
            path: snapshotFile.path,
            role: snapshotFile.role,
            revision: {
              increment: 1,
            },
            sortOrder: snapshotFile.sortOrder,
            type: snapshotFile.nodeType === 'folder' ? 'folder' : 'file',
            updatedAt: new Date(),
          },
        });

        fileIdsByPath.set(snapshotFile.path, updated.id);
        continue;
      }

      const created = await tx.workspaceFile.create({
        data: {
          content: snapshotFile.content,
          createdByUserId: actor.userId,
          documentId: input.workspaceId,
          isPrimary: snapshotFile.isPrimary,
          kind: snapshotFile.kind,
          language: snapshotFile.language,
          name: snapshotFile.name,
          organizationId: actor.organizationId,
          originDeviceId: actor.deviceId,
          parentId,
          path: snapshotFile.path,
          role: snapshotFile.role,
          sortOrder: snapshotFile.sortOrder,
          type: snapshotFile.nodeType === 'folder' ? 'folder' : 'file',
        },
      });

      fileIdsByPath.set(snapshotFile.path, created.id);
    }

    const primarySnapshotFile =
      orderedSnapshotFiles.find(
        (file) => file.nodeType === 'file' && file.isPrimary
      ) || orderedSnapshotFiles.find((file) => file.nodeType === 'file');
    const primaryFileId = primarySnapshotFile
      ? fileIdsByPath.get(primarySnapshotFile.path) || null
      : null;

    await tx.document.update({
      where: { id: input.workspaceId },
      data: {
        content: primarySnapshotFile?.content || '',
        originDeviceId: actor.deviceId,
        revision: {
          increment: 1,
        },
        status: 'draft',
      },
    });

    if (primaryFileId) {
      await tx.session.updateMany({
        where: {
          deletedAt: null,
          organizationId: actor.organizationId,
          wikiId: input.workspaceId,
          OR: [
            { activeFileId: null },
            { activeFileId: { in: deletedFileIds } },
          ],
        },
        data: {
          activeFileId: primaryFileId,
          revision: {
            increment: 1,
          },
        },
      });
    }
  });

  await materializeWorkspaceMirror({
    organizationId: actor.organizationId,
    workspaceId: input.workspaceId,
  });

  const restartedPreview = hadActivePreview
    ? await startWorkspacePreview(actor, {
        workspaceId: input.workspaceId,
      }).catch(() => null)
    : null;

  return {
    restoredSnapshot: mapWorkspaceSnapshot(snapshot),
    restartedPreview,
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
    lockedSnapshotId?: string | null;
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
        lockedVersionId: input.lockedSnapshotId || null,
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
          lockedVersionId: input.lockedSnapshotId || null,
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
            lockedVersionId: input.lockedSnapshotId || null,
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
  snapshotId?: string | null;
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
    },
  });

  if (!workspace) {
    return {
      workspace: null,
      deliverable: null,
      files: [],
      snapshots: [],
      visibleVersions: [],
      snapshotFiles: [],
      currentFile: null,
      currentConversation: null,
      latestConversation: null,
      conversationTree: [],
      conversationRuns: [],
      activeAssistantRun: null,
      currentSnapshot: null,
      stagedChangeSets: [],
      workspacePlan: null,
      workflowSummary: null,
      activeLock: null,
    };
  }

  const [
    files,
    snapshots,
    conversations,
    assistantRunRecords,
    activeLock,
    workspacePlan,
    stagedChangeSets,
    workspaceRuns,
  ] = await Promise.all([
    ensureWorkspaceFiles(params.organizationId, workspace.id),
    listWorkspaceSnapshots({
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

  const currentSnapshot =
    snapshots.find((snapshot) => snapshot.id === params.snapshotId) || null;
  const snapshotFiles = currentSnapshot ? currentSnapshot.files : [];

  const workspaceFiles = files.map(mapWorkspaceFile);
  const deliverableFiles = workspaceFiles.filter((file) => file.role === 'deliverable');
  const deliverable = buildDeliverable({
    currentVersion: workspace.currentVersion,
    files: workspaceFiles,
    plan: workspacePlan,
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
    currentSnapshot && snapshotFiles.length > 0
      ? resolveCurrentSnapshotFile({
          fileId: params.fileId || currentConversation?.activeFileId || null,
          files: snapshotFiles,
        })
      : resolveCurrentWorkspaceFile({
          fileId:
            params.fileId || currentConversation?.activeFileId || resolvePrimaryFile(files)?.id || null,
          files: workspaceFiles,
        });
  const workflowSummary = deriveWorkflowSummary({
    activePreviewRun,
    activeAssistantRun: activeAssistantRun ? mapAssistantRun(activeAssistantRun) : null,
    currentFiles: deliverableFiles,
    deliverable,
    language: params.language || DEFAULT_APP_LANGUAGE,
    previewCapability,
    snapshots,
    stagedChangeSets,
  });
  const hydratedWorkspacePlan = hydrateWorkspacePlanForView({
    activeAssistantRun: activeAssistantRun ? mapAssistantRun(activeAssistantRun) : null,
    plan: workspacePlan,
    workflowSummary,
  });

  return {
    workspace: mapWorkspaceWithRelations({
      ...workspace,
      deliverable,
      files,
      knowledgeItems: workspace.knowledgeItems,
      stagedChangeSets,
      versions: snapshots,
      workspacePlan: hydratedWorkspacePlan,
    }),
    deliverable,
    files: workspaceFiles,
    snapshots,
    visibleVersions: snapshots.filter(isVisibleVersion),
    snapshotFiles,
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
    currentSnapshot,
    stagedChangeSets,
    workspacePlan: hydratedWorkspacePlan,
    workflowSummary,
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
    baseSnapshotId: session.baseVersionId,
    baseDeliverableVersionId: session.baseVersionId,
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
  deletedAt: Date | null;
  id: string;
  organizationId: string;
  originDeviceId: string | null;
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
    title: document.title,
    content: document.content,
    status: document.status,
    currentVersion: document.currentVersion,
    createdByUserId: document.createdByUserId,
    originDeviceId: document.originDeviceId,
    revision: document.revision,
    deletedAt: document.deletedAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export function mapWorkspaceFile(file: {
  content: string;
  createdAt: Date;
  createdByUserId: string | null;
  deletedAt: Date | null;
  documentId: string;
  id: string;
  isPrimary: boolean;
  kind: string;
  language: string | null;
  name: string;
  organizationId: string;
  originDeviceId: string | null;
  parentId: string | null;
  path: string;
  role?: string | null;
  revision: number;
  sortOrder: number;
  type: string;
  updatedAt: Date;
}): WorkspaceFileData {
  return {
    id: file.id,
    organizationId: file.organizationId,
    workspaceId: file.documentId,
    parentId: file.parentId,
    name: file.name,
    path: file.path,
    nodeType: file.type === 'folder' ? 'folder' : 'file',
    kind: normalizeFileKind(file.kind),
    role: normalizeWorkspaceFileRole(file.role),
    language: file.language,
    content: file.content,
    sortOrder: file.sortOrder,
    isPrimary: file.isPrimary,
    createdByUserId: file.createdByUserId,
    originDeviceId: file.originDeviceId,
    revision: file.revision,
    deletedAt: file.deletedAt,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

export function mapWorkspaceSnapshot(version: {
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
  snapshotType?: string | null;
  sourceMessageId: string | null;
  sourceSessionId: string | null;
  title: string;
  versionNum: number;
}): WorkspaceSnapshotData {
  const snapshotType = version.snapshotType || 'manual';
  const visible = !isRecoverySnapshotType(snapshotType);
  const pinned = isPinnedRecoverySnapshotType(snapshotType);

  return {
    id: version.id,
    organizationId: version.organizationId,
    workspaceId: version.documentId,
    versionNum: version.versionNum,
    title: version.title,
    content: version.content,
    files: parseSnapshotFiles(version.content),
    parentSnapshotId: version.parentVersionId,
    sourceConversationId: version.sourceSessionId,
    sourceMessageId: version.sourceMessageId,
    snapshotType,
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
  id: string;
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
  messages: Array<Parameters<typeof mapCommentMessage>[0]>;
  organizationId: string;
  originDeviceId: string | null;
  resolvedAt: Date | null;
  revision: number;
  selectionAnchor: string | null;
  status: string;
  updatedAt: Date;
  version: Parameters<typeof mapWorkspaceSnapshot>[0] | null;
  versionId: string | null;
}): CommentThreadData {
  const reviewAnchor = parseReviewAnchor(thread.selectionAnchor);

  return {
    id: thread.id,
    organizationId: thread.organizationId,
    workspaceId: thread.documentId,
    wikiId: thread.documentId,
    fileId: thread.fileId,
    snapshotId: thread.versionId,
    draftRevision: thread.draftRevision,
    anchorText: thread.anchorText,
    selectionAnchor: thread.selectionAnchor,
    reviewAnchor,
    status: thread.status,
    messages: thread.messages.map(mapCommentMessage),
    resolvedAt: thread.resolvedAt,
    snapshot: thread.version ? mapWorkspaceSnapshot(thread.version) : null,
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
  listWorkspaceSnapshots({
    organizationId: params.organizationId,
    workspaceId: params.wikiId,
  });
export const createWikiVersion = (actor: ActorContext, wikiId: string) =>
  createWorkspaceSnapshot(actor, { workspaceId: wikiId });
export const getActiveWikiLock = getActiveWorkspaceLock;
export const acquireWikiLock = (actor: ActorContext, input: {
  lockedVersionId?: string | null;
  ttlMinutes?: number;
  wikiId: string;
}) =>
  acquireWorkspaceLock(actor, {
    lockedSnapshotId: input.lockedVersionId,
    ttlMinutes: input.ttlMinutes,
    workspaceId: input.wikiId,
  });
export const releaseWikiLock = (actor: ActorContext, wikiId: string) =>
  releaseWorkspaceLock(actor, wikiId);
export const mapWiki = mapWorkspace;
export const mapWikiVersion = mapWorkspaceSnapshot;

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

async function ensureWorkspaceFiles(organizationId: string, workspaceId: string) {
  let files = await prisma.workspaceFile.findMany({
    where: {
      deletedAt: null,
      documentId: workspaceId,
      organizationId,
    },
    orderBy: [{ path: 'asc' }, { sortOrder: 'asc' }],
  });

  if (files.length > 0) {
    return files;
  }

  const workspace = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: workspaceId,
      organizationId,
    },
  });

  if (!workspace) {
    return [];
  }

  const primaryFileName = getDefaultFileName('richtext');
  const file = await prisma.workspaceFile.create({
    data: {
      organizationId,
      documentId: workspace.id,
      name: primaryFileName,
      path: primaryFileName,
      type: 'file',
      kind: 'richtext',
      role: 'deliverable',
      language: inferFileLanguage(primaryFileName),
      content: workspace.content,
      isPrimary: true,
      sortOrder: 0,
      createdByUserId: workspace.createdByUserId,
      originDeviceId: workspace.originDeviceId,
    },
  });

  await prisma.session.updateMany({
    where: {
      deletedAt: null,
      organizationId,
      wikiId: workspace.id,
      activeFileId: null,
    },
    data: {
      activeFileId: file.id,
      revision: {
        increment: 1,
      },
    },
  });

  files = [file];
  return files;
}

async function rebuildDescendantPaths(params: {
  fileId: string;
  oldPath: string;
  organizationId: string;
  workspaceId: string;
}) {
  const root = await prisma.workspaceFile.findUnique({
    where: { id: params.fileId },
  });

  if (!root) {
    return;
  }

  const descendants = await prisma.workspaceFile.findMany({
    where: {
      deletedAt: null,
      documentId: params.workspaceId,
      organizationId: params.organizationId,
      path: {
        startsWith: `${params.oldPath}/`,
      },
    },
    orderBy: { path: 'asc' },
  });

  for (const descendant of descendants) {
    const nextPath = descendant.path.replace(params.oldPath, root.path);
    await prisma.workspaceFile.update({
      where: { id: descendant.id },
      data: {
        path: nextPath,
        revision: {
          increment: 1,
        },
      },
    });
  }
}

async function findNearestSnapshotBeforeMessage(params: {
  messageCreatedAt: Date;
  organizationId: string;
  workspaceId: string;
}) {
  return prisma.version.findFirst({
    where: {
      deletedAt: null,
      documentId: params.workspaceId,
      organizationId: params.organizationId,
      lockedAt: {
        lte: params.messageCreatedAt,
      },
    },
    orderBy: { lockedAt: 'desc' },
  });
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
  revision: number;
  sessionId: string;
  stagedChangeSets?: WorkspaceWithRelations['stagedChangeSets'];
  status: string;
  title: string;
  updatedAt: Date;
  versions: WorkspaceSnapshotData[];
  workspacePlan?: WorkspaceWithRelations['workspacePlan'];
}): WorkspaceWithRelations {
  return {
    ...mapWorkspace(workspace),
    deliverable: workspace.deliverable || null,
    files: workspace.files.map(mapWorkspaceFile),
    knowledgeItems: workspace.knowledgeItems.map(mapKnowledgeItem),
    stagedChangeSets: workspace.stagedChangeSets || [],
    snapshots: workspace.versions,
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
    lockedSnapshotId: lock.lockedVersionId,
    expiresAt: lock.expiresAt,
    createdAt: lock.createdAt,
    updatedAt: lock.updatedAt,
  };
}

function parseSnapshotFiles(content: string): WorkspaceSnapshotFileData[] {
  try {
    const parsed = JSON.parse(content) as SnapshotPayload | Value;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'files' in parsed &&
      Array.isArray(parsed.files)
    ) {
      return parsed.files.map((file) => ({
        ...file,
        kind: normalizeFileKind(file.kind),
        role: normalizeWorkspaceFileRole(file.role),
        language: file.language || null,
        nodeType: file.nodeType === 'folder' ? 'folder' : 'file',
      }));
    }
  } catch {
    // fall through to legacy snapshot decoding below
  }

  return [
    {
      id: 'legacy-primary',
      workspaceId: 'legacy',
      parentId: null,
      name: 'main.md',
      path: 'main.md',
      nodeType: 'file',
      kind: 'richtext',
      role: 'deliverable',
      language: 'markdown',
      content,
      sortOrder: 0,
      isPrimary: true,
      createdByUserId: null,
      originDeviceId: null,
      revision: 1,
      snapshotId: null,
    },
  ];
}

function parseReviewAnchor(selectionAnchor: string | null) {
  if (!selectionAnchor) {
    return null;
  }

  try {
    const parsed = JSON.parse(selectionAnchor);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.surfaceType === 'string' &&
      typeof parsed.bindingType === 'string' &&
      parsed.anchorPayload &&
      typeof parsed.anchorPayload === 'object'
    ) {
      return parsed;
    }
  } catch {
    // Legacy anchors may not be JSON; keep them as opaque strings.
  }

  return null;
}

function serializeWorkspaceSnapshot(payload: SnapshotPayload) {
  return JSON.stringify(payload);
}

function mapWorkspaceFileToSnapshot(file: WorkspaceFileData): WorkspaceSnapshotFileData {
  return {
    id: file.id,
    workspaceId: file.workspaceId,
    parentId: file.parentId,
    name: file.name,
    path: file.path,
    nodeType: file.nodeType,
    kind: file.kind,
    role: file.role,
    language: file.language,
    content: file.content,
    sortOrder: file.sortOrder,
    isPrimary: file.isPrimary,
    createdByUserId: file.createdByUserId,
    originDeviceId: file.originDeviceId,
    revision: file.revision,
  };
}

function resolvePrimaryFile(files: Array<Parameters<typeof mapWorkspaceFile>[0]>) {
  const deliverableFiles = files.filter(
    (file) => normalizeWorkspaceFileRole(file.role) === 'deliverable'
  );
  return (
    deliverableFiles.find((file) => file.isPrimary && file.type === 'file') ||
    deliverableFiles.find((file) => file.type === 'file') ||
    null
  );
}

function resolveCurrentWorkspaceFile(params: {
  fileId: string | null;
  files: WorkspaceFileData[];
}) {
  const deliverableFiles = params.files.filter((file) => file.role === 'deliverable');
  return (
    deliverableFiles.find((file) => file.id === params.fileId) ||
    deliverableFiles.find((file) => file.isPrimary) ||
    deliverableFiles.find((file) => file.nodeType === 'file') ||
    null
  );
}

function resolveCurrentSnapshotFile(params: {
  fileId: string | null;
  files: WorkspaceSnapshotFileData[];
}) {
  const deliverableFiles = params.files.filter((file) => file.role === 'deliverable');
  return (
    deliverableFiles.find((file) => file.id === params.fileId) ||
    deliverableFiles.find((file) => file.isPrimary) ||
    deliverableFiles.find((file) => file.nodeType === 'file') ||
    null
  );
}

function normalizeWorkspaceFileRole(role?: string | null): WorkspaceFileData['role'] {
  return role === 'support' ? 'support' : 'deliverable';
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
  const existing = await prisma.workspaceFile.findFirst({
    where: {
      deletedAt: null,
      documentId: workspaceId,
      organizationId: actor.organizationId,
      path: SUPPORT_UPLOADS_ROOT,
      type: 'folder',
    },
  });

  if (existing) {
    return mapWorkspaceFile(existing);
  }

  return createWorkspaceFile(actor, {
    name: SUPPORT_UPLOADS_ROOT,
    nodeType: 'folder',
    role: 'support',
    workspaceId,
  });
}

function makeUniqueChildName(
  name: string,
  siblings: Array<{ name: string }>
) {
  if (!siblings.some((sibling) => sibling.name === name)) {
    return name;
  }

  const extensionIndex = name.lastIndexOf('.');
  const hasExtension = extensionIndex > 0;
  const base = hasExtension ? name.slice(0, extensionIndex) : name;
  const extension = hasExtension ? name.slice(extensionIndex) : '';

  let counter = 2;
  let candidate = `${base} ${counter}${extension}`;
  while (siblings.some((sibling) => sibling.name === candidate)) {
    counter += 1;
    candidate = `${base} ${counter}${extension}`;
  }

  return candidate;
}

function buildWorkspacePath(parentPath: string | null, name: string) {
  return parentPath ? `${parentPath}/${name}` : name;
}

function getParentWorkspacePath(filePath: string) {
  const slashIndex = filePath.lastIndexOf('/');
  if (slashIndex === -1) {
    return null;
  }

  return filePath.slice(0, slashIndex) || null;
}

function getWorkspacePathDepth(filePath: string) {
  return filePath.split('/').length;
}

async function pruneWorkspaceRecoveryCheckpoints(params: {
  organizationId: string;
  workspaceId: string;
}) {
  const checkpoints = await prisma.version.findMany({
    where: {
      deletedAt: null,
      documentId: params.workspaceId,
      organizationId: params.organizationId,
      snapshotType: 'checkpoint',
    },
    orderBy: { versionNum: 'desc' },
    select: {
      id: true,
    },
  });

  const staleCheckpointIds = checkpoints
    .slice(MAX_TEMPORARY_RECOVERY_POINTS)
    .map((checkpoint) => checkpoint.id);

  if (staleCheckpointIds.length === 0) {
    return;
  }

  await prisma.version.updateMany({
    where: {
      id: {
        in: staleCheckpointIds,
      },
    },
    data: {
      deletedAt: new Date(),
      revision: {
        increment: 1,
      },
    },
  });
}

function getDefaultFileName(kind: 'richtext' | 'markdown' | 'text' | 'code') {
  switch (kind) {
    case 'markdown':
      return 'main.md';
    case 'code':
      return 'index.ts';
    case 'text':
      return 'notes.txt';
    default:
      return 'main.md';
  }
}

function getInitialFileContent(kind: 'richtext' | 'markdown' | 'text' | 'code') {
  switch (kind) {
    case 'code':
      return '';
    case 'text':
      return '';
    case 'markdown':
      return '[]';
    default:
      return '[]';
  }
}

function inferFileKind(name: string): 'richtext' | 'markdown' | 'text' | 'code' {
  if (name.endsWith('.md') || name.endsWith('.mdx')) {
    return 'markdown';
  }

  if (
    name.endsWith('.ts') ||
    name.endsWith('.tsx') ||
    name.endsWith('.js') ||
    name.endsWith('.jsx') ||
    name.endsWith('.css') ||
    name.endsWith('.html') ||
    name.endsWith('.json')
  ) {
    return 'code';
  }

  if (name.endsWith('.txt')) {
    return 'text';
  }

  return 'richtext';
}

function inferFileLanguage(name: string) {
  const extension = name.split('.').pop()?.toLowerCase();
  if (!extension || extension === name.toLowerCase()) {
    return null;
  }

  const languageMap: Record<string, string> = {
    css: 'css',
    html: 'html',
    js: 'javascript',
    json: 'json',
    jsx: 'javascript',
    md: 'markdown',
    mdx: 'markdown',
    ts: 'typescript',
    tsx: 'typescript',
    txt: 'text',
  };

  return languageMap[extension] || extension;
}

function normalizeFileKind(value: string): WorkspaceFileData['kind'] {
  if (value === 'markdown' || value === 'text' || value === 'code') {
    return value;
  }

  return 'richtext';
}

function truncate(value: string, max = 120) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
