'use client';

import { getStoredAISettingsHeader } from '@/lib/client/ai-settings';
import type { ResearchMode } from '@/types';

export type AgentRunAttachmentInput = {
  file: File;
  id: string;
  kind: string;
  source: string;
};

type AgentRunRequest = {
  activeFileId?: string | null;
  attachments?: AgentRunAttachmentInput[];
  baseVersionId?: string | null;
  conversationId?: string | null;
  message: string;
  model?: string | null;
  researchMode?: ResearchMode;
  signal?: AbortSignal;
  workspaceId?: string | null;
};

export async function requestAgentRun({
  activeFileId,
  attachments,
  baseVersionId,
  conversationId,
  message,
  model,
  researchMode = 'light',
  signal,
  workspaceId,
}: AgentRunRequest) {
  const formData = new FormData();
  formData.set('activeFileId', activeFileId || '');
  formData.set('baseVersionId', baseVersionId || '');
  formData.set('conversationId', conversationId || '');
  formData.set('sessionId', conversationId || '');
  formData.set('researchMode', researchMode);
  formData.set('workspaceId', workspaceId || '');
  formData.set('wikiId', workspaceId || '');
  formData.set('message', message);
  formData.set('model', model || '');
  formData.set(
    'attachmentsMeta',
    JSON.stringify(
      (attachments || []).map((attachment) => ({
        id: attachment.id,
        kind: attachment.kind,
        mimeType: attachment.file.type || null,
        name: attachment.file.name,
        sizeBytes: attachment.file.size,
        source: attachment.source,
      }))
    )
  );

  (attachments || []).forEach((attachment) => {
    formData.append('attachments', attachment.file, attachment.file.name);
  });

  const isDeepResearch = researchMode === 'deep';
  const response = await fetch(isDeepResearch ? '/api/ai/research-plan' : '/api/ai/chat', {
    method: 'POST',
    headers: {
      ...getStoredAISettingsHeader(),
    },
    body: formData,
    signal,
  });

  return {
    isDeepResearch,
    response,
  };
}

export async function requestProposalContinue(params: {
  runId: string;
  signal?: AbortSignal;
  workspaceId: string;
}) {
  return fetch(
    `/api/workspaces/${params.workspaceId}/assistant-runs/${params.runId}/proposal/continue`,
    {
      method: 'POST',
      headers: {
        ...getStoredAISettingsHeader(),
      },
      signal: params.signal,
    }
  );
}

export async function requestResearchStart(params: {
  runId: string;
  signal?: AbortSignal;
  workspaceId: string;
}) {
  return fetch(
    `/api/workspaces/${params.workspaceId}/assistant-runs/${params.runId}/research-plan/start`,
    {
      method: 'POST',
      headers: {
        ...getStoredAISettingsHeader(),
      },
      signal: params.signal,
    }
  );
}

export function resolveWorkspaceChangeFromHeaders(
  response: Response,
  fallback: {
    conversationId?: string | null;
    workspaceId?: string | null;
  }
) {
  return {
    conversationId:
      response.headers.get('x-dao-conversation-id') || fallback.conversationId || null,
    workspaceId:
      response.headers.get('x-dao-workspace-id') || fallback.workspaceId || null,
  };
}
