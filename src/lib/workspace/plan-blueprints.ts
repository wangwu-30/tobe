import type { DeliverableType, WorkspacePlanStageData } from '@/types';

type StageBlueprint = {
  checkpoint: boolean;
  defaultDescription: string;
  defaultTitle: string;
  kind: string;
};

const PLAN_STAGE_BLUEPRINTS: Record<DeliverableType, StageBlueprint[]> = {
  code: [
    {
      kind: 'clarify',
      defaultTitle: 'Clarify',
      defaultDescription: 'Clarify the technical target, scope, and constraints.',
      checkpoint: true,
    },
    {
      kind: 'structure',
      defaultTitle: 'Structure',
      defaultDescription: 'Shape the implementation approach before touching code.',
      checkpoint: true,
    },
    {
      kind: 'implement',
      defaultTitle: 'Implement',
      defaultDescription: 'Produce the working code or staged implementation changes.',
      checkpoint: false,
    },
    {
      kind: 'verify',
      defaultTitle: 'Verify',
      defaultDescription: 'Verify behavior, fix risks, and tighten the result.',
      checkpoint: true,
    },
    {
      kind: 'finalize',
      defaultTitle: 'Finalize',
      defaultDescription: 'Save a stable version worth comparing or handing off.',
      checkpoint: true,
    },
  ],
  document: [
    {
      kind: 'clarify',
      defaultTitle: 'Clarify',
      defaultDescription: 'Clarify audience, outcome, and scope.',
      checkpoint: true,
    },
    {
      kind: 'structure',
      defaultTitle: 'Structure',
      defaultDescription: 'Shape the outline, sections, and content flow.',
      checkpoint: true,
    },
    {
      kind: 'draft',
      defaultTitle: 'Draft',
      defaultDescription: 'Render the first full draft into the live deliverable.',
      checkpoint: false,
    },
    {
      kind: 'review',
      defaultTitle: 'Review',
      defaultDescription: 'Address targeted feedback and refine clarity.',
      checkpoint: true,
    },
    {
      kind: 'finalize',
      defaultTitle: 'Finalize',
      defaultDescription: 'Save a milestone once this version is stable.',
      checkpoint: true,
    },
  ],
  slides: [
    {
      kind: 'clarify',
      defaultTitle: 'Clarify',
      defaultDescription: 'Clarify audience, presentation goal, and narrative arc.',
      checkpoint: true,
    },
    {
      kind: 'structure',
      defaultTitle: 'Structure',
      defaultDescription: 'Shape the slide sequence, pacing, and section order.',
      checkpoint: true,
    },
    {
      kind: 'draft',
      defaultTitle: 'Draft',
      defaultDescription: 'Render the live slide draft and keep recovery points available.',
      checkpoint: false,
    },
    {
      kind: 'review',
      defaultTitle: 'Review',
      defaultDescription: 'Refine slide-level clarity, pacing, and emphasis.',
      checkpoint: true,
    },
    {
      kind: 'finalize',
      defaultTitle: 'Finalize',
      defaultDescription: 'Save a milestone when the deck reaches a stable checkpoint.',
      checkpoint: true,
    },
  ],
  web: [
    {
      kind: 'clarify',
      defaultTitle: 'Clarify',
      defaultDescription: 'Clarify the page goal, audience, and success criteria.',
      checkpoint: true,
    },
    {
      kind: 'structure',
      defaultTitle: 'Structure',
      defaultDescription: 'Shape the sections, hierarchy, and layout direction.',
      checkpoint: true,
    },
    {
      kind: 'render',
      defaultTitle: 'Render',
      defaultDescription: 'Build the live page draft and its React structure.',
      checkpoint: false,
    },
    {
      kind: 'preview',
      defaultTitle: 'Preview',
      defaultDescription: 'Make the page previewable and validate the rendered result.',
      checkpoint: true,
    },
    {
      kind: 'review',
      defaultTitle: 'Review',
      defaultDescription: 'Refine content, layout, and implementation from feedback.',
      checkpoint: true,
    },
    {
      kind: 'finalize',
      defaultTitle: 'Finalize',
      defaultDescription: 'Save a milestone when the current page is ready to compare.',
      checkpoint: true,
    },
  ],
};

export function getWorkspacePlanBlueprint(deliverableType: DeliverableType) {
  return PLAN_STAGE_BLUEPRINTS[deliverableType];
}

export function buildDefaultPlanStages(
  deliverableType: DeliverableType
): WorkspacePlanStageData[] {
  return PLAN_STAGE_BLUEPRINTS[deliverableType].map((stage, index) => ({
    id: stage.kind,
    kind: stage.kind,
    title: stage.defaultTitle,
    description: stage.defaultDescription,
    status: index === 0 ? 'in_progress' : 'pending',
    checkpoint: stage.checkpoint,
  }));
}

export function normalizePlanStageKind(
  deliverableType: DeliverableType,
  kind: string
) {
  const blueprint = PLAN_STAGE_BLUEPRINTS[deliverableType];
  return blueprint.some((stage) => stage.kind === kind)
    ? kind
    : blueprint[0]?.kind || 'clarify';
}
