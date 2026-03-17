import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { buildCommentContext } from '@/lib/ai/context-builder';
import { getSelectedModelFromHeaders } from '@/lib/ai/providers';
import { streamWithPi, toPiContextMessages } from '@/lib/ai/pi-runtime';
import {
  normalizeCommentAgents,
  parseCommentAgentBindings,
  refreshCommentAgentBindings,
  stringifyCommentAgentBindings,
} from '@/lib/comments/agents';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';

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

      await prisma.commentMessage.create({
        data: {
          organizationId: thread?.organizationId || actor.organizationId,
          threadId,
          role: 'assistant',
          content: persistedText,
          model: modelKey,
          agentId: activeAgent.id,
          agentLabel: activeAgent.name,
          createdByUserId: actor.userId,
          originDeviceId: actor.deviceId,
        },
      });

      const nextBindings = refreshCommentAgentBindings({
        bindings: parseCommentAgentBindings(thread?.agentBindingsJson),
        mentions: [
          {
            agentId: activeAgent.id,
            agentLabel: activeAgent.name,
            handle: activeAgent.handle,
          },
        ],
      });

      await prisma.commentThread.update({
        where: { id: threadId },
        data: {
          agentBindingsJson:
            nextBindings.length > 0 ? stringifyCommentAgentBindings(nextBindings) : null,
          createdByUserId: actor.userId,
          originDeviceId: actor.deviceId,
          revision: {
            increment: 1,
          },
          updatedAt: new Date(),
        },
      });
    },
  });
}
