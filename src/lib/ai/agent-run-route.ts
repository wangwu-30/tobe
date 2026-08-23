import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { describeAIError } from '@/lib/ai/error-utils';
import {
  ChatRequestError,
  createChatUserMessage,
  ensureChatConversation,
} from '@/lib/ai/chat-request';
import {
  parseAgentRunRequest,
  type AgentRunRequestPayload,
  type ChatAgentRunPayload,
  type CommentReplyAgentRunPayload,
  type ExtractMemoryAgentRunPayload,
  type SuggestEditAgentRunPayload,
} from '@/lib/ai/agent-run-request';
import {
  buildOnboardingAssistantConversationContext,
  buildWorkspaceAssistantConversationContext,
  buildWorkspaceAssistantSystemPrompt,
  initializeWorkspaceAssistantRun,
  startWorkspaceAssistantRun,
  streamWorkspaceAssistantRun,
} from '@/lib/ai/conversation-runner';
import { runWithAssistantRunFailureBoundary } from '@/lib/ai/assistant-run-lifecycle';
import {
  executeCommentReplyAgentRun,
  executeExtractMemoryAgentRun,
  executeSuggestEditAgentRun,
} from '@/lib/ai/non-chat-agent-run';
import { getSelectedModelFromHeaders } from '@/lib/ai/providers';
import {
  generateDeepResearchPlan,
  isExplicitOfflineRequest,
  LIGHT_RESEARCH_SEARCH_BUDGET,
} from '@/lib/ai/research-runner';
import { translate } from '@/lib/i18n/copy';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getSearchProviderFromHeaders } from '@/lib/search/providers';
import { SearchProviderError } from '@/lib/search/types';
import { stringifyAssistantRunPayload } from '@/lib/workspace/assistant-run-payload';
import {
  beginOnboardingAssistantTurn,
  ConversationCommandError,
} from '@/objects/conversation/commands';

const INTERNAL_FIRST_PASS_PREFIX = 'Take the first author pass for this deliverable.';

type AgentRunRequestContext = Awaited<ReturnType<typeof resolveAgentRunRequestContext>>;
type ChatAgentRunRequestContext = Omit<AgentRunRequestContext, 'payload'> & {
  payload: ChatAgentRunPayload;
};
type CommentReplyAgentRunRequestContext = Omit<AgentRunRequestContext, 'payload'> & {
  payload: CommentReplyAgentRunPayload;
};
type SuggestEditAgentRunRequestContext = Omit<AgentRunRequestContext, 'payload'> & {
  payload: SuggestEditAgentRunPayload;
};
type ExtractMemoryAgentRunRequestContext = Omit<AgentRunRequestContext, 'payload'> & {
  payload: ExtractMemoryAgentRunPayload;
};

export async function handleAgentRunRequest(req: NextRequest) {
  try {
    const payload = await parseAgentRunRequest(req);

    switch (payload.mode) {
      case 'chat':
        return payload.researchMode === 'deep'
          ? handleDeepResearchPayloadRequest(req, payload)
          : handleLightChatPayloadRequest(req, payload);
      case 'comment-reply':
        return handleCommentReplyPayloadRequest(req, payload);
      case 'suggest-edit':
        return handleSuggestEditPayloadRequest(req, payload);
      case 'extract-memory':
        return handleExtractMemoryPayloadRequest(req, payload);
    }
  } catch (error) {
    return handleAgentRunError(error);
  }
}

export async function handleLightChatRunRequest(req: NextRequest) {
  let payload: AgentRunRequestPayload;
  try {
    payload = await parseAgentRunRequest(req);
  } catch (error) {
    return handleAgentRunError(error);
  }
  if (payload.mode !== 'chat') {
    return NextResponse.json(
      { error: 'This route only accepts chat payloads.' },
      { status: 400 }
    );
  }

  if (payload.researchMode === 'deep') {
    return NextResponse.json(
      { error: 'Deep research requires the research plan flow.' },
      { status: 400 }
    );
  }

  return handleLightChatPayloadRequest(req, payload);
}

