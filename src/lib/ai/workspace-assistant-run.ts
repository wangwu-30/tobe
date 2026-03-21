import type { Settings } from '@/lib/ai/providers';
import type { SearchProvider } from '@/lib/search/types';
import type { ResearchMode } from '@/types';
import type { AgentRunMessage, AnyPiModel } from '@/framework/agent/run';
import { createWorkspaceAgentTools } from '@/lib/ai/pi-agent-tools';
import { streamPiAgentChat } from '@/lib/ai/chat-agent';
import { updateAssistantRun } from '@/lib/workspace/service';

type ActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

export type WorkspaceAssistantRunMessage = AgentRunMessage;

export async function streamWorkspaceAssistantRunWithPersistence(params: {
  actor: ActorContext;
  assistantRunId: string;
  conversationId: string;
  model: AnyPiModel;
  modelKey: string;
  researchMode?: ResearchMode;
  searchBudget?: number;
  searchProvider?: SearchProvider | null;
  settings: Settings;
  systemPrompt: string;
  toolMessages: WorkspaceAssistantRunMessage[];
  workspaceId: string;
  emptyReplyErrorMessage?: string;
  failedRunSummary?: string;
  persistAssistantReply: (params: {
    modelKey: string;
    text: string;
  }) => Promise<void> | void;
  onAfterFinish?: (text: string) => Promise<void> | void;
}) {
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
      if (!persistedText) {
        const emptyReplyErrorMessage =
          params.emptyReplyErrorMessage || 'AI finished without a visible reply.';
        await updateAssistantRun(params.actor, {
          finishedAt: new Date(),
          runId: params.assistantRunId,
          status: 'failed',
          summary: emptyReplyErrorMessage,
        });
        throw new Error(emptyReplyErrorMessage);
      }

      await params.persistAssistantReply({
        modelKey: `agent:${params.modelKey}`,
        text: persistedText,
      });

      await updateAssistantRun(params.actor, {
        finishedAt: new Date(),
        runId: params.assistantRunId,
        status: 'completed',
        summary: persistedText,
      });

      await params.onAfterFinish?.(persistedText);
    },
    onError: async (error) => {
      await updateAssistantRun(params.actor, {
        finishedAt: new Date(),
        runId: params.assistantRunId,
        status: 'failed',
        summary:
          error instanceof Error
            ? error.message
            : params.failedRunSummary || 'AI run failed.',
      });
    },
  });

  response.headers.set('x-dao-conversation-id', params.conversationId);
  response.headers.set('x-dao-workspace-id', params.workspaceId);

  return response;
}
