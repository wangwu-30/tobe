import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import {
  createChatUserMessage,
  ensureChatConversation,
  parseChatRequest,
} from '@/lib/ai/chat-request';
import { buildChatSystemPrompt } from '@/lib/ai/context-builder';
import { getSelectedModelFromHeaders } from '@/lib/ai/providers';
import { generateDeepResearchPlan } from '@/lib/ai/research-runner';
import { translate } from '@/lib/i18n/copy';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getSearchProviderFromHeaders } from '@/lib/search/providers';
import { SearchProviderError } from '@/lib/search/types';
import { stringifyAssistantRunPayload } from '@/lib/workspace/assistant-run-payload';
import { createAssistantRun, updateAssistantRun } from '@/lib/workspace/service';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const actor = await getPlatformContextFromHeaders(req.headers);
    const payload = await parseChatRequest(req);
    const { model, settings } = getSelectedModelFromHeaders(
      req.headers,
      payload.model || undefined
    );
    const language = settings.language || 'zh-CN';

    await getSearchProviderFromHeaders(req.headers);

    const { conversation, workspaceId } = await ensureChatConversation({
      actor,
      activeFileId: payload.activeFileId,
      baseVersionId: payload.baseVersionId,
      conversationId: payload.conversationId,
      conversationTitle: translate(language, 'chat.newConversation'),
      title: translate(language, 'workspace.untitledProject'),
      workspaceId: payload.workspaceId,
    });
    const userMessage = await createChatUserMessage({
      actor,
      activeFileId: payload.activeFileId,
      attachments: payload.attachments,
      content: payload.message,
      conversationId: conversation.id,
      workspaceId,
    });
    const systemPrompt = await buildChatSystemPrompt({
      conversationId: conversation.id,
      language: settings.language,
      organizationId: actor.organizationId,
      researchMode: 'deep',
      workspaceId,
    });
    const proposal = await generateDeepResearchPlan({
      message: payload.message,
      model,
      settings,
      systemPrompt,
      sourceScope: {
        attachments: payload.attachments.length > 0,
        web: true,
        workspace: true,
      },
    });

    const assistantRun = await createAssistantRun(actor, {
      conversationId: conversation.id,
      mode: 'run',
      requestMessageId: userMessage.id,
      title: proposal.title,
      workspaceId,
    });

    const updatedRun = await updateAssistantRun(actor, {
      payloadJson: stringifyAssistantRunPayload({
        researchPlanProposal: proposal,
        researchProgress: {
          mode: 'deep',
          phase: 'proposal',
          currentStepLabel: '研究计划待确认',
          providerState: 'ready',
          reportFileId: null,
          reportFileName: null,
          stepIndex: null,
          totalSteps: null,
        },
      }),
      runId: assistantRun.id,
      status: 'completed',
      summary: proposal.summary,
    });

    return NextResponse.json({
      conversationId: conversation.id,
      run: updatedRun,
      workspaceId,
    });
  } catch (error) {
    if (error instanceof SearchProviderError) {
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
}
