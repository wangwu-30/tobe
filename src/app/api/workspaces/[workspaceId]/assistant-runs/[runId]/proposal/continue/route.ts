import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import {
  buildWorkspaceAssistantConversationContext,
  startWorkspaceAssistantRun,
} from '@/lib/ai/conversation-runner';
import { getSelectedModelFromHeaders } from '@/lib/ai/providers';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getSearchProviderFromHeaders } from '@/lib/search/providers';
import { parseAssistantRunPayload } from '@/lib/workspace/assistant-run-payload';
import { defineRoute } from '@/framework/resilience';


export const POST = defineRoute(async function POST(
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
  const searchProvider = await getSearchProviderFromHeaders(req.headers);
  const { systemPrompt, toolMessages } =
    await buildWorkspaceAssistantConversationContext({
      conversationId: run.sessionId,
      language: settings.language,
      modelSupportsImages,
      organizationId: actor.organizationId,
      userId: actor.userId,
      workspaceId,
    });

  return startWorkspaceAssistantRun({
    actor,
    conversationId: run.sessionId,
    model,
    modelKey,
    run: {
      mode: 'revision',
      requestMessageId: run.requestMessageId,
      title: run.title,
    },
    searchProvider,
    settings,
    systemPrompt,
    toolMessages: [
      ...toolMessages,
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
});
