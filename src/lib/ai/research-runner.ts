import { completeWithPi, extractTextContent } from '@/lib/ai/pi-runtime';
import { markdownToPlate } from '@/lib/ai/serializer';
import type { Settings } from '@/lib/ai/providers';
import type { SearchProvider, SearchCitation, SearchResult } from '@/lib/search/types';
import { createWorkspaceFile, listWorkspaceFiles, updateWorkspaceFile } from '@/lib/workspace/service';
import type {
  DeepResearchPlanProposalData,
  ResearchProgressData,
} from '@/types';
import type { Api, Model as PiModel } from '@mariozechner/pi-ai';

type AnyPiModel = PiModel<Api>;

type ActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

export const LIGHT_RESEARCH_SEARCH_BUDGET = 2;
export const DEEP_RESEARCH_INITIAL_QUERY_LIMIT = 5;
export const DEEP_RESEARCH_FOLLOW_UP_QUERY_LIMIT = 2;
export const DEEP_RESEARCH_TOTAL_SEARCH_BUDGET =
  DEEP_RESEARCH_INITIAL_QUERY_LIMIT + DEEP_RESEARCH_FOLLOW_UP_QUERY_LIMIT;

export type DeepResearchExecutionResult = {
  citations: SearchCitation[];
  keyFindings: string[];
  reportContent: string;
  reportFileId: string;
  reportFileName: string;
  reportTitle: string;
  summary: string;
};

export async function generateDeepResearchPlan(params: {
  message: string;
  model: AnyPiModel;
  settings: Settings;
  systemPrompt: string;
  allowedDomains?: string[];
  sourceScope?: {
    attachments?: boolean;
    web?: boolean;
    workspace?: boolean;
  };
}): Promise<DeepResearchPlanProposalData> {
  const response = await completeWithPi({
    model: params.model,
    settings: params.settings,
    context: {
      systemPrompt: [
        params.systemPrompt,
        '',
        'You are preparing a deep research plan for 成形.',
        'Return JSON only.',
        'Produce 3 to 5 search subquestions, a concise summary, and a practical report outline.',
        'Keep the scope tight and decision-oriented.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: [
            `User request: ${params.message.trim()}`,
            params.allowedDomains?.length
              ? `Allowed domains: ${params.allowedDomains.join(', ')}`
              : null,
            '',
            'Return exactly one JSON object:',
            '{"title":"...","summary":"...","subquestions":["..."],"reportOutline":["..."],"allowedDomains":["..."]}',
          ]
            .filter(Boolean)
            .join('\n'),
          timestamp: Date.now(),
        },
      ],
    },
  });

  const fallbackTitle = params.message.trim().slice(0, 40) || '研究计划';
  try {
    const parsed = JSON.parse(stripJsonFences(extractTextContent(response))) as {
      allowedDomains?: unknown;
      reportOutline?: unknown;
      subquestions?: unknown;
      summary?: unknown;
      title?: unknown;
    };
    return {
      status: 'pending' as const,
      title:
        typeof parsed.title === 'string' && parsed.title.trim()
          ? parsed.title.trim()
          : fallbackTitle,
      query: params.message.trim(),
      summary:
        typeof parsed.summary === 'string' && parsed.summary.trim()
          ? parsed.summary.trim()
          : `围绕“${fallbackTitle}”整理公开网页与当前工作区中的关键信息。`,
      subquestions: parseStringList(parsed.subquestions, 5),
      reportOutline: parseStringList(parsed.reportOutline, 6),
      allowedDomains: parseStringList(parsed.allowedDomains, 8),
      sourceScope: {
        attachments: params.sourceScope?.attachments !== false,
        web: params.sourceScope?.web !== false,
        workspace: params.sourceScope?.workspace !== false,
      },
    } satisfies DeepResearchPlanProposalData;
  } catch {
    return {
      status: 'pending',
      title: fallbackTitle,
      query: params.message.trim(),
      summary: `围绕“${fallbackTitle}”整理公开网页与当前工作区中的关键信息。`,
      subquestions: [params.message.trim()],
      reportOutline: ['核心结论', '关键证据', '待验证事项'],
      allowedDomains: params.allowedDomains || [],
      sourceScope: {
        attachments: params.sourceScope?.attachments !== false,
        web: params.sourceScope?.web !== false,
        workspace: params.sourceScope?.workspace !== false,
      },
    };
  }
}

