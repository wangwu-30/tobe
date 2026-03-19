import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { buildChatSystemPrompt, buildCommentContext } from '@/lib/ai/context-builder';
import { createWorkspaceAgentTools } from '@/lib/ai/pi-agent-tools';
import { streamPiAgentChat } from '@/lib/ai/chat-agent';
import { getSelectedModelFromHeaders } from '@/lib/ai/providers';
import { streamWithPi, toPiContextMessages } from '@/lib/ai/pi-runtime';
import {
  normalizeCommentAgents,
  parseCommentAgentBindings,
  refreshCommentAgentBindings,
  stringifyCommentAgentBindings,
} from '@/lib/comments/agents';
import { parseReviewAnchor } from '@/lib/comments/review-anchor';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { startWorkspacePreview } from '@/lib/platform/run-service';
import {
  createAssistantRun,
  createConversationForWorkspace,
  updateAssistantRun,
  updateWorkspaceFile,
} from '@/lib/workspace/service';

export async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const {
    agentId,
    threadId,
    wikiContent,
    documentContent,
    anchorText,
    wikiId,
    documentId,
    model: modelOverride,
  } = await req.json();

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
  const selectedAgentId = typeof agentId === 'string' && agentId.trim() ? agentId.trim() : 'assistant';

  const resolvedWikiId = wikiId || documentId || thread?.documentId || undefined;
  const reviewAnchor = parseReviewAnchor(thread?.selectionAnchor || null);

  const { model, modelKey, settings } = getSelectedModelFromHeaders(
    req.headers,
    modelOverride
  );
  const commentAgents = normalizeCommentAgents(settings.commentAgents, settings.language);
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

  if (
    resolvedWikiId &&
    shouldUseToolEnabledWebCommentReply({
      activeAgentId: activeAgent.id,
      reviewAnchorSurfaceType: reviewAnchor?.surfaceType || null,
    })
  ) {
    if (process.env.DAO_E2E === '1') {
      return runE2EWebCommentReply({
        activeAgent,
        actor,
        anchorText: anchorText || thread?.anchorText || '',
        reviewAnchor,
        thread,
        threadId,
        threadMessages,
        workspaceId: resolvedWikiId,
      });
    }

    return runToolEnabledWebCommentReply({
      activeAgent,
      actor,
      anchorText: anchorText || thread?.anchorText || '',
      model,
      modelKey,
      reviewAnchor,
      settings,
      thread,
      threadId,
      threadMessages,
      workspaceId: resolvedWikiId,
    });
  }

  const { systemPrompt, messages } = await buildCommentContext({
    anchorText: anchorText || thread?.anchorText || '',
    language: settings.language,
    organizationId: thread?.organizationId || actor.organizationId,
    threadMessages: threadMessages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({ role: message.role, content: message.content })),
    wikiContent: wikiContent || documentContent || '',
    wikiId: resolvedWikiId,
  });
  const agentSystemPrompt = `${systemPrompt}\n\n## Comment Agent\nHandle this reply as ${activeAgent.name} (${activeAgent.handle}).\n${activeAgent.systemPrompt}`;

  return streamWithPi({
    model,
    settings,
    context: {
      systemPrompt: agentSystemPrompt,
      messages: toPiContextMessages(
        messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        model
      ),
    },
    onFinish: async ({ text }) => {
      const persistedText = text.trim();
      if (!persistedText) {
        return;
      }

      await persistCommentAgentReply({
        activeAgent,
        actor,
        modelKey,
        thread,
        threadId,
        text: persistedText,
      });
    },
  });
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

