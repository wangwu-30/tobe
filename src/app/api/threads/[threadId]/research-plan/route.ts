import { NextRequest, NextResponse } from 'next/server';
import { getSelectedModelFromHeaders } from '@/lib/ai/providers';
import { generateDeepResearchPlan } from '@/lib/ai/research-runner';
import {
  buildCommentResearchPrompt,
  buildNextResearchState,
} from '@/lib/comments/research-orchestration';
import {
  stringifyCommentAgentMentions,
} from '@/lib/comments/agents';
import {
  parseCommentResearchState,
  stringifyCommentResearchState,
} from '@/lib/comments/research';
import { prisma } from '@/lib/db/prisma';
import {
  buildCommentResearchAgentState,
  resolveCommentResearchTargetFromBindings,
} from '@/objects/comment/agent-bindings';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getSearchProviderFromHeaders } from '@/lib/search/providers';
import { SearchProviderError } from '@/lib/search/types';
import { mapCommentThread } from '@/lib/wiki/service';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json().catch(() => ({}));
  const { threadId } = await params;
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const persistMessage = body.persistMessage !== false;

  if (!content) {
    return NextResponse.json({ error: 'Missing research request.' }, { status: 400 });
  }

  const thread = await prisma.commentThread.findFirst({
    where: {
      deletedAt: null,
      id: threadId,
      organizationId: actor.organizationId,
      status: {
        in: ['open', 'applied'],
      },
    },
    include: {
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      },
      version: {
        include: {
          labels: {
            where: { deletedAt: null },
          },
        },
      },
    },
  });

  if (!thread) {
    return NextResponse.json({ error: 'Thread not found.' }, { status: 404 });
  }

  const { model, settings } = getSelectedModelFromHeaders(req.headers);
  const targetResult = resolveCommentResearchTargetFromBindings({
    bindingsJson: thread.agentBindingsJson,
    content,
    preferredAgentId: typeof body.agentId === 'string' ? body.agentId : null,
    settings,
  });

  if (!targetResult.agent || !targetResult.mention) {
    return NextResponse.json(
      { error: targetResult.error || 'No research role is available.' },
      { status: 400 }
    );
  }
  const targetAgent = targetResult.agent;

  try {
    await getSearchProviderFromHeaders(req.headers);
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

  const persistedMessage = persistMessage
    ? await prisma.commentMessage.create({
        data: {
          organizationId: actor.organizationId,
          threadId: thread.id,
          role: 'user',
          content,
          mentionedAgentsJson: stringifyCommentAgentMentions([targetResult.mention]),
          createdByUserId: actor.userId,
          originDeviceId: actor.deviceId,
        },
      })
    : null;

  const systemPrompt = await buildCommentResearchPrompt({
    anchorText:
      (typeof body.anchorText === 'string' && body.anchorText.trim()) || thread.anchorText,
    documentContent:
      typeof body.documentContent === 'string' ? body.documentContent : '',
    messages: [...thread.messages, ...(persistedMessage ? [persistedMessage] : [])].map((message) => ({
      role: message.role,
      content: message.content,
    })),
    organizationId: actor.organizationId,
    settings,
    targetAgent,
    workspaceId: thread.documentId,
  });

  const proposal = await generateDeepResearchPlan({
    message: content,
    model,
    settings,
    systemPrompt,
    sourceScope: {
      attachments: false,
      web: true,
      workspace: true,
    },
  });

  const nextBindings = buildCommentResearchAgentState({
    bindingsJson: thread.agentBindingsJson,
    targetAgent,
  });
  const nextResearchState = buildNextResearchState({
    current: parseCommentResearchState(thread.researchStateJson),
    progress: {
      mode: 'deep',
      phase: 'proposal',
      currentStepLabel: '研究计划待确认',
      providerState: 'ready',
      reportFileId: null,
      reportFileName: null,
      stepIndex: null,
      totalSteps: null,
    },
    proposal,
    targetAgent,
  });

  const updatedThread = await prisma.commentThread.update({
    where: { id: thread.id },
    data: {
      agentBindingsJson: nextBindings.bindingsJson,
      researchStateJson: stringifyCommentResearchState(nextResearchState),
      resolvedAt: null,
      status: 'open',
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      revision: {
        increment: 1,
      },
      updatedAt: new Date(),
    },
    include: {
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      },
      version: {
        include: {
          labels: {
            where: { deletedAt: null },
          },
        },
      },
    },
  });

  return NextResponse.json(mapCommentThread(updatedThread));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json().catch(() => ({}));
  const { threadId } = await params;
  const action =
    body.action === 'approve' ? 'approve' : body.action === 'dismiss' ? 'dismiss' : null;

  if (!action) {
    return NextResponse.json({ error: 'Unsupported research action.' }, { status: 400 });
  }

  const thread = await prisma.commentThread.findFirst({
    where: {
      deletedAt: null,
      id: threadId,
      organizationId: actor.organizationId,
    },
    include: {
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      },
      version: {
        include: {
          labels: {
            where: { deletedAt: null },
          },
        },
      },
    },
  });

  if (!thread) {
    return NextResponse.json({ error: 'Thread not found.' }, { status: 404 });
  }

  const currentResearchState = parseCommentResearchState(thread.researchStateJson);
  if (!currentResearchState?.proposal) {
    return NextResponse.json({ error: 'No research proposal found.' }, { status: 400 });
  }

  const updatedThread = await prisma.commentThread.update({
    where: { id: thread.id },
    data: {
      researchStateJson:
        action === 'dismiss'
          ? null
          : stringifyCommentResearchState({
              ...currentResearchState,
              proposal: {
                ...currentResearchState.proposal,
                status: 'approved',
              },
              progress: {
                mode: 'deep',
                phase: 'proposal',
                currentStepLabel: '研究计划已确认，等待开始',
                providerState: 'ready',
                reportFileId: null,
                reportFileName: null,
                stepIndex: null,
                totalSteps: null,
              },
            }),
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      revision: {
        increment: 1,
      },
      updatedAt: new Date(),
    },
    include: {
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      },
      version: {
        include: {
          labels: {
            where: { deletedAt: null },
          },
        },
      },
    },
  });

  return NextResponse.json(mapCommentThread(updatedThread));
}
