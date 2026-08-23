import { safeJsonParse } from '@/framework/resilience';
import { parseAssistantRunPayload } from '@/lib/workspace/assistant-run-payload';
import { mapWorkspace } from '@/objects/workspace/view';
import type {
  AssistantRunData,
  ChatAttachmentData,
  ConversationBranchSummary,
  ConversationData,
  ConversationMessageData,
  ConversationWithRelations,
} from '@/types';

type SupportFileEnvelope = {
  base64?: string;
  encoding: 'base64';
  kind: 'binary';
  mimeType: string | null;
  originalName: string;
  sizeBytes: number | null;
};

export function mapConversation(
  session: {
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
    projectId?: string | null;
    revision: number;
    scopeKind?: string | null;
    sourceType: string;
    title: string;
    updatedAt: Date;
    wikiId: string | null;
  },
  pendingChangeSetsByConversation?: Map<string, number>
): ConversationData {
  return {
    id: session.id,
    organizationId: session.organizationId,
    workspaceId: session.wikiId || session.projectId || null,
    projectId: session.projectId || session.wikiId || null,
    wikiId: session.wikiId,
    parentConversationId: session.parentSessionId,
    forkedFromMessageId: session.forkedFromMessageId,
    baseVersionId: session.baseVersionId,
    activeFileId: session.activeFileId,
    hasPendingChanges:
      (pendingChangeSetsByConversation?.get(session.id) || 0) > 0,
    scopeFilter: session.activeFileId,
    scopeKind: normalizeConversationScopeKind(session.scopeKind),
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
  focusNodeId?: string | null;
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
    workspaceId: message.focusNodeId || message.documentId || null,
    focusNodeId: message.focusNodeId || message.documentId || null,
    wikiId: message.documentId || message.focusNodeId || null,
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
  const kind = normalizeAttachmentKind(attachment.kind);

  return {
    id: attachment.id,
    organizationId: attachment.organizationId,
    conversationId: attachment.sessionId,
    messageId: attachment.messageId,
    workspaceId: attachment.documentId,
    workspaceFileId: attachment.fileId,
    filePath: attachment.file.path,
    kind,
    source: normalizeAttachmentSource(attachment.source),
    storageFormat: normalizeAttachmentStorageFormat(attachment.storageFormat),
    mimeType: attachment.mimeType,
    originalName: attachment.originalName,
    sizeBytes: attachment.sizeBytes,
    previewUrl: buildAttachmentPreviewUrl(
      kind,
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
  documentId: string | null;
  finishedAt: Date | null;
  id: string;
  mode: string;
  organizationId: string;
  originDeviceId: string | null;
  payloadJson: string | null;
  requestMessageId: string | null;
  revision: number;
  scopeKind?: string | null;
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
    scopeKind: normalizeConversationScopeKind(run.scopeKind),
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

export function buildConversationTree(
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

export function mapConversationWithRelations(
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
    projectId?: string | null;
    revision: number;
    scopeKind?: string | null;
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

function buildAttachmentPreviewUrl(
  kind: ChatAttachmentData['kind'],
  storedContent?: string | null,
  mimeType?: string | null
) {
  if (kind !== 'image' || !storedContent) {
    return null;
  }

  const parsed = safeJsonParse<SupportFileEnvelope | null>(storedContent, null);
  if (!parsed || parsed.kind !== 'binary' || parsed.encoding !== 'base64' || !parsed.base64) {
    return null;
  }

  const resolvedMimeType = mimeType || parsed.mimeType || 'application/octet-stream';
  return `data:${resolvedMimeType};base64,${parsed.base64}`;
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

function normalizeConversationScopeKind(
  scopeKind?: string | null
): ConversationData['scopeKind'] {
  return scopeKind === 'team' ? 'team' : 'wiki';
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
