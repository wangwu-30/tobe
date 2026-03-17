import type {
  CommentAgentBindingData,
  CommentAgentConfigData,
  CommentAgentReferenceData,
} from '@/types';
import type { AppLanguage } from '@/lib/i18n/language';

export const COMMENT_AGENT_LISTENING_WINDOW_MS = 3 * 60 * 1000;

function normalizeHandle(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
  if (!normalized) {
    return '';
  }

  const withAt = normalized.startsWith('@') ? normalized : `@${normalized}`;
  return withAt.replace(/[^@a-z0-9_-]/g, '');
}

function defaultBuiltinAgentName(language?: AppLanguage | null) {
  return language === 'zh-CN' ? 'AI 助手' : 'AI Assistant';
}

export function getBuiltinCommentAgents(
  language?: AppLanguage | null
): CommentAgentConfigData[] {
  return [
    {
      id: 'assistant',
      handle: '@assistant',
      name: defaultBuiltinAgentName(language),
      systemPrompt:
        language === 'zh-CN'
          ? '你是评论线程里的 AI 助手。把用户评论当作局部修改请求，给出直接、可执行、贴近原文的回应。'
          : 'You are the AI assistant inside comment threads. Treat each user message as a localized revision request and respond with direct, actionable feedback.',
      enabled: true,
      builtin: true,
    },
  ];
}

export function normalizeCommentAgents(
  input: unknown,
  language?: AppLanguage | null
): CommentAgentConfigData[] {
  const builtins = getBuiltinCommentAgents(language);
  const byId = new Map(builtins.map((agent) => [agent.id, agent]));
  const byHandle = new Set(builtins.map((agent) => agent.handle));

  if (!Array.isArray(input)) {
    return [...builtins];
  }

  input.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const record = item as Record<string, unknown>;
    const id =
      typeof record.id === 'string' && record.id.trim()
        ? record.id.trim()
        : null;
    const handle =
      typeof record.handle === 'string' ? normalizeHandle(record.handle) : '';
    const name =
      typeof record.name === 'string' && record.name.trim()
        ? record.name.trim()
        : null;
    const systemPrompt =
      typeof record.systemPrompt === 'string' ? record.systemPrompt.trim() : '';

    if (!id || !handle || !name || byId.has(id) || byHandle.has(handle)) {
      return;
    }

    byId.set(id, {
      id,
      handle,
      name,
      systemPrompt,
      enabled: record.enabled !== false,
      builtin: false,
    });
    byHandle.add(handle);
  });

  return [...byId.values()];
}

export function buildStoredCommentAgents(
  agents: CommentAgentConfigData[]
): CommentAgentConfigData[] {
  return agents
    .filter((agent) => !agent.builtin)
    .map((agent) => ({
      id: agent.id,
      handle: normalizeHandle(agent.handle),
      name: agent.name.trim(),
      systemPrompt: agent.systemPrompt.trim(),
      enabled: agent.enabled,
      builtin: false,
    }))
    .filter((agent) => agent.id && agent.handle && agent.name);
}

export function parseCommentAgentMentions(
  content: string,
  agents: CommentAgentConfigData[]
): CommentAgentReferenceData[] {
  const registry = new Map(
    agents.map((agent) => [normalizeHandle(agent.handle), agent])
  );
  const seen = new Set<string>();
  const matches: CommentAgentReferenceData[] = [];
  const pattern = /(^|\s)(@[a-z0-9_-]+)/gi;
  let match: RegExpExecArray | null = pattern.exec(content);

  while (match) {
    const handle = normalizeHandle(match[2] || '');
    const agent = registry.get(handle);
    if (agent && !seen.has(agent.id)) {
      seen.add(agent.id);
      matches.push({
        agentId: agent.id,
        agentLabel: agent.name,
        handle: agent.handle,
      });
    }
    match = pattern.exec(content);
  }

  return matches;
}

export function parseCommentAgentBindings(
  value: string | null | undefined
): CommentAgentBindingData[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const bindings: Array<CommentAgentBindingData | null> = parsed
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const record = item as Record<string, unknown>;
        if (
          typeof record.agentId !== 'string' ||
          typeof record.agentLabel !== 'string' ||
          typeof record.handle !== 'string' ||
          typeof record.listeningUntil !== 'string' ||
          typeof record.lastActivatedAt !== 'string'
        ) {
          return null;
        }

        return {
          agentId: record.agentId,
          agentLabel: record.agentLabel,
          handle: normalizeHandle(record.handle),
          listeningUntil: record.listeningUntil,
          lastActivatedAt: record.lastActivatedAt,
          sortOrder:
            typeof record.sortOrder === 'number' && Number.isFinite(record.sortOrder)
              ? record.sortOrder
              : 0,
        } satisfies CommentAgentBindingData;
      });

    return bindings
      .filter((item): item is CommentAgentBindingData => item !== null)
      .sort((left, right) => left.sortOrder - right.sortOrder);
  } catch {
    return [];
  }
}

