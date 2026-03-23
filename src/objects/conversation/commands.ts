import { prisma } from '@/lib/db/prisma';
import { recordSyncEvent } from '@/lib/platform/sync';
import { ensureWorkspaceFiles } from '@/objects/file/commands';
import { resolvePrimaryFile } from '@/objects/file/schema';
import { findNearestVersionBeforeMessage } from '@/objects/state/queries';
import { mapWorkspaceVersion } from '@/objects/workspace/view';
import type {
  AssistantRunData,
  ConversationMessageData,
} from '@/types';
import {
  mapAssistantRun,
  mapConversation,
  mapConversationMessage,
} from './view';

type ConversationActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

function resolveProjectScopedConversationId(workspace: {
  id: string;
  projectId?: string | null;
}) {
  return workspace.projectId || workspace.id;
}

function resolveMessageFocusNodeId(input: {
  focusNodeId?: string | null;
  workspaceId?: string | null;
}) {
  return input.focusNodeId || input.workspaceId || null;
}

export async function createConversationForWorkspace(
  actor: ConversationActorContext,
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
  const projectId = resolveProjectScopedConversationId(workspace);

  const conversation = await prisma.session.create({
    data: {
      organizationId: actor.organizationId,
      projectId,
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
      projectId,
      parentConversationId: input.parentConversationId || null,
      baseVersionId: input.baseVersionId || null,
      sourceType,
    },
    revision: conversation.revision,
  });

  return mapConversation(conversation);
}

export async function createConversationFromWorkspaceVersion(
  actor: ConversationActorContext,
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

export async function createConversationMessage(
  actor: ConversationActorContext,
  input: {
    activeFileId?: string | null;
    content: string;
    conversationId: string;
    focusNodeId?: string | null;
    model?: string | null;
    role: string;
    workspaceId?: string | null;
  }
): Promise<ConversationMessageData> {
  const focusNodeId = resolveMessageFocusNodeId(input);
  const message = await prisma.chatMessage.create({
    data: {
      organizationId: actor.organizationId,
      sessionId: input.conversationId,
      role: input.role,
      content: input.content,
      documentId: null,
      focusNodeId,
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
      workspaceId: focusNodeId,
      focusNodeId,
    },
    revision: message.revision,
  });

  return mapConversationMessage(message);
}

export async function createAssistantRun(
  actor: ConversationActorContext,
  input: {
    conversationId: string;
    mode: AssistantRunData['mode'];
    payloadJson?: string | null;
    requestMessageId?: string | null;
    title: string;
    workspaceId: string;
  }
): Promise<AssistantRunData> {
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
  actor: ConversationActorContext,
  input: {
    finishedAt?: Date | null;
    mode?: AssistantRunData['mode'];
    payloadJson?: string | null;
    runId: string;
    status?: AssistantRunData['status'];
    summary?: string | null;
  }
): Promise<AssistantRunData> {
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

export async function branchConversation(
  actor: ConversationActorContext,
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

  if (!conversation) {
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
  const projectId = conversation.projectId || conversation.wikiId || null;
  const focusNodeId =
    forkMessage.focusNodeId || forkMessage.documentId || conversation.wikiId || null;
  if (!projectId || !focusNodeId) {
    throw new Error('Conversation is missing project focus.');
  }
  const baseVersion = await findNearestVersionBeforeMessage({
    messageCreatedAt: forkMessage.createdAt,
    organizationId: actor.organizationId,
    workspaceId: focusNodeId,
  });

  const fallbackTitle = truncateConversationTitle(
    forkMessage.content.replace(/\s+/g, ' ').trim(),
    42
  ).trim();
  const title = input.title?.trim() || fallbackTitle || 'New Conversation';

  const branchedConversation = await prisma.$transaction(async (tx) => {
    const nextConversation = await tx.session.create({
      data: {
        organizationId: actor.organizationId,
        projectId,
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
          documentId: null,
          focusNodeId: message.focusNodeId || message.documentId || null,
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
      workspaceId: focusNodeId,
      projectId,
    },
    revision: branchedConversation.revision,
  });

  return {
    baseVersion: baseVersion ? mapWorkspaceVersion(baseVersion) : null,
    conversation: mapConversation(branchedConversation),
  };
}

function truncateConversationTitle(value: string, max = 120) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) {
    return normalized;
  }

  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}
