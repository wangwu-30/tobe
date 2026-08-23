import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { safeJsonParse } from '@/framework/resilience';
import {
  createConversationForWorkspace,
  createConversationMessage,
  createOnboardingConversation,
} from '@/objects/conversation/commands';
import {
  createWorkspaceWithConversation,
  storeMessageSupportAttachments,
} from '@/lib/workspace/service';
import type { ChatScope, ResearchMode } from '@/types';

export class ChatRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = 'ChatRequestError';
  }
}

export type IncomingAttachment = {
  content: string;
  kind: 'image' | 'text' | 'file';
  mimeType: string | null;
  originalName: string;
  sizeBytes: number | null;
  source: 'upload' | 'clipboard';
  storageFormat: 'text' | 'base64-envelope';
};

export type ChatRequestPayload = {
  activeFileId?: string | null;
  attachments: IncomingAttachment[];
  baseVersionId?: string | null;
  conversationId?: string | null;
  focusNodeId?: string | null;
  message: string;
  model?: string | null;
  researchMode?: ResearchMode;
  scope: ChatScope;
  workspaceId?: string | null;
};

type ActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

export async function parseChatRequest(req: NextRequest): Promise<ChatRequestPayload> {
  const contentType = req.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    const files = formData
      .getAll('attachments')
      .filter((item): item is File => item instanceof File);
    const meta = safeParseJson<Array<{
      kind?: 'image' | 'text' | 'file';
      mimeType?: string | null;
      name?: string;
      sizeBytes?: number | null;
      source?: 'upload' | 'clipboard';
    }>>(formData.get('attachmentsMeta')) || [];
    const focusNodeId = asNullableString(formData.get('focusNodeId'));

    return {
      activeFileId: asNullableString(formData.get('activeFileId')),
      attachments: await Promise.all(
        files.map((file, index) => normalizeIncomingAttachment(file, meta[index]))
      ),
      baseVersionId: asNullableString(formData.get('baseVersionId')),
      conversationId:
        asNullableString(formData.get('conversationId')) ||
        asNullableString(formData.get('sessionId')),
      focusNodeId,
      message: asString(formData.get('message')),
      model: asNullableString(formData.get('model')),
      researchMode: asResearchMode(formData.get('researchMode')),
      scope: asChatScope(formData.get('scope')),
      workspaceId:
        focusNodeId ||
        asNullableString(formData.get('workspaceId')) ||
        asNullableString(formData.get('wikiId')),
    };
  }

  const body = await req.json();
  const focusNodeId =
    typeof body.focusNodeId === 'string' ? body.focusNodeId : null;
  return {
    activeFileId: body.activeFileId || null,
    attachments: [],
    baseVersionId: body.baseVersionId || null,
    conversationId: body.conversationId || body.sessionId || null,
    focusNodeId,
    message: typeof body.message === 'string' ? body.message : '',
    model: typeof body.model === 'string' ? body.model : null,
    researchMode: body.researchMode === 'deep' ? 'deep' : 'light',
    scope: asChatScope(body.scope),
    workspaceId: focusNodeId || body.workspaceId || body.wikiId,
  };
}

export async function ensureChatConversation(params: {
  actor: ActorContext;
  activeFileId?: string | null;
  baseVersionId?: string | null;
  conversationId?: string | null;
  conversationTitle: string;
  title: string;
  scope: ChatScope;
  workspaceId?: string | null;
}) {
  let conversationId = params.conversationId || null;
  let workspaceId = params.workspaceId || null;

  let conversation = conversationId
    ? await prisma.session.findFirst({
        where: {
          deletedAt: null,
          id: conversationId,
          organizationId: params.actor.organizationId,
        },
      })
    : null;

  if (conversationId && !conversation) {
    throw new ChatRequestError(
      'Conversation not found.',
      404,
      'CHAT_CONVERSATION_NOT_FOUND'
    );
  }

  const expectedScopeKind = params.scope === 'onboarding' ? 'team' : 'wiki';
  if (conversation && conversation.scopeKind !== expectedScopeKind) {
    throw new ChatRequestError(
      'Conversation scope does not match the request.',
      409,
      'CHAT_SCOPE_CONFLICT'
    );
  }

  if (params.scope === 'onboarding') {
    if (
      workspaceId ||
      params.activeFileId ||
      params.baseVersionId ||
      conversation?.projectId ||
      conversation?.wikiId ||
      conversation?.activeFileId ||
      conversation?.baseVersionId
    ) {
      throw new ChatRequestError(
        'Onboarding chat cannot target a workspace.',
        409,
        'ONBOARDING_WORKSPACE_NOT_ALLOWED'
      );
    }

    if (!conversation) {
      const createdConversation = await createOnboardingConversation(params.actor, {
        title: params.conversationTitle,
      });
      conversationId = createdConversation.id;
      conversation = await prisma.session.findUnique({
        where: { id: conversationId },
      });
    }

    if (!conversation) {
      throw new Error('Failed to initialize onboarding conversation.');
    }

    return {
      conversation,
      conversationId: conversation.id,
      scopeKind: 'team' as const,
      workspaceId: null,
    };
  }

  if (!conversation) {
    if (!workspaceId) {
      const workspace = await createWorkspaceWithConversation(params.actor, {
        conversationTitle: params.conversationTitle,
        title: params.title,
      });

      conversationId = workspace.conversation.id;
      workspaceId = workspace.workspace.id;
    } else {
      const createdConversation = await createConversationForWorkspace(params.actor, {
        activeFileId: params.activeFileId,
        baseVersionId: params.baseVersionId,
        title: params.conversationTitle,
        workspaceId,
      });
      conversationId = createdConversation.id;
    }

    conversation = await prisma.session.findUnique({
      where: { id: conversationId! },
    });
  }

  if (!conversation) {
    throw new Error('Failed to initialize conversation.');
  }

  if (conversation.scopeKind !== 'wiki') {
    throw new ChatRequestError(
      'Conversation scope does not match the request.',
      409,
      'CHAT_SCOPE_CONFLICT'
    );
  }

  if (!workspaceId) {
    const latestMessage = await prisma.chatMessage.findFirst({
      where: {
        deletedAt: null,
        organizationId: params.actor.organizationId,
        sessionId: conversation.id,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        documentId: true,
        focusNodeId: true,
      },
    });
    workspaceId =
      latestMessage?.focusNodeId ||
      latestMessage?.documentId ||
      conversation.wikiId ||
      conversation.projectId ||
      null;
  }

  if (!workspaceId) {
    throw new ChatRequestError(
      'Conversation is not attached to a workspace.',
      409,
      'WORKSPACE_SCOPE_REQUIRED'
    );
  }

  await assertWorkspaceMatchesConversation({
    conversation,
    organizationId: params.actor.organizationId,
    workspaceId,
  });

  return {
    conversation,
    conversationId: conversation.id,
    scopeKind: 'wiki' as const,
    workspaceId,
  };
}

