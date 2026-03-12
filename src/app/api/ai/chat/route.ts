import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import {
  loadConversationHistoryForAgent,
  mapHistoryMessageToAgent,
  streamWorkspaceAssistantRun,
} from '@/lib/ai/conversation-runner';
import { buildChatSystemPrompt } from '@/lib/ai/context-builder';
import { getSelectedModelFromHeaders } from '@/lib/ai/providers';
import { maybeBuildReplanProposal } from '@/lib/ai/replan-proposal';
import { translate } from '@/lib/i18n/copy';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getSearchProviderFromHeaders } from '@/lib/search/providers';
import { SearchProviderError } from '@/lib/search/types';
import { getWorkspacePlan } from '@/lib/workspace/planning';
import { stringifyAssistantRunPayload } from '@/lib/workspace/assistant-run-payload';
import {
  createAssistantRun,
  createConversationForWorkspace,
  createConversationMessage,
  createWorkspaceWithConversation,
  storeMessageSupportAttachments,
  updateAssistantRun,
} from '@/lib/workspace/service';

export const runtime = 'nodejs';

const INTERNAL_FIRST_PASS_PREFIX = 'Take the first author pass for this deliverable.';

type IncomingAttachment = {
  content: string;
  kind: 'image' | 'text' | 'file';
  mimeType: string | null;
  originalName: string;
  sizeBytes: number | null;
  source: 'upload' | 'clipboard';
  storageFormat: 'text' | 'base64-envelope';
};

