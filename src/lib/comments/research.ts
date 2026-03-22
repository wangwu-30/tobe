import { safeJsonParse } from '@/framework/resilience';
import type {
  CommentResearchStateData,
  DeepResearchPlanProposalData,
  ResearchProgressData,
} from '@/types';

export function parseCommentResearchState(
  value: string | null | undefined
): CommentResearchStateData | null {
  if (!value) {
    return null;
  }

  const parsed = safeJsonParse<{
    progress?: Partial<ResearchProgressData> | null;
    proposal?: Partial<DeepResearchPlanProposalData> | null;
    reportFileId?: string | null;
    reportFileName?: string | null;
    summary?: string | null;
    targetAgentId?: string | null;
    targetAgentLabel?: string | null;
  } | null>(value, null);
  if (!parsed) {
    return null;
  }

  return {
    progress: parseResearchProgress(parsed.progress),
    proposal: parseResearchPlanProposal(parsed.proposal),
    reportFileId:
      typeof parsed.reportFileId === 'string' ? parsed.reportFileId : null,
    reportFileName:
      typeof parsed.reportFileName === 'string' ? parsed.reportFileName : null,
    summary: typeof parsed.summary === 'string' ? parsed.summary : null,
    targetAgentId:
      typeof parsed.targetAgentId === 'string' ? parsed.targetAgentId : null,
    targetAgentLabel:
      typeof parsed.targetAgentLabel === 'string' ? parsed.targetAgentLabel : null,
  };
}

export function stringifyCommentResearchState(value: CommentResearchStateData | null) {
  return value ? JSON.stringify(value) : null;
}

function parseResearchPlanProposal(
  value: Partial<DeepResearchPlanProposalData> | null | undefined
): DeepResearchPlanProposalData | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (
    typeof value.title !== 'string' ||
    typeof value.query !== 'string' ||
    typeof value.summary !== 'string'
  ) {
    return null;
  }

  return {
    status:
      value.status === 'approved' || value.status === 'dismissed'
        ? value.status
        : 'pending',
    title: value.title,
    query: value.query,
    summary: value.summary,
    subquestions: parseStringArray(value.subquestions),
    reportOutline: parseStringArray(value.reportOutline),
    allowedDomains: parseStringArray(value.allowedDomains),
    sourceScope: {
      attachments: value.sourceScope?.attachments !== false,
      web: value.sourceScope?.web !== false,
      workspace: value.sourceScope?.workspace !== false,
    },
  };
}

function parseResearchProgress(
  value: Partial<ResearchProgressData> | null | undefined
): ResearchProgressData | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const phase =
    value.phase === 'proposal' ||
    value.phase === 'searching' ||
    value.phase === 'analyzing_gaps' ||
    value.phase === 'reporting' ||
    value.phase === 'blocked' ||
    value.phase === 'completed'
      ? value.phase
      : null;
  const mode = value.mode === 'deep' || value.mode === 'light' ? value.mode : null;

  if (!phase || !mode) {
    return null;
  }

  return {
    mode,
    phase,
    currentStepLabel:
      typeof value.currentStepLabel === 'string' ? value.currentStepLabel : null,
    providerState:
      value.providerState === 'unavailable' ? 'unavailable' : 'ready',
    reportFileId: typeof value.reportFileId === 'string' ? value.reportFileId : null,
    reportFileName:
      typeof value.reportFileName === 'string' ? value.reportFileName : null,
    stepIndex:
      typeof value.stepIndex === 'number' && Number.isFinite(value.stepIndex)
        ? value.stepIndex
        : null,
    totalSteps:
      typeof value.totalSteps === 'number' && Number.isFinite(value.totalSteps)
        ? value.totalSteps
        : null,
  };
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}
