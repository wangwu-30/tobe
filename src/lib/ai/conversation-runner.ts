import type { Api, Model as PiModel } from '@mariozechner/pi-ai';
import { prisma } from '@/lib/db/prisma';
import { buildChatSystemPrompt } from '@/lib/ai/context-builder';
import { buildReplyLanguageInstruction } from '@/lib/ai/language';
import { createWorkspaceAgentTools } from '@/lib/ai/pi-agent-tools';
import { streamPiAgentChat } from '@/lib/ai/chat-agent';
import { safeJsonParse } from '@/framework/resilience';
import { resolvePiProviderApiKey } from '@/framework/agent/run';
import type { Settings } from '@/lib/ai/providers';
import type { SearchProvider } from '@/lib/search/types';
import {
  AssistantRunTransitionError,
  createAssistantRun,
  createConversationMessage,
  updateAssistantRun,
} from '@/objects/conversation/commands';
import {
  ensureWorkspaceFiles,
  updateWorkspaceFile,
} from '@/objects/file/commands';
import { listProjects } from '@/objects/project/queries';
import type { ConversationScopeKind, ResearchMode } from '@/types';

type AnyPiModel = PiModel<Api>;

const E2E_FALLBACK_START_DELAY_MS = 1_500;
const E2E_FALLBACK_POST_WRITE_SETTLE_MS = 3_500;

export type AgentConversationMessage =
  | {
      role: 'assistant';
      content: string;
      createdAt?: Date | string;
    }
  | {
      role: 'user';
      content:
        | string
        | Array<
            | {
                type: 'image';
                data: string;
                mimeType: string;
              }
            | {
                type: 'text';
                text: string;
              }
          >;
      createdAt?: Date | string;
    };

type AssistantRunStreamBaseParams = {
  actor: ActorContext;
  assistantRunId: string;
  conversationId: string;
  emptyReplySummary?: string;
  errorSummary?: string;
  model: AnyPiModel;
  modelKey: string;
  onAfterFinish?: (text: string) => Promise<void> | void;
  researchMode?: ResearchMode;
  searchBudget?: number;
  searchProvider?: SearchProvider | null;
  settings: Settings;
  systemPrompt: string;
  toolMessages: AgentConversationMessage[];
};

type TeamAssistantRunStreamParams = AssistantRunStreamBaseParams & {
  persistAssistantText?: never;
  scopeKind: 'team';
  workspaceId: null;
};

type WikiAssistantRunStreamParams = AssistantRunStreamBaseParams & {
  persistAssistantText?: (text: string) => Promise<void> | void;
  scopeKind?: 'wiki';
  workspaceId: string;
};

type WorkspaceAssistantRunStreamParams =
  | TeamAssistantRunStreamParams
  | WikiAssistantRunStreamParams;

type WorkspaceAssistantRunDescriptor = {
  mode: Parameters<typeof createAssistantRun>[1]['mode'];
  payloadJson?: string | null;
  requestMessageId?: string | null;
  title: string;
};

type WorkspaceAssistantRunStartParams = Omit<
  WikiAssistantRunStreamParams,
  'assistantRunId'
> & {
  run: WorkspaceAssistantRunDescriptor;
};

type ActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

type HistoryMessageRecord = {
  attachments: Array<{
    file: {
      content: string;
      path: string;
    };
    kind: string;
    mimeType: string | null;
    originalName: string;
  }>;
  content: string;
  createdAt: Date;
  role: string;
};

type WorkspaceAssistantSystemPromptParams = {
  conversationId: string;
  explicitOffline?: boolean;
  language: Parameters<typeof buildChatSystemPrompt>[0]['language'];
  organizationId: string;
  researchMode?: ResearchMode;
  userId: string;
  workspaceId: string;
};

type OnboardingAssistantSystemPromptParams = {
  language: Parameters<typeof buildChatSystemPrompt>[0]['language'];
  organizationId: string;
};

