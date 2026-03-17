import { NextRequest, NextResponse } from 'next/server';
import { describeAIError } from '@/lib/ai/error-utils';
import { generatePlanStepsWithAI } from '@/lib/ai/plan-generator';
import { getSelectedModelFromHeaders } from '@/lib/ai/providers';
import { translate } from '@/lib/i18n/copy';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getWorkspacePlan, updateWorkspacePlan } from '@/lib/workspace/planning';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const plan = await getWorkspacePlan({
    organizationId: actor.organizationId,
    workspaceId,
  });

  if (!plan) {
    return NextResponse.json({ error: 'Workspace plan not found.' }, { status: 404 });
  }

  const { model, modelKey, settings } = getSelectedModelFromHeaders(req.headers);
  const language = settings.language || 'zh-CN';

  await updateWorkspacePlan(actor, {
    lastProgressNote: translate(language, 'plan.generatingDescription'),
    stages: [],
    status: 'generating',
    workspaceId,
  });

  try {
    const stages = await generatePlanStepsWithAI({
      constraints: plan.constraints,
      deliverableType: plan.deliverableType,
      goal: plan.goal,
      model,
      settings,
      styleGuide: plan.styleGuide,
    });

    const nextPlan = await updateWorkspacePlan(actor, {
      activeStageId: stages[0]?.id || null,
      lastProgressNote: null,
      stages,
      status: 'drafting',
      workspaceId,
    });

    return NextResponse.json(nextPlan);
  } catch (error) {
    const nextError = describeAIError({
      language,
      modelKey,
      rawMessage: error instanceof Error ? error.message : 'Plan generation failed.',
    });
    const blockedPlan = await updateWorkspacePlan(actor, {
      lastProgressNote: nextError.message,
      stages: [],
      status: 'blocked',
      workspaceId,
    });

    return NextResponse.json(
      {
        error: nextError.message,
        plan: blockedPlan,
      },
      { status: nextError.statusCode || 500 }
    );
  }
}