type ChatRequestPayload = {
  activeFileId?: string | null;
  attachments: IncomingAttachment[];
  baseSnapshotId?: string | null;
  conversationId?: string | null;
  message: string;
  model?: string | null;
  searchMode?: 'auto' | 'force';
  workspaceId?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const actor = await getPlatformContextFromHeaders(req.headers);
    const payload = await parseChatRequest(req);
    const { model, modelKey, settings } = getSelectedModelFromHeaders(
      req.headers,
      payload.model || undefined
    );
    const language = settings.language || 'zh-CN';
    const newConversationTitle = translate(language, 'chat.newConversation');
    const untitledProjectTitle = translate(language, 'workspace.untitledProject');
    const modelSupportsImages = Array.isArray((model as { input?: string[] }).input)
      ? ((model as { input?: string[] }).input || []).includes('image')
      : false;

    let conversationId = payload.conversationId || null;
    let workspaceId = payload.workspaceId || null;

    let conversation = conversationId
      ? await prisma.session.findFirst({
          where: {
            deletedAt: null,
            id: conversationId,
            organizationId: actor.organizationId,
          },
        })
      : null;

    if (!conversation) {
      if (!workspaceId) {
        const workspace = await createWorkspaceWithConversation(actor, {
          conversationTitle: newConversationTitle,
          title: untitledProjectTitle,
        });

        conversationId = workspace.conversation.id;
        workspaceId = workspace.workspace.id;
      } else {
        const createdConversation = await createConversationForWorkspace(actor, {
          activeFileId: payload.activeFileId,
          baseSnapshotId: payload.baseSnapshotId,
          title: newConversationTitle,
          workspaceId,
        });
        conversationId = createdConversation.id;
      }

      conversation = await prisma.session.findUnique({
        where: { id: conversationId! },
      });
    }

    if (!conversation) {
      throw new Error('Failed to initialize conversation.');
    }

    if (!workspaceId) {
      workspaceId = conversation.wikiId;
    }

    if (!workspaceId) {
      throw new Error('Conversation is not attached to a workspace.');
    }

    if (!conversation.wikiId) {
      conversation = await prisma.session.update({
        where: { id: conversation.id },
        data: { wikiId: workspaceId },
      });
    }

    const userMessage = await createConversationMessage(actor, {
      activeFileId: payload.activeFileId,
      content: payload.message,
      conversationId: conversation.id,
      role: 'user',
      workspaceId,
    });

    if (payload.attachments.length > 0) {
      await storeMessageSupportAttachments(actor, {
        attachments: payload.attachments,
        conversationId: conversation.id,
        messageId: userMessage.id,
        workspaceId,
      });
    }

    const inferredMode = inferRunMode(payload.message, payload.attachments.length > 0);
    const assistantRun = await createAssistantRun(actor, {
      conversationId: conversation.id,
      mode: inferredMode,
      requestMessageId: userMessage.id,
      title: buildRunTitle(payload.message),
      workspaceId,
    });

    await updateAssistantRun(actor, {
      runId: assistantRun.id,
      status: 'planning',
    });

    const history = await loadConversationHistoryForAgent({
      conversationId: conversation.id,
      organizationId: actor.organizationId,
    });

    try {
      if (inferredMode === 'revision') {
        const workspacePlan = await getWorkspacePlan({
          organizationId: actor.organizationId,
          workspaceId,
        });
        const proposal = await maybeBuildReplanProposal({
          currentPlan: workspacePlan,
          message: payload.message,
          model,
          settings,
        });

        if (proposal) {
          const summary = [
            proposal.summary,
            '',
            'Review the proposed plan card in this conversation, then choose apply and continue or keep the current plan.',
          ].join('\n');

          await updateAssistantRun(actor, {
            finishedAt: new Date(),
            mode: 'replan',
            payloadJson: stringifyAssistantRunPayload({ planProposal: proposal }),
            runId: assistantRun.id,
            status: 'completed',
            summary: proposal.summary,
          });

          await createConversationMessage(actor, {
            content: summary,
            conversationId: conversation.id,
            model: `agent:${modelKey}`,
            role: 'assistant',
            workspaceId,
          });

          if (
            history.length <= 1 &&
            !payload.message.trim().startsWith(INTERNAL_FIRST_PASS_PREFIX)
          ) {
            const title =
              payload.message.slice(0, 50) + (payload.message.length > 50 ? '...' : '');
            await prisma.session.update({
              where: { id: conversation.id },
              data: { title },
            });
          }

          const response = new Response(summary, {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          });
          response.headers.set('x-dao-conversation-id', conversation.id);
          response.headers.set('x-dao-workspace-id', workspaceId);
          response.headers.set('x-dao-wiki-id', workspaceId);
          return response;
        }
      }
    } catch (error) {
      await updateAssistantRun(actor, {
        finishedAt: new Date(),
        runId: assistantRun.id,
        status: 'failed',
        summary: error instanceof Error ? error.message : 'Could not prepare the AI run.',
      });
      throw error;
    }

    const systemPrompt = await buildChatSystemPrompt({
      conversationId: conversation.id,
      language: settings.language,
      organizationId: actor.organizationId,
      workspaceId,
    });
    let forcedSearchContext = '';
    let searchProvider = null;

    try {
      searchProvider = getSearchProviderFromHeaders(req.headers);
      if (payload.searchMode === 'force') {
        const result = await searchProvider.search({
          maxResults: 6,
          query: payload.message,
        });
        forcedSearchContext = [
          '## Web Search Context',
          result.answer || 'No summary answer returned.',
          '',
          '### Citations',
          ...(result.citations.length > 0
            ? result.citations.map(
                (citation) =>
                  `- ${citation.title || citation.url}${citation.snippet ? ` — ${citation.snippet}` : ''} (${citation.url})`
              )
            : result.results.map(
                (resultItem) =>
                  `- ${resultItem.title || resultItem.url}${resultItem.snippet ? ` — ${resultItem.snippet}` : ''} (${resultItem.url})`
              )),
        ].join('\n');
      }
    } catch (error) {
      if (error instanceof SearchProviderError && payload.searchMode === 'force') {
        throw error;
      }
    }

    return streamWorkspaceAssistantRun({
      actor,
      assistantRunId: assistantRun.id,
      conversationId: conversation.id,
      model,
      modelKey,
      searchProvider,
      settings,
      systemPrompt: forcedSearchContext ? `${systemPrompt}\n\n${forcedSearchContext}` : systemPrompt,
      toolMessages: history.map((historyMessage) =>
        mapHistoryMessageToAgent(historyMessage, modelSupportsImages)
      ),
      workspaceId,
      onAfterFinish: async () => {
        if (
          history.length <= 1 &&
          !payload.message.trim().startsWith(INTERNAL_FIRST_PASS_PREFIX)
        ) {
          const title =
            payload.message.slice(0, 50) + (payload.message.length > 50 ? '...' : '');
          await prisma.session.update({
            where: { id: conversation.id },
            data: { title },
          });
        }
      },
    });
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
}

