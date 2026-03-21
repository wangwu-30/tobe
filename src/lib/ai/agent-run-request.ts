import type { NextRequest } from 'next/server';
import {
  parseChatRequest,
  type ChatRequestPayload,
} from '@/lib/ai/chat-request';

export type ChatAgentRunPayload = ChatRequestPayload & {
  mode: 'chat';
};

type CommentReplyAgentRunTarget = {
  agentId?: string | null;
  threadId: string;
  workspaceId?: string | null;
};

type CommentReplyAgentRunInput = {
  anchorText?: string | null;
  documentContent?: string | null;
};

export type CommentReplyAgentRunPayload = {
  mode: 'comment-reply';
  model?: string | null;
  input: CommentReplyAgentRunInput;
  target: CommentReplyAgentRunTarget;
};

type SuggestEditAgentRunTarget = {
  workspaceId?: string | null;
};

type SuggestEditAgentRunInput = {
  anchorText: string;
  documentContent?: string | null;
  threadDiscussion: string;
};

export type SuggestEditAgentRunPayload = {
  mode: 'suggest-edit';
  model?: string | null;
  input: SuggestEditAgentRunInput;
  target: SuggestEditAgentRunTarget;
};

type ExtractMemoryAgentRunTarget = {
  threadId: string;
};

export type ExtractMemoryAgentRunPayload = {
  mode: 'extract-memory';
  model?: string | null;
  target: ExtractMemoryAgentRunTarget;
};

export type AgentRunRequestPayload =
  | ChatAgentRunPayload
  | CommentReplyAgentRunPayload
  | SuggestEditAgentRunPayload
  | ExtractMemoryAgentRunPayload;

export async function parseAgentRunRequest(
  req: NextRequest,
  options?: {
    forcedMode?: AgentRunRequestPayload['mode'];
  }
): Promise<AgentRunRequestPayload> {
  const contentType = req.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    return {
      mode: 'chat',
      ...(await parseChatRequest(req)),
    };
  }

  const body = await req.clone().json().catch(() => null);
  const mode = options?.forcedMode || (typeof body?.mode === 'string' ? body.mode : null);

  if (mode === 'comment-reply') {
    return buildCommentReplyAgentRunPayload(body);
  }

  if (mode === 'suggest-edit') {
    return buildSuggestEditAgentRunPayload(body);
  }

  if (mode === 'extract-memory') {
    return buildExtractMemoryAgentRunPayload(body);
  }

  return {
    mode: 'chat',
    ...(await parseChatRequest(req)),
  };
}

export function buildCommentReplyAgentRunPayload(
  body: unknown
): CommentReplyAgentRunPayload {
  const value = asRecord(body);
  const target = asRecord(value.target);
  const input = asRecord(value.input);

  return {
    mode: 'comment-reply',
    model: asNullableString(value.model),
    input: {
      anchorText: asNullableString(input.anchorText) || asNullableString(value.anchorText),
      documentContent:
        asNullableString(input.documentContent) ||
        asNullableString(value.documentContent) ||
        asNullableString(value.wikiContent),
    },
    target: {
      agentId: asNullableString(target.agentId) || asNullableString(value.agentId),
      threadId: asString(target.threadId) || asString(value.threadId),
      workspaceId:
        asNullableString(target.workspaceId) ||
        asNullableString(value.workspaceId) ||
        asNullableString(value.documentId) ||
        asNullableString(value.wikiId),
    },
  };
}

export function buildSuggestEditAgentRunPayload(
  body: unknown
): SuggestEditAgentRunPayload {
  const value = asRecord(body);
  const target = asRecord(value.target);
  const input = asRecord(value.input);

  return {
    mode: 'suggest-edit',
    model: asNullableString(value.model),
    input: {
      anchorText: asString(input.anchorText) || asString(value.anchorText),
      documentContent:
        asNullableString(input.documentContent) ||
        asNullableString(value.documentContent) ||
        asNullableString(value.wikiContent),
      threadDiscussion:
        asString(input.threadDiscussion) || asString(value.threadDiscussion),
    },
    target: {
      workspaceId:
        asNullableString(target.workspaceId) ||
        asNullableString(value.workspaceId) ||
        asNullableString(value.documentId) ||
        asNullableString(value.wikiId),
    },
  };
}

export function buildExtractMemoryAgentRunPayload(
  body: unknown
): ExtractMemoryAgentRunPayload {
  const value = asRecord(body);
  const target = asRecord(value.target);

  return {
    mode: 'extract-memory',
    model: asNullableString(value.model),
    target: {
      threadId: asString(target.threadId) || asString(value.threadId),
    },
  };
}

function asRecord(value: unknown) {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function asNullableString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : '';
}
