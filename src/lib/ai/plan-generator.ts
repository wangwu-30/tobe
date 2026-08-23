import type { Api, Model as PiModel } from '@earendil-works/pi-ai';
import { buildPlanLanguageInstruction } from '@/lib/ai/language';
import { completeWithPi, extractTextContent } from '@/lib/ai/pi-runtime';
import { safeJsonParse } from '@/framework/resilience';
import type { Settings } from '@/lib/ai/providers';
import { getCanonicalDeliverableType } from '@/lib/workspace/deliverable-types';
import { getWorkspacePlanBlueprint } from '@/lib/workspace/plan-blueprints';
import type { DeliverableType, PlanStepData, RenderAs } from '@/types';

type AnyPiModel = PiModel<Api>;

export async function generatePlanStepsWithAI(params: {
  constraints?: string | null;
  deliverableType: DeliverableType;
  goal: string;
  model: AnyPiModel;
  resultShape: RenderAs;
  settings: Settings;
  styleGuide?: string | null;
}) {
  const blueprint = getWorkspacePlanBlueprint(params.deliverableType).map((stage) => ({
    checkpoint: stage.checkpoint,
    descriptionHint: stage.defaultDescription,
    id: stage.kind,
  }));
  const response = await completeWithPi({
    model: params.model,
    settings: params.settings,
    context: {
      systemPrompt: [
        'You are designing an AI-native authoring plan for 成形.',
        'Return JSON only. No markdown fences, no prose.',
        'Keep the original stage ids exactly as given.',
        'For each stage, rewrite the title and description so they fit the specific goal.',
        'Titles must be short and concrete. Descriptions must be one sentence.',
        'Keep checkpoint booleans aligned with the stage blueprint.',
        'Treat "Current result shape" as the live presentation format and "Plan blueprint type" as the canonical stage taxonomy.',
        buildPlanLanguageInstruction(params.settings.language),
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: [
            `Goal: ${params.goal.trim() || 'Create a new deliverable'}`,
            `Current result shape: ${params.resultShape}`,
            `Plan blueprint type: ${getCanonicalDeliverableType(params.deliverableType)}`,
            params.styleGuide?.trim() ? `Style / tone: ${params.styleGuide.trim()}` : null,
            params.constraints?.trim() ? `Constraints: ${params.constraints.trim()}` : null,
            '',
            'Stage blueprint:',
            ...blueprint.map(
              (step) =>
                `- ${step.id} | checkpoint=${step.checkpoint ? 'true' : 'false'} | ${step.descriptionHint}`
            ),
            '',
            'Return this exact JSON shape:',
            '{"steps":[{"id":"clarify","title":"...","description":"...","checkpoint":true}]}',
          ]
            .filter(Boolean)
            .join('\n'),
          timestamp: Date.now(),
        },
      ],
    },
  });

  const raw = extractTextContent(response);
  return parsePlanStepsResponse(raw, blueprint);
}

function parsePlanStepsResponse(
  raw: string,
  blueprint: Array<{ checkpoint: boolean; id: string }>
) {
  const parsed = safeJsonParse<{
    steps?: Array<Record<string, unknown>>;
  } | null>(stripJsonFences(raw), null);

  const steps = parsed?.steps;
  if (!Array.isArray(steps)) {
    throw new Error('Plan generator did not return a steps array.');
  }

  const normalized = blueprint.map((stage, index) => {
    const matching =
      steps.find((step) => step?.id === stage.id) ||
      steps[index] ||
      null;

    return {
      id: stage.id,
      kind: stage.id,
      title:
        typeof matching?.title === 'string' && matching.title.trim()
          ? matching.title.trim()
          : fallbackTitle(stage.id),
      description:
        typeof matching?.description === 'string' && matching.description.trim()
          ? matching.description.trim()
          : '',
      checkpoint: stage.checkpoint,
      status: index === 0 ? 'in_progress' : 'pending',
    } satisfies PlanStepData;
  });

  return normalized;
}

function stripJsonFences(raw: string) {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function fallbackTitle(id: string) {
  return id
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