async function parseChatRequest(req: NextRequest): Promise<ChatRequestPayload> {
  const contentType = req.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    const files = formData
      .getAll('attachments')
      .filter((item): item is File => item instanceof File);
    const meta = safeParseJson<Array<{
      kind?: 'image' | 'text' | 'file';
      mimeType?: string | null;
      name?: string;
      sizeBytes?: number | null;
      source?: 'upload' | 'clipboard';
    }>>(formData.get('attachmentsMeta')) || [];

    return {
      activeFileId: asNullableString(formData.get('activeFileId')),
      attachments: await Promise.all(
        files.map((file, index) => normalizeIncomingAttachment(file, meta[index]))
      ),
      baseSnapshotId: asNullableString(formData.get('baseSnapshotId')),
      conversationId:
        asNullableString(formData.get('conversationId')) ||
        asNullableString(formData.get('sessionId')),
      message: asString(formData.get('message')),
      model: asNullableString(formData.get('model')),
      searchMode: asSearchMode(formData.get('searchMode')),
      workspaceId:
        asNullableString(formData.get('workspaceId')) ||
        asNullableString(formData.get('wikiId')),
    };
  }

  const body = await req.json();
  return {
    activeFileId: body.activeFileId || null,
    attachments: [],
    baseSnapshotId: body.baseSnapshotId || null,
    conversationId: body.conversationId || body.sessionId || null,
    message: typeof body.message === 'string' ? body.message : '',
    model: typeof body.model === 'string' ? body.model : null,
    searchMode: body.searchMode === 'force' ? 'force' : 'auto',
    workspaceId: body.workspaceId || body.wikiId || null,
  };
}

async function normalizeIncomingAttachment(
  file: File,
  meta?: {
    kind?: 'image' | 'text' | 'file';
    mimeType?: string | null;
    name?: string;
    sizeBytes?: number | null;
    source?: 'upload' | 'clipboard';
  }
): Promise<IncomingAttachment> {
  const kind =
    meta?.kind ||
    (file.type.startsWith('image/')
      ? 'image'
      : file.type.startsWith('text/')
        ? 'text'
        : 'file');
  const mimeType = meta?.mimeType || file.type || null;
  const originalName = meta?.name || file.name || 'attachment';
  const sizeBytes = meta?.sizeBytes ?? file.size ?? null;
  const source = meta?.source === 'clipboard' ? 'clipboard' : 'upload';

  if (kind === 'text' || mimeType?.startsWith('text/')) {
    return {
      content: await file.text(),
      kind: kind === 'file' ? 'file' : 'text',
      mimeType,
      originalName,
      sizeBytes,
      source,
      storageFormat: 'text',
    };
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');
  return {
    content: JSON.stringify({
      base64,
      encoding: 'base64',
      kind: 'binary',
      mimeType,
      originalName,
      sizeBytes,
    }),
    kind,
    mimeType,
    originalName,
    sizeBytes,
    source,
    storageFormat: 'base64-envelope',
  };
}

function inferRunMode(message: string, hasAttachments: boolean) {
  if (message.trim().startsWith(INTERNAL_FIRST_PASS_PREFIX)) {
    return 'first_pass' as const;
  }

  if (!hasAttachments && message.trim().endsWith('?')) {
    return 'question' as const;
  }

  return 'revision' as const;
}

function buildRunTitle(message: string) {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'AI update';
  }

  return normalized.length > 60 ? `${normalized.slice(0, 57)}...` : normalized;
}

function safeParseJson<T>(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function asString(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value : '';
}

function asNullableString(value: FormDataEntryValue | null) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asSearchMode(value: FormDataEntryValue | null): 'auto' | 'force' {
  return value === 'force' ? 'force' : 'auto';
}
