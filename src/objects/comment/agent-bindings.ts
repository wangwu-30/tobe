import type { Settings } from '@/lib/ai/providers';
import {
  parseCommentAgentBindings,
  parseCommentAgentMentions,
  refreshCommentAgentBindings,
  stopCommentAgentListening,
  stringifyCommentAgentBindings,
} from '@/lib/comments/agents';
import {
  buildResearchBindings,
  resolveCommentResearchTarget,
} from '@/lib/comments/research-orchestration';
import type {
  CommentAgentBindingData,
  CommentAgentConfigData,
  CommentAgentReferenceData,
} from '@/types';

type CommentAgentBindingsState = {
  bindings: CommentAgentBindingData[];
  bindingsJson: string | null;
};

export function buildCommentMessageAgentState(params: {
  agents: CommentAgentConfigData[];
  bindingsJson?: string | null;
  content: string;
  now?: Date;
  role: string;
}) {
  const currentBindings = parseCommentAgentBindings(params.bindingsJson);
  const mentions =
    params.role === 'user'
      ? parseCommentAgentMentions(params.content, params.agents)
      : [];
  const nextBindings =
    params.role === 'user' && mentions.length > 0
      ? refreshCommentAgentBindings({
          bindings: currentBindings,
          mentions,
          now: params.now,
        })
      : currentBindings;

  return {
    ...buildCommentAgentBindingsState(nextBindings),
    mentions,
  };
}

export function refreshCommentAgentBindingsState(params: {
  bindingsJson?: string | null;
  mentions: CommentAgentReferenceData[];
  now?: Date;
}) {
  const nextBindings = refreshCommentAgentBindings({
    bindings: parseCommentAgentBindings(params.bindingsJson),
    mentions: params.mentions,
    now: params.now,
  });

  return buildCommentAgentBindingsState(nextBindings);
}

export function stopCommentAgentListeningState(params: {
  agentId: string;
  bindingsJson?: string | null;
}) {
  const nextBindings = stopCommentAgentListening({
    agentId: params.agentId,
    bindings: parseCommentAgentBindings(params.bindingsJson),
  });

  return buildCommentAgentBindingsState(nextBindings);
}

export function resolveCommentResearchTargetFromBindings(params: {
  bindingsJson?: string | null;
  content: string;
  preferredAgentId?: string | null;
  settings: Settings;
}) {
  return resolveCommentResearchTarget({
    bindings: parseCommentAgentBindings(params.bindingsJson),
    content: params.content,
    preferredAgentId: params.preferredAgentId,
    settings: params.settings,
  });
}

export function buildCommentResearchAgentState(params: {
  bindingsJson?: string | null;
  targetAgent: CommentAgentConfigData;
}) {
  return buildCommentAgentBindingsState(
    buildResearchBindings({
      bindingsJson: params.bindingsJson,
      targetAgent: params.targetAgent,
    })
  );
}

function buildCommentAgentBindingsState(
  bindings: CommentAgentBindingData[]
): CommentAgentBindingsState {
  return {
    bindings,
    bindingsJson: bindings.length > 0 ? stringifyCommentAgentBindings(bindings) : null,
  };
}