async function runToolEnabledWebCommentReply(params: {
  activeAgent: {
    handle: string;
    id: string;
    name: string;
    systemPrompt: string;
  };
  actor: {
    deviceId: string;
    organizationId: string;
    userId: string;
  };
  anchorText: string;
  model: Parameters<typeof streamPiAgentChat>[0]['model'];
  modelKey: string;
  reviewAnchor: ReturnType<typeof parseReviewAnchor>;
  settings: Parameters<typeof streamPiAgentChat>[0]['settings'];
  thread: {
    agentBindingsJson?: string | null;
    anchorText: string;
    documentId: string;
    fileId: string | null;
    organizationId: string;
    selectionAnchor: string | null;
  } | null;
  threadId: string;
  threadMessages: Array<{
    content: string;
    role: string;
  }>;
  workspaceId: string;
}) {
  const conversationId = await resolveCommentRunConversationId({
    actor: params.actor,
    preferredFileId: params.thread?.fileId || null,
    workspaceId: params.workspaceId,
  });
  const assistantRun = await createAssistantRun(params.actor, {
    conversationId,
    mode: 'revision',
    title: buildCommentRunTitle(params.anchorText),
    workspaceId: params.workspaceId,
  });

  await updateAssistantRun(params.actor, {
    runId: assistantRun.id,
    status: 'planning',
  });

  const systemPrompt = await buildChatSystemPrompt({
    conversationId,
    language: params.settings.language,
    organizationId: params.actor.organizationId,
    workspaceId: params.workspaceId,
  });
  const workspaceAgent = createWorkspaceAgentTools({
    actorUserId: params.actor.userId,
    conversationId,
    organizationId: params.actor.organizationId,
    originDeviceId: params.actor.deviceId,
    workspaceId: params.workspaceId,
  });

  return streamPiAgentChat({
    sessionId: conversationId,
    model: params.model,
    settings: params.settings,
    systemPrompt: [
      systemPrompt,
      '',
      '## Comment Agent',
      `Handle this reply as ${params.activeAgent.name} (${params.activeAgent.handle}).`,
      params.activeAgent.systemPrompt,
      '',
      '## Review Thread Execution',
      'This is a web-component review thread. Do not stop at advice-only feedback.',
      'Use workspace tools to inspect the current deliverable, update the live draft implementation, and then summarize the concrete changes.',
      'If you changed the web-facing output, call `start_preview` before finishing so the preview is refreshed.',
      'If the anchor maps imperfectly, use the review anchor payload and workspace files to locate the implementation instead of claiming uncertainty too early.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: buildWebCommentRunRequest({
          anchorText: params.anchorText,
          reviewAnchor: params.reviewAnchor,
          threadMessages: params.threadMessages,
        }),
        createdAt: new Date(),
      },
    ],
    tools: workspaceAgent.tools,
    onFirstText: async () => {
      await updateAssistantRun(params.actor, {
        runId: assistantRun.id,
        status: 'running',
      });
    },
    onFinish: async ({ text }) => {
      const persistedText = (
        text.trim() || workspaceAgent.getLatestToolSummary() || ''
      ).trim();
      if (!persistedText) {
        await updateAssistantRun(params.actor, {
          finishedAt: new Date(),
          runId: assistantRun.id,
          status: 'failed',
          summary: 'AI finished without a visible review reply.',
        });
        throw new Error('AI finished without a visible review reply.');
      }

      await persistCommentAgentReply({
        activeAgent: params.activeAgent,
        actor: params.actor,
        modelKey: `agent:${params.modelKey}`,
        thread: params.thread,
        threadId: params.threadId,
        text: persistedText,
      });

      await updateAssistantRun(params.actor, {
        finishedAt: new Date(),
        runId: assistantRun.id,
        status: 'completed',
        summary: persistedText,
      });
    },
    onError: async (error) => {
      await updateAssistantRun(params.actor, {
        finishedAt: new Date(),
        runId: assistantRun.id,
        status: 'failed',
        summary: error instanceof Error ? error.message : 'AI review run failed.',
      });
    },
  });
}

