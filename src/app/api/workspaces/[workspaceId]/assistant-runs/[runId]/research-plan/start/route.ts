import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { buildChatSystemPrompt } from '@/lib/ai/context-builder';
import { getSelectedModelFromHeaders } from '@/lib/ai/providers';
import { executeDeepResearch } from '@/lib/ai/research-runner';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getSearchProviderFromHeaders } from '@/lib/search/providers';
import { SearchProviderError } from '@/lib/search/types';
import {
  parseAssistantRunPayload,
  stringifyAssistantRunPayload,
} from '@/lib/workspace/assistant-run-payload';
import {
  createAssistantRun,
  createConversationMessage,
  updateAssistantRun,
} from '@/lib/workspace/service';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { runId, workspaceId } = await params;

  const proposalRun = await prisma.assistantRun.findFirst({
    where: {
      deletedAt: null,
      documentId: workspaceId,
      id: runId,
      organizationId: actor.organizationId,
    },
    include: {
      requestMessage: true,
      session: true,
    },
  });

  if (!proposalRun || !proposalRun.session) {
    return NextResponse.json({ error: 'Research proposal run not found.' }, { status: 404 });
  }

  const proposalPayload = parseAssistantRunPayload(proposalRun.payloadJson);
  if (
    !proposalPayload.researchPlanProposal ||
    proposalPayload.researchPlanProposal.status !== 'approved'
  ) {
    return NextResponse.json(
      { error: 'The research plan must be approved before starting.' },
      { status: 400 }
    );
  }

  const { model, modelKey, settings } = getSelectedModelFromHeaders(req.headers);

  let searchProvider;
  try {
    searchProvider = await getSearchProviderFromHeaders(req.headers);
  } catch (error) {
    if (error instanceof SearchProviderError) {
      await updateAssistantRun(actor, {
        payloadJson: stringifyAssistantRunPayload({
          ...proposalPayload,
          researchProgress: {
            mode: 'deep',
            phase: 'blocked',
            currentStepLabel: '联网研究当前不可用',
            providerState: 'unavailable',
            reportFileId: null,
            reportFileName: null,
            stepIndex: null,
            totalSteps: null,
          },
        }),
        runId: proposalRun.id,
      });
      return NextResponse.json(
        {
          error: error.message,
          details: error.details ?? null,
        },
        { status: error.status }
      );
    }
    throw error;
  }

  const executionRun = await createAssistantRun(actor, {
    conversationId: proposalRun.sessionId,
    mode: 'run',
    requestMessageId: proposalRun.requestMessageId,
    title: proposalPayload.researchPlanProposal.title,
    workspaceId,
  });

  await updateAssistantRun(actor, {
    payloadJson: stringifyAssistantRunPayload({
      researchPlanProposal: proposalPayload.researchPlanProposal,
      researchProgress: {
        mode: 'deep',
        phase: 'proposal',
        currentStepLabel: '研究计划已确认，准备开始',
        providerState: 'ready',
        reportFileId: null,
        reportFileName: null,
        stepIndex: null,
        totalSteps: null,
      },
    }),
    runId: executionRun.id,
    status: 'planning',
    summary: proposalPayload.researchPlanProposal.summary,
  });

  try {
    const systemPrompt = await buildChatSystemPrompt({
      conversationId: proposalRun.sessionId,
      language: settings.language,
      organizationId: actor.organizationId,
      researchMode: 'deep',
      workspaceId,
    });

    const result = await executeDeepResearch({
      actor,
      model,
      proposal: proposalPayload.researchPlanProposal,
      searchProvider,
      settings,
      systemPrompt,
      workspaceId,
      onProgress: async (progress) => {
        await updateAssistantRun(actor, {
          payloadJson: stringifyAssistantRunPayload({
            researchPlanProposal: proposalPayload.researchPlanProposal,
            researchProgress: progress,
          }),
          runId: executionRun.id,
          status:
            progress.phase === 'proposal'
              ? 'planning'
              : progress.phase === 'blocked'
                ? 'failed'
                : progress.phase === 'completed'
                  ? 'completed'
                  : 'running',
          summary:
            progress.currentStepLabel ||
            proposalPayload.researchPlanProposal?.summary ||
            null,
        });
      },
    });

    const persistedSummary = buildResearchSummary(result);
    await createConversationMessage(actor, {
      content: persistedSummary,
      conversationId: proposalRun.sessionId,
      model: `agent:${modelKey}`,
      role: 'assistant',
      workspaceId,
    });

    await updateAssistantRun(actor, {
      finishedAt: new Date(),
      payloadJson: stringifyAssistantRunPayload({
        researchPlanProposal: proposalPayload.researchPlanProposal,
        researchProgress: {
          mode: 'deep',
          phase: 'completed',
          currentStepLabel: '研究完成',
          providerState: 'ready',
          reportFileId: result.reportFileId,
          reportFileName: result.reportFileName,
          stepIndex: null,
          totalSteps: null,
        },
      }),
      runId: executionRun.id,
      status: 'completed',
      summary: persistedSummary,
    });

    return NextResponse.json({
      conversationId: proposalRun.sessionId,
      reportFileId: result.reportFileId,
      runId: executionRun.id,
      workspaceId,
    });
  } catch (error) {
    await updateAssistantRun(actor, {
      finishedAt: new Date(),
      payloadJson: stringifyAssistantRunPayload({
        researchPlanProposal: proposalPayload.researchPlanProposal,
        researchProgress: {
          mode: 'deep',
          phase: 'blocked',
          currentStepLabel:
            error instanceof Error ? error.message : '研究执行失败',
          providerState: 'ready',
          reportFileId: null,
          reportFileName: null,
          stepIndex: null,
          totalSteps: null,
        },
      }),
      runId: executionRun.id,
      status: 'failed',
      summary: error instanceof Error ? error.message : 'Research run failed.',
    });

    if (error instanceof SearchProviderError) {
      return NextResponse.json(
        {
          error: error.message,
          details: error.details ?? null,
        },
        { status: error.status }
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Research run failed.',
      },
      { status: 500 }
    );
  }
}

function buildResearchSummary(result: {
  keyFindings: string[];
  reportFileName: string;
  summary: string;
}) {
  const lines = [result.summary.trim()];

  result.keyFindings.slice(0, 3).forEach((finding) => {
    lines.push(`- ${finding}`);
  });

  lines.push(`完整报告：${result.reportFileName}`);

  return lines.filter(Boolean).join('\n');
}
