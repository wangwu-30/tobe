import { prisma } from '@/lib/db/prisma';
import { buildReplyLanguageInstruction } from '@/lib/ai/language';
import {
  formatProjectAiContext,
  loadProjectAiContextData,
} from '@/lib/ai/project-context';
import type { AppLanguage } from '@/lib/i18n/language';
import { resolveWorkflowExtensionHints } from '@/lib/workflows/extension-hints';
import { formatWorkflowPlaybookForPrompt } from '@/lib/workflows/service';

type ActiveWorkflowPlanRecord = {
  activeWorkflowPlaybook?: {
    status?: string | null;
    checklist: string;
    content: string;
    constraints: string;
    extensionHints?: string | null;
    originDeviceId?: string | null;
    steps: string;
    summary: string;
    title: string;
  } | null;
} | null;

function parseStructuredList(raw: string) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '').trim())
    .filter(Boolean);
}

function buildScopedDocumentIds(workspaceId: string | null | undefined, projectId?: string | null) {
  return Array.from(new Set([workspaceId, projectId].filter(Boolean))) as string[];
}

function resolveContextScopeLabel(
  documentId: string | null,
  workspaceId: string | null | undefined,
  projectId?: string | null
) {
  if (documentId && workspaceId && documentId === workspaceId) {
    return 'current';
  }

  if (documentId && projectId && documentId === projectId) {
    return 'project';
  }

  return 'global';
}

