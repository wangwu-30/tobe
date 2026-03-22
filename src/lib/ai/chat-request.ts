import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { safeJsonParse } from '@/framework/resilience';
import {
  createConversationForWorkspace,
  createConversationMessage,
} from '@/objects/conversation/commands';
import {
  createWorkspaceWithConversation,
  storeMessageSupportAttachments,
} from '@/lib/workspace/service';
import type { ResearchMode } from '@/types';

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
  message: string;
  model?: string | null;
  researchMode?: ResearchMode;
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

    return {
      activeFileId: asNullableString(formData.get('activeFileId')),
      attachments: await Promise.all(
        files.map((file, index) => normalizeIncomingAttachment(file, meta[index]))
      ),
      baseVersionId: asNullableString(formData.get('baseVersionId')),
      conversationId:
        asNullableString(formData.get('conversationId')) ||
        asNullableString(formData.get('sessionId')),
      message: asString(formData.get('message')),
      model: asNullableString(formData.get('model')),
      researchMode: asResearchMode(formData.get('researchMode')),
      workspaceId:
        asNullableString(formData.get('workspaceId')) ||
        asNullableString(formData.get('wikiId')),
    };
  }

  const body = await req.json();
  return {
    activeFileId: body.activeFileId || null,
    attachments: [],
    baseVersionId: body.baseVersionId || null,
    conversationId: body.conversationId || body.sessionId || null,
    message: typeof body.message === 'string' ? body.message : '',
    model: typeof body.model === 'string' ? body.model : null,
    researchMode: body.researchMode === 'deep' ? 'deep' : 'light',
    workspaceId: body.workspaceId || body.wikiId || null,
  };
}

export async function ensureChatConversation(params: {
  actor: ActorContext;
  activeFileId?: string | null;
  baseVersionId?: string | null;
  conversationId?: string | null;
  conversationTitle: string;
  title: string;
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

  if (!workspaceId) {
    workspaceId = conversation.wikiId;
  }

  if (!workspaceId) {
    throw new Error('Conversation is not attached to a workspace.');
  }

  if (!conversation.wikiId) {
    conversation = await prisma.session.update({
      where: { id: conversation.id },
      data: { wikiId: workspaceId },
    });
  }

  return {
    conversation,
    conversationId: conversation.id,
    workspaceId,
  };
}

export async function createChatUserMessage(params: {
  actor: ActorContext;
  activeFileId?: string | null;
  attachments: IncomingAttachment[];
  content: string;
  conversationId: string;
  workspaceId: string;
}) {
  const userMessage = await createConversationMessage(params.actor, {
    activeFileId: params.activeFileId,
    content: params.content,
    conversationId: params.conversationId,
    role: 'user',
    workspaceId: params.workspaceId,
  });

  if (params.attachments.length > 0) {
    await storeMessageSupportAttachments(params.actor, {
      attachments: params.attachments,
      conversationId: params.conversationId,
      messageId: userMessage.id,
      workspaceId: params.workspaceId,
    });
  }

  return userMessage;
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

function safeParseJson<T>(value: FormDataEntryValue | null): T | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  return safeJsonParse<T | null>(value, null);
}