async function runE2EWebCommentReply(params: {
  activeAgent: {
    handle: string;
    id: string;
    name: string;
  };
  actor: {
    deviceId: string;
    organizationId: string;
    userId: string;
  };
  anchorText: string;
  reviewAnchor: ReturnType<typeof parseReviewAnchor>;
  thread: {
    agentBindingsJson?: string | null;
    documentId: string;
    fileId: string | null;
    organizationId: string;
  } | null;
  threadId: string;
  threadMessages: Array<{
    content: string;
    role: string;
  }>;
  workspaceId: string;
}) {
  const targetFileId =
    params.thread?.fileId ||
    (typeof params.reviewAnchor?.sourceMapping?.fileId === 'string'
      ? params.reviewAnchor.sourceMapping.fileId
      : null);

  if (!targetFileId) {
    throw new Error('Web review thread is missing a source file mapping.');
  }

  const targetFile = await prisma.workspaceFile.findFirst({
    where: {
      deletedAt: null,
      documentId: params.workspaceId,
      id: targetFileId,
      organizationId: params.actor.organizationId,
    },
  });

  if (!targetFile) {
    throw new Error('Web review source file not found.');
  }

  const currentExcerpt =
    typeof params.reviewAnchor?.anchorPayload?.excerpt === 'string' &&
    params.reviewAnchor.anchorPayload.excerpt.trim()
      ? params.reviewAnchor.anchorPayload.excerpt.trim()
      : params.anchorText.trim();
  const nextExcerpt = `${currentExcerpt}（已按评论更新）`;
  const nextContent =
    currentExcerpt && targetFile.content.includes(currentExcerpt)
      ? targetFile.content.replace(currentExcerpt, nextExcerpt)
      : targetFile.content;

  if (nextContent !== targetFile.content) {
    await updateWorkspaceFile(params.actor, {
      content: nextContent,
      fileId: targetFile.id,
      workspaceId: params.workspaceId,
    });
  }

  await startWorkspacePreview(params.actor, {
    workspaceId: params.workspaceId,
  });

  const summary = [
    `已按评论更新 ${targetFile.path} 中对应的预览文案，并刷新了预览。`,
    `当前定位仍锚定在 ${readReviewSelector(params.reviewAnchor) || '该组件'}，可以继续在 Review 中回放验证。`,
  ].join(' ');

  await persistCommentAgentReply({
    activeAgent: params.activeAgent,
    actor: params.actor,
    modelKey: 'dao-e2e:web-comment-revision',
    thread: params.thread,
    threadId: params.threadId,
    text: summary,
  });

  return new Response(summary, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function buildWebCommentRunRequest(params: {
  anchorText: string;
  reviewAnchor: ReturnType<typeof parseReviewAnchor>;
  threadMessages: Array<{
    content: string;
    role: string;
  }>;
}) {
  const discussion = params.threadMessages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
    .join('\n\n');

  return [
    'Handle the current review request as a concrete implementation change on the live draft.',
    `Highlighted request anchor: "${params.anchorText}"`,
    params.reviewAnchor
      ? `Review anchor payload:\n${JSON.stringify(params.reviewAnchor, null, 2)}`
      : 'Review anchor payload: unavailable',
    '',
    'Thread discussion:',
    discussion || '(no prior discussion)',
    '',
    'Requirements:',
    '- Inspect the current workspace files with tools before editing.',
    '- Modify the live draft directly instead of replying with advice only.',
    '- Stay anchored to the review request, selector, excerpt, and surrounding DOM context.',
    '- If you changed the previewed output, refresh preview before finishing.',
    '- End with a concise comment-thread summary of the concrete implementation changes.',
  ].join('\n');
}

async function persistCommentAgentReply(params: {
  activeAgent: {
    handle: string;
    id: string;
    name: string;
  };
  actor: {
    deviceId: string;
    organizationId: string;
    userId: string;
  };
  modelKey: string;
  thread: {
    agentBindingsJson?: string | null;
    organizationId: string;
  } | null;
  threadId: string;
  text: string;
}) {
  await prisma.commentMessage.create({
    data: {
      organizationId: params.thread?.organizationId || params.actor.organizationId,
      threadId: params.threadId,
      role: 'assistant',
      content: params.text,
      model: params.modelKey,
      agentId: params.activeAgent.id,
      agentLabel: params.activeAgent.name,
      createdByUserId: params.actor.userId,
      originDeviceId: params.actor.deviceId,
    },
  });

  const nextBindings = refreshCommentAgentBindings({
    bindings: parseCommentAgentBindings(params.thread?.agentBindingsJson),
    mentions: [
      {
        agentId: params.activeAgent.id,
        agentLabel: params.activeAgent.name,
        handle: params.activeAgent.handle,
      },
    ],
  });

  await prisma.commentThread.update({
    where: { id: params.threadId },
    data: {
      agentBindingsJson:
        nextBindings.length > 0 ? stringifyCommentAgentBindings(nextBindings) : null,
      createdByUserId: params.actor.userId,
      originDeviceId: params.actor.deviceId,
      revision: {
        increment: 1,
      },
      updatedAt: new Date(),
    },
  });
}

async function resolveCommentRunConversationId(params: {
  actor: {
    deviceId: string;
    organizationId: string;
    userId: string;
  };
  preferredFileId: string | null;
  workspaceId: string;
}) {
  const existingConversation = await prisma.session.findFirst({
    where: {
      deletedAt: null,
      organizationId: params.actor.organizationId,
      wikiId: params.workspaceId,
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });

  if (existingConversation?.id) {
    return existingConversation.id;
  }

  const createdConversation = await createConversationForWorkspace(params.actor, {
    activeFileId: params.preferredFileId,
    title: 'Review Execution',
    workspaceId: params.workspaceId,
  });

  return createdConversation.id;
}

function buildCommentRunTitle(anchorText: string) {
  const normalized = anchorText.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'Review revision';
  }

  return normalized.length > 48 ? `${normalized.slice(0, 45)}...` : normalized;
}

function readReviewSelector(reviewAnchor: ReturnType<typeof parseReviewAnchor>) {
  if (!reviewAnchor) {
    return null;
  }

  const selector = reviewAnchor.anchorPayload?.cssSelector;
  if (typeof selector === 'string' && selector.trim()) {
    return selector.trim();
  }

  const fallback = reviewAnchor.anchorPayload?.selector;
  return typeof fallback === 'string' && fallback.trim() ? fallback.trim() : null;
}