export async function buildWorkspaceAssistantSystemPrompt(
  params: WorkspaceAssistantSystemPromptParams
) {
  return buildChatSystemPrompt({
    conversationId: params.conversationId,
    explicitOffline: params.explicitOffline,
    language: params.language,
    organizationId: params.organizationId,
    researchMode: params.researchMode,
    userId: params.userId,
    workspaceId: params.workspaceId,
  });
}

export async function buildWorkspaceAssistantConversationContext(
  params: WorkspaceAssistantSystemPromptParams & {
    modelSupportsImages: boolean;
  }
) {
  const [history, systemPrompt] = await Promise.all([
    loadConversationHistoryForAgent({
      conversationId: params.conversationId,
      organizationId: params.organizationId,
    }),
    buildWorkspaceAssistantSystemPrompt(params),
  ]);

  return {
    history,
    systemPrompt,
    toolMessages: history.map((message) =>
      mapHistoryMessageToAgent(message, params.modelSupportsImages)
    ),
  };
}

export async function buildOnboardingAssistantSystemPrompt(
  params: OnboardingAssistantSystemPromptParams
) {
  const projects = await listProjects(params.organizationId);
  const parts = [
    'You are the onboarding assistant for a one-person team in 成形.',
    'Use this chat to understand the user, clarify what they want to organize or create, and help them decide what their first Wiki space should be.',
    'This is conversation only. You have no tools and cannot create, edit, delete, preview, or otherwise change a Wiki, document, file, project, task, room, or external resource.',
    'Never claim that a Wiki or document has been created or changed. When the user is ready, summarize the proposed Wiki purpose and suggest using the explicit create-space action in the interface.',
    'Ask at most one focused clarification question at a time unless the user explicitly asks for a broader plan.',
    buildReplyLanguageInstruction(params.language),
  ];

  if (projects.length > 0) {
    parts.push('', '## Existing Wiki Summaries');
    projects.slice(0, 20).forEach((project) => {
      parts.push(
        `- ${project.title}: ${project.preview} (${project.deliverableCount} pages)`
      );
    });
    parts.push(
      'Use these summaries only to avoid duplicate suggestions. Do not imply access to page contents.'
    );
  } else {
    parts.push('', 'There are no existing Wiki spaces in this organization yet.');
  }

  return parts.join('\n');
}

export async function buildOnboardingAssistantConversationContext(params: {
  conversationId: string;
  language: OnboardingAssistantSystemPromptParams['language'];
  modelSupportsImages: boolean;
  organizationId: string;
}) {
  const [history, systemPrompt] = await Promise.all([
    loadConversationHistoryForAgent({
      conversationId: params.conversationId,
      organizationId: params.organizationId,
    }),
    buildOnboardingAssistantSystemPrompt(params),
  ]);

  return {
    history,
    systemPrompt,
    toolMessages: history.map((message) =>
      mapHistoryMessageToAgent(message, params.modelSupportsImages)
    ),
  };
}

