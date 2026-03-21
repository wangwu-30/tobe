import { buildCommentContext } from '@/lib/ai/context-builder';
import { isVisibleCommentMessage } from '@/derive/agent-watching';
import {
  getActiveCommentAgentBindings,
  normalizeCommentAgents,
  parseCommentAgentBindings,
  parseCommentAgentMentions,
  refreshCommentAgentBindings,
} from '@/lib/comments/agents';
import type {
  CommentAgentBindingData,
  CommentAgentConfigData,
  CommentAgentReferenceData,
  CommentResearchStateData,
} from '@/types';
import type { Settings } from '@/lib/ai/providers';

export function resolveCommentResearchTarget(params: {
  bindings: CommentAgentBindingData[];
  content: string;
  preferredAgentId?: string | null;
  settings: Settings;
}) {
  const agents = normalizeCommentAgents(params.settings.commentAgents, params.settings.language);
  const enabledAgents = new Map(
    agents.filter((agent) => agent.enabled).map((agent) => [agent.id, agent])
  );
  const mentions = parseCommentAgentMentions(params.content, agents);

  if (mentions.length > 1) {
    return {
      agent: null,
      error: 'Deep research can target only one role at a time.',
      mention: null,
    };
  }

  const singleMention = mentions[0] || null;
  if (singleMention) {
    const agent = enabledAgents.get(singleMention.agentId) || null;
    return {
      agent,
      error: agent ? null : 'The selected role is unavailable.',
      mention: singleMention,
    };
  }

  if (params.preferredAgentId) {
    const preferred = enabledAgents.get(params.preferredAgentId) || null;
    if (preferred) {
      return {
        agent: preferred,
        error: null,
        mention: buildAgentReference(preferred),
      };
    }
  }

  const activeBindings = getActiveCommentAgentBindings({
    bindings: params.bindings,
  }).filter((binding) => enabledAgents.has(binding.agentId));

  if (activeBindings.length === 1) {
    const binding = activeBindings[0];
    const agent = enabledAgents.get(binding.agentId) || null;
    return {
      agent,
      error: agent ? null : 'The selected role is unavailable.',
      mention: agent ? buildAgentReference(agent) : null,
    };
  }

  const assistant = enabledAgents.get('assistant') || null;
  return {
    agent: assistant,
    error: assistant ? null : 'No comment role is available for deep research.',
    mention: assistant ? buildAgentReference(assistant) : null,
  };
}

export function buildCommentResearchSummary(result: {
  keyFindings: string[];
  reportFileName: string;
  summary: string;
}) {
  const lines = [result.summary.trim()];
  result.keyFindings.slice(0, 3).forEach((finding) => {
    lines.push(`- ${finding}`);
  });
  lines.push(`完整报告见支持资料：${result.reportFileName}`);
  return lines.filter(Boolean).join('\n');
}

export async function buildCommentResearchPrompt(params: {
  anchorText: string;
  documentContent: string;
  messages: Array<{ role: string; content: string }>;
  organizationId: string;
  settings: Settings;
  targetAgent: CommentAgentConfigData;
  userId?: string | null;
  workspaceId: string;
}) {
  const context = await buildCommentContext({
    anchorText: params.anchorText,
    language: params.settings.language,
    organizationId: params.organizationId,
    threadMessages: params.messages
      .filter(isVisibleCommentMessage)
      .map((message) => ({
        role: message.role,
        content: message.content,
      })),
    userId: params.userId,
    wikiContent: params.documentContent,
    wikiId: params.workspaceId,
  });

  return [
    context.systemPrompt,
    '',
    '## Comment Agent',
    `Handle this thread as ${params.targetAgent.name} (${params.targetAgent.handle}).`,
    params.targetAgent.systemPrompt,
    '',
    '## Deep Research Output Contract',
    'Keep the final comment-thread reply concise.',
    'The full research report will be saved into support material.',
    'Surface only the executive summary, up to three key findings, and a pointer to the report artifact.',
  ].join('\n');
}

export function buildNextResearchState(params: {
  current: CommentResearchStateData | null;
  proposal: CommentResearchStateData['proposal'];
  progress: CommentResearchStateData['progress'];
  reportFileId?: string | null;
  reportFileName?: string | null;
  summary?: string | null;
  targetAgent: CommentAgentConfigData;
}) {
  return {
    proposal: params.proposal || null,
    progress: params.progress || null,
    reportFileId: params.reportFileId ?? params.current?.reportFileId ?? null,
    reportFileName: params.reportFileName ?? params.current?.reportFileName ?? null,
    summary: params.summary ?? params.current?.summary ?? null,
    targetAgentId: params.targetAgent.id,
    targetAgentLabel: params.targetAgent.name,
  } satisfies CommentResearchStateData;
}

export function buildResearchBindings(params: {
  bindingsJson: string | null | undefined;
  targetAgent: CommentAgentConfigData;
}) {
  return refreshCommentAgentBindings({
    bindings: parseCommentAgentBindings(params.bindingsJson),
    mentions: [buildAgentReference(params.targetAgent)],
  });
}

function buildAgentReference(agent: CommentAgentConfigData): CommentAgentReferenceData {
  return {
    agentId: agent.id,
    agentLabel: agent.name,
    handle: agent.handle,
  };
}
