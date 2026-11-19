import {
  buildWorkspaceAssistantSystemPrompt,
  startWorkspaceAssistantRun,
} from '@/lib/ai/conversation-runner';
import { buildCommentContext } from '@/lib/ai/context-builder';
import { prisma } from '@/lib/db/prisma';
import { streamWithPi, toPiContextMessages } from '@/lib/ai/pi-runtime';
import { parseReviewAnchor } from '@/lib/comments/review-anchor';
import {
  buildWebCommentRunRequest,
  WEB_COMMENT_STAGING_SYSTEM_PROMPT_LINES,
} from '@/lib/comments/web-comment-prompt';
import { createStagedChangeSet } from '@/lib/workspace/planning';
import { refreshCommentAgentBindingsState } from '@/objects/comment/agent-bindings';
import { createConversationForWorkspace } from '@/objects/conversation/commands';

export { buildWebCommentRunRequest, WEB_COMMENT_STAGING_SYSTEM_PROMPT_LINES };

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
    userId: params.actor.userId,
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
    userId: params.actor.userId,
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
      ...WEB_COMMENT_STAGING_SYSTEM_PROMPT_LINES,
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

function normalizeStagedFileKind(
  kind: string
): 'richtext' | 'markdown' | 'text' | 'code' {
  if (
    kind === 'richtext' ||
    kind === 'markdown' ||
    kind === 'text' ||
    kind === 'code'
  ) {
    return kind;
  }
  return 'code';
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

  const [workspace, targetFile] = await Promise.all([
    prisma.document.findFirst({
      where: {
        deletedAt: null,
        id: params.workspaceId,
        organizationId: params.actor.organizationId,
      },
      select: {
        draftBaseVersionId: true,
        draftRevision: true,
      },
    }),
    prisma.workspaceFile.findFirst({
      where: {
        deletedAt: null,
        documentId: params.workspaceId,
        id: targetFileId,
        organizationId: params.actor.organizationId,
      },
    }),
  ]);

  if (!workspace || !targetFile) {
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
    await createStagedChangeSet(params.actor, {
      baseDraftRevision: workspace.draftRevision,
      baseVersionId: workspace.draftBaseVersionId,
      changes: [
        {
          fileId: targetFile.id,
          kind: normalizeStagedFileKind(targetFile.kind),
          name: targetFile.name,
          nextContent,
          operation: 'update',
          preimage: {
            content: targetFile.content,
            revision: targetFile.revision,
          },
          summary: `根据评论更新 ${targetFile.path} 中的预览文案`,
        },
      ],
      sourceType: 'comment-assistant',
      summary: `基于网页评论为 ${targetFile.path} 生成待审阅的建议修改。`,
      title: buildCommentRunTitle(params.anchorText),
      workspaceId: params.workspaceId,
    });
  }

  const summary = [
    `已按评论生成 ${targetFile.path} 的建议修改，请在审阅队列中确认应用到草稿并刷新预览。`,
    `当前定位仍锚定在 ${readReviewSelector(params.reviewAnchor) || '该组件'}，应用后可继续在 Review 中回放验证。`,
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
  const workspace = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: params.workspaceId,
      organizationId: params.actor.organizationId,
    },
    select: {
      id: true,
      projectId: true,
    },
  });
  const projectId = workspace?.projectId || workspace?.id || params.workspaceId;
  const existingConversation = await prisma.session.findFirst({
    where: {
      deletedAt: null,
      organizationId: params.actor.organizationId,
      OR: [
        { projectId },
        {
          projectId: null,
          wikiId: params.workspaceId,
        },
      ],
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