export async function executeDeepResearch(params: {
  actor: ActorContext;
  model: AnyPiModel;
  proposal: DeepResearchPlanProposalData;
  searchProvider: SearchProvider;
  settings: Settings;
  systemPrompt: string;
  workspaceId: string;
  onProgress?: (progress: ResearchProgressData) => Promise<void> | void;
}) {
  const initialQueries = params.proposal.subquestions.slice(
    0,
    DEEP_RESEARCH_INITIAL_QUERY_LIMIT
  );
  const initialResults: SearchResult[] = [];

  for (let index = 0; index < initialQueries.length; index += 1) {
    const query = applyAllowedDomains(initialQueries[index], params.proposal.allowedDomains);
    await params.onProgress?.({
      mode: 'deep',
      phase: 'searching',
      currentStepLabel: `正在搜索：${initialQueries[index]}`,
      providerState: 'ready',
      reportFileId: null,
      reportFileName: null,
      stepIndex: index + 1,
      totalSteps: initialQueries.length,
    });
    initialResults.push(
      await params.searchProvider.search({
        maxResults: 6,
        query,
      })
    );
  }

  await params.onProgress?.({
    mode: 'deep',
    phase: 'analyzing_gaps',
    currentStepLabel: '正在分析信息缺口',
    providerState: 'ready',
    reportFileId: null,
    reportFileName: null,
    stepIndex: null,
    totalSteps: null,
  });

  const gapAnalysis = await analyzeResearchGaps({
    model: params.model,
    proposal: params.proposal,
    results: initialResults,
    settings: params.settings,
    systemPrompt: params.systemPrompt,
  });

  const followUpQueries = gapAnalysis.followUpQueries.slice(
    0,
    DEEP_RESEARCH_FOLLOW_UP_QUERY_LIMIT
  );
  const followUpResults: SearchResult[] = [];
  for (let index = 0; index < followUpQueries.length; index += 1) {
    const query = applyAllowedDomains(followUpQueries[index], params.proposal.allowedDomains);
    await params.onProgress?.({
      mode: 'deep',
      phase: 'searching',
      currentStepLabel: `正在补充：${followUpQueries[index]}`,
      providerState: 'ready',
      reportFileId: null,
      reportFileName: null,
      stepIndex: index + 1,
      totalSteps: followUpQueries.length,
    });
    followUpResults.push(
      await params.searchProvider.search({
        maxResults: 6,
        query,
      })
    );
  }

  await params.onProgress?.({
    mode: 'deep',
    phase: 'reporting',
    currentStepLabel: '正在整理研究报告',
    providerState: 'ready',
    reportFileId: null,
    reportFileName: null,
    stepIndex: null,
    totalSteps: null,
  });

  const synthesis = await synthesizeResearchReport({
    gapSummary: gapAnalysis.gapSummary,
    model: params.model,
    proposal: params.proposal,
    results: [...initialResults, ...followUpResults],
    settings: params.settings,
    systemPrompt: params.systemPrompt,
  });
  const citations = dedupeCitations(
    [...initialResults, ...followUpResults].flatMap((result) => result.citations || [])
  );
  const reportFile = await writeResearchReportFile({
    actor: params.actor,
    content: ensureReferencesSection(synthesis.reportMarkdown, citations),
    title: synthesis.reportTitle || params.proposal.title,
    workspaceId: params.workspaceId,
  });

  const result: DeepResearchExecutionResult = {
    citations,
    keyFindings: synthesis.keyFindings.slice(0, 3),
    reportContent: ensureReferencesSection(synthesis.reportMarkdown, citations),
    reportFileId: reportFile.id,
    reportFileName: reportFile.name,
    reportTitle: reportFile.name,
    summary: synthesis.executiveSummary,
  };

  await params.onProgress?.({
    mode: 'deep',
    phase: 'completed',
    currentStepLabel: '研究完成',
    providerState: 'ready',
    reportFileId: reportFile.id,
    reportFileName: reportFile.name,
    stepIndex: null,
    totalSteps: null,
  });

  return result;
}