export async function loadConversationHistoryForAgent(params: {
  conversationId: string;
  organizationId: string;
}) {
  return prisma.chatMessage.findMany({
    where: {
      deletedAt: null,
      organizationId: params.organizationId,
      sessionId: params.conversationId,
    },
    include: {
      attachments: {
        where: { deletedAt: null },
        include: {
          file: {
            select: {
              content: true,
              path: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export function mapHistoryMessageToAgent(
  message: HistoryMessageRecord,
  modelSupportsImages: boolean
): AgentConversationMessage {
  const baseText = message.content.trim();
  const attachmentLines =
    message.attachments.length > 0
      ? [
          '',
          'Attachments available in workspace support files:',
          ...message.attachments.map(
            (attachment) => `- ${attachment.originalName} -> ${attachment.file.path}`
          ),
        ].join('\n')
      : '';

  if (message.role !== 'user') {
    return {
      createdAt: message.createdAt,
      content: baseText,
      role: 'assistant',
    };
  }

  const blocks: Array<
    | {
        type: 'image';
        data: string;
        mimeType: string;
      }
    | {
        type: 'text';
        text: string;
      }
  > = [];

  const textLines = [baseText];
  if (attachmentLines) {
    textLines.push(attachmentLines);
  }

  if (
    message.attachments.some((attachment) => attachment.kind === 'image') &&
    !modelSupportsImages
  ) {
    textLines.push(
      '',
      'Image attachments were kept as support files because the current model does not support direct image input.'
    );
  }

  const joinedText = textLines.filter(Boolean).join('\n');
  if (joinedText.trim()) {
    blocks.push({ type: 'text', text: joinedText.trim() });
  }

  if (modelSupportsImages) {
    for (const attachment of message.attachments) {
      if (attachment.kind !== 'image') {
        continue;
      }

      const imageBlock = readImageBlockFromStoredContent(
        attachment.file.content,
        attachment.mimeType
      );
      if (imageBlock) {
        blocks.push(imageBlock);
      }
    }
  }

  return {
    createdAt: message.createdAt,
    content: blocks.length > 0 ? blocks : joinedText,
    role: 'user',
  };
}

export async function startWorkspaceAssistantRun(
  params: WorkspaceAssistantRunStartParams
) {
  const assistantRun = await initializeWorkspaceAssistantRun({
    actor: params.actor,
    conversationId: params.conversationId,
    initialUpdate: {
      status: 'planning',
    },
    run: params.run,
    scopeKind: params.scopeKind,
    workspaceId: params.workspaceId,
  });

  return streamWorkspaceAssistantRun({
    actor: params.actor,
    assistantRunId: assistantRun.id,
    conversationId: params.conversationId,
    emptyReplySummary: params.emptyReplySummary,
    errorSummary: params.errorSummary,
    model: params.model,
    modelKey: params.modelKey,
    onAfterFinish: params.onAfterFinish,
    persistAssistantText: params.persistAssistantText,
    researchMode: params.researchMode,
    searchBudget: params.searchBudget,
    searchProvider: params.searchProvider,
    settings: params.settings,
    scopeKind: params.scopeKind,
    systemPrompt: params.systemPrompt,
    toolMessages: params.toolMessages,
    workspaceId: params.workspaceId,
  });
}

export async function initializeWorkspaceAssistantRun(params: {
  actor: ActorContext;
  conversationId: string;
  initialUpdate?: Omit<Parameters<typeof updateAssistantRun>[1], 'runId'>;
  run: WorkspaceAssistantRunDescriptor;
  scopeKind?: ConversationScopeKind;
  workspaceId: string | null;
}) {
  return createAssistantRun(params.actor, {
    conversationId: params.conversationId,
    finishedAt: params.initialUpdate?.finishedAt,
    mode: params.initialUpdate?.mode || params.run.mode,
    payloadJson:
      params.initialUpdate?.payloadJson === undefined
        ? params.run.payloadJson
        : params.initialUpdate.payloadJson,
    requestMessageId: params.run.requestMessageId,
    scopeKind: params.scopeKind || 'wiki',
    status: params.initialUpdate?.status,
    summary: params.initialUpdate?.summary,
    title: params.run.title,
    workspaceId: params.workspaceId,
  });
}

export async function streamWorkspaceAssistantRun(
  params: WorkspaceAssistantRunStreamParams
) {
  const scopeKind = params.scopeKind || 'wiki';
  if (scopeKind === 'wiki' && !params.workspaceId) {
    throw new Error('Workspace assistant runs require a workspace.');
  }
  if (scopeKind === 'team' && params.workspaceId) {
    throw new Error('Onboarding assistant runs cannot target a workspace.');
  }

  const providerApiKey = await resolvePiProviderApiKey({
    provider: params.model.provider,
    settings: params.settings,
  });

  if (process.env.DAO_E2E === '1' && !providerApiKey) {
    return streamE2EWorkspaceAssistantRun(params);
  }

  const workspaceAgent =
    scopeKind === 'wiki' && params.workspaceId
      ? createWorkspaceAgentTools({
          actorUserId: params.actor.userId,
          conversationId: params.conversationId,
          organizationId: params.actor.organizationId,
          originDeviceId: params.actor.deviceId,
          researchMode: params.researchMode || 'light',
          searchBudget: params.searchBudget,
          searchProvider: params.searchProvider || null,
          workspaceId: params.workspaceId,
        })
      : null;

  const response = await streamPiAgentChat({
    sessionId: params.conversationId,
    model: params.model,
    settings: params.settings,
    systemPrompt: params.systemPrompt,
    messages: params.toolMessages,
    tools: workspaceAgent?.tools || [],
    onFirstText: async () => {
      try {
        await updateAssistantRun(params.actor, {
          runId: params.assistantRunId,
          status: 'running',
        });
      } catch (error) {
        if (!(error instanceof AssistantRunTransitionError)) {
          throw error;
        }
      }
    },
    onFinish: async ({ text }) => {
      const persistedText =
        text.trim() || workspaceAgent?.getLatestToolSummary() || '';
      const emptyReplySummary =
        params.emptyReplySummary || 'AI finished without a visible reply.';
      if (!persistedText) {
        await updateAssistantRun(params.actor, {
          finishedAt: new Date(),
          runId: params.assistantRunId,
          status: 'failed',
          summary: emptyReplySummary,
        });
        throw new Error(emptyReplySummary);
      }

      if (scopeKind === 'wiki' && params.persistAssistantText) {
        await params.persistAssistantText(persistedText);
      } else {
        await createConversationMessage(params.actor, {
          content: persistedText,
          conversationId: params.conversationId,
          focusNodeId: params.workspaceId,
          model: `agent:${params.modelKey}`,
          role: 'assistant',
          scopeKind,
          workspaceId: params.workspaceId,
        });
      }

      await params.onAfterFinish?.(persistedText);

      await updateAssistantRun(params.actor, {
        finishedAt: new Date(),
        runId: params.assistantRunId,
        status: 'completed',
        summary: persistedText,
      });

    },
    onError: async (error) => {
      const errorSummary = params.errorSummary || 'AI run failed.';
      try {
        await updateAssistantRun(params.actor, {
          finishedAt: new Date(),
          runId: params.assistantRunId,
          status: 'failed',
          summary: error instanceof Error ? error.message : errorSummary,
        });
      } catch (transitionError) {
        if (!(transitionError instanceof AssistantRunTransitionError)) {
          throw transitionError;
        }
      }
    },
  });

  response.headers.set('x-dao-conversation-id', params.conversationId);
  if (params.workspaceId) {
    response.headers.set('x-dao-workspace-id', params.workspaceId);
  }

  return response;
}

async function streamE2EWorkspaceAssistantRun(
  params: WorkspaceAssistantRunStreamParams
) {
  const encoder = new TextEncoder();

  const response = new Response(
    new ReadableStream({
      async start(controller) {
        try {
          await updateAssistantRun(params.actor, {
            runId: params.assistantRunId,
            status: 'running',
          });

          await new Promise((resolve) => setTimeout(resolve, E2E_FALLBACK_START_DELAY_MS));

          const persistedText =
            (params.scopeKind || 'wiki') === 'team'
              ? '我们可以先一起厘清目标。你希望这个 Wiki 最先帮助你整理哪类信息或完成什么工作？'
              : await applyE2EWorkspaceAssistantFallback(params);

          // Keep the run open long enough for the workspace polling loop to
          // observe the persisted draft change before the simulated run settles.
          await new Promise((resolve) =>
            setTimeout(resolve, E2E_FALLBACK_POST_WRITE_SETTLE_MS)
          );

          controller.enqueue(encoder.encode(persistedText));

          if ((params.scopeKind || 'wiki') === 'wiki' && params.persistAssistantText) {
            await params.persistAssistantText(persistedText);
          } else {
            await createConversationMessage(params.actor, {
              content: persistedText,
              conversationId: params.conversationId,
              focusNodeId: params.workspaceId,
              model: 'agent:e2e-fallback',
              role: 'assistant',
              scopeKind: params.scopeKind || 'wiki',
              workspaceId: params.workspaceId,
            });
          }

          await params.onAfterFinish?.(persistedText);

          await updateAssistantRun(params.actor, {
            finishedAt: new Date(),
            runId: params.assistantRunId,
            status: 'completed',
            summary: persistedText,
          });

          controller.close();
        } catch (error) {
          const errorSummary = params.errorSummary || 'AI run failed.';
          await updateAssistantRun(params.actor, {
            finishedAt: new Date(),
            runId: params.assistantRunId,
            status: 'failed',
            summary: error instanceof Error ? error.message : errorSummary,
          });
          controller.error(error);
        }
      },
    }),
    {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    }
  );

  response.headers.set('x-dao-conversation-id', params.conversationId);
  if (params.workspaceId) {
    response.headers.set('x-dao-workspace-id', params.workspaceId);
  }

  return response;
}

async function applyE2EWorkspaceAssistantFallback(
  params: WorkspaceAssistantRunStreamParams
) {
  if (!params.workspaceId) {
    throw new Error('Workspace fallback requires a workspace.');
  }
  const latestUserMessage = await prisma.chatMessage.findFirst({
    where: {
      deletedAt: null,
      organizationId: params.actor.organizationId,
      role: 'user',
      sessionId: params.conversationId,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      content: true,
    },
  });

  const files = await ensureWorkspaceFiles(
    params.actor.organizationId,
    params.workspaceId
  );
  const targetFile =
    files.find((file) => file.isPrimary) ||
    files.find((file) => file.type === 'file') ||
    null;
  const marker = extractE2EMarker(latestUserMessage?.content || '');
  const nextText = buildE2EFallbackDraftText({
    currentContent: targetFile?.content || '',
    marker,
  });

  if (targetFile) {
    await updateWorkspaceFile(params.actor, {
      content: nextText,
      fileId: targetFile.id,
      workspaceId: params.workspaceId,
    });
  }

  return marker
    ? `已按请求更新当前草稿，并保留 ${marker}。`
    : '已按请求更新当前草稿，并补上更清楚的执行说明。';
}

function extractE2EMarker(content: string) {
  const match = content.match(/\bB\d-MARK-[A-Z0-9-]+\b/i);
  return match?.[0]?.toUpperCase() || null;
}

function buildE2EFallbackDraftText(params: {
  currentContent: string;
  marker: string | null;
}) {
  const nextParagraph = params.marker
    ? `当前内容已经更新为更适合正式稿的表达，并明确强调执行节奏。${params.marker}`
    : '当前内容已经更新为更适合正式稿的表达，并明确强调执行节奏。';
  const parsed = safeJsonParse<Array<Record<string, unknown>> | null>(
    params.currentContent,
    null
  );

  if (Array.isArray(parsed)) {
    const nextBlocks = parsed.map((block) => ({
      ...block,
    }));
    const paragraphIndex = nextBlocks.findIndex((block) => block.type === 'p');
    const nextParagraphBlock = {
      children: [{ text: nextParagraph }],
      type: 'p',
    };

    if (paragraphIndex >= 0) {
      nextBlocks[paragraphIndex] = nextParagraphBlock;
    } else {
      nextBlocks.push(nextParagraphBlock);
    }

    return JSON.stringify(nextBlocks);
  }

  return `${params.currentContent.trim()}\n${nextParagraph}`.trim();
}

function readImageBlockFromStoredContent(content: string, mimeType: string | null) {
  const parsed = safeJsonParse<{
    base64?: string;
    encoding?: string;
    kind?: string;
    mimeType?: string | null;
  } | null>(content, null);
  if (!parsed || parsed.kind !== 'binary' || parsed.encoding !== 'base64' || !parsed.base64) {
    return null;
  }

  return {
    type: 'image' as const,
    data: parsed.base64,
    mimeType: mimeType || parsed.mimeType || 'application/octet-stream',
  };
}
