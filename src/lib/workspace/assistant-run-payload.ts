import type {
  AssistantPlanProposalData,
  DeliverableType,
  WorkspacePlanStageData,
} from '@/types';

type AssistantRunPayload = {
  planProposal?: AssistantPlanProposalData | null;
};

export function parseAssistantRunPayload(raw: string | null | undefined) {
  if (!raw) {
    return { planProposal: null } satisfies AssistantRunPayload;
  }

  try {
    const parsed = JSON.parse(raw) as {
      planProposal?: Partial<AssistantPlanProposalData> | null;
    };
    const planProposal = parsePlanProposal(parsed.planProposal);
    return {
      planProposal,
    } satisfies AssistantRunPayload;
  } catch {
    return { planProposal: null } satisfies AssistantRunPayload;
  }
}

export function stringifyAssistantRunPayload(payload: AssistantRunPayload) {
  return JSON.stringify({
    planProposal: payload.planProposal || null,
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
  return value === 'web' || value === 'code' || value === 'slides' || value === 'document'
    ? value
    : null;
}

function fallbackTitle(kind: string) {
  return kind
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