export async function handleDeepResearchPlanRequest(req: NextRequest) {
  let payload: AgentRunRequestPayload;
  try {
    payload = await parseAgentRunRequest(req);
  } catch (error) {
    return handleAgentRunError(error);
  }
  if (payload.mode !== 'chat') {
    return NextResponse.json(
      { error: 'This route only accepts chat payloads.' },
      { status: 400 }
    );
  }

  return handleDeepResearchPayloadRequest(req, payload);
}

async function handleLightChatPayloadRequest(
  req: NextRequest,
  payload: ChatAgentRunPayload
) {
  try {
    const context = (await resolveAgentRunRequestContext(
      req,
      payload
    )) as ChatAgentRunRequestContext;
    return await executeLightChatRunRequest(context, req);
  } catch (error) {
    return handleAgentRunError(error);
  }
}

async function handleDeepResearchPayloadRequest(
  req: NextRequest,
  payload: ChatAgentRunPayload
) {
  try {
    const context = (await resolveAgentRunRequestContext(
      req,
      payload
    )) as ChatAgentRunRequestContext;
    return await executeDeepResearchPlanRequest(context, req);
  } catch (error) {
    return handleAgentRunError(error);
  }
}

async function handleCommentReplyPayloadRequest(
  req: NextRequest,
  payload: CommentReplyAgentRunPayload
) {
  try {
    const context = (await resolveAgentRunRequestContext(
      req,
      payload
    )) as CommentReplyAgentRunRequestContext;
    return await executeCommentReplyAgentRun({
      actor: context.actor,
      model: context.model,
      modelKey: context.modelKey,
      payload: context.payload,
      settings: context.settings,
    });
  } catch (error) {
    return handleAgentRunError(error);
  }
}

async function handleSuggestEditPayloadRequest(
  req: NextRequest,
  payload: SuggestEditAgentRunPayload
) {
  let modelKey: string | null = null;
  let language: 'zh-CN' | 'en-US' | undefined;

  try {
    const context = (await resolveAgentRunRequestContext(
      req,
      payload
    )) as SuggestEditAgentRunRequestContext;
    modelKey = context.modelKey;
    language = context.settings.language;
    return await executeSuggestEditAgentRun({
      actor: context.actor,
      model: context.model,
      modelKey: context.modelKey,
      payload: context.payload,
      settings: context.settings,
    });
  } catch (error) {
    return handleDescribedAgentRunError(error, {
      fallbackMessage: 'Suggest edit failed',
      language,
      modelKey,
    });
  }
}

async function handleExtractMemoryPayloadRequest(
  req: NextRequest,
  payload: ExtractMemoryAgentRunPayload
) {
  let modelKey: string | null = null;
  let language: 'zh-CN' | 'en-US' | undefined;

  try {
    const context = (await resolveAgentRunRequestContext(
      req,
      payload
    )) as ExtractMemoryAgentRunRequestContext;
    modelKey = context.modelKey;
    language = context.settings.language;
    return await executeExtractMemoryAgentRun({
      actor: context.actor,
      model: context.model,
      modelKey: context.modelKey,
      payload: context.payload,
      settings: context.settings,
    });
  } catch (error) {
    return handleDescribedAgentRunError(error, {
      fallbackMessage: 'Memory extraction failed',
      language,
      modelKey,
    });
  }
}

async function resolveAgentRunRequestContext(
  req: NextRequest,
  payload: AgentRunRequestPayload
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { model, modelKey, settings } = getSelectedModelFromHeaders(
    req.headers,
    resolveModelOverride(payload) || undefined
  );

  return {
    actor,
    model,
    modelKey,
    payload,
    settings,
  };
}

