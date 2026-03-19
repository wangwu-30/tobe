import { normalizeStoredDeliverableType } from '@/lib/workspace/deliverable-types';
import type {
  AssistantPlanProposalData,
  DeepResearchPlanProposalData,
  DeliverableType,
  ResearchProgressData,
  WorkspacePlanStageData,
} from '@/types';

type AssistantRunPayload = {
  planProposal?: AssistantPlanProposalData | null;
  researchPlanProposal?: DeepResearchPlanProposalData | null;
  researchProgress?: ResearchProgressData | null;
};

export function parseAssistantRunPayload(raw: string | null | undefined) {
  if (!raw) {
    return {
      planProposal: null,
      researchPlanProposal: null,
      researchProgress: null,
    } satisfies AssistantRunPayload;
  }

  try {
    const parsed = JSON.parse(raw) as {
      planProposal?: Partial<AssistantPlanProposalData> | null;
      researchPlanProposal?: Partial<DeepResearchPlanProposalData> | null;
      researchProgress?: Partial<ResearchProgressData> | null;
    };
    const planProposal = parsePlanProposal(parsed.planProposal);
    const researchPlanProposal = parseResearchPlanProposal(parsed.researchPlanProposal);
    const researchProgress = parseResearchProgress(parsed.researchProgress);
    return {
      planProposal,
      researchPlanProposal,
      researchProgress,
    } satisfies AssistantRunPayload;
  } catch {
    return {
      planProposal: null,
      researchPlanProposal: null,
      researchProgress: null,
    } satisfies AssistantRunPayload;
  }
}

export function stringifyAssistantRunPayload(payload: AssistantRunPayload) {
  return JSON.stringify({
    planProposal: payload.planProposal || null,
    researchPlanProposal: payload.researchPlanProposal || null,
    researchProgress: payload.researchProgress || null,
  });
}

function parsePlanProposal(
  value: Partial<AssistantPlanProposalData> | null | undefined
): AssistantPlanProposalData | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (
    typeof value.goal !== 'string' ||
    typeof value.summary !== 'string' ||
    typeof value.originalRequest !== 'string'
  ) {
    return null;
  }

  const deliverableType = normalizeDeliverableType(value.deliverableType);
  if (!deliverableType) {
    return null;
  }

  return {
    status:
      value.status === 'applied' || value.status === 'dismissed'
        ? value.status
        : 'pending',
    goal: value.goal,
    deliverableType,
    constraints: typeof value.constraints === 'string' ? value.constraints : null,
    styleGuide: typeof value.styleGuide === 'string' ? value.styleGuide : null,
    summary: value.summary,
    originalRequest: value.originalRequest,
    stages: parsePlanStages(value.stages, deliverableType),
  };
}

function parsePlanStages(
  value: unknown,
  deliverableType: DeliverableType
): WorkspacePlanStageData[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((stage) => {
      if (!stage || typeof stage !== 'object') {
        return null;
      }

      const record = stage as Record<string, unknown>;
      const kind =
        typeof record.kind === 'string' && record.kind.trim()
          ? record.kind.trim()
          : typeof record.id === 'string' && record.id.trim()
            ? record.id.trim()
            : 'clarify';

      return {
        id:
          typeof record.id === 'string' && record.id.trim() ? record.id.trim() : kind,
        kind,
        title:
          typeof record.title === 'string' && record.title.trim()
            ? record.title.trim()
            : fallbackTitle(kind),
        description:
          typeof record.description === 'string' ? record.description.trim() : '',
        status:
          record.status === 'completed' ||
          record.status === 'blocked' ||
          record.status === 'in_progress'
            ? record.status
            : 'pending',
        checkpoint: Boolean(record.checkpoint),
      } satisfies WorkspacePlanStageData;
    })
    .filter((stage): stage is WorkspacePlanStageData => Boolean(stage));
}

function normalizeDeliverableType(value: unknown): DeliverableType | null {
  return normalizeStoredDeliverableType(value);
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
  const mode = value.mode === 'deep' ? 'deep' : value.mode === 'light' ? 'light' : null;
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

function fallbackTitle(kind: string) {
  return kind
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
