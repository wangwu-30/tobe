import { prisma } from '@/lib/db/prisma';
import { recordSyncEvent } from '@/lib/platform/sync';
import { ensureWorkspaceFiles } from '@/objects/file/commands';
import { resolvePrimaryFile } from '@/objects/file/schema';
import { findNearestVersionBeforeMessage } from '@/objects/state/queries';
import { mapWorkspaceVersion } from '@/objects/workspace/view';
import type {
  AssistantRunData,
  ConversationMessageData,
  ConversationScopeKind,
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

export class ConversationCommandError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = 'ConversationCommandError';
  }
}

export class AssistantRunTransitionError extends ConversationCommandError {
  constructor(
    readonly currentStatus: AssistantRunData['status'],
    readonly requestedStatus: AssistantRunData['status']
  ) {
    super(
      `Assistant run cannot transition from ${currentStatus} to ${requestedStatus}.`,
      409,
      'ASSISTANT_RUN_STATUS_CONFLICT'
    );
    this.name = 'AssistantRunTransitionError';
  }
}

const ASSISTANT_RUN_STATUS_TRANSITIONS: Record<
  AssistantRunData['status'],
  readonly AssistantRunData['status'][]
> = {
  cancelled: ['queued', 'planning', 'running', 'cancelled'],
  completed: ['queued', 'planning', 'running', 'completed'],
  failed: ['queued', 'planning', 'running', 'failed'],
  planning: ['queued', 'planning'],
  queued: ['queued'],
  running: ['queued', 'planning', 'running'],
};

const TERMINAL_ASSISTANT_RUN_STATUSES = new Set<AssistantRunData['status']>([
  'cancelled',
  'completed',
  'failed',
]);

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
      scopeKind: 'wiki',
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

export async function createOnboardingConversation(
  actor: ConversationActorContext,
  input: { title?: string }
) {
  const conversation = await prisma.session.create({
    data: {
      organizationId: actor.organizationId,
      title: input.title?.trim() || 'New Conversation',
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      scopeKind: 'team',
      sourceType: 'onboarding',
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
      scopeKind: 'team',
      sourceType: 'onboarding',
      title: conversation.title,
      workspaceId: null,
    },
    revision: conversation.revision,
  });

  return mapConversation(conversation);
}