async function executeLightChatRunRequest(
  context: ChatAgentRunRequestContext,
  req: NextRequest
) {
  assertSupportedChatCapabilities(context.payload);
  const language = context.settings.language || 'zh-CN';
  const newConversationTitle = translate(language, 'chat.newConversation');
  const untitledProjectTitle = translate(language, 'workspace.untitledProject');
  const modelSupportsImages = Array.isArray((context.model as { input?: string[] }).input)
    ? ((context.model as { input?: string[] }).input || []).includes('image')
    : false;

  if (context.payload.scope === 'onboarding') {
    const { assistantRun, conversation } = await beginOnboardingAssistantTurn(
      context.actor,
      {
        content: context.payload.message,
        conversationId: context.payload.conversationId,
        conversationTitle: newConversationTitle,
        mode: 'run',
        runTitle: buildRunTitle(context.payload.message),
      }
    );
    return runWithAssistantRunFailureBoundary({
      actor: context.actor,
      assistantRunId: assistantRun.id,
      operation: async () => {
      const { history, systemPrompt, toolMessages } =
        await buildOnboardingAssistantConversationContext({
          conversationId: conversation.id,
          language: context.settings.language,
          modelSupportsImages,
          organizationId: context.actor.organizationId,
        });

        return streamWorkspaceAssistantRun({
        actor: context.actor,
        assistantRunId: assistantRun.id,
        conversationId: conversation.id,
        model: context.model,
        modelKey: context.modelKey,
        settings: context.settings,
        scopeKind: 'team',
        systemPrompt,
        toolMessages,
        workspaceId: null,
        onAfterFinish: async () => {
          if (history.length <= 1) {
            const title =
              context.payload.message.slice(0, 50) +
              (context.payload.message.length > 50 ? '...' : '');
            await prisma.session.updateMany({
              where: {
                deletedAt: null,
                id: conversation.id,
                organizationId: context.actor.organizationId,
                activeFileId: null,
                baseVersionId: null,
                projectId: null,
                scopeKind: 'team',
                sourceType: 'onboarding',
                wikiId: null,
              },
              data: { title },
            });
          }
        },
        });
      },
    });
  }

  const { conversation, scopeKind, workspaceId } = await ensureChatConversation({
    actor: context.actor,
    activeFileId: context.payload.activeFileId,
    baseVersionId: context.payload.baseVersionId,
    conversationId: context.payload.conversationId,
    conversationTitle: newConversationTitle,
    scope: context.payload.scope,
    title: untitledProjectTitle,
    workspaceId: context.payload.workspaceId,
  });
  if (scopeKind !== 'wiki' || !workspaceId) {
    throw new ChatRequestError(
      'Workspace chat requires a Wiki scope.',
      409,
      'WORKSPACE_SCOPE_REQUIRED'
    );
  }

  const userMessage = await createChatUserMessage({
    actor: context.actor,
    activeFileId: context.payload.activeFileId,
    attachments: context.payload.attachments,
    content: context.payload.message,
    conversationId: conversation.id,
    focusNodeId: context.payload.focusNodeId,
    scopeKind,
    workspaceId,
  });

  const explicitOffline = isExplicitOfflineRequest(context.payload.message);
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

  const planningPayloadJson =
    explicitOffline || searchProviderUnavailable
      ? stringifyAssistantRunPayload({
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
        })
      : null;

  const { history, systemPrompt, toolMessages } =
    await buildWorkspaceAssistantConversationContext({
      conversationId: conversation.id,
      explicitOffline,
      language: context.settings.language,
      modelSupportsImages,
      organizationId: context.actor.organizationId,
      researchMode: 'light',
      userId: context.actor.userId,
      workspaceId,
    });

  return startWorkspaceAssistantRun({
    actor: context.actor,
    conversationId: conversation.id,
    model: context.model,
    modelKey: context.modelKey,
    run: {
      mode: 'run',
      payloadJson: planningPayloadJson,
      requestMessageId: userMessage.id,
      title: buildRunTitle(context.payload.message),
    },
    researchMode: 'light',
    searchBudget: LIGHT_RESEARCH_SEARCH_BUDGET,
    searchProvider,
    settings: context.settings,
    scopeKind: 'wiki',
    systemPrompt,
    toolMessages,
    workspaceId,
    onAfterFinish: async () => {
      if (
        history.length <= 1 &&
        !context.payload.message.trim().startsWith(INTERNAL_FIRST_PASS_PREFIX)
      ) {
        const title =
          context.payload.message.slice(0, 50) +
          (context.payload.message.length > 50 ? '...' : '');
        await prisma.session.update({
          where: { id: conversation.id },
          data: { title },
        });
      }
    },
  });
}

