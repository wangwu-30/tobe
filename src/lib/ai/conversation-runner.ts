import type { Api, Model as PiModel } from '@mariozechner/pi-ai';
import { prisma } from '@/lib/db/prisma';
import { buildChatSystemPrompt } from '@/lib/ai/context-builder';
import { createWorkspaceAgentTools } from '@/lib/ai/pi-agent-tools';
import { streamPiAgentChat } from '@/lib/ai/chat-agent';
import type { Settings } from '@/lib/ai/providers';
import type { SearchProvider } from '@/lib/search/types';
import {
  createAssistantRun,
  createConversationMessage,
  updateAssistantRun,
} from '@/objects/conversation/commands';
import type { ResearchMode } from '@/types';

type AnyPiModel = PiModel<Api>;

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

type WorkspaceAssistantRunStreamParams = {
  actor: ActorContext;
  assistantRunId: string;
  conversationId: string;
  emptyReplySummary?: string;
  errorSummary?: string;
  model: AnyPiModel;
  modelKey: string;
  onAfterFinish?: (text: string) => Promise<void> | void;
  persistAssistantText?: (text: string) => Promise<void> | void;
  researchMode?: ResearchMode;
  searchBudget?: number;
  searchProvider?: SearchProvider | null;
  settings: Settings;
  systemPrompt: string;
  toolMessages: AgentConversationMessage[];
  workspaceId: string;
};

type WorkspaceAssistantRunDescriptor = {
  mode: Parameters<typeof createAssistantRun>[1]['mode'];
  payloadJson?: string | null;
  requestMessageId?: string | null;
  title: string;
};

type WorkspaceAssistantRunStartParams = Omit<
  WorkspaceAssistantRunStreamParams,
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
  workspaceId: string;
}) {
  const assistantRun = await createAssistantRun(params.actor, {
    conversationId: params.conversationId,
    mode: params.run.mode,
    payloadJson: params.run.payloadJson,
    requestMessageId: params.run.requestMessageId,
    title: params.run.title,
    workspaceId: params.workspaceId,
  });

  if (!params.initialUpdate) {
    return assistantRun;
  }

  return updateAssistantRun(params.actor, {
    ...params.initialUpdate,
    runId: assistantRun.id,
  });
}

export async function streamWorkspaceAssistantRun(
  params: WorkspaceAssistantRunStreamParams
) {
  const workspaceAgent = createWorkspaceAgentTools({
    actorUserId: params.actor.userId,
    conversationId: params.conversationId,
    organizationId: params.actor.organizationId,
    originDeviceId: params.actor.deviceId,
    researchMode: params.researchMode || 'light',
    searchBudget: params.searchBudget,
    searchProvider: params.searchProvider || null,
    workspaceId: params.workspaceId,
  });

  const response = await streamPiAgentChat({
    sessionId: params.conversationId,
    model: params.model,
    settings: params.settings,
    systemPrompt: params.systemPrompt,
    messages: params.toolMessages,
    tools: workspaceAgent.tools,
    onFirstText: async () => {
      await updateAssistantRun(params.actor, {
        runId: params.assistantRunId,
        status: 'running',
      });
    },
    onFinish: async ({ text }) => {
      const persistedText = text.trim() || workspaceAgent.getLatestToolSummary() || '';
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

      if (params.persistAssistantText) {
        await params.persistAssistantText(persistedText);
      } else {
        await createConversationMessage(params.actor, {
          content: persistedText,
          conversationId: params.conversationId,
          model: `agent:${params.modelKey}`,
          role: 'assistant',
          workspaceId: params.workspaceId,
        });
      }

      await updateAssistantRun(params.actor, {
        finishedAt: new Date(),
        runId: params.assistantRunId,
        status: 'completed',
        summary: persistedText,
      });

      await params.onAfterFinish?.(persistedText);
    },
    onError: async (error) => {
      const errorSummary = params.errorSummary || 'AI run failed.';
      await updateAssistantRun(params.actor, {
        finishedAt: new Date(),
        runId: params.assistantRunId,
        status: 'failed',
        summary: error instanceof Error ? error.message : errorSummary,
      });
    },
  });

  response.headers.set('x-dao-conversation-id', params.conversationId);
  response.headers.set('x-dao-workspace-id', params.workspaceId);

  return response;
}

function readImageBlockFromStoredContent(content: string, mimeType: string | null) {
  try {
    const parsed = JSON.parse(content) as {
      base64?: string;
      encoding?: string;
      kind?: string;
      mimeType?: string | null;
    };
    if (parsed.kind !== 'binary' || parsed.encoding !== 'base64' || !parsed.base64) {
      return null;
    }

    return {
      type: 'image' as const,
      data: parsed.base64,
      mimeType: mimeType || parsed.mimeType || 'application/octet-stream',
    };
  } catch {
    return null;
  }
}