export async function beginOnboardingAssistantTurn(
  actor: ConversationActorContext,
  input: {
    content: string;
    conversationId?: string | null;
    conversationTitle?: string;
    mode: AssistantRunData['mode'];
    model?: string | null;
    runTitle: string;
  }
) {
  return prisma.$transaction(async (tx) => {
    const requestedConversationId = input.conversationId?.trim() || null;
    let conversation = requestedConversationId
      ? await tx.session.findFirst({
          where: {
            deletedAt: null,
            id: requestedConversationId,
            organizationId: actor.organizationId,
          },
        })
      : null;

    if (requestedConversationId && !conversation) {
      throw new ConversationCommandError(
        'Conversation not found.',
        404,
        'CHAT_CONVERSATION_NOT_FOUND'
      );
    }

    if (
      conversation &&
      (conversation.scopeKind !== 'team' ||
        conversation.sourceType !== 'onboarding' ||
        conversation.projectId ||
        conversation.wikiId ||
        conversation.activeFileId ||
        conversation.baseVersionId)
    ) {
      throw new ConversationCommandError(
        'Conversation scope does not match the request.',
        409,
        'CHAT_SCOPE_CONFLICT'
      );
    }

    if (!conversation) {
      conversation = await tx.session.create({
        data: {
          organizationId: actor.organizationId,
          title: input.conversationTitle?.trim() || 'New Conversation',
          createdByUserId: actor.userId,
          originDeviceId: actor.deviceId,
          scopeKind: 'team',
          sourceType: 'onboarding',
        },
      });

      await tx.syncEvent.create({
        data: {
          id: crypto.randomUUID(),
          actorUserId: actor.userId,
          entityId: conversation.id,
          entityType: 'conversation',
          occurredAt: new Date(),
          organizationId: actor.organizationId,
          originDeviceId: actor.deviceId,
          payload: JSON.stringify({
            op: 'create',
            scopeKind: 'team',
            sourceType: 'onboarding',
            title: conversation.title,
            workspaceId: null,
          }),
          pushedAt: null,
          revision: conversation.revision,
        },
      });
    }

    const activeRun = await tx.assistantRun.findFirst({
      where: {
        deletedAt: null,
        organizationId: actor.organizationId,
        scopeKind: 'team',
        sessionId: conversation.id,
        status: { in: ['queued', 'planning', 'running'] },
      },
      select: { id: true },
    });
    if (activeRun) {
      throw new ConversationCommandError(
        'An onboarding reply is already in progress.',
        409,
        'ONBOARDING_RUN_ACTIVE'
      );
    }

    const message = await tx.chatMessage.create({
      data: {
        organizationId: actor.organizationId,
        sessionId: conversation.id,
        role: 'user',
        content: input.content,
        documentId: null,
        focusNodeId: null,
        model: input.model || null,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
    });

    const sessionUpdate = await tx.session.updateMany({
      where: {
        activeFileId: null,
        baseVersionId: null,
        deletedAt: null,
        id: conversation.id,
        organizationId: actor.organizationId,
        projectId: null,
        revision: conversation.revision,
        scopeKind: 'team',
        sourceType: 'onboarding',
        wikiId: null,
      },
      data: {
        originDeviceId: actor.deviceId,
        revision: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (sessionUpdate.count !== 1) {
      throw new ConversationCommandError(
        'Conversation scope changed before the onboarding turn started.',
        409,
        'CHAT_SCOPE_CONFLICT'
      );
    }

    const run = await tx.assistantRun.create({
      data: {
        organizationId: actor.organizationId,
        sessionId: conversation.id,
        documentId: null,
        scopeKind: 'team',
        requestMessageId: message.id,
        mode: input.mode,
        title: input.runTitle.trim(),
        status: 'queued',
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
    });

    await tx.syncEvent.create({
      data: {
        id: crypto.randomUUID(),
        actorUserId: actor.userId,
        entityId: message.id,
        entityType: 'conversation_message',
        occurredAt: new Date(),
        organizationId: actor.organizationId,
        originDeviceId: actor.deviceId,
        payload: JSON.stringify({
          op: 'create',
          conversationId: conversation.id,
          focusNodeId: null,
          role: 'user',
          workspaceId: null,
        }),
        pushedAt: null,
        revision: message.revision,
      },
    });

    return {
      assistantRun: mapAssistantRun(run),
      conversation: mapConversation({
        ...conversation,
        revision: conversation.revision + 1,
      }),
      userMessage: mapConversationMessage(message),
    };
  });
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
    scopeKind?: ConversationScopeKind;
    workspaceId?: string | null;
  }
): Promise<ConversationMessageData> {
  const focusNodeId = resolveMessageFocusNodeId(input);
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

  const scopeKind = input.scopeKind || 'wiki';
  if (conversation.scopeKind !== scopeKind) {
    throw new Error('Conversation scope does not match the message.');
  }

  if (scopeKind === 'team') {
    if (
      conversation.projectId ||
      conversation.wikiId ||
      input.activeFileId ||
      focusNodeId
    ) {
      throw new Error('Onboarding conversations cannot target a workspace.');
    }
  } else if (focusNodeId) {
    await assertWorkspaceMatchesConversation({
      conversation,
      organizationId: actor.organizationId,
      workspaceId: focusNodeId,
    });
  }

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
    finishedAt?: Date | null;
    mode: AssistantRunData['mode'];
    payloadJson?: string | null;
    requestMessageId?: string | null;
    scopeKind?: ConversationScopeKind;
    status?: AssistantRunData['status'];
    summary?: string | null;
    title: string;
    workspaceId?: string | null;
  }
): Promise<AssistantRunData> {
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

  const scopeKind = input.scopeKind || 'wiki';
  const initialStatus = input.status || 'queued';
  const initialFinishedAt = TERMINAL_ASSISTANT_RUN_STATUSES.has(initialStatus)
    ? input.finishedAt || new Date()
    : null;
  if (
    !TERMINAL_ASSISTANT_RUN_STATUSES.has(initialStatus) &&
    input.finishedAt
  ) {
    throw new Error(
      `Assistant run status ${initialStatus} cannot set finishedAt.`
    );
  }
  if (input.requestMessageId) {
    const requestMessage = await prisma.chatMessage.findFirst({
      where: {
        deletedAt: null,
        id: input.requestMessageId,
        organizationId: actor.organizationId,
        role: 'user',
        sessionId: input.conversationId,
      },
      select: {
        createdByUserId: true,
        documentId: true,
        focusNodeId: true,
        id: true,
      },
    });
    if (!requestMessage) {
      throw new Error('Assistant run request message not found in conversation.');
    }
    if (requestMessage.createdByUserId !== actor.userId) {
      throw new Error('Assistant run request message belongs to another actor.');
    }
    const messageWorkspaceId =
      requestMessage.focusNodeId || requestMessage.documentId || null;
    if (
      scopeKind === 'team' &&
      (requestMessage.focusNodeId !== null || requestMessage.documentId !== null)
    ) {
      throw new Error('Onboarding request messages cannot target a workspace.');
    }
    if (scopeKind === 'wiki' && input.workspaceId) {
      if (!messageWorkspaceId) {
        throw new Error('Workspace assistant runs require a workspace-scoped request message.');
      }
      await assertWorkspaceMatchesConversation({
        conversation,
        organizationId: actor.organizationId,
        workspaceId: messageWorkspaceId,
      });
    }
  }

  if (conversation.scopeKind !== scopeKind) {
    throw new Error('Conversation scope does not match the assistant run.');
  }

  if (scopeKind === 'team') {
    if (input.workspaceId || conversation.projectId || conversation.wikiId) {
      throw new Error('Onboarding assistant runs cannot target a workspace.');
    }
  } else {
    if (!input.workspaceId) {
      throw new Error('Workspace assistant runs require a workspace.');
    }
    await assertWorkspaceMatchesConversation({
      conversation,
      organizationId: actor.organizationId,
      workspaceId: input.workspaceId,
    });
  }

  const run = await prisma.assistantRun.create({
    data: {
      organizationId: actor.organizationId,
      sessionId: input.conversationId,
      documentId: input.workspaceId || null,
      scopeKind,
      requestMessageId: input.requestMessageId || null,
      mode: input.mode,
      title: input.title.trim(),
      status: initialStatus,
      summary: input.summary ?? null,
      payloadJson: input.payloadJson ?? null,
      finishedAt: initialFinishedAt,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
    },
  });

  return mapAssistantRun(run);
}

async function assertWorkspaceMatchesConversation(params: {
  conversation: { projectId: string | null; wikiId: string | null };
  organizationId: string;
  workspaceId: string;
}) {
  const workspace = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: params.workspaceId,
      organizationId: params.organizationId,
    },
    select: {
      id: true,
      projectId: true,
    },
  });

  if (!workspace) {
    throw new Error('Workspace not found.');
  }

  const workspaceProjectId = workspace.projectId || workspace.id;
  if (params.conversation.projectId) {
    if (params.conversation.projectId !== workspaceProjectId) {
      throw new Error('Workspace does not belong to this conversation.');
    }
    return;
  }

  if (!params.conversation.wikiId) {
    throw new Error('Conversation is not attached to a workspace.');
  }

  const legacyWorkspace = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: params.conversation.wikiId,
      organizationId: params.organizationId,
    },
    select: {
      id: true,
      projectId: true,
    },
  });
  if (
    !legacyWorkspace ||
    (legacyWorkspace.projectId || legacyWorkspace.id) !== workspaceProjectId
  ) {
    throw new Error('Workspace does not belong to this conversation.');
  }
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

  const currentStatus = existing.status as AssistantRunData['status'];
  const nextStatus = input.status || currentStatus;
  const allowedStatuses = ASSISTANT_RUN_STATUS_TRANSITIONS[nextStatus];
  if (!allowedStatuses || !allowedStatuses.includes(currentStatus)) {
    throw new AssistantRunTransitionError(currentStatus, nextStatus);
  }
  const currentFinishedAt = existing.finishedAt;
  const nextFinishedAt = TERMINAL_ASSISTANT_RUN_STATUSES.has(nextStatus)
    ? input.finishedAt === undefined
      ? currentFinishedAt || new Date()
      : input.finishedAt || new Date()
    : input.finishedAt === undefined
      ? currentFinishedAt
      : input.finishedAt;
  if (
    !TERMINAL_ASSISTANT_RUN_STATUSES.has(nextStatus) &&
    nextFinishedAt
  ) {
    throw new Error(
      `Assistant run status ${nextStatus} cannot set finishedAt.`
    );
  }

  const updated = await prisma.assistantRun.updateMany({
    where: {
      deletedAt: null,
      id: existing.id,
      organizationId: actor.organizationId,
      ...(input.status !== undefined ? { status: { in: [...allowedStatuses] } } : {}),
    },
    data: {
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.payloadJson !== undefined ? { payloadJson: input.payloadJson } : {}),
      ...(input.status !== undefined || input.finishedAt !== undefined
        ? { finishedAt: nextFinishedAt }
        : {}),
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      revision: {
        increment: 1,
      },
    },
  });
  if (updated.count !== 1) {
    const current = await prisma.assistantRun.findFirst({
      where: {
        deletedAt: null,
        id: input.runId,
        organizationId: actor.organizationId,
      },
    });
    if (!current) {
      throw new Error('Assistant run not found.');
    }
    throw new AssistantRunTransitionError(
      current.status as AssistantRunData['status'],
      nextStatus
    );
  }

  const run = await prisma.assistantRun.findUniqueOrThrow({
    where: { id: existing.id },
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