async function executeDeepResearchPlanRequest(
  context: ChatAgentRunRequestContext,
  req: NextRequest
) {
  assertSupportedChatCapabilities(context.payload);
  if (context.payload.scope === 'onboarding') {
    throw new ChatRequestError(
      'Deep research is not supported in onboarding chat.',
      400,
      'ONBOARDING_DEEP_RESEARCH_NOT_SUPPORTED'
    );
  }
  const language = context.settings.language || 'zh-CN';

  await getSearchProviderFromHeaders(req.headers);

  const { conversation, workspaceId } = await ensureChatConversation({
    actor: context.actor,
    activeFileId: context.payload.activeFileId,
    baseVersionId: context.payload.baseVersionId,
    conversationId: context.payload.conversationId,
    conversationTitle: translate(language, 'chat.newConversation'),
    scope: context.payload.scope,
    title: translate(language, 'workspace.untitledProject'),
    workspaceId: context.payload.workspaceId,
  });
  if (!workspaceId) {
    throw new ChatRequestError(
      'Deep research requires a workspace.',
      409,
      'WORKSPACE_SCOPE_REQUIRED'
    );
  }

  const userMessage = await createChatUserMessage({
    actor: context.actor,
    activeFileId: context.payload.activeFileId,
    attachments: context.payload.attachments,
    content: context.payload.message,
    conversationId: conversation.id,
    focusNodeId: context.payload.focusNodeId,
    workspaceId,
  });

  const systemPrompt = await buildWorkspaceAssistantSystemPrompt({
    conversationId: conversation.id,
    language: context.settings.language,
    organizationId: context.actor.organizationId,
    researchMode: 'deep',
    userId: context.actor.userId,
    workspaceId,
  });
  const proposal = await generateDeepResearchPlan({
    message: context.payload.message,
    model: context.model,
    settings: context.settings,
    systemPrompt,
    sourceScope: {
      attachments: context.payload.attachments.length > 0,
      web: true,
      workspace: true,
    },
  });

  const updatedRun = await initializeWorkspaceAssistantRun({
    actor: context.actor,
    conversationId: conversation.id,
    initialUpdate: {
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
      status: 'completed',
      summary: proposal.summary,
    },
    run: {
      mode: 'run',
      requestMessageId: userMessage.id,
      title: proposal.title,
    },
    workspaceId,
  });

  return NextResponse.json({
    conversationId: conversation.id,
    run: updatedRun,
    workspaceId,
  });
}

function handleAgentRunError(error: unknown) {
  if (error instanceof ConversationCommandError) {
    return NextResponse.json(
      {
        code: error.code,
        error: error.message,
      },
      { status: error.status }
    );
  }

  if (error instanceof ChatRequestError) {
    return NextResponse.json(
      {
        code: error.code,
        error: error.message,
      },
      { status: error.status }
    );
  }

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

function assertSupportedChatCapabilities(payload: ChatAgentRunPayload) {
  if (payload.scope !== 'onboarding') {
    return;
  }

  if (payload.attachments.length > 0) {
    throw new ChatRequestError(
      'Attachments are not supported in onboarding chat.',
      400,
      'ONBOARDING_ATTACHMENTS_NOT_SUPPORTED'
    );
  }

  if (
    payload.workspaceId ||
    payload.focusNodeId ||
    payload.activeFileId ||
    payload.baseVersionId
  ) {
    throw new ChatRequestError(
      'Onboarding chat cannot target a workspace.',
      409,
      'ONBOARDING_WORKSPACE_NOT_ALLOWED'
    );
  }
}

function handleDescribedAgentRunError(
  error: unknown,
  params: {
    fallbackMessage: string;
    language?: 'zh-CN' | 'en-US';
    modelKey: string | null;
  }
) {
  const info = describeAIError({
    language: params.language,
    modelKey: params.modelKey,
    rawMessage:
      error instanceof Error ? error.message : params.fallbackMessage,
  });

  return NextResponse.json(
    {
      error: info.message,
      details: info.detail,
    },
    { status: info.statusCode }
  );
}

function resolveModelOverride(payload: AgentRunRequestPayload) {
  return 'model' in payload ? payload.model || null : null;
}

function buildRunTitle(message: string) {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'AI update';
  }

  return normalized.length > 60 ? `${normalized.slice(0, 57)}...` : normalized;
}
