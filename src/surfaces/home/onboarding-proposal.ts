import { safeJsonParse } from '@/framework/resilience/safe-data';

export const WIKI_SPACE_PROPOSAL_FENCE = 'wiki-space-proposal';

export type OnboardingWikiProposal = {
  purpose: string;
  source: 'assistant-structured' | 'conversation-summary';
  title: string;
};

type OnboardingMessageLike = {
  content: string;
  role: string;
};

const PROPOSAL_FENCE_REGEX = /```wiki-space-proposal[ \t]*\r?\n([\s\S]*?)```/gi;
const MAX_TITLE_LENGTH = 80;
const MAX_DERIVED_TITLE_LENGTH = 42;
const MAX_PURPOSE_LENGTH = 280;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeText(value: string, maxLength: number) {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }

  return collapsed.slice(0, maxLength).trim();
}

export function parseStructuredWikiProposal(
  content: string
): { purpose: string; title: string } | null {
  if (!content || !content.includes('```')) {
    return null;
  }

  let match: RegExpExecArray | null = null;
  let lastValid: { purpose: string; title: string } | null = null;
  const regex = new RegExp(PROPOSAL_FENCE_REGEX.source, 'gi');

  while ((match = regex.exec(content)) !== null) {
    const rawJson = match[1]?.trim();
    if (!rawJson) {
      continue;
    }

    const parsed = safeJsonParse<Record<string, unknown> | null>(
      rawJson,
      null,
      isRecord
    );
    if (!parsed) {
      continue;
    }

    const rawTitle = typeof parsed.title === 'string' ? parsed.title : '';
    const rawPurpose =
      typeof parsed.purpose === 'string'
        ? parsed.purpose
        : typeof parsed.goal === 'string'
          ? parsed.goal
          : '';
    const title = normalizeText(rawTitle, MAX_TITLE_LENGTH);
    if (!title) {
      continue;
    }

    lastValid = {
      purpose: normalizeText(rawPurpose, MAX_PURPOSE_LENGTH),
      title,
    };
  }

  return lastValid;
}

export function stripOnboardingProposalBlocks(content: string): string {
  if (!content || !content.includes('```')) {
    return content;
  }

  const stripped = content
    .replace(PROPOSAL_FENCE_REGEX, (fullMatch, jsonBody: string) => {
      const parsed = safeJsonParse<Record<string, unknown> | null>(
        jsonBody?.trim(),
        null,
        isRecord
      );
      if (parsed && typeof parsed.title === 'string' && parsed.title.trim()) {
        return '';
      }
      return fullMatch;
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return stripped.length > 0 ? stripped : content;
}

export function suggestTitleFromGoal(goal: string): string {
  const normalized = goal.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  const firstClause =
    normalized
      .split(/[。！？!?\n]/)[0]
      ?.trim() || normalized;

  const cleaned = firstClause
    .replace(
      /^(?:(?:please|can you|could you)\s+)?(?:help me\s+)?(?:build|create|plan|design|organize|start|write|make)\s+(?:a|an|the|my|our)?\s*/i,
      ''
    )
    .replace(
      /^(?:请)?(?:帮我|我想|我要|想要|准备)?(?:建立|创建|整理|规划|搭建|写|做)(?:一个|一份|一套)?/,
      ''
    )
    .replace(/[.,;:!?。，；：！？]+$/, '')
    .trim();

  const candidate = cleaned || firstClause;
  if (candidate.length <= MAX_DERIVED_TITLE_LENGTH) {
    return candidate;
  }

  const truncated = candidate.slice(0, MAX_DERIVED_TITLE_LENGTH);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > 18) {
    return truncated.slice(0, lastSpace).trim();
  }

  return truncated.trim();
}

export function deriveOnboardingWikiProposal(
  messages: OnboardingMessageLike[]
): OnboardingWikiProposal | null {
  let latestUserGoal = '';
  let hasAssistantReply = false;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const text = message.content.trim();
    if (!text) continue;

    if (!latestUserGoal && message.role === 'user') {
      latestUserGoal = text;
    }
    if (message.role === 'assistant') {
      hasAssistantReply = true;
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant') {
      continue;
    }

    const structured = parseStructuredWikiProposal(message.content);
    if (structured) {
      return {
        purpose: structured.purpose || normalizeText(latestUserGoal, MAX_PURPOSE_LENGTH),
        source: 'assistant-structured',
        title: structured.title,
      };
    }
  }

  if (!latestUserGoal || !hasAssistantReply) {
    return null;
  }

  const derivedTitle = suggestTitleFromGoal(latestUserGoal);
  if (!derivedTitle) {
    return null;
  }

  return {
    purpose: normalizeText(latestUserGoal, MAX_PURPOSE_LENGTH),
    source: 'conversation-summary',
    title: derivedTitle,
  };
}
