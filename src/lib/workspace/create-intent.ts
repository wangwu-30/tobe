import type { DeliverableType } from '@/types';
import { getCanonicalDeliverableType } from '@/lib/workspace/deliverable-types';

export type WorkspaceCreateIntent = 'document' | 'web' | 'both';

export type WorkspaceCreateIntentChoice = WorkspaceCreateIntent | 'other';

export function normalizeWorkspaceCreateIntent(
  value: unknown
): WorkspaceCreateIntent | null {
  return value === 'document' || value === 'web' || value === 'both' ? value : null;
}

export function normalizeWorkspaceCreateIntentChoice(
  value: unknown
): WorkspaceCreateIntentChoice | null {
  return value === 'document' ||
    value === 'web' ||
    value === 'both' ||
    value === 'other'
    ? value
    : null;
}

export function mapDeliverableTypeToCreateIntent(
  deliverableType: DeliverableType | null | undefined
): WorkspaceCreateIntent | null {
  const canonicalDeliverableType = deliverableType
    ? getCanonicalDeliverableType(deliverableType)
    : null;

  if (canonicalDeliverableType === 'web') {
    return 'web';
  }

  if (canonicalDeliverableType === 'document') {
    return 'document';
  }

  return null;
}

export function mapCreateIntentToDeliverableType(
  createIntent: WorkspaceCreateIntent | null | undefined
): DeliverableType | null {
  if (createIntent === 'document' || createIntent === 'web') {
    return createIntent;
  }

  return null;
}

export function inferWorkspaceCreateIntent(input: {
  constraints?: string | null;
  goal?: string | null;
  selectedIntent?: WorkspaceCreateIntentChoice | null;
  selectedIntentNote?: string | null;
  styleGuide?: string | null;
  workflowPlaybookId?: string | null;
}): WorkspaceCreateIntent | null {
  if (
    input.selectedIntent === 'document' ||
    input.selectedIntent === 'web' ||
    input.selectedIntent === 'both'
  ) {
    return input.selectedIntent;
  }

  const workflowIntent = inferIntentFromWorkflowId(input.workflowPlaybookId);
  const corpus = normalizeCorpus([
    input.goal,
    input.constraints,
    input.styleGuide,
    input.selectedIntent === 'other' ? input.selectedIntentNote : null,
  ]);

  if (!corpus) {
    return workflowIntent;
  }

  if (matchesAny(corpus, BOTH_INTENT_PATTERNS)) {
    return 'both';
  }

  if (workflowIntent === 'both') {
    return 'both';
  }

  const documentScore = countMatches(corpus, DOCUMENT_INTENT_PATTERNS);
  const webScore = countMatches(corpus, WEB_INTENT_PATTERNS);

  if (documentScore > 0 && webScore > 0) {
    return 'both';
  }

  if (workflowIntent === 'document' && documentScore >= webScore) {
    return 'document';
  }

  if (documentScore > 0) {
    return 'document';
  }

  if (webScore > 0) {
    return 'web';
  }

  return workflowIntent;
}

export function shouldClarifyWorkspaceCreateGoal(goal: string | null | undefined) {
  const normalizedGoal = normalizeCorpus([goal]);
  if (!normalizedGoal) {
    return false;
  }

  if (matchesAny(normalizedGoal, VAGUE_GOAL_PATTERNS)) {
    return true;
  }

  return (
    normalizedGoal.length <= 12 &&
    !matchesAny(normalizedGoal, [
      ...DOCUMENT_INTENT_PATTERNS,
      ...GOAL_DETAIL_PATTERNS,
      ...WEB_INTENT_PATTERNS,
    ])
  );
}

function inferIntentFromWorkflowId(workflowPlaybookId: string | null | undefined) {
  if (!workflowPlaybookId) {
    return null;
  }

  if (workflowPlaybookId.includes('deep-research-market-analysis')) {
    return 'document' satisfies WorkspaceCreateIntent;
  }

  if (workflowPlaybookId.includes('spec-to-web-release')) {
    return 'both' satisfies WorkspaceCreateIntent;
  }

  return null;
}

function normalizeCorpus(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => (part || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function countMatches(corpus: string, patterns: RegExp[]) {
  return patterns.reduce(
    (count, pattern) => (pattern.test(corpus) ? count + 1 : count),
    0
  );
}

function matchesAny(corpus: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(corpus));
}

const BOTH_INTENT_PATTERNS = [
  /(文档|报告|方案|brief|spec|specification|requirements?|需求|规格).*(网页|网站|落地页|页面|web|website|landing page|site|page)/i,
  /(网页|网站|落地页|页面|web|website|landing page|site|page).*(文档|报告|方案|brief|spec|specification|requirements?|需求|规格)/i,
  /(同时|并且|并|together|along with|also).*(网页|网站|落地页|页面|web|website|landing page|site|page).*(文档|报告|方案|brief|spec|requirements?|需求|规格)/i,
];

const GOAL_DETAIL_PATTERNS = [
  /\baudience\b/i,
  /\bcustomer(s)?\b/i,
  /\bfor\b/i,
  /\blaunch\b/i,
  /\bresult\b/i,
  /\bsales\b/i,
  /\bteam\b/i,
  /\buser(s)?\b/i,
  /\bwho\b/i,
  /产品/i,
  /介绍/i,
  /分析/i,
  /受众/i,
  /团队/i,
  /客户/i,
  /目标/i,
  /用户/i,
  /结果/i,
  /转化/i,
  /面向/i,
];

const DOCUMENT_INTENT_PATTERNS = [
  /\breport\b/i,
  /\bbrief\b/i,
  /\bproposal\b/i,
  /\bresearch\b/i,
  /\banalysis\b/i,
  /\bdeck\b/i,
  /\bpresentation\b/i,
  /\bpptx?\b/i,
  /\bsummary\b/i,
  /\boverview\b/i,
  /\bmemo\b/i,
  /\bbriefing\b/i,
  /\bspec\b/i,
  /\bspecification\b/i,
  /\brequirements?\b/i,
  /\bfaq\b/i,
  /\bdocument\b/i,
  /报告/i,
  /方案/i,
  /文档/i,
  /调研/i,
  /研究/i,
  /分析/i,
  /摘要/i,
  /执行摘要/i,
  /说明/i,
  /总结/i,
  /综述/i,
  /汇报/i,
  /路演/i,
  /幻灯片/i,
  /演示文稿/i,
  /规格/i,
  /需求/i,
  /课件/i,
];

const WEB_INTENT_PATTERNS = [
  /\blanding page\b/i,
  /\bwebsite\b/i,
  /\bsite\b/i,
  /\bweb app\b/i,
  /\bhomepage\b/i,
  /\bfrontend\b/i,
  /\bfront-end\b/i,
  /\bnext\.?js\b/i,
  /\breact\b/i,
  /\bhtml\b/i,
  /\bcss\b/i,
  /网页/i,
  /网站/i,
  /落地页/i,
  /页面/i,
  /官网/i,
  /前端/i,
  /在线工具/i,
];

const VAGUE_GOAL_PATTERNS = [
  /\b(make|build|create)\s+(something|anything|stuff|whatever|a thing)\b/i,
  /\bhelp me (make|build|create)(\s+(something|anything|stuff|whatever|a thing))?\b/i,
  /帮我(弄|做|搞|整)(个|一个)?(东西|内容|玩意儿)?/i,
  /(弄|做|搞|整)(个|一个)?(东西|内容|玩意儿)/i,
];
