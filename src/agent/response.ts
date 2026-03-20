'use client';

import { readTextResponseStream, type StreamController } from '@/framework/agent';
import { stripAIStreamControlTokens } from '@/lib/ai/stream-protocol';
import { resolveWorkspaceChangeFromHeaders } from './run';

type WorkspaceChangeFallback = {
  conversationId?: string | null;
  workspaceId?: string | null;
};

export async function readAgentResponseError(response: Response) {
  const payload = await response.json().catch(() => null);

  return (
    payload?.error ||
    payload?.details ||
    `AI request failed: ${response.status} ${response.statusText}`
  );
}

export async function ensureAgentResponseOk(response: Response) {
  if (!response.ok) {
    throw new Error(await readAgentResponseError(response));
  }

  return response;
}

export async function consumeAssistantTextResponse(params: {
  onFirstChunk?: () => void;
  onText: (text: string) => void;
  response: Response;
  streamController: StreamController;
  workspaceChangeFallback: WorkspaceChangeFallback;
}) {
  await ensureAgentResponseOk(params.response);

  params.streamController.dismissSlowResponse();

  const workspaceChange = resolveWorkspaceChangeFromHeaders(
    params.response,
    params.workspaceChangeFallback
  );
  const fullText = await readTextResponseStream({
    onActivity: () => {
      params.streamController.markActivity();
    },
    onFirstChunk: params.onFirstChunk,
    onText: params.onText,
    response: params.response,
    transformChunk: stripAIStreamControlTokens,
  });

  return {
    fullText,
    workspaceChange,
  };
}
