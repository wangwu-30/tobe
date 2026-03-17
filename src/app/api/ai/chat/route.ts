import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import {
  createChatUserMessage,
  ensureChatConversation,
  parseChatRequest,
} from '@/lib/ai/chat-request';
import {
  loadConversationHistoryForAgent,
  mapHistoryMessageToAgent,
  streamWorkspaceAssistantRun,
} from '@/lib/ai/conversation-runner';
import { buildChatSystemPrompt } from '@/lib/ai/context-builder';
import { getSelectedModelFromHeaders } from '@/lib/ai/providers';
import {
  isExplicitOfflineRequest,
  LIGHT_RESEARCH_SEARCH_BUDGET,
} from '@/lib/ai/research-runner';
import { translate } from '@/lib/i18n/copy';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getSearchProviderFromHeaders } from '@/lib/search/providers';
import { SearchProviderError } from '@/lib/search/types';
import { stringifyAssistantRunPayload } from '@/lib/workspace/assistant-run-payload';
import {
  createAssistantRun,
  updateAssistantRun,
} from '@/lib/workspace/service';

export const runtime = 'nodejs';

const INTERNAL_FIRST_PASS_PREFIX = 'Take the first author pass for this deliverable.';

export async function POST(req: NextRequest) {
  try {
    const actor = await getPlatformContextFromHeaders(req.headers);
    const payload = await parseChatRequest(req);
    if (payload.researchMode === 'deep') {
      return NextResponse.json(
        { error: 'Deep research requires the research plan flow.' },
        { status: 400 }
      );
    }

    const { model, modelKey, settings } = getSelectedModelFromHeaders(
      req.headers,
      payload.model || undefined
    );
    const language = settings.language || 'zh-CN';
    const newConversationTitle = translate(language, 'chat.newConversation');
    const untitledProjectTitle = translate(language, 'workspace.untitledProject');
    const modelSupportsImages = Array.isArray((model as { input?: string[] }).input)
      ? ((model as { input?: string[] }).input || []).includes('image')
      : false;

    const { conversation, workspaceId } = await ensureChatConversation({
      actor,
      activeFileId: payload.activeFileId,
      baseVersionId: payload.baseVersionId,
      conversationId: payload.conversationId,
      conversationTitle: newConversationTitle,
      title: untitledProjectTitle,
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

    const assistantRun = await createAssistantRun(actor, {
      conversationId: conversation.id,
      mode: 'run',
      requestMessageId: userMessage.id,
      title: buildRunTitle(payload.message),
      workspaceId,
    });

    await updateAssistantRun(actor, {
      runId: assistantRun.id,
      status: 'planning',
    });

    const history = await loadConversationHistoryForAgent({
      conversationId: conversation.id,
      organizationId: actor.organizationId,
    });

    const explicitOffline = isExplicitOfflineRequest(payload.message);
    let searchProvider = null;
    let searchProviderUnavailable = false;

    if (!explicitOffline) {
      try {
        searchProvider = await getSearchProviderFromHeaders(req.headers);
      } catch (error) {
        if (error instanceof SearchProviderError) {
          searchProviderUnavailable = true;
        } else {
          throw error;
        }
      }
    }

    if (explicitOffline || searchProviderUnavailable) {
      await updateAssistantRun(actor, {
        payloadJson: stringifyAssistantRunPayload({
          researchProgress: {
            mode: 'light',
            phase: 'blocked',
            currentStepLabel: explicitOffline
              ? '本轮按离线处理'
              : '联网未就绪，本轮按离线处理',
            providerState: searchProviderUnavailable ? 'unavailable' : 'ready',
            reportFileId: null,
            reportFileName: null,
            stepIndex: null,
            totalSteps: null,
          },
        }),
        runId: assistantRun.id,
      });
    }

    const systemPrompt = await buildChatSystemPrompt({
      conversationId: conversation.id,
      explicitOffline,
      language: settings.language,
      organizationId: actor.organizationId,
      researchMode: 'light',
      workspaceId,
    });

    return streamWorkspaceAssistantRun({
      actor,
      assistantRunId: assistantRun.id,
      conversationId: conversation.id,
      model,
      modelKey,
      researchMode: 'light',
      searchBudget: LIGHT_RESEARCH_SEARCH_BUDGET,
      searchProvider,
      settings,
      systemPrompt,
      toolMessages: history.map((historyMessage) =>
        mapHistoryMessageToAgent(historyMessage, modelSupportsImages)
      ),
      workspaceId,
      onAfterFinish: async () => {
        if (
          history.length <= 1 &&
          !payload.message.trim().startsWith(INTERNAL_FIRST_PASS_PREFIX)
        ) {
          const title =
            payload.message.slice(0, 50) + (payload.message.length > 50 ? '...' : '');
          await prisma.session.update({
            where: { id: conversation.id },
            data: { title },
          });
        }
      },
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

function buildRunTitle(message: string) {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'AI update';
  }

  return normalized.length > 60 ? `${normalized.slice(0, 57)}...` : normalized;
}
