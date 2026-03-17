import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import {
  loadConversationHistoryForAgent,
  mapHistoryMessageToAgent,
  streamWorkspaceAssistantRun,
} from '@/lib/ai/conversation-runner';
import { buildChatSystemPrompt } from '@/lib/ai/context-builder';
import { getSelectedModelFromHeaders } from '@/lib/ai/providers';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getSearchProviderFromHeaders } from '@/lib/search/providers';
import { parseAssistantRunPayload } from '@/lib/workspace/assistant-run-payload';
import { createAssistantRun } from '@/lib/workspace/service';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { runId, workspaceId } = await params;
  const run = await prisma.assistantRun.findFirst({
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

  if (!run || !run.session || !run.requestMessage) {
    return NextResponse.json({ error: 'Proposal run not found.' }, { status: 404 });
  }

  const payload = parseAssistantRunPayload(run.payloadJson);
  if (!payload.planProposal || payload.planProposal.status !== 'applied') {
    return NextResponse.json(
      { error: 'The plan proposal must be applied before continuing.' },
      { status: 400 }
    );
  }

  const { model, modelKey, settings } = getSelectedModelFromHeaders(req.headers);
  const modelSupportsImages = Array.isArray((model as { input?: string[] }).input)
    ? ((model as { input?: string[] }).input || []).includes('image')
    : false;
  const history = await loadConversationHistoryForAgent({
    conversationId: run.sessionId,
    organizationId: actor.organizationId,
  });
  const searchProvider = await getSearchProviderFromHeaders(req.headers);
  const systemPrompt = await buildChatSystemPrompt({
    conversationId: run.sessionId,
    language: settings.language,
    organizationId: actor.organizationId,
    workspaceId,
  });
  const continuationRun = await createAssistantRun(actor, {
    conversationId: run.sessionId,
    mode: 'revision',
    requestMessageId: run.requestMessageId,
    title: run.title,
    workspaceId,
  });

  return streamWorkspaceAssistantRun({
    actor,
    assistantRunId: continuationRun.id,
    conversationId: run.sessionId,
    model,
    modelKey,
    searchProvider,
    settings,
    systemPrompt,
    toolMessages: [
      ...history.map((message) => mapHistoryMessageToAgent(message, modelSupportsImages)),
      {
        role: 'user',
        content: [
          'The user approved the proposed workspace plan. Continue execution now.',
          `Original request: ${payload.planProposal.originalRequest}`,
          `Approved plan goal: ${payload.planProposal.goal}`,
          'Work directly against the approved plan and summarize the concrete changes you made.',
        ].join('\n'),
        createdAt: new Date(),
      },
    ],
    workspaceId,
  });
}