export function isExplicitOfflineRequest(message: string) {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return [
    '不要联网',
    '离线处理',
    '不用联网',
    '只基于当前内容',
    'work offline',
    'offline only',
    'do not browse',
    "don't browse",
    'no web search',
  ].some((pattern) => normalized.includes(pattern));
}

type ResearchSynthesis = {
  executiveSummary: string;
  keyFindings: string[];
  reportMarkdown: string;
  reportTitle: string;
};

async function analyzeResearchGaps(params: {
  model: AnyPiModel;
  proposal: DeepResearchPlanProposalData;
  results: SearchResult[];
  settings: Settings;
  systemPrompt: string;
}) {
  const response = await completeWithPi({
    model: params.model,
    settings: params.settings,
    context: {
      systemPrompt: [
        params.systemPrompt,
        '',
        'You are analyzing research coverage gaps.',
        'Return JSON only.',
        'Identify the remaining factual gaps and produce at most two follow-up search queries.',
        'If coverage is sufficient, return an empty followUpQueries array.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: [
            `Research title: ${params.proposal.title}`,
            `Research query: ${params.proposal.query}`,
            '',
            'Subquestions:',
            ...params.proposal.subquestions.map((question) => `- ${question}`),
            '',
            'Current findings:',
            formatResearchResults(params.results),
            '',
            'Return exactly one JSON object:',
            '{"gapSummary":"...","followUpQueries":["...","..."]}',
          ].join('\n'),
          timestamp: Date.now(),
        },
      ],
    },
  });

  try {
    const parsed = JSON.parse(stripJsonFences(extractTextContent(response))) as {
      followUpQueries?: unknown;
      gapSummary?: unknown;
    };
    return {
      followUpQueries: Array.isArray(parsed.followUpQueries)
        ? parsed.followUpQueries
            .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
            .filter(Boolean)
        : [],
      gapSummary:
        typeof parsed.gapSummary === 'string' ? parsed.gapSummary.trim() : '',
    };
  } catch {
    return {
      followUpQueries: [],
      gapSummary: '',
    };
  }
}

async function synthesizeResearchReport(params: {
  gapSummary: string;
  model: AnyPiModel;
  proposal: DeepResearchPlanProposalData;
  results: SearchResult[];
  settings: Settings;
  systemPrompt: string;
}): Promise<ResearchSynthesis> {
  const response = await completeWithPi({
    model: params.model,
    settings: params.settings,
    context: {
      systemPrompt: [
        params.systemPrompt,
        '',
        'You are writing a deep research report for 成形.',
        'Return JSON only.',
        'The report must be concise, structured, and citation-rich.',
        'Every key finding must include one or more source URLs in the text.',
        'Mark uncertain claims as "待验证".',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: [
            `Research title: ${params.proposal.title}`,
            `Research query: ${params.proposal.query}`,
            params.gapSummary ? `Gap summary: ${params.gapSummary}` : null,
            '',
            'Expected report outline:',
            ...params.proposal.reportOutline.map((entry) => `- ${entry}`),
            '',
            'Search findings:',
            formatResearchResults(params.results),
            '',
            'Return exactly one JSON object:',
            '{"reportTitle":"...","executiveSummary":"...","keyFindings":["..."],"reportMarkdown":"..."}',
          ]
            .filter(Boolean)
            .join('\n'),
          timestamp: Date.now(),
        },
      ],
    },
  });

  try {
    const parsed = JSON.parse(stripJsonFences(extractTextContent(response))) as {
      executiveSummary?: unknown;
      keyFindings?: unknown;
      reportMarkdown?: unknown;
      reportTitle?: unknown;
    };
    const reportMarkdown =
      typeof parsed.reportMarkdown === 'string' && parsed.reportMarkdown.trim()
        ? parsed.reportMarkdown.trim()
        : buildFallbackReport(params.proposal, params.results);
    return {
      reportTitle:
        typeof parsed.reportTitle === 'string' && parsed.reportTitle.trim()
          ? parsed.reportTitle.trim()
          : params.proposal.title,
      executiveSummary:
        typeof parsed.executiveSummary === 'string' && parsed.executiveSummary.trim()
          ? parsed.executiveSummary.trim()
          : params.proposal.summary,
      keyFindings: Array.isArray(parsed.keyFindings)
        ? parsed.keyFindings
            .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
            .filter(Boolean)
        : [],
      reportMarkdown,
    };
  } catch {
    return {
      reportTitle: params.proposal.title,
      executiveSummary: params.proposal.summary,
      keyFindings: [],
      reportMarkdown: buildFallbackReport(params.proposal, params.results),
    };
  }
}

