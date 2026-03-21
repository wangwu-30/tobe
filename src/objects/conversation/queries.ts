import { prisma } from '@/lib/db/prisma';
import {
  buildConversationTree,
  mapAssistantRun,
  mapConversation,
  mapConversationMessage,
  mapConversationWithRelations,
} from './view';
import type {
  AssistantRunData,
  ConversationBranchSummary,
  ConversationWithRelations,
} from '@/types';

export async function listConversations(params: {
  organizationId: string;
  workspaceId?: string | null;
}) {
  const conversations = await prisma.session.findMany({
    where: {
      deletedAt: null,
      organizationId: params.organizationId,
      ...(params.workspaceId ? { wikiId: params.workspaceId } : {}),
    },
    include: {
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return conversations.map((conversation) => ({
    ...mapConversation(conversation),
    messages: conversation.messages.map(mapConversationMessage),
  }));
}

export async function listConversationBranches(params: {
  organizationId: string;
  workspaceId: string;
}) {
  const conversations = await prisma.session.findMany({
    where: {
      deletedAt: null,
      organizationId: params.organizationId,
      wikiId: params.workspaceId,
    },
    include: {
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { updatedAt: 'asc' },
  });

  return buildConversationTree(
    conversations.map((conversation) => ({
      ...mapConversation(conversation),
      lastMessagePreview: conversation.messages[0]
        ? truncateConversationPreview(conversation.messages[0].content)
        : null,
    }))
  );
}

export async function listAssistantRuns(params: {
  conversationId?: string | null;
  organizationId: string;
  workspaceId?: string | null;
}) {
  const runs = await prisma.assistantRun.findMany({
    where: {
      deletedAt: null,
      organizationId: params.organizationId,
      ...(params.conversationId ? { sessionId: params.conversationId } : {}),
      ...(params.workspaceId ? { documentId: params.workspaceId } : {}),
    },
    orderBy: [{ startedAt: 'asc' }, { createdAt: 'asc' }],
  });

  return runs.map(mapAssistantRun);
}

export async function getWorkspaceConversationState(params: {
  conversationId?: string | null;
  organizationId: string;
  pendingChangeSetsByConversation: Map<string, number>;
  workspace: Parameters<typeof mapConversationWithRelations>[1];
  workspaceId: string;
}): Promise<{
  activeAssistantRun: AssistantRunData | null;
  conversationRuns: AssistantRunData[];
  conversationTree: ConversationBranchSummary[];
  currentConversation: ConversationWithRelations | null;
  latestConversation: ConversationWithRelations | null;
}> {
  const [conversations, assistantRunRecords, currentConversationRecord] = await Promise.all([
    prisma.session.findMany({
      where: {
        deletedAt: null,
        organizationId: params.organizationId,
        wikiId: params.workspaceId,
      },
      include: {
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'asc' },
    }),
    prisma.assistantRun.findMany({
      where: {
        deletedAt: null,
        documentId: params.workspaceId,
        organizationId: params.organizationId,
      },
      orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
    }),
    params.conversationId
      ? prisma.session.findFirst({
          where: {
            deletedAt: null,
            id: params.conversationId,
            organizationId: params.organizationId,
            wikiId: params.workspaceId,
          },
          include: fullConversationInclude,
        })
      : Promise.resolve(null),
  ]);

  const latestConversationRecord =
    currentConversationRecord ||
    (await prisma.session.findFirst({
      where: {
        deletedAt: null,
        organizationId: params.organizationId,
        wikiId: params.workspaceId,
      },
      include: fullConversationInclude,
      orderBy: { updatedAt: 'desc' },
    }));

  const currentConversation = currentConversationRecord
    ? mapConversationWithRelations(
        currentConversationRecord,
        params.workspace,
        params.pendingChangeSetsByConversation
      )
    : latestConversationRecord
      ? mapConversationWithRelations(
          latestConversationRecord,
          params.workspace,
          params.pendingChangeSetsByConversation
        )
      : null;
  const latestConversation = latestConversationRecord
    ? mapConversationWithRelations(
        latestConversationRecord,
        params.workspace,
        params.pendingChangeSetsByConversation
      )
    : null;
  const conversationRuns = assistantRunRecords
    .filter((run) => run.sessionId === currentConversation?.id)
    .map(mapAssistantRun)
    .sort(
      (left, right) =>
        new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime()
    );
  const activeAssistantRun =
    assistantRunRecords.find(
      (run) => run.status === 'queued' || run.status === 'planning' || run.status === 'running'
    ) || null;

  return {
    activeAssistantRun: activeAssistantRun ? mapAssistantRun(activeAssistantRun) : null,
    conversationRuns,
    conversationTree: buildConversationTree(
      conversations.map((conversation) => ({
        ...mapConversation(conversation, params.pendingChangeSetsByConversation),
        lastMessagePreview: conversation.messages[0]
          ? truncateWorkspaceConversationPreview(conversation.messages[0].content)
          : null,
      }))
    ),
    currentConversation,
    latestConversation,
  };
}

function truncateConversationPreview(value: string, max = 120) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) {
    return normalized;
  }

  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

const fullConversationInclude = {
  messages: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
    include: {
      attachments: {
        where: { deletedAt: null },
        include: {
          file: {
            select: {
              content: true,
              path: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' as const },
      },
    },
  },
};

function truncateWorkspaceConversationPreview(value: string, max = 120) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
