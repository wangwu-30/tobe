import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  parseAssistantRunPayload,
  stringifyAssistantRunPayload,
} from '@/lib/workspace/assistant-run-payload';
import { updateAssistantRun } from '@/lib/workspace/service';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { runId, workspaceId } = await params;
  const body = await req.json().catch(() => ({}));
  const action =
    body.action === 'dismiss' ? 'dismiss' : body.action === 'approve' ? 'approve' : null;

  if (!action) {
    return NextResponse.json({ error: 'Unsupported research action.' }, { status: 400 });
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
  const proposal = payload.researchPlanProposal;
  if (!proposal) {
    return NextResponse.json({ error: 'No research proposal is attached to this run.' }, { status: 400 });
  }

  const nextProposal = {
    ...proposal,
    status: action === 'approve' ? 'approved' : 'dismissed',
  } as const;

  const updatedRun = await updateAssistantRun(actor, {
    payloadJson: stringifyAssistantRunPayload({
      ...payload,
      researchPlanProposal: nextProposal,
      researchProgress:
        action === 'dismiss'
          ? null
          : {
              mode: 'deep',
              phase: 'proposal',
              currentStepLabel: '研究计划已确认，等待开始',
              providerState: 'ready',
              reportFileId: null,
              reportFileName: null,
              stepIndex: null,
              totalSteps: null,
            },
    }),
    runId: run.id,
    summary:
      action === 'approve'
        ? `已确认研究计划。${proposal.summary}`
        : `已取消研究计划。${proposal.summary}`,
  });

  return NextResponse.json({
    proposal: nextProposal,
    run: updatedRun,
    shouldStart: action === 'approve',
  });
}
