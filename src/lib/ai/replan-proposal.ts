import type { Api, Model as PiModel } from '@mariozechner/pi-ai';
import { completeWithPi, extractTextContent } from '@/lib/ai/pi-runtime';
import { generatePlanStepsWithAI } from '@/lib/ai/plan-generator';
import type { Settings } from '@/lib/ai/providers';
import { normalizeStoredDeliverableType } from '@/lib/workspace/deliverable-types';
import type {
  AssistantPlanProposalData,
  DeliverableType,
  WorkspacePlanData,
} from '@/types';

type AnyPiModel = PiModel<Api>;

type ReplanDecision = {
  constraints?: string | null;
  decision: 'continue' | 'replan';
  deliverableType?: DeliverableType;
  goal?: string;
  styleGuide?: string | null;
  summary?: string;
};

export async function maybeBuildReplanProposal(params: {
  currentPlan: WorkspacePlanData | null;
  message: string;
  model: AnyPiModel;
  settings: Settings;
}) {
  const trimmedMessage = params.message.trim();
  const currentPlan = params.currentPlan;
  if (!trimmedMessage || !currentPlan) {
    return null;
  }

  const decision = await classifyReplanNeed({
    currentPlan,
    message: params.message,
    model: params.model,
    settings: params.settings,
  });
  if (!decision || decision.decision !== 'replan' || !decision.goal?.trim()) {
    return null;
  }

  const deliverableType = decision.deliverableType || currentPlan.deliverableType;
  const constraints =
    decision.constraints === undefined
      ? currentPlan.constraints
      : normalizeNullableString(decision.constraints);
  const styleGuide =
    decision.styleGuide === undefined
      ? currentPlan.styleGuide
      : normalizeNullableString(decision.styleGuide);
  const stages = (await generatePlanStepsWithAI({
    constraints,
    deliverableType,
    goal: decision.goal.trim(),
    model: params.model,
    settings: params.settings,
    styleGuide,
  })).map((stage) => ({
    ...stage,
    status: 'pending' as const,
  }));

  return {
    status: 'pending',
    goal: decision.goal.trim(),
    deliverableType,
    constraints,
    styleGuide,
    summary:
      normalizeNullableString(decision.summary) ||
      `Refocus the workspace plan around "${decision.goal.trim()}".`,
    originalRequest: trimmedMessage,
    stages,
  } satisfies AssistantPlanProposalData;
}

async function classifyReplanNeed(params: {
  currentPlan: WorkspacePlanData;
  message: string;
  model: AnyPiModel;
  settings: Settings;
}) {
  const response = await completeWithPi({
    model: params.model,
    settings: params.settings,
    context: {
      systemPrompt: [
        'You decide whether a user request should keep the current workspace plan or propose a new high-level plan.',
        'Return JSON only. No markdown fences, no prose.',
        'Choose "replan" only when the request materially changes the goal, scope, result shape, audience, or top-level structure.',
        'Local revisions, polishing, feature tweaks, layout changes, and scoped additions stay as "continue".',
        'When returning "replan", provide a concise new goal and one-sentence summary.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: [
            `Current result shape: ${params.currentPlan.deliverableType}`,
            `Current goal: ${params.currentPlan.goal}`,
            params.currentPlan.constraints
              ? `Current constraints: ${params.currentPlan.constraints}`
              : null,
            params.currentPlan.styleGuide
              ? `Current style guide: ${params.currentPlan.styleGuide}`
              : null,
            '',
            'Current stages:',
            ...params.currentPlan.stages.map(
              (stage) => `- ${stage.kind}: ${stage.title} | ${stage.description}`
            ),
            '',
            `User request: ${params.message.trim()}`,
            '',
            'Return exactly one JSON object:',
            '{"decision":"continue"}',
            'or',
            '{"decision":"replan","goal":"...","deliverableType":"document","constraints":null,"styleGuide":null,"summary":"..."}',
          ]
            .filter(Boolean)
            .join('\n'),
          timestamp: Date.now(),
        },
      ],
    },
  });

  return parseDecisionResponse(extractTextContent(response));
}

function parseDecisionResponse(raw: string): ReplanDecision | null {
  try {
    const parsed = JSON.parse(stripJsonFences(raw)) as Record<string, unknown>;
    if (parsed.decision !== 'continue' && parsed.decision !== 'replan') {
      return null;
    }

    return {
      decision: parsed.decision,
      goal: typeof parsed.goal === 'string' ? parsed.goal : undefined,
      deliverableType: normalizeDeliverableType(parsed.deliverableType),
      constraints:
        parsed.constraints === null || typeof parsed.constraints === 'string'
          ? parsed.constraints
          : undefined,
      styleGuide:
        parsed.styleGuide === null || typeof parsed.styleGuide === 'string'
          ? parsed.styleGuide
          : undefined,
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
    };
  } catch {
    return null;
  }
}

function normalizeDeliverableType(value: unknown): DeliverableType | undefined {
  return normalizeStoredDeliverableType(value) || undefined;
}

function normalizeNullableString(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return value === null ? null : null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function stripJsonFences(raw: string) {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}