export async function buildCommentContext(params: {
  anchorText: string;
  language?: AppLanguage | null;
  organizationId: string;
  threadMessages: { role: string; content: string }[];
  wikiContent: string;
  wikiId?: string;
}): Promise<{ systemPrompt: string; messages: { role: 'user' | 'assistant'; content: string }[] }> {
  const {
    anchorText,
    organizationId,
    threadMessages,
    wikiContent,
    wikiId,
  } = params;

  const memories = await prisma.memory.findMany({
    where: {
      active: true,
      deletedAt: null,
      organizationId,
      ...(wikiId
        ? {
            OR: [
              { documentId: wikiId },
              { documentId: null },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
  });

  const knowledgeItems = await prisma.knowledgeItem.findMany({
    where: {
      deletedAt: null,
      organizationId,
      ...(wikiId
        ? {
            OR: [
              { documentId: wikiId },
              { documentId: null },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
  });

  const systemParts: string[] = [
    'You are the review agent inside 成形. You are responding to a local revision request on a deliverable draft or visible version.',
    'Treat the user comment as a request to AI, not as ordinary peer chat.',
    'Your reply should stay anchored to the highlighted text and the current deliverable content.',
    buildReplyLanguageInstruction(params.language),
    '',
    '## Wiki Content',
    wikiContent,
    '',
    '## Highlighted Text',
    `"${anchorText}"`,
  ];

  if (memories.length > 0) {
    systemParts.push('', '## Organization and Wiki Memories');
    memories.forEach((memory) => {
      systemParts.push(`- [${memory.category}] ${memory.content}`);
    });
  }

  if (knowledgeItems.length > 0) {
    systemParts.push('', '## Knowledge Base');
    knowledgeItems.forEach((item) => {
      systemParts.push(`- **${item.title}**: ${item.content}`);
    });
  }

  return {
    systemPrompt: systemParts.join('\n'),
    messages: threadMessages.map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: message.content,
    })),
  };
}

export async function buildChatSystemPrompt(params: {
  conversationId?: string;
  explicitOffline?: boolean;
  language?: AppLanguage | null;
  organizationId: string;
  researchMode?: 'light' | 'deep';
  wikiId?: string | null;
  workspaceId?: string | null;
}): Promise<string> {
  const workspaceId = params.workspaceId || params.wikiId;
  const findWorkspacePlan = prisma.workspacePlan.findFirst as unknown as (
    args: object
  ) => Promise<ActiveWorkflowPlanRecord>;
  const [activePlan, projectContext] = await Promise.all([
    workspaceId
      ? findWorkspacePlan({
          where: {
            deletedAt: null,
            documentId: workspaceId,
            organizationId: params.organizationId,
          },
          include: {
            activeWorkflowPlaybook: true,
          },
        })
      : Promise.resolve(null),
    workspaceId
      ? loadProjectAiContextData({
          organizationId: params.organizationId,
          workspaceId,
        })
      : Promise.resolve(null),
  ]);
  const scopedDocumentIds = buildScopedDocumentIds(workspaceId, projectContext?.id || null);
  const [memories, knowledgeItems] = await Promise.all([
    prisma.memory.findMany({
      where: {
        active: true,
        deletedAt: null,
        organizationId: params.organizationId,
        ...(scopedDocumentIds.length > 0
          ? {
              OR: [
                { documentId: { in: scopedDocumentIds } },
                { documentId: null },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.knowledgeItem.findMany({
      where: {
        deletedAt: null,
        organizationId: params.organizationId,
        ...(scopedDocumentIds.length > 0
          ? {
              OR: [
                { documentId: { in: scopedDocumentIds } },
                { documentId: null },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const parts: string[] = [
    'You are the first author inside 成形, an artifact-first AI authoring studio.',
    'The deliverable is the product. The workspace is only its container.',
    'A conversation is one continuation thread around the same deliverable. It is not a formal deliverable branch or version.',
    'Use tools instead of pretending to edit content in your head.',
    'Use `write_file` to update the live deliverable files directly. Treat slide decks as document content, not as a separate result shape.',
    'Direct live-draft updates create a recovery point automatically. Keep only the recent recovery points in mind; they are not user-facing milestones.',
    'Do not claim a result is live unless a tool response confirms the live draft or preview state.',
    'When the user wants to inspect a web deliverable, use `start_preview` after the relevant changes are live. Use `list_workspace_runs` to confirm preview state when needed.',
    'Never say a file, draft, or preview is updated unless a tool result confirms that state.',
    'Do not dump the full deliverable only into chat when a tool can write it into the workspace.',
    'Use `create_file` only when you truly need a new implementation asset.',
    'For web deliverables, default to a React implementation. Keep a thin previewable `index.html` mount shell when needed, but put the real UI in React source files.',
    'When context is unclear, call `get_workspace_context` first. That includes the current deliverable, project deliverable summaries, plan, versions, files, review threads, and staged changes.',
    'If the user references another deliverable in the same project, use `list_project_deliverables` and `read_project_deliverable_file` before reusing its copy, structure, or implementation details.',
    'Treat visible versions as milestones. Recovery checkpoints are internal and should not be described as user-facing versions.',
    'When the user asks to freeze a milestone, call `create_version`.',
    'When the user asks about local feedback, treat comments as precise revision requests and stay anchored to the affected section.',
    'After using tools, respond with a concise summary of what you rendered, previewed, saved, created, or learned.',
    buildReplyLanguageInstruction(params.language),
  ];

  if (params.explicitOffline) {
    parts.push(
      'The user explicitly asked to work offline. Do not call `search_web` in this run.'
    );
  } else if (params.researchMode === 'deep') {
    parts.push(
      'You are executing a deep research plan. Follow the approved subquestions, synthesize across sources, surface uncertainty as "待验证", and produce a concise summary that points to the full report artifact.'
    );
  } else {
    parts.push(
      'Use `search_web` only when the task depends on recent external information, fact verification, or missing domain background. Skip it for purely structural or local editing work.'
    );
  }

  if (memories.length > 0) {
    parts.push('', '## Memories to Always Apply');
    memories.forEach((memory) => {
      parts.push(
        `- [${resolveContextScopeLabel(memory.documentId, workspaceId, projectContext?.id || null)} / ${memory.category}] ${memory.content}`
      );
    });
  }

  if (knowledgeItems.length > 0) {
    parts.push('', '## Knowledge to Reuse');
    knowledgeItems.forEach((item) => {
      parts.push(
        `- [${resolveContextScopeLabel(item.documentId, workspaceId, projectContext?.id || null)}] ${item.title}: ${item.content}`
      );
    });
  }

  if (projectContext) {
    parts.push('', '## Current Project Context');
    parts.push(formatProjectAiContext(projectContext));
    parts.push(
      'Only the current deliverable content is injected deeply by default. Read sibling deliverables explicitly before copying their structure, code, or copy.'
    );
  }

  if (activePlan?.activeWorkflowPlaybook?.status === 'active') {
    parts.push('', '## Active Workflow Playbook');
    parts.push(
      formatWorkflowPlaybookForPrompt({
        title: activePlan.activeWorkflowPlaybook.title,
        summary: activePlan.activeWorkflowPlaybook.summary,
        steps: parseStructuredList(activePlan.activeWorkflowPlaybook.steps),
        constraints: parseStructuredList(activePlan.activeWorkflowPlaybook.constraints),
        checklist: parseStructuredList(activePlan.activeWorkflowPlaybook.checklist),
        extensionHints: resolveWorkflowExtensionHints({
          originDeviceId: activePlan.activeWorkflowPlaybook.originDeviceId || null,
          serialized: activePlan.activeWorkflowPlaybook.extensionHints,
        }),
        content: activePlan.activeWorkflowPlaybook.content,
      })
    );
  }

  return parts.join('\n');
}

export async function buildSuggestionContext(params: {
  anchorText: string;
  organizationId: string;
  threadDiscussion: string;
  wikiContent: string;
  wikiId?: string;
}): Promise<string> {
  const { anchorText, organizationId, threadDiscussion, wikiContent, wikiId } =
    params;

  const memories = await prisma.memory.findMany({
    where: {
      active: true,
      deletedAt: null,
      organizationId,
      ...(wikiId
        ? {
            OR: [
              { documentId: wikiId },
              { documentId: null },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
  });

  const parts: string[] = [
    'You are an AI editor for 成形.',
    'Generate a precise replacement for the highlighted deliverable text based on the discussion.',
    'Return only the replacement text. Do not include explanation.',
    '',
    '## Full Wiki',
    wikiContent,
    '',
    '## Text to Replace',
    `"${anchorText}"`,
    '',
    '## Discussion',
    threadDiscussion,
  ];

  if (memories.length > 0) {
    parts.push('', '## Memories');
    memories.forEach((memory) => {
      parts.push(`- [${memory.category}] ${memory.content}`);
    });
  }

  return parts.join('\n');
}
