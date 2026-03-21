import {
  parseCommentAgentBindings,
  parseCommentAgentMentionsJson,
  refreshCommentAgentBindings,
  stopCommentAgentListening,
  stringifyCommentAgentMentions,
} from '@/lib/comments/agents';
import type { CommentAgentBindingData, CommentAgentReferenceData } from '@/types';

export const COMMENT_AGENT_STOP_LISTENING_MODEL = 'comment-control:stop_agent_listening';
const COMMENT_AGENT_STOP_LISTENING_CONTENT = '[comment-control] stop_agent_listening';

type CommentAgentMessageRecord = {
  agentId?: string | null;
  agentLabel?: string | null;
  content: string;
  createdAt: Date | string;
  mentionedAgentsJson?: string | null;
  model?: string | null;
  role: string;
};

export function deriveCommentAgentBindings(params: {
  bindingsJson?: string | null;
  messages: CommentAgentMessageRecord[];
}) {
  if (!hasCommentAgentBindingHistory(params.messages)) {
    return parseCommentAgentBindings(params.bindingsJson);
  }

  let bindings: CommentAgentBindingData[] = [];
  for (const message of [...params.messages].sort(compareCommentMessageTimestamp)) {
    const mentions = parseCommentAgentMentionsJson(message.mentionedAgentsJson);

    if (message.role === 'user' && mentions.length > 0) {
      bindings = refreshCommentAgentBindings({
        bindings,
        mentions,
        now: new Date(message.createdAt),
      });
      continue;
    }

    if (isStopCommentAgentMessage(message) && mentions.length > 0) {
      bindings = stopCommentAgentListening({
        agentId: mentions[0].agentId,
        bindings,
      });
      continue;
    }

    if (!isCommentAgentReplyMessage(message)) {
      continue;
    }

    const existingBinding = bindings.find((binding) => binding.agentId === message.agentId);
    if (!existingBinding) {
      continue;
    }

    bindings = refreshCommentAgentBindings({
      bindings,
      mentions: [
        {
          agentId: existingBinding.agentId,
          agentLabel: message.agentLabel?.trim() || existingBinding.agentLabel,
          handle: existingBinding.handle,
        },
      ],
      now: new Date(message.createdAt),
    });
  }

  return bindings;
}

export function buildStopCommentAgentControlMessage(target: CommentAgentReferenceData) {
  return {
    content: COMMENT_AGENT_STOP_LISTENING_CONTENT,
    mentionedAgentsJson: stringifyCommentAgentMentions([target]),
    model: COMMENT_AGENT_STOP_LISTENING_MODEL,
    role: 'system' as const,
  };
}

export function isStopCommentAgentMessage(
  message: Pick<CommentAgentMessageRecord, 'model' | 'role'>
) {
  return (
    message.role === 'system' &&
    message.model === COMMENT_AGENT_STOP_LISTENING_MODEL
  );
}

export function isVisibleCommentMessage(
  message: Pick<CommentAgentMessageRecord, 'model' | 'role'>
) {
  return !isStopCommentAgentMessage(message);
}

function hasCommentAgentBindingHistory(messages: CommentAgentMessageRecord[]) {
  return messages.some((message) => {
    const mentions = parseCommentAgentMentionsJson(message.mentionedAgentsJson);
    return (
      (message.role === 'user' && mentions.length > 0) ||
      (isStopCommentAgentMessage(message) && mentions.length > 0)
    );
  });
}

function isCommentAgentReplyMessage(
  message: Pick<CommentAgentMessageRecord, 'agentId' | 'role'>
) {
  return (
    message.role === 'assistant' &&
    typeof message.agentId === 'string' &&
    message.agentId.trim().length > 0
  );
}

function compareCommentMessageTimestamp(
  left: Pick<CommentAgentMessageRecord, 'createdAt'>,
  right: Pick<CommentAgentMessageRecord, 'createdAt'>
) {
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}
