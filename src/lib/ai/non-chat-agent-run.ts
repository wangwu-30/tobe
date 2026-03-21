import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import type {
  CommentReplyAgentRunPayload,
  ExtractMemoryAgentRunPayload,
  SuggestEditAgentRunPayload,
} from '@/lib/ai/agent-run-request';
import { isVisibleCommentMessage } from '@/derive/agent-watching';
import { buildSuggestionContext } from '@/lib/ai/context-builder';
import { describeAIError } from '@/lib/ai/error-utils';
import {
  buildMemoryExtractionPrompt,
  parseMemoryExtractionResponse,
  saveExtractedMemories,
} from '@/lib/ai/memory-extractor';
import { completeWithPi, extractTextContent } from '@/lib/ai/pi-runtime';
import { normalizeCommentAgents } from '@/lib/comments/agents';
import {
  runE2EWebCommentReply,
  runStandardCommentReply,
  runToolEnabledWebCommentReply,
} from '@/lib/comments/reply-run';
import { parseReviewAnchor } from '@/lib/comments/review-anchor';

type ActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

export async function executeCommentReplyAgentRun(params: {
  actor: ActorContext;
  model: Parameters<typeof runStandardCommentReply>[0]['model'];
  modelKey: string;
  payload: CommentReplyAgentRunPayload;
  settings: Parameters<typeof runStandardCommentReply>[0]['settings'];
}) {
  const threadId = params.payload.target.threadId;
  const threadMessages = await prisma.commentMessage.findMany({
    where: {
      deletedAt: null,
      threadId,
    },
    orderBy: { createdAt: 'asc' },
  });

  const thread = await prisma.commentThread.findUnique({
    where: { id: threadId },
  });

  const selectedAgentId =
    typeof params.payload.target.agentId === 'string' && params.payload.target.agentId.trim()
      ? params.payload.target.agentId.trim()
      : 'assistant';
  const resolvedWorkspaceId =
    params.payload.target.workspaceId || thread?.documentId || undefined;
  const reviewAnchor = parseReviewAnchor(thread?.selectionAnchor || null);
  const commentAgents = normalizeCommentAgents(
    params.settings.commentAgents,
    params.settings.language
  );
  const activeAgent = commentAgents.find(
    (entry) => entry.id === selectedAgentId && entry.enabled
  );

  if (!activeAgent) {
    return Response.json(
      {
        error: 'Comment agent unavailable',
        details: 'This agent is missing or disabled in current settings.',
      },
      { status: 409 }
    );
  }

  const anchorText = params.payload.input.anchorText || thread?.anchorText || '';

  if (
    resolvedWorkspaceId &&
    shouldUseToolEnabledWebCommentReply({
      activeAgentId: activeAgent.id,
      reviewAnchorSurfaceType: reviewAnchor?.surfaceType || null,
    })
  ) {
    if (process.env.DAO_E2E === '1') {
      return runE2EWebCommentReply({
        activeAgent,
        actor: params.actor,
        anchorText,
        reviewAnchor,
        thread,
        threadId,
        workspaceId: resolvedWorkspaceId,
      });
    }

    return runToolEnabledWebCommentReply({
      activeAgent,
      actor: params.actor,
      anchorText,
      model: params.model,
      modelKey: params.modelKey,
      reviewAnchor,
      settings: params.settings,
      thread,
      threadId,
      threadMessages,
      workspaceId: resolvedWorkspaceId,
    });
  }

  return runStandardCommentReply({
    activeAgent,
    actor: params.actor,
    anchorText,
    model: params.model,
    modelKey: params.modelKey,
    settings: params.settings,
    thread,
    threadId,
    threadMessages,
    wikiContent: params.payload.input.documentContent || '',
    workspaceId: resolvedWorkspaceId,
  });
}

export async function executeSuggestEditAgentRun(params: {
  actor: ActorContext;
  model: Parameters<typeof completeWithPi>[0]['model'];
  modelKey: string;
  payload: SuggestEditAgentRunPayload;
  settings: Parameters<typeof completeWithPi>[0]['settings'];
}) {
  try {
    if (process.env.DAO_E2E === '1') {
      return NextResponse.json({
        suggestion: resolveE2ESuggestion(
          params.payload.input.threadDiscussion,
          params.payload.input.anchorText
        ),
      });
    }

    const systemPrompt = await buildSuggestionContext({
      anchorText: params.payload.input.anchorText,
      organizationId: params.actor.organizationId,
      threadDiscussion: params.payload.input.threadDiscussion,
      userId: params.actor.userId,
      wikiContent: params.payload.input.documentContent || '',
      wikiId: params.payload.target.workspaceId || undefined,
    });

    const message = await completeWithPi({
      model: params.model,
      settings: params.settings,
      context: {
        systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Generate the replacement text for "${params.payload.input.anchorText}". Return only the replacement text.`,
            timestamp: Date.now(),
          },
        ],
      },
    });

    return NextResponse.json({ suggestion: extractTextContent(message).trim() });
  } catch (error) {
    const info = describeAIError({
      language: params.settings.language,
      modelKey: params.modelKey,
      rawMessage: error instanceof Error ? error.message : 'Suggest edit failed',
    });

    return NextResponse.json(
      {
        error: info.message,
        details: info.detail,
      },
      { status: info.statusCode }
    );
  }
}

export async function executeExtractMemoryAgentRun(params: {
  actor: ActorContext;
  model: Parameters<typeof completeWithPi>[0]['model'];
  modelKey: string;
  payload: ExtractMemoryAgentRunPayload;
  settings: Parameters<typeof completeWithPi>[0]['settings'];
}) {
  try {
    const thread = await prisma.commentThread.findUnique({
      where: { id: params.payload.target.threadId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    if (!thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const prompt = buildMemoryExtractionPrompt(
      thread.messages
        .filter(isVisibleCommentMessage)
        .map((message) => ({
          role: message.role,
          content: message.content,
        })),
      thread.anchorText || ''
    );

    const message = await completeWithPi({
      model: params.model,
      settings: params.settings,
      context: {
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      },
    });

    const memories = parseMemoryExtractionResponse(extractTextContent(message));

    if (memories.length === 0) {
      return NextResponse.json({ memories: [] });
    }

    const saved = await saveExtractedMemories({
      memories,
      organizationId: params.actor.organizationId,
      threadId: params.payload.target.threadId,
      wikiId: thread.documentId,
    });

    return NextResponse.json({ memories: saved });
  } catch (error) {
    const info = describeAIError({
      language: params.settings.language,
      modelKey: params.modelKey,
      rawMessage: error instanceof Error ? error.message : 'Memory extraction failed',
    });

    return NextResponse.json(
      {
        error: info.message,
        details: info.detail,
      },
      { status: info.statusCode }
    );
  }
}

function shouldUseToolEnabledWebCommentReply(params: {
  activeAgentId: string;
  reviewAnchorSurfaceType: string | null;
}) {
  return (
    params.activeAgentId === 'assistant' &&
    params.reviewAnchorSurfaceType === 'web-component'
  );
}

function resolveE2ESuggestion(
  threadDiscussion: string | null | undefined,
  anchorText: string | null | undefined
) {
  const lastAssistantReply = (threadDiscussion || '')
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .reverse()
    .find((segment) => segment.startsWith('AI:'));

  if (lastAssistantReply) {
    const suggestion = lastAssistantReply.slice(3).trim();
    if (suggestion) {
      return suggestion;
    }
  }

  return anchorText?.trim() || '';
}
