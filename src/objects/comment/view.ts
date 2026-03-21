import {
  parseCommentAgentBindings,
  parseCommentAgentMentionsJson,
} from '@/lib/comments/agents';
import { parseCommentResearchState } from '@/lib/comments/research';
import {
  buildReviewAnchorFingerprint,
  parseReviewAnchor,
} from '@/lib/comments/review-anchor';
import { normalizeCommentThreadStatus } from '@/lib/comments/status';
import { mapWorkspaceVersion } from '@/objects/workspace/view';
import type { CommentMessageData, CommentThreadData } from '@/types';

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
