import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { updateAssistantRun } from '@/objects/conversation/commands';
import { parseAssistantRunPayload, stringifyAssistantRunPayload } from '@/lib/workspace/assistant-run-payload';
import { updateWorkspacePlan } from '@/lib/workspace/planning';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { runId, workspaceId } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body.action === 'dismiss' ? 'dismiss' : body.action === 'apply' ? 'apply' : null;

  if (!action) {
    return NextResponse.json({ error: 'Unsupported proposal action.' }, { status: 400 });
  }

  const run = await prisma.assistantRun.findFirst({
    where: {
      deletedAt: null,
      documentId: workspaceId,
      id: runId,
      organizationId: actor.organizationId,
    },
  });

  if (!run) {
    return NextResponse.json({ error: 'Assistant run not found.' }, { status: 404 });
  }

  const payload = parseAssistantRunPayload(run.payloadJson);
  const proposal = payload.planProposal;
  if (!proposal) {
    return NextResponse.json({ error: 'No plan proposal is attached to this run.' }, { status: 400 });
  }

  if (proposal.status !== 'pending') {
    return NextResponse.json({ proposal }, { status: 200 });
  }

  const nextProposal = {
    ...proposal,
    status: action === 'apply' ? 'applied' : 'dismissed',
  } as const;

  if (action === 'apply') {
    await updateWorkspacePlan(actor, {
      activeStageId: proposal.stages[0]?.id || null,
      constraints: proposal.constraints,
      deliverableType: proposal.deliverableType,
      goal: proposal.goal,
      incrementVersion: true,
      lastProgressNote: proposal.summary,
      stages: proposal.stages.map((stage, index) => ({
        ...stage,
        status: index === 0 ? 'in_progress' : 'pending',
      })),
      status: 'drafting',
      styleGuide: proposal.styleGuide,
      workspaceId,
    });
  }

  const updatedRun = await updateAssistantRun(actor, {
    payloadJson: stringifyAssistantRunPayload({
      planProposal: nextProposal,
    }),
    runId: run.id,
    summary:
      action === 'apply'
        ? `Applied the proposed plan. ${proposal.summary}`
        : `Kept the current plan. ${proposal.summary}`,
  });

  return NextResponse.json({
    proposal: nextProposal,
    run: updatedRun,
    shouldContinue: action === 'apply',
  });
}
