'use client';

import type { ChatAttachmentData, ChatMessageData } from '@/types';
import type { ChatComposerAttachment } from '@/components/chat/attachment-types';

const LOCAL_ORGANIZATION_ID = 'local-org';
const PENDING_CONVERSATION_ID = 'pending-conversation';

type LocalMessageContext = {
  conversationId?: string | null;
  workspaceId?: string | null;
};

type TempIdGenerator = () => string;

function resolveConversationId(conversationId?: string | null) {
  return conversationId || PENDING_CONVERSATION_ID;
}

function resolveWorkspaceId(workspaceId?: string | null) {
  return workspaceId || '';
}

function createLocalMessageDraft(params: LocalMessageContext & {
  attachments: ChatAttachmentData[];
  content: string;
  model: string | null;
  nextTempId: TempIdGenerator;
  role: 'assistant' | 'user';
}) {
  return {
    id:
      params.role === 'assistant'
        ? `${params.nextTempId()}-assistant`
        : params.nextTempId(),
    conversationId: resolveConversationId(params.conversationId),
    organizationId: LOCAL_ORGANIZATION_ID,
    role: params.role,
    content: params.content,
    attachments: params.attachments,
    workspaceId: params.workspaceId || null,
    wikiId: params.workspaceId || null,
    model: params.model,
    createdByUserId: null,
    originDeviceId: null,
    revision: 1,
    deletedAt: null,
    createdAt: new Date(),
  } satisfies ChatMessageData;
}

export function createLocalAttachmentDrafts(params: LocalMessageContext & {
  attachments?: ChatComposerAttachment[];
  nextTempId: TempIdGenerator;
}) {
  return (params.attachments || []).map((attachment, index) => {
    const timestamp = new Date();

    return {
      id: `${params.nextTempId()}-attachment-${index}`,
      organizationId: LOCAL_ORGANIZATION_ID,
      conversationId: resolveConversationId(params.conversationId),
      messageId: '',
      workspaceId: resolveWorkspaceId(params.workspaceId),
      workspaceFileId: '',
      filePath: attachment.file.name,
      kind: attachment.kind,
      source: attachment.source,
      storageFormat:
        attachment.kind === 'image'
          ? ('base64-envelope' as const)
          : ('text' as const),
      mimeType: attachment.file.type || null,
      originalName: attachment.file.name,
      sizeBytes: attachment.file.size,
      previewUrl:
        attachment.kind === 'image' ? URL.createObjectURL(attachment.file) : null,
      createdByUserId: null,
      originDeviceId: null,
      revision: 1,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    } satisfies ChatAttachmentData;
  });
}

export function createLocalUserMessageDraft(params: LocalMessageContext & {
  attachments: ChatAttachmentData[];
  content: string;
  nextTempId: TempIdGenerator;
}) {
  return createLocalMessageDraft({
    attachments: params.attachments,
    content: params.content,
    conversationId: params.conversationId,
    model: null,
    nextTempId: params.nextTempId,
    role: 'user',
    workspaceId: params.workspaceId,
  });
}

export function createLocalAssistantMessageDraft(params: LocalMessageContext & {
  model: string | null;
  nextTempId: TempIdGenerator;
}) {
  return createLocalMessageDraft({
    attachments: [],
    content: '',
    conversationId: params.conversationId,
    model: params.model,
    nextTempId: params.nextTempId,
    role: 'assistant',
    workspaceId: params.workspaceId,
  });
}
