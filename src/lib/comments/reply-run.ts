import {
  buildWorkspaceAssistantSystemPrompt,
  startWorkspaceAssistantRun,
} from '@/lib/ai/conversation-runner';
import { buildCommentContext } from '@/lib/ai/context-builder';
import { prisma } from '@/lib/db/prisma';
import { streamWithPi, toPiContextMessages } from '@/lib/ai/pi-runtime';
import { parseReviewAnchor } from '@/lib/comments/review-anchor';
import { startWorkspacePreview } from '@/lib/platform/run-service';
import { refreshCommentAgentBindingsState } from '@/objects/comment/agent-bindings';
import {
  createConversationForWorkspace,
  updateWorkspaceFile,
} from '@/lib/workspace/service';

type ActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

type CommentAgent = {
  handle: string;
  id: string;
  name: string;
};

type CommentThreadRecord = {
  agentBindingsJson?: string | null;
  anchorText: string;
  documentId: string;
  fileId: string | null;
  organizationId: string;
  selectionAnchor: string | null;
} | null;

type CommentThreadMessage = {
  content: string;
  role: string;
};

export async function runStandardCommentReply(params: {
  activeAgent: CommentAgent & {
    systemPrompt: string;
  };
  actor: ActorContext;
  anchorText: string;
  model: Parameters<typeof streamWithPi>[0]['model'];
  modelKey: string;
  settings: Parameters<typeof streamWithPi>[0]['settings'];
  thread: CommentThreadRecord;
  threadId: string;
  threadMessages: CommentThreadMessage[];
  wikiContent: string;
  workspaceId?: string;
}) {
  const { systemPrompt, messages } = await buildCommentContext({
    anchorText: params.anchorText,
    language: params.settings.language,
    organizationId: params.thread?.organizationId || params.actor.organizationId,
    threadMessages: params.threadMessages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({ role: message.role, content: message.content })),
    wikiContent: params.wikiContent,
    wikiId: params.workspaceId,
  });
  const agentSystemPrompt = [
    systemPrompt,
    '',
    '## Comment Agent',
    `Handle this reply as ${params.activeAgent.name} (${params.activeAgent.handle}).`,
    params.activeAgent.systemPrompt,
  ].join('\n');

  return streamWithPi({
    model: params.model,
    settings: params.settings,
    context: {
      systemPrompt: agentSystemPrompt,
      messages: toPiContextMessages(
        messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        params.model
      ),
    },
    onFinish: async ({ text }) => {
      const persistedText = text.trim();
      if (!persistedText) {
        return;
      }

      await persistCommentAgentReply({
        activeAgent: params.activeAgent,
        actor: params.actor,
        modelKey: params.modelKey,
        text: persistedText,
        thread: params.thread,
        threadId: params.threadId,
      });
    },
  });
}

export async function runToolEnabledWebCommentReply(params: {
  activeAgent: CommentAgent & {
    systemPrompt: string;
  };
  actor: ActorContext;
  anchorText: string;
  model: Parameters<typeof startWorkspaceAssistantRun>[0]['model'];
  modelKey: string;
  reviewAnchor: ReturnType<typeof parseReviewAnchor>;
  settings: Parameters<typeof startWorkspaceAssistantRun>[0]['settings'];
  thread: CommentThreadRecord;
  threadId: string;
  threadMessages: CommentThreadMessage[];
  workspaceId: string;
}) {
  const conversationId = await resolveCommentRunConversationId({
    actor: params.actor,
    preferredFileId: params.thread?.fileId || null,
    workspaceId: params.workspaceId,
  });
  const systemPrompt = await buildWorkspaceAssistantSystemPrompt({
    conversationId,
    language: params.settings.language,
    organizationId: params.actor.organizationId,
    workspaceId: params.workspaceId,
  });

  return startWorkspaceAssistantRun({
    actor: params.actor,
    conversationId,
    emptyReplySummary: 'AI finished without a visible review reply.',
    errorSummary: 'AI review run failed.',
    model: params.model,
    modelKey: params.modelKey,
    persistAssistantText: async (persistedText) => {
      await persistCommentAgentReply({
        activeAgent: params.activeAgent,
        actor: params.actor,
        modelKey: `agent:${params.modelKey}`,
        text: persistedText,
        thread: params.thread,
        threadId: params.threadId,
      });
    },
    run: {
      mode: 'revision',
      title: buildCommentRunTitle(params.anchorText),
    },
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
    toolMessages: [
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
    workspaceId: params.workspaceId,
  });
}

export async function runE2EWebCommentReply(params: {
  activeAgent: CommentAgent;
  actor: ActorContext;
  anchorText: string;
  reviewAnchor: ReturnType<typeof parseReviewAnchor>;
  thread: CommentThreadRecord;
  threadId: string;
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
    text: summary,
    thread: params.thread,
    threadId: params.threadId,
  });

  return new Response(summary, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function persistCommentAgentReply(params: {
  activeAgent: CommentAgent;
  actor: ActorContext;
  modelKey: string;
  text: string;
  thread: {
    agentBindingsJson?: string | null;
    organizationId: string;
  } | null;
  threadId: string;
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

  const nextBindings = refreshCommentAgentBindingsState({
    bindingsJson: params.thread?.agentBindingsJson,
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
      agentBindingsJson: nextBindings.bindingsJson,
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
  actor: ActorContext;
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

function buildWebCommentRunRequest(params: {
  anchorText: string;
  reviewAnchor: ReturnType<typeof parseReviewAnchor>;
  threadMessages: CommentThreadMessage[];
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