export function stringifyCommentAgentBindings(bindings: CommentAgentBindingData[]) {
  return JSON.stringify(bindings);
}

export function stringifyCommentAgentMentions(mentions: CommentAgentReferenceData[]) {
  return JSON.stringify(mentions);
}

export function parseCommentAgentMentionsJson(
  value: string | null | undefined
): CommentAgentReferenceData[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const record = item as Record<string, unknown>;
        if (
          typeof record.agentId !== 'string' ||
          typeof record.agentLabel !== 'string' ||
          typeof record.handle !== 'string'
        ) {
          return null;
        }

        return {
          agentId: record.agentId,
          agentLabel: record.agentLabel,
          handle: normalizeHandle(record.handle),
        } satisfies CommentAgentReferenceData;
      })
      .filter((item): item is CommentAgentReferenceData => Boolean(item));
  } catch {
    return [];
  }
}

export function refreshCommentAgentBindings(params: {
  bindings: CommentAgentBindingData[];
  mentions: CommentAgentReferenceData[];
  now?: Date;
}) {
  const now = params.now || new Date();
  const nextBindings = [...params.bindings];
  const nowIso = now.toISOString();
  const listeningUntil = new Date(
    now.getTime() + COMMENT_AGENT_LISTENING_WINDOW_MS
  ).toISOString();
  let nextSortOrder =
    nextBindings.reduce((max, binding) => Math.max(max, binding.sortOrder), -1) + 1;

  params.mentions.forEach((mention) => {
    const existingIndex = nextBindings.findIndex(
      (binding) => binding.agentId === mention.agentId
    );

    if (existingIndex >= 0) {
      nextBindings[existingIndex] = {
        ...nextBindings[existingIndex],
        agentLabel: mention.agentLabel,
        handle: normalizeHandle(mention.handle),
        lastActivatedAt: nowIso,
        listeningUntil,
      };
      return;
    }

    nextBindings.push({
      ...mention,
      handle: normalizeHandle(mention.handle),
      lastActivatedAt: nowIso,
      listeningUntil,
      sortOrder: nextSortOrder,
    });
    nextSortOrder += 1;
  });

  return nextBindings.sort((left, right) => left.sortOrder - right.sortOrder);
}

export function stopCommentAgentListening(params: {
  agentId: string;
  bindings: CommentAgentBindingData[];
}) {
  return params.bindings.filter((binding) => binding.agentId !== params.agentId);
}

export function getActiveCommentAgentBindings(params: {
  bindings: CommentAgentBindingData[];
  now?: Date;
}) {
  const now = (params.now || new Date()).getTime();
  return params.bindings.filter(
    (binding) => new Date(binding.listeningUntil).getTime() > now
  );
}

export function resolveReplyTargets(params: {
  agents: CommentAgentConfigData[];
  bindings: CommentAgentBindingData[];
  content: string;
  now?: Date;
}) {
  const mentions = parseCommentAgentMentions(params.content, params.agents);
  if (mentions.length > 0) {
    return mentions;
  }

  const enabledAgents = new Map(
    params.agents.filter((agent) => agent.enabled).map((agent) => [agent.id, agent])
  );

  return getActiveCommentAgentBindings({
    bindings: params.bindings,
    now: params.now,
  }).filter((binding) => enabledAgents.has(binding.agentId));
}

export function resolveSingleResearchTarget(params: {
  agents: CommentAgentConfigData[];
  bindings?: CommentAgentBindingData[];
  content: string;
}) {
  const mentions = parseCommentAgentMentions(params.content, params.agents);
  if (mentions.length > 1) {
    return {
      error: 'multiple',
      target: null,
    } as const;
  }

  if (mentions.length === 1) {
    return {
      error: null,
      target: mentions[0],
    } as const;
  }

  const enabledBindings = (params.bindings || []).filter((binding) =>
    params.agents.some((agent) => agent.id === binding.agentId && agent.enabled)
  );
  if (enabledBindings.length === 1) {
    return {
      error: null,
      target: {
        agentId: enabledBindings[0].agentId,
        agentLabel: enabledBindings[0].agentLabel,
        handle: enabledBindings[0].handle,
      },
    } as const;
  }

  const assistantAgent =
    params.agents.find((agent) => agent.id === 'assistant' && agent.enabled) || null;
  if (assistantAgent) {
    return {
      error: null,
      target: {
        agentId: assistantAgent.id,
        agentLabel: assistantAgent.name,
        handle: assistantAgent.handle,
      },
    } as const;
  }

  return {
    error: 'missing',
    target: null,
  } as const;
}

export function formatRemainingListeningMs(listeningUntil: Date | string, now: number) {
  return Math.max(0, new Date(listeningUntil).getTime() - now);
}

export function buildMissingAgentBindings(params: {
  agents: CommentAgentConfigData[];
  bindings: CommentAgentBindingData[];
}) {
  const registry = new Set(params.agents.map((agent) => agent.id));
  return params.bindings.filter((binding) => !registry.has(binding.agentId));
}