async function writeResearchReportFile(params: {
  actor: ActorContext;
  content: string;
  title: string;
  workspaceId: string;
}) {
  const files = await listWorkspaceFiles({
    organizationId: params.actor.organizationId,
    workspaceId: params.workspaceId,
  });
  const researchFolder =
    files.find(
      (file) =>
        file.role === 'support' &&
        file.nodeType === 'folder' &&
        file.parentId === null &&
        file.name === '研究'
    ) ||
    (await createWorkspaceFile(params.actor, {
      name: '研究',
      nodeType: 'folder',
      role: 'support',
      workspaceId: params.workspaceId,
    }));

  const existingNames = new Set(
    files
      .filter((file) => file.parentId === researchFolder.id && file.role === 'support')
      .map((file) => file.name)
  );
  const nextName = makeUniqueResearchName(params.title.trim() || '研究报告', existingNames);
  const reportFile = await createWorkspaceFile(params.actor, {
    kind: 'richtext',
    name: nextName,
    parentId: researchFolder.id,
    role: 'support',
    workspaceId: params.workspaceId,
  });

  return updateWorkspaceFile(params.actor, {
    content: JSON.stringify(markdownToPlate(params.content)),
    fileId: reportFile.id,
    kind: 'richtext',
    name: nextName,
    role: 'support',
    workspaceId: params.workspaceId,
  });
}

function formatResearchResults(results: SearchResult[]) {
  if (results.length === 0) {
    return '- No search results.';
  }

  return results
    .map((result, index) => {
      const citations = dedupeCitations(result.citations || []);
      return [
        `### Finding ${index + 1}`,
        `Query: ${result.query}`,
        `Answer: ${result.answer || 'No summary answer returned.'}`,
        '',
        'Citations:',
        ...(citations.length > 0
          ? citations.map(
              (citation) =>
                `- ${citation.title || citation.url}${citation.snippet ? ` — ${citation.snippet}` : ''} (${citation.url})`
            )
          : ['- No citations returned.']),
      ].join('\n');
    })
    .join('\n\n');
}

function applyAllowedDomains(query: string, allowedDomains: string[]) {
  if (allowedDomains.length === 0) {
    return query;
  }

  return `${query} ${allowedDomains.map((domain) => `site:${domain}`).join(' OR ')}`;
}

function dedupeCitations(citations: SearchCitation[]) {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = citation.url.trim();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function ensureReferencesSection(content: string, citations: SearchCitation[]) {
  const trimmed = content.trim();
  const references = citations.map((citation) => `- ${citation.title || citation.url}: ${citation.url}`);
  const suffix =
    references.length > 0
      ? `\n\n## 参考来源\n${references.join('\n')}`
      : '\n\n## 参考来源\n- 待验证';

  if (trimmed.includes('## 参考来源')) {
    return trimmed;
  }

  return `${trimmed}${suffix}`;
}

function buildFallbackReport(
  proposal: DeepResearchPlanProposalData,
  results: SearchResult[]
) {
  const sections = [
    `# ${proposal.title}`,
    '',
    proposal.summary,
    '',
  ];

  results.forEach((result, index) => {
    sections.push(`## 子问题 ${index + 1}`);
    sections.push(`- 查询：${result.query}`);
    sections.push(`- 摘要：${result.answer || '待验证'}`);
    const citations = dedupeCitations(result.citations || []);
    citations.slice(0, 3).forEach((citation) => {
      sections.push(`- 来源：${citation.url}`);
    });
    sections.push('');
  });

  return sections.join('\n');
}

function makeUniqueResearchName(baseName: string, existingNames: Set<string>) {
  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let index = 2;
  while (existingNames.has(`${baseName}（${index}）`)) {
    index += 1;
  }
  return `${baseName}（${index}）`;
}

function stripJsonFences(raw: string) {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function parseStringList(value: unknown, limit: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)
    .slice(0, limit);
}