export async function createChatUserMessage(params: {
  actor: ActorContext;
  activeFileId?: string | null;
  attachments: IncomingAttachment[];
  content: string;
  conversationId: string;
  focusNodeId?: string | null;
  scopeKind?: 'team' | 'wiki';
  workspaceId?: string | null;
}) {
  if (!params.workspaceId && params.attachments.length > 0) {
    throw new ChatRequestError(
      'Attachments are not supported in onboarding chat.',
      400,
      'ONBOARDING_ATTACHMENTS_NOT_SUPPORTED'
    );
  }

  const userMessage = await createConversationMessage(params.actor, {
    activeFileId: params.activeFileId,
    content: params.content,
    conversationId: params.conversationId,
    focusNodeId: params.workspaceId
      ? params.focusNodeId || params.workspaceId
      : null,
    role: 'user',
    scopeKind: params.scopeKind || 'wiki',
    workspaceId: params.workspaceId,
  });

  if (params.attachments.length > 0) {
    const workspaceId = params.workspaceId;
    if (!workspaceId) {
      throw new ChatRequestError(
        'Attachments are not supported in onboarding chat.',
        400,
        'ONBOARDING_ATTACHMENTS_NOT_SUPPORTED'
      );
    }
    await storeMessageSupportAttachments(params.actor, {
      attachments: params.attachments,
      conversationId: params.conversationId,
      messageId: userMessage.id,
      workspaceId,
    });
  }

  return userMessage;
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
    throw new ChatRequestError('Workspace not found.', 404, 'WORKSPACE_NOT_FOUND');
  }

  const expectedProjectId = params.conversation.projectId;
  const workspaceProjectId = workspace.projectId || workspace.id;
  if (expectedProjectId) {
    if (expectedProjectId !== workspaceProjectId) {
      throw new ChatRequestError(
        'Workspace does not belong to this conversation.',
        409,
        'CHAT_WORKSPACE_CONFLICT'
      );
    }
    return;
  }

  if (params.conversation.wikiId !== params.workspaceId) {
    throw new ChatRequestError(
      'Workspace does not belong to this conversation.',
      409,
      'CHAT_WORKSPACE_CONFLICT'
    );
  }
}

async function normalizeIncomingAttachment(
  file: File,
  meta?: {
    kind?: 'image' | 'text' | 'file';
    mimeType?: string | null;
    name?: string;
    sizeBytes?: number | null;
    source?: 'upload' | 'clipboard';
  }
): Promise<IncomingAttachment> {
  const kind =
    meta?.kind ||
    (file.type.startsWith('image/')
      ? 'image'
      : file.type.startsWith('text/')
        ? 'text'
        : 'file');
  const mimeType = meta?.mimeType || file.type || null;
  const originalName = meta?.name || file.name || 'attachment';
  const sizeBytes = meta?.sizeBytes ?? file.size ?? null;
  const source = meta?.source === 'clipboard' ? 'clipboard' : 'upload';

  if (kind === 'text' || mimeType?.startsWith('text/')) {
    return {
      content: await file.text(),
      kind: kind === 'file' ? 'file' : 'text',
      mimeType,
      originalName,
      sizeBytes,
      source,
      storageFormat: 'text',
    };
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');
  return {
    content: base64,
    kind,
    mimeType,
    originalName,
    sizeBytes,
    source,
    storageFormat: 'base64-envelope',
  };
}

function asNullableString(value: FormDataEntryValue | string | null | undefined) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asString(value: FormDataEntryValue | string | null | undefined) {
  return typeof value === 'string' ? value : '';
}

function asResearchMode(value: FormDataEntryValue | string | null | undefined): ResearchMode {
  return typeof value === 'string' && value === 'deep' ? 'deep' : 'light';
}

function asChatScope(value: unknown): ChatScope {
  if (value === undefined || value === null || value === '') {
    return 'workspace';
  }

  if (value === 'onboarding' || value === 'workspace') {
    return value;
  }

  throw new ChatRequestError(
    'Chat scope must be either onboarding or workspace.',
    400,
    'INVALID_CHAT_SCOPE'
  );
}

function safeParseJson<T>(value: FormDataEntryValue | null): T | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  return safeJsonParse<T | null>(value, null);
}
