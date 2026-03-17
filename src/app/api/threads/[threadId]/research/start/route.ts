import { NextRequest, NextResponse } from 'next/server';
import { getSelectedModelFromHeaders } from '@/lib/ai/providers';
import { executeDeepResearch } from '@/lib/ai/research-runner';
import {
  buildCommentResearchPrompt,
  buildCommentResearchSummary,
  buildNextResearchState,
  buildResearchBindings,
  resolveCommentResearchTarget,
} from '@/lib/comments/research-orchestration';
import {
  parseCommentAgentBindings,
  stringifyCommentAgentBindings,
} from '@/lib/comments/agents';
import {
  parseCommentResearchState,
  stringifyCommentResearchState,
} from '@/lib/comments/research';
import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getSearchProviderFromHeaders } from '@/lib/search/providers';
import { SearchProviderError } from '@/lib/search/types';
import { mapCommentThread } from '@/lib/wiki/service';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json().catch(() => ({}));
  const { threadId } = await params;

  const thread = await prisma.commentThread.findFirst({
    where: {
      deletedAt: null,
      id: threadId,
      organizationId: actor.organizationId,
    },
    include: {
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      },
      version: true,
    },
  });

  if (!thread) {
    return NextResponse.json({ error: 'Thread not found.' }, { status: 404 });
  }

  const currentResearchState = parseCommentResearchState(thread.researchStateJson);
  if (!currentResearchState?.proposal || currentResearchState.proposal.status !== 'approved') {
    return NextResponse.json(
      { error: 'The research plan must be approved before starting.' },
      { status: 400 }
    );
  }

  const { model, settings } = getSelectedModelFromHeaders(req.headers);
  const targetResult = resolveCommentResearchTarget({
    bindings: parseCommentAgentBindings(thread.agentBindingsJson),
    content: currentResearchState.proposal.query,
    preferredAgentId: currentResearchState.targetAgentId,
    settings,
  });

  if (!targetResult.agent) {
    const blockedState = buildNextResearchState({
      current: currentResearchState,
      progress: {
        mode: 'deep',
        phase: 'blocked',
        currentStepLabel: targetResult.error || 'The research role is unavailable.',
        providerState: 'unavailable',
        reportFileId: null,
        reportFileName: null,
        stepIndex: null,
        totalSteps: null,
      },
      proposal: currentResearchState.proposal,
      targetAgent: {
        builtin: true,
        enabled: false,
        handle: currentResearchState.targetAgentLabel || '@assistant',
        id: currentResearchState.targetAgentId || 'assistant',
        name: currentResearchState.targetAgentLabel || 'AI 助手',
        systemPrompt: '',
      },
    });
    await prisma.commentThread.update({
      where: { id: thread.id },
      data: {
        researchStateJson: stringifyCommentResearchState(blockedState),
        updatedAt: new Date(),
      },
    });
    return NextResponse.json(
      { error: targetResult.error || 'The research role is unavailable.' },
      { status: 409 }
    );
  }
  const targetAgent = targetResult.agent;

  let searchProvider;
  try {
    searchProvider = await getSearchProviderFromHeaders(req.headers);
  } catch (error) {
    if (error instanceof SearchProviderError) {
      const blockedState = buildNextResearchState({
        current: currentResearchState,
        progress: {
          mode: 'deep',
          phase: 'blocked',
          currentStepLabel: '联网研究当前不可用',
          providerState: 'unavailable',
          reportFileId: null,
          reportFileName: null,
          stepIndex: null,
          totalSteps: null,
        },
        proposal: currentResearchState.proposal,
        targetAgent,
      });
      await prisma.commentThread.update({
        where: { id: thread.id },
        data: {
          researchStateJson: stringifyCommentResearchState(blockedState),
          updatedAt: new Date(),
        },
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

  const initialResearchState = buildNextResearchState({
    current: currentResearchState,
    progress: {
      mode: 'deep',
      phase: 'proposal',
      currentStepLabel: '研究计划已确认，准备开始',
      providerState: 'ready',
      reportFileId: null,
      reportFileName: null,
      stepIndex: null,
      totalSteps: null,
    },
    proposal: currentResearchState.proposal,
    targetAgent,
  });

  await prisma.commentThread.update({
    where: { id: thread.id },
    data: {
      researchStateJson: stringifyCommentResearchState(initialResearchState),
      updatedAt: new Date(),
    },
  });

  try {
    const systemPrompt = await buildCommentResearchPrompt({
      anchorText:
        (typeof body.anchorText === 'string' && body.anchorText.trim()) || thread.anchorText,
      documentContent:
        typeof body.documentContent === 'string' ? body.documentContent : '',
      messages: thread.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      organizationId: actor.organizationId,
      settings,
      targetAgent,
      workspaceId: thread.documentId,
    });

    const result = await executeDeepResearch({
      actor,
      model,
      proposal: currentResearchState.proposal,
      searchProvider,
      settings,
      systemPrompt,
      workspaceId: thread.documentId,
      onProgress: async (progress) => {
        await prisma.commentThread.update({
          where: { id: thread.id },
          data: {
            researchStateJson: stringifyCommentResearchState(
              buildNextResearchState({
                current: currentResearchState,
                progress,
                proposal: currentResearchState.proposal,
                targetAgent,
              })
            ),
            updatedAt: new Date(),
          },
        });
      },
    });

    const summary = buildCommentResearchSummary(result);
    const nextBindings = buildResearchBindings({
      bindingsJson: thread.agentBindingsJson,
      targetAgent,
    });

    await prisma.commentMessage.create({
      data: {
        organizationId: actor.organizationId,
        threadId: thread.id,
        role: 'assistant',
        content: summary,
        model: null,
        agentId: targetAgent.id,
        agentLabel: targetAgent.name,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
    });

    const completedThread = await prisma.commentThread.update({
      where: { id: thread.id },
      data: {
        agentBindingsJson:
          nextBindings.length > 0 ? stringifyCommentAgentBindings(nextBindings) : null,
        researchStateJson: stringifyCommentResearchState(
          buildNextResearchState({
            current: currentResearchState,
            progress: {
              mode: 'deep',
              phase: 'completed',
              currentStepLabel: '研究完成',
              providerState: 'ready',
              reportFileId: result.reportFileId,
              reportFileName: result.reportFileName,
              stepIndex: null,
              totalSteps: null,
            },
            proposal: currentResearchState.proposal,
            reportFileId: result.reportFileId,
            reportFileName: result.reportFileName,
            summary: result.summary,
            targetAgent,
          })
        ),
        revision: {
          increment: 1,
        },
        updatedAt: new Date(),
      },
      include: {
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
        version: true,
      },
    });

    return NextResponse.json(mapCommentThread(completedThread));
  } catch (error) {
    const blockedState = buildNextResearchState({
      current: currentResearchState,
      progress: {
        mode: 'deep',
        phase: 'blocked',
        currentStepLabel: error instanceof Error ? error.message : '研究执行失败',
        providerState: 'ready',
        reportFileId: null,
        reportFileName: null,
        stepIndex: null,
        totalSteps: null,
      },
      proposal: currentResearchState.proposal,
      targetAgent,
    });

    await prisma.commentThread.update({
      where: { id: thread.id },
      data: {
        researchStateJson: stringifyCommentResearchState(blockedState),
        updatedAt: new Date(),
      },
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
