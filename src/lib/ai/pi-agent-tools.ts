import type { AgentTool } from '@mariozechner/pi-agent-core';
import { Type } from '@mariozechner/pi-ai';
import { prisma } from '@/lib/db/prisma';
import {
  formatProjectAiContext,
  loadProjectAiContextData,
} from '@/lib/ai/project-context';
import { markdownToPlate, plateToMarkdown } from '@/lib/ai/serializer';
import {
  getBoundVersionIdForWiki,
} from '@/lib/comments/version-binding';
import {
  listWorkspaceRuns,
  startWorkspacePreview,
  stopWorkspacePreview,
} from '@/lib/platform/run-service';
import {
  branchConversation,
  createWorkspaceFile,
  createWorkspaceVersion,
  listWorkspaceFiles,
  listWorkspaceVersions,
  updateWorkspaceFile,
} from '@/lib/workspace/service';
import { detectWorkspacePreviewCapability } from '@/lib/workspace/preview';
import { inferDeliverableType } from '@/lib/workspace/planning';
import {
  applyStagedChangeSet,
  discardStagedChangeSet,
  getPendingStagedChangeSets,
} from '@/lib/workspace/staged-changes';
import type { SearchProvider } from '@/lib/search/types';
import type { DeliverableType, ResearchMode, WorkspaceFileData } from '@/types';

type CreateWorkspaceAgentToolsParams = {
  actorUserId: string;
  conversationId: string;
  organizationId: string;
  originDeviceId: string;
  researchMode?: ResearchMode;
  searchBudget?: number;
  workspaceId: string;
  searchProvider?: SearchProvider | null;
};

export function createWorkspaceAgentTools({
  actorUserId,
  conversationId,
  organizationId,
  originDeviceId,
  researchMode = 'light',
  searchBudget = 2,
  workspaceId,
  searchProvider,
}: CreateWorkspaceAgentToolsParams): {
  getLatestToolSummary: () => string | null;
  tools: AgentTool[];
} {
  const wikiId = workspaceId;
  const toolSummaries: string[] = [];
  let remainingSearchBudget = searchBudget;
  let cachedDeliverableType: DeliverableType | null = null;
  let liveDraftRecoveryCheckpoint:
    | {
        id: string;
        title: string;
      }
    | null = null;

  const rememberToolSummary = (summary: string) => {
    const normalized = summary.trim();
    if (!normalized || toolSummaries.includes(normalized)) {
      return;
    }

    toolSummaries.push(normalized);
  };

  const getWorkspaceDeliverableType = async (): Promise<DeliverableType> => {
    if (cachedDeliverableType) {
      return cachedDeliverableType;
    }

    const [workspacePlan, workspace] = await Promise.all([
      prisma.workspacePlan.findFirst({
        where: {
          deletedAt: null,
          documentId: workspaceId,
          organizationId,
        },
      }),
      prisma.document.findFirst({
        where: {
          deletedAt: null,
          id: workspaceId,
          organizationId,
        },
        include: {
          files: {
            where: { deletedAt: null },
            orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
        },
      }),
    ]);

    cachedDeliverableType =
      (workspacePlan?.deliverableType as DeliverableType | undefined) ||
      inferDeliverableType({
        fileKind: workspace?.files[0]?.kind || null,
        files: workspace?.files.map((file) => ({ kind: file.kind, path: file.path })) || [],
        title: workspace?.title,
      });

    return cachedDeliverableType;
  };

  const loadCurrentProjectContext = async () =>
    loadProjectAiContextData({
      organizationId,
      workspaceId,
    });

  const assertProjectTargetWorkspace = async (targetWorkspaceId: string) => {
    const projectContext = await loadCurrentProjectContext();
    if (!projectContext) {
      throw new Error('No current project context.');
    }

    const targetDeliverable = projectContext.deliverables.find(
      (deliverable) => deliverable.id === targetWorkspaceId
    );

    if (!targetDeliverable) {
      throw new Error('The requested deliverable is not in the current project.');
    }

    return {
      projectContext,
      targetDeliverable,
    };
  };

  const buildScopedDocumentIds = (projectId?: string | null) =>
    Array.from(new Set([wikiId, projectId].filter(Boolean))) as string[];

  const resolveContextScopeLabel = (documentId: string | null, projectId?: string | null) => {
    if (documentId && documentId === wikiId) {
      return 'current';
    }

    if (documentId && projectId && documentId === projectId) {
      return 'project';
    }

    return 'global';
  };

  const ensureLiveDraftRecoveryCheckpoint = async () => {
    if (liveDraftRecoveryCheckpoint) {
      return liveDraftRecoveryCheckpoint;
    }

    const version = await createWorkspaceVersion(
      {
        deviceId: originDeviceId,
        organizationId,
        userId: actorUserId,
      },
      {
        sourceConversationId: conversationId,
        title: 'Recovery Point before AI Update',
        versionType: 'checkpoint',
        workspaceId,
      }
    );

    liveDraftRecoveryCheckpoint = {
      id: version.id,
      title: version.title,
    };
    return liveDraftRecoveryCheckpoint;
  };

  const maybeStartPreviewForWeb = async () => {
    const [files, runs] = await Promise.all([
      listWorkspaceFiles({
        organizationId,
        workspaceId,
      }),
      listWorkspaceRuns({
        organizationId,
        workspaceId,
      }),
    ]);
    const previewCapability = detectWorkspacePreviewCapability(files);
    const activePreviewRun =
      runs.find(
        (run) =>
          run.kind === 'preview' &&
          (run.status === 'pending' || run.status === 'running')
      ) || null;

    if (activePreviewRun) {
      return {
        previewCapability,
        previewRun: activePreviewRun,
      };
    }

    if (!previewCapability.canPreview) {
      return {
        previewCapability,
        previewRun: null,
      };
    }

    const previewRun = await startWorkspacePreview(
      {
        deviceId: originDeviceId,
        organizationId,
        userId: actorUserId,
      },
      {
        workspaceId,
      }
    );

    return {
      previewCapability,
      previewRun,
    };
  };

  const upsertLiveDraftFile = async (input: {
    content: string;
    deliverableType: DeliverableType;
    existing: WorkspaceFileData | null;
    kind?: 'richtext' | 'markdown' | 'text' | 'code';
    language?: string;
    path?: string;
    setPrimary?: boolean;
  }) => {
    const workspaceFiles = await listWorkspaceFiles({
      organizationId,
      workspaceId,
    });
    const primaryFile =
      workspaceFiles.find((file) => file.nodeType === 'file' && file.isPrimary) ||
      workspaceFiles.find((file) => file.nodeType === 'file') ||
      null;
    const explicitPath = input.path?.trim() || null;
    const isWebDeliverable = input.deliverableType === 'web';

    if (!isWebDeliverable) {
      const preferredTarget = input.existing || (!explicitPath ? primaryFile : null) || null;
      const targetPath =
        explicitPath ||
        preferredTarget?.path ||
        getDefaultLiveDraftPath(input.deliverableType);

      if (!preferredTarget && targetPath.includes('/')) {
        throw new Error(
          'Create the parent folders first before writing a nested live-draft file.'
        );
      }

      await ensureLiveDraftRecoveryCheckpoint();

      const nextKind =
        input.kind ||
        preferredTarget?.kind ||
        (input.deliverableType === 'code' ? 'code' : 'markdown');
      const nextLanguage =
        input.language !== undefined
          ? input.language
          : inferFileLanguageFromPath(targetPath);
      const shouldSetPrimary =
        input.setPrimary !== undefined
          ? input.setPrimary
          : !explicitPath || preferredTarget?.isPrimary || false;
      const targetName = targetPath.split('/').pop() || targetPath;

      let updatedFile: WorkspaceFileData;
      if (preferredTarget) {
        updatedFile = await updateWorkspaceFile(
          {
            deviceId: originDeviceId,
            organizationId,
            userId: actorUserId,
          },
          {
            content: input.content,
            fileId: preferredTarget.id,
            kind: nextKind,
            language: nextLanguage,
            name: targetName,
            setPrimary: shouldSetPrimary,
            workspaceId,
          }
        );
      } else {
        const createdFile = await createWorkspaceFile(
          {
            deviceId: originDeviceId,
            organizationId,
            userId: actorUserId,
          },
          {
            kind: nextKind,
            name: targetName,
            workspaceId,
          }
        );

        updatedFile = await updateWorkspaceFile(
          {
            deviceId: originDeviceId,
            organizationId,
            userId: actorUserId,
          },
          {
            content: input.content,
            fileId: createdFile.id,
            kind: nextKind,
            language: nextLanguage,
            setPrimary: shouldSetPrimary,
            workspaceId,
          }
        );
      }

      const summaryParts = [`Updated the live draft in ${updatedFile.path}.`];
      if (liveDraftRecoveryCheckpoint?.title) {
        summaryParts.push(
          `Recovery point ready: ${liveDraftRecoveryCheckpoint.title}.`
        );
      }

      const summary = summaryParts.join(' ');
      rememberToolSummary(summary);

      return {
        details: {
          recoveryCheckpoint: liveDraftRecoveryCheckpoint,
          updatedFile,
        },
        summary,
      };
    }

    const contentLooksHtml = looksLikeHtmlDocument(input.content);
    const htmlEntrypoint =
      workspaceFiles.find((file) => file.nodeType === 'file' && file.path === 'index.html') ||
      null;
    const preferredTarget =
      input.existing ||
      (!explicitPath
        ? (contentLooksHtml ? htmlEntrypoint || primaryFile : primaryFile)
        : null) ||
      null;
    const targetPath = resolveWebTargetPath({
      contentLooksHtml,
      existingPath: preferredTarget?.path || null,
      explicitPath,
    });

    if (!preferredTarget && targetPath.includes('/')) {
      throw new Error(
        'Create the parent folders first before writing a nested web file.'
      );
    }

    await ensureLiveDraftRecoveryCheckpoint();

    const nextKind =
      input.kind || (contentLooksHtml ? 'code' : preferredTarget?.kind || 'code');
    const nextLanguage =
      input.language !== undefined
        ? input.language
        : contentLooksHtml
          ? 'html'
          : inferFileLanguageFromPath(targetPath);
    const shouldSetPrimary =
      input.setPrimary !== undefined
        ? input.setPrimary
        : contentLooksHtml || targetPath === 'index.html' || preferredTarget?.isPrimary || false;
    const targetName = targetPath.split('/').pop() || targetPath;

    let updatedFile: WorkspaceFileData;
    if (preferredTarget) {
      updatedFile = await updateWorkspaceFile(
        {
          deviceId: originDeviceId,
          organizationId,
          userId: actorUserId,
        },
        {
          content: input.content,
          fileId: preferredTarget.id,
          kind: nextKind,
          language: nextLanguage,
          name: targetName,
          setPrimary: shouldSetPrimary,
          workspaceId,
        }
      );
    } else {
      const createdFile = await createWorkspaceFile(
        {
          deviceId: originDeviceId,
          organizationId,
          userId: actorUserId,
        },
        {
          kind: nextKind,
          name: targetName,
          workspaceId,
        }
      );

      updatedFile = await updateWorkspaceFile(
        {
          deviceId: originDeviceId,
          organizationId,
          userId: actorUserId,
        },
        {
          content: input.content,
          fileId: createdFile.id,
          kind: nextKind,
          language: nextLanguage,
          setPrimary: shouldSetPrimary,
          workspaceId,
        }
      );
    }

    const { previewCapability, previewRun } = await maybeStartPreviewForWeb();
    const summaryParts = [`Updated the current web deliverable in ${updatedFile.path}.`];

    if (liveDraftRecoveryCheckpoint?.title) {
      summaryParts.push(`Recovery point ready: ${liveDraftRecoveryCheckpoint.title}.`);
    }

    if (previewRun?.previewUrl) {
      summaryParts.push(`Preview is available at ${previewRun.previewUrl}.`);
    } else if (previewCapability.canPreview) {
      summaryParts.push('The draft is previewable.');
    } else {
      summaryParts.push(`Preview is still blocked: ${previewCapability.reason}`);
    }

    const summary = summaryParts.join(' ');
    rememberToolSummary(summary);

    return {
      details: {
        previewRun,
        recoveryCheckpoint: liveDraftRecoveryCheckpoint,
        updatedFile,
      },
      summary,
    };
  };

  const tools: AgentTool[] = [
    {
      name: 'get_workspace_context',
      label: 'Get Workspace Context',
      description:
        'Inspect the current deliverable workspace, including project deliverable summaries, the live draft, shared brief, visible versions, staged changes, review threads, knowledge items, and memories.',
      parameters: Type.Object({}),
      async execute() {
        const [
          wiki,
          conversation,
          projectContext,
          workspacePlan,
          stagedChangeSets,
          workspaceRuns,
        ] = await Promise.all([
          prisma.document.findFirst({
            where: {
              deletedAt: null,
              id: wikiId,
              organizationId,
            },
            include: {
              versions: {
                where: { deletedAt: null },
                orderBy: { versionNum: 'desc' },
                take: 5,
              },
              threads: {
                where: { deletedAt: null },
                include: {
                  messages: {
                    where: { deletedAt: null },
                    orderBy: { createdAt: 'asc' },
                  },
                  version: true,
                },
                orderBy: { updatedAt: 'desc' },
                take: 20,
              },
              knowledgeItems: {
                where: { deletedAt: null },
                orderBy: { createdAt: 'desc' },
                take: 20,
              },
              files: {
                where: { deletedAt: null },
                orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
                take: 50,
              },
            },
          }),
          prisma.session.findFirst({
            where: {
              deletedAt: null,
              id: conversationId,
              organizationId,
            },
            include: {
              messages: {
                where: { deletedAt: null },
                orderBy: { createdAt: 'asc' },
                take: 12,
              },
            },
          }),
          loadCurrentProjectContext(),
          prisma.workspacePlan.findFirst({
            where: {
              deletedAt: null,
              documentId: wikiId,
              organizationId,
            },
          }),
          prisma.stagedChangeSet.findMany({
            where: {
              deletedAt: null,
              documentId: wikiId,
              organizationId,
            },
            orderBy: { createdAt: 'desc' },
            take: 10,
          }),
          listWorkspaceRuns({
            organizationId,
            workspaceId,
          }),
        ]);
        const scopedDocumentIds = buildScopedDocumentIds(projectContext?.id || null);
        const [memories, knowledgeItems] = await Promise.all([
          prisma.memory.findMany({
            where: {
              active: true,
              deletedAt: null,
              organizationId,
              OR: [
                { documentId: { in: scopedDocumentIds } },
                { documentId: null },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
          }),
          prisma.knowledgeItem.findMany({
            where: {
              deletedAt: null,
              organizationId,
              OR: [
                { documentId: { in: scopedDocumentIds } },
                { documentId: null },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
          }),
        ]);
        const previewCapability = detectWorkspacePreviewCapability(wiki?.files || []);
        const activePreviewRun =
          workspaceRuns.find(
            (run) =>
              run.kind === 'preview' &&
              (run.status === 'pending' || run.status === 'running')
          ) || null;

        const summary = [
          `Conversation: ${conversation?.title || conversationId}`,
          wiki
            ? `Deliverable Workspace: ${wiki.title} (${wiki.status}, v${wiki.currentVersion})`
            : 'Deliverable Workspace: none',
          '',
          'Current project deliverables:',
          projectContext ? formatProjectAiContext(projectContext, { includeWorkspaceIds: true }) : 'No current project context.',
          '',
          'Current deliverable content:',
          wiki ? serializeWikiContent(wiki.content) : 'No deliverable yet.',
          '',
          'Workspace brief:',
          workspacePlan
            ? [
                `- Goal: ${workspacePlan.goal}`,
                `- Deliverable type: ${workspacePlan.deliverableType}`,
                workspacePlan.constraints
                  ? `- Constraints: ${workspacePlan.constraints}`
                  : null,
                workspacePlan.styleGuide
                  ? `- Style: ${workspacePlan.styleGuide}`
                  : null,
              ]
                .filter(Boolean)
                .join('\n')
            : 'No shared brief yet.',
          '',
          'Recent conversation:',
          conversation && conversation.messages.length > 0
            ? conversation.messages
                .map((message) => `- ${message.role}: ${truncate(message.content)}`)
                .join('\n')
            : 'No conversation messages yet.',
          '',
          'Files:',
          wiki && wiki.files.length > 0
            ? wiki.files
                .map(
                  (file) =>
                    `- [${file.type}] ${file.path} (${file.kind}${file.isPrimary ? ', primary deliverable' : ''})`
                )
                .join('\n')
            : 'No files yet.',
          '',
          'Preview capability:',
          previewCapability.canPreview
            ? `- Ready via ${previewCapability.entryPath}${activePreviewRun?.previewUrl ? `, active at ${activePreviewRun.previewUrl}` : ''}.`
            : `- Not ready. ${previewCapability.reason}`,
          '',
          'Recent workspace runs:',
          workspaceRuns.length > 0
            ? workspaceRuns
                .slice(0, 8)
                .map((run) => {
                  const previewSuffix = run.previewUrl ? ` -> ${run.previewUrl}` : '';
                  return `- [${run.kind}] ${run.command} (${run.status})${previewSuffix}`;
                })
                .join('\n')
            : 'None.',
          '',
          'Pending staged changes:',
          stagedChangeSets.filter((changeSet) => changeSet.status === 'pending').length > 0
            ? stagedChangeSets
                .filter((changeSet) => changeSet.status === 'pending')
                .map((changeSet) => `- ${changeSet.title}: ${changeSet.summary}`)
                .join('\n')
            : 'None.',
          '',
          'Open review threads:',
          wiki
            ? summarizeThreads(wiki.threads.filter((thread) => thread.status === 'open'))
            : 'No deliverable yet.',
          '',
          'Pending verification review threads:',
          wiki
            ? summarizeThreads(
                wiki.threads.filter((thread) => thread.status === 'applied')
              )
            : 'No deliverable yet.',
          '',
          'Resolved review threads:',
          wiki
            ? summarizeThreads(wiki.threads.filter((thread) => thread.status === 'resolved'))
            : 'No deliverable yet.',
          '',
          'Knowledge items:',
          knowledgeItems.length > 0
            ? knowledgeItems
                .map(
                  (item) =>
                    `- [${resolveContextScopeLabel(item.documentId, projectContext?.id || null)}] ${item.title}: ${item.content}`
                )
                .join('\n')
            : 'None.',
          '',
          'Active memories:',
          memories.length > 0
            ? memories
                .map(
                  (memory) =>
                    `- [${resolveContextScopeLabel(memory.documentId, projectContext?.id || null)} / ${memory.category}] ${memory.content}`
                )
                .join('\n')
            : 'None.',
        ].join('\n');

        return {
          content: [{ type: 'text', text: summary }],
          details: {
            conversation,
            knowledgeItems,
            memories,
            projectContext,
            stagedChangeSets,
            workspaceRuns,
            workspacePlan,
            wiki,
          },
        };
      },
    },
    {
      name: 'list_project_deliverables',
      label: 'List Project Deliverables',
      description:
        'List the current deliverable and sibling deliverables in the same project, including workspace ids for follow-up reads.',
      parameters: Type.Object({}),
      async execute() {
        const projectContext = await loadCurrentProjectContext();
        const summary = projectContext
          ? formatProjectAiContext(projectContext, { includeWorkspaceIds: true })
          : 'No current project context.';

        return {
          content: [{ type: 'text', text: summary }],
          details: projectContext,
        };
      },
    },
    {
      name: 'read_project_deliverable_file',
      label: 'Read Project Deliverable File',
      description:
        'Read the primary file or a specific file from another deliverable in the same project.',
      parameters: Type.Object({
        fileId: Type.Optional(Type.String({ minLength: 1 })),
        path: Type.Optional(Type.String({ minLength: 1 })),
        targetWorkspaceId: Type.String({ minLength: 1 }),
      }),
      async execute(_toolCallId, params) {
        const input = params as {
          fileId?: string;
          path?: string;
          targetWorkspaceId: string;
        };
        const { targetDeliverable } = await assertProjectTargetWorkspace(
          input.targetWorkspaceId
        );
        const files = await listWorkspaceFiles({
          organizationId,
          workspaceId: input.targetWorkspaceId,
        });

        const targetFile =
          (input.fileId
            ? files.find((file) => file.id === input.fileId)
            : input.path
              ? files.find((file) => file.path === input.path)
              : null) ||
          files.find((file) => file.nodeType === 'file' && file.isPrimary) ||
          files.find((file) => file.nodeType === 'file') ||
          null;

        if (!targetFile) {
          throw new Error('No readable file found in the requested deliverable.');
        }

        return {
          content: [
            {
              type: 'text',
              text: [
                `Deliverable: ${targetDeliverable.title}`,
                `Workspace ID: ${targetDeliverable.id}`,
                `Type: ${targetDeliverable.deliverableType}`,
                `Status: ${targetDeliverable.status}`,
                '',
                'Files:',
                files
                  .filter((file) => file.nodeType === 'file')
                  .map(
                    (file) =>
                      `- ${file.path} (${file.kind}${file.isPrimary ? ', primary' : ''})`
                  )
                  .join('\n'),
                '',
                `# ${targetFile.path}`,
                '',
                targetFile.content,
              ].join('\n'),
            },
          ],
          details: {
            file: targetFile,
            files,
            targetDeliverable,
          },
        };
      },
    },
    {
      name: 'lock_current_wiki',
      label: 'Lock Current Wiki',
      description:
        'Save the current draft as a visible milestone and lock the document for review.',
      parameters: Type.Object({}),
      async execute() {
        const wiki = await prisma.document.findUnique({
          where: { id: wikiId },
        });

        if (!wiki) {
          throw new Error('No deliverable exists in the current workspace.');
        }

        const version = await createWorkspaceVersion(
          {
            deviceId: originDeviceId,
            organizationId,
            userId: actorUserId,
          },
          {
            sourceConversationId: conversationId,
            title: wiki.title,
            workspaceId,
          }
        );
        await prisma.document.update({
          where: { id: wiki.id },
          data: {
            status: 'locked',
          },
        });

        return {
          content: [
            {
              type: 'text',
              text: `Saved "${wiki.title}" as milestone ${version.versionNum} and locked it for review.`,
            },
          ],
          details: {
            versionId: version.id,
            versionNum: version.versionNum,
            wikiId: wiki.id,
          },
        };
      },
    },
    {
      name: 'list_files',
      label: 'List Files',
      description:
        'List the files and folders in the current workspace.',
      parameters: Type.Object({}),
      async execute() {
        const files = await listWorkspaceFiles({
          organizationId,
          workspaceId,
        });

        return {
          content: [
            {
              type: 'text',
              text:
                files.length > 0
                  ? files
                      .map(
                        (file) =>
                          `- [${file.nodeType}] ${file.path} (${file.kind}${file.isPrimary ? ', primary' : ''})`
                      )
                      .join('\n')
                  : 'No files yet.',
            },
          ],
          details: files,
        };
      },
    },
    {
      name: 'read_file',
      label: 'Read File',
      description:
        'Read the content of one file in the current workspace.',
      parameters: Type.Object({
        fileId: Type.Optional(Type.String({ minLength: 1 })),
        path: Type.Optional(Type.String({ minLength: 1 })),
      }),
      async execute(_toolCallId, params) {
        const input = params as { fileId?: string; path?: string };
        const file = await prisma.workspaceFile.findFirst({
          where: {
            deletedAt: null,
            documentId: workspaceId,
            organizationId,
            ...(input.fileId
              ? { id: input.fileId }
              : input.path
                ? { path: input.path }
                : {}),
          },
        });

        if (!file) {
          throw new Error('File not found.');
        }

        return {
          content: [
            {
              type: 'text',
              text: `# ${file.path}\n\n${file.content}`,
            },
          ],
          details: file,
        };
      },
    },
    {
      name: 'write_file',
      label: 'Write File',
      description:
        'Create or overwrite the live deliverable files in the current workspace directly. Treat slide decks as document content instead of a separate result shape.',
      parameters: Type.Object({
        content: Type.String(),
        fileId: Type.Optional(Type.String({ minLength: 1 })),
        kind: Type.Optional(Type.String({ minLength: 1 })),
        language: Type.Optional(Type.String({ minLength: 1 })),
        path: Type.Optional(Type.String({ minLength: 1 })),
        setPrimary: Type.Optional(Type.Boolean()),
      }),
      async execute(_toolCallId, params) {
        const input = params as {
          content: string;
          fileId?: string;
          kind?: 'richtext' | 'markdown' | 'text' | 'code';
          language?: string;
          path?: string;
          setPrimary?: boolean;
        };
        const deliverableType = await getWorkspaceDeliverableType();

        const existing = input.fileId
          ? await prisma.workspaceFile.findFirst({
              where: {
                deletedAt: null,
                id: input.fileId,
                documentId: workspaceId,
                organizationId,
              },
            })
          : input.path
            ? await prisma.workspaceFile.findFirst({
                where: {
                  deletedAt: null,
                  path: input.path,
                  documentId: workspaceId,
                  organizationId,
                },
              })
            : null;

        const result = await upsertLiveDraftFile({
          content: input.content,
          deliverableType,
          existing: existing ? mapWorkspaceFileRecord(existing) : null,
          kind: input.kind,
          language: input.language,
          path: input.path,
          setPrimary: input.setPrimary,
        });

        return {
          content: [
            {
              type: 'text',
              text: result.summary,
            },
          ],
          details: result.details,
        };
      },
    },
    {
      name: 'create_file',
      label: 'Create File',
      description:
        'Create a new file or folder in the current workspace.',
      parameters: Type.Object({
        kind: Type.Optional(Type.String({ minLength: 1 })),
        name: Type.String({ minLength: 1 }),
        nodeType: Type.Optional(Type.String({ minLength: 1 })),
        parentId: Type.Optional(Type.String({ minLength: 1 })),
      }),
      async execute(_toolCallId, params) {
        const input = params as {
          kind?: 'richtext' | 'markdown' | 'text' | 'code';
          name: string;
          nodeType?: 'file' | 'folder';
          parentId?: string;
        };
        const file = await createWorkspaceFile(
          {
            deviceId: originDeviceId,
            organizationId,
            userId: actorUserId,
          },
          {
            kind: input.kind,
            name: input.name,
            nodeType: input.nodeType,
            parentId: input.parentId,
            workspaceId,
          }
        );
        rememberToolSummary(`Created ${file.path}.`);

        return {
          content: [{ type: 'text', text: `Created ${file.path}.` }],
          details: file,
        };
      },
    },
    {
      name: 'list_workspace_runs',
      label: 'List Workspace Runs',
      description:
        'Inspect recent preview and command runs for the current workspace.',
      parameters: Type.Object({}),
      async execute() {
        const runs = await listWorkspaceRuns({
          organizationId,
          workspaceId,
        });

        return {
          content: [
            {
              type: 'text',
              text:
                runs.length > 0
                  ? runs
                      .map((run) => {
                        const previewSuffix = run.previewUrl ? ` -> ${run.previewUrl}` : '';
                        return `- [${run.kind}] ${run.command} (${run.status})${previewSuffix}`;
                      })
                      .join('\n')
                  : 'No workspace runs yet.',
            },
          ],
          details: runs,
        };
      },
    },
    {
      name: 'apply_staged_change_set',
      label: 'Apply Staged Change Set',
      description:
        'Apply a pending staged change set to the live workspace draft so the result becomes visible outside the plan review queue.',
      parameters: Type.Object({
        changeSetId: Type.Optional(Type.String({ minLength: 1 })),
        checkpointTitle: Type.Optional(Type.String({ minLength: 1 })),
      }),
      async execute(_toolCallId, params) {
        const input = params as { changeSetId?: string; checkpointTitle?: string };
        const pendingChangeSets = await getPendingStagedChangeSets({
          organizationId,
          workspaceId,
        });
        const changeSet =
          (input.changeSetId
            ? pendingChangeSets.find((item) => item.id === input.changeSetId) || null
            : pendingChangeSets[0] || null);

        if (!changeSet) {
          throw new Error(
            input.changeSetId
              ? 'Requested staged change set is not pending in this workspace.'
              : 'No pending staged change sets are available.'
          );
        }

        const applied = await applyStagedChangeSet(
          {
            deviceId: originDeviceId,
            organizationId,
            userId: actorUserId,
          },
          {
            changeSetId: changeSet.id,
            checkpointTitle: input.checkpointTitle,
            workspaceId,
          }
        );
        rememberToolSummary(`Applied staged changes "${applied.title}" to the live draft.`);

        return {
          content: [
            {
              type: 'text',
              text: `Applied staged changes "${applied.title}" to the live draft.`,
            },
          ],
          details: applied,
        };
      },
    },
    {
      name: 'discard_staged_change_set',
      label: 'Discard Staged Change Set',
      description:
        'Discard a pending staged change set so it no longer waits in the plan review queue.',
      parameters: Type.Object({
        changeSetId: Type.Optional(Type.String({ minLength: 1 })),
      }),
      async execute(_toolCallId, params) {
        const input = params as { changeSetId?: string };
        const pendingChangeSets = await getPendingStagedChangeSets({
          organizationId,
          workspaceId,
        });
        const changeSet =
          (input.changeSetId
            ? pendingChangeSets.find((item) => item.id === input.changeSetId) || null
            : pendingChangeSets[0] || null);

        if (!changeSet) {
          throw new Error(
            input.changeSetId
              ? 'Requested staged change set is not pending in this workspace.'
              : 'No pending staged change sets are available.'
          );
        }

        const discarded = await discardStagedChangeSet(
          {
            deviceId: originDeviceId,
            organizationId,
            userId: actorUserId,
          },
          {
            changeSetId: changeSet.id,
            workspaceId,
          }
        );
        rememberToolSummary(`Discarded staged changes "${discarded.title}".`);

        return {
          content: [
            {
              type: 'text',
              text: `Discarded staged changes "${discarded.title}".`,
            },
          ],
          details: discarded,
        };
      },
    },
    {
      name: 'start_preview',
      label: 'Start Preview',
      description:
        'Start the product preview for the current workspace draft or a selected version.',
      parameters: Type.Object({
        versionId: Type.Optional(Type.String({ minLength: 1 })),
      }),
      async execute(_toolCallId, params) {
        const input = params as { versionId?: string };
        const run = await startWorkspacePreview(
          {
            deviceId: originDeviceId,
            organizationId,
            userId: actorUserId,
          },
          {
            versionId: input.versionId || null,
            workspaceId,
          }
        );
        rememberToolSummary(
          run.previewUrl
            ? `Preview started at ${run.previewUrl}.`
            : 'Preview started.'
        );

        return {
          content: [
            {
              type: 'text',
              text: run.previewUrl
                ? `Preview started at ${run.previewUrl}.`
                : 'Preview started.',
            },
          ],
          details: run,
        };
      },
    },
    {
      name: 'stop_preview',
      label: 'Stop Preview',
      description:
        'Stop any running preview for the current workspace.',
      parameters: Type.Object({}),
      async execute() {
        const stopped = await stopWorkspacePreview(organizationId, workspaceId);
        rememberToolSummary(
          stopped.stoppedRunIds.length > 0
            ? `Stopped ${stopped.stoppedRunIds.length} preview run(s).`
            : 'No active preview was running.'
        );
        return {
          content: [
            {
              type: 'text',
              text:
                stopped.stoppedRunIds.length > 0
                  ? `Stopped ${stopped.stoppedRunIds.length} preview run(s).`
                  : 'No active preview was running.',
            },
          ],
          details: stopped,
        };
      },
    },
    {
      name: 'list_versions',
      label: 'List Versions',
      description:
        'List saved versions for the current workspace.',
      parameters: Type.Object({}),
      async execute() {
        const versions = await listWorkspaceVersions({
          organizationId,
          workspaceId,
        });

        return {
          content: [
            {
              type: 'text',
              text:
                versions.length > 0
                  ? versions
                      .map(
                        (version) =>
                          `- v${version.versionNum} ${version.title} (${version.versionType})`
                      )
                      .join('\n')
                  : 'No versions yet.',
            },
          ],
          details: versions,
        };
      },
    },
    {
      name: 'create_version',
      label: 'Save Version',
      description:
        'Save the current workspace files as a visible milestone version.',
      parameters: Type.Object({
        title: Type.Optional(Type.String({ minLength: 1 })),
      }),
      async execute(_toolCallId, params) {
        const input = params as { title?: string };
        const version = await createWorkspaceVersion(
          {
            deviceId: originDeviceId,
            organizationId,
            userId: actorUserId,
          },
          {
            sourceConversationId: conversationId,
            title: input.title,
            workspaceId,
          }
        );
        rememberToolSummary(`Saved milestone "${version.title}".`);

        return {
          content: [
            {
              type: 'text',
              text: `Saved milestone v${version.versionNum}.`,
            },
          ],
          details: version,
        };
      },
    },
    {
      name: 'branch_conversation',
      label: 'Continue in New Chat',
      description:
        'Create a new conversation from a message in the current thread.',
      parameters: Type.Object({
        messageId: Type.String({ minLength: 1 }),
        title: Type.Optional(Type.String({ minLength: 1 })),
      }),
      async execute(_toolCallId, params) {
        const input = params as { messageId: string; title?: string };
        const result = await branchConversation(
          {
            deviceId: originDeviceId,
            organizationId,
            userId: actorUserId,
          },
          {
            conversationId,
            messageId: input.messageId,
            title: input.title,
          }
        );

        return {
          content: [
            {
              type: 'text',
              text: `Opened a new chat continuation "${result.conversation.title}".`,
            },
          ],
          details: result,
        };
      },
    },
    ...(searchProvider
      ? [{
          name: 'search_web',
          label: 'Search Web',
          description:
            'Search the web for up-to-date information and return citations.',
          parameters: Type.Object({
            maxResults: Type.Optional(Type.Number()),
            query: Type.String({ minLength: 1 }),
          }),
          async execute(_toolCallId: string, params: unknown) {
            if (researchMode === 'light' && remainingSearchBudget <= 0) {
              return {
                content: [
                  {
                    type: 'text',
                    text: '[System] 联网搜索预算已耗尽，请基于现有搜索结果和已有知识继续完成任务。',
                  },
                ],
                details: {
                  budgetExhausted: true,
                },
              };
            }

            const input = params as { maxResults?: number; query: string };
            const result = await searchProvider.search({
              maxResults: input.maxResults,
              query: input.query,
            });
            if (researchMode === 'light') {
              remainingSearchBudget -= 1;
            }

            return {
              content: [
                {
                  type: 'text',
                  text: formatSearchResult(result),
                },
              ],
              details: result,
            };
          },
        } satisfies AgentTool]
      : []),
    {
      name: 'list_comment_threads',
      label: 'List Comment Threads',
      description:
        'List review threads for the current deliverable.',
      parameters: Type.Object({
        status: Type.Optional(
          Type.Union([
            Type.Literal('open'),
            Type.Literal('applied'),
            Type.Literal('resolved'),
            Type.Literal('all'),
          ])
        ),
      }),
      async execute(_toolCallId, params) {
        const input = params as {
          status?: 'open' | 'applied' | 'resolved' | 'all';
        };
        const status = input.status || 'open';

        const threads = await prisma.commentThread.findMany({
          where: {
            deletedAt: null,
            documentId: wikiId,
            organizationId,
            ...(status === 'all' ? {} : { status }),
          },
          include: {
            messages: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'asc' },
            },
            version: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 20,
        });

        return {
          content: [
            {
              type: 'text',
              text: threads.length > 0 ? summarizeThreads(threads) : 'No matching comment threads.',
            },
          ],
          details: {
            threads,
            wikiId,
          },
        };
      },
    },
    {
      name: 'reply_to_comment',
      label: 'Reply To Comment',
      description:
        'Append an assistant reply to a review thread.',
      parameters: Type.Object({
        content: Type.String({ minLength: 1 }),
        threadId: Type.String({ minLength: 1 }),
      }),
      async execute(_toolCallId, params) {
        const input = params as { content: string; threadId: string };
        const message = await prisma.commentMessage.create({
          data: {
            content: input.content,
            createdByUserId: actorUserId,
            model: 'agent:pi-agent-core',
            organizationId,
            originDeviceId,
            role: 'assistant',
            threadId: input.threadId,
          },
        });

        await prisma.commentThread.update({
          where: { id: input.threadId },
          data: {
            originDeviceId,
            revision: {
              increment: 1,
            },
            updatedAt: new Date(),
          },
        });

        return {
          content: [{ type: 'text', text: 'Added an assistant reply to the review thread.' }],
          details: message,
        };
      },
    },
    {
      name: 'resolve_comment',
      label: 'Resolve Comment',
      description:
        'Resolve a review thread and move it out of the active list.',
      parameters: Type.Object({
        threadId: Type.String({ minLength: 1 }),
      }),
      async execute(_toolCallId, params) {
        const input = params as { threadId: string };
        const existingThread = await prisma.commentThread.findUnique({
          where: { id: input.threadId },
          select: {
            documentId: true,
            id: true,
            versionId: true,
          },
        });

        if (!existingThread) {
          throw new Error('Thread not found.');
        }

        const versionId =
          existingThread.versionId ||
          (await getBoundVersionIdForWiki(existingThread.documentId));

        const thread = await prisma.commentThread.update({
          where: { id: input.threadId },
          data: {
            originDeviceId,
            resolvedAt: new Date(),
            revision: {
              increment: 1,
            },
            status: 'resolved',
            ...(versionId ? { versionId } : {}),
          },
          include: {
            messages: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'asc' },
            },
            version: true,
          },
        });

        return {
          content: [{ type: 'text', text: 'Resolved the review thread.' }],
          details: thread,
        };
      },
    },
    {
      name: 'add_knowledge_item',
      label: 'Add Knowledge Item',
      description:
        'Save a reusable knowledge note for the current deliverable workspace.',
      parameters: Type.Object({
        content: Type.String({ minLength: 1 }),
        title: Type.String({ minLength: 1 }),
      }),
      async execute(_toolCallId, params) {
        const input = params as { content: string; title: string };
        const item = await prisma.knowledgeItem.create({
          data: {
            content: input.content,
            createdByUserId: actorUserId,
            documentId: wikiId,
            organizationId,
            originDeviceId,
            sourceType: 'agent-note',
            title: input.title,
          },
        });

        return {
          content: [{ type: 'text', text: `Saved knowledge item "${item.title}".` }],
          details: item,
        };
      },
    },
  ];

  return {
    getLatestToolSummary: () =>
      toolSummaries.length > 0 ? toolSummaries.join(' ') : null,
    tools,
  };
}

function extractTitleFromMarkdown(markdown: string) {
  const heading = markdown.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim() || 'Generated Workspace';
}

function serializeWikiContent(content: string) {
  try {
    return plateToMarkdown(JSON.parse(content));
  } catch {
    return content;
  }
}

function summarizeThreads(
  threads: Array<{
    anchorText: string;
    id: string;
    messages: Array<{ role: string; content: string }>;
    status: string;
    version?: { versionNum: number } | null;
  }>
) {
  if (threads.length === 0) {
    return 'None.';
  }

  return threads
    .map((thread) => {
      const latestMessage = thread.messages[thread.messages.length - 1];
      const latestSummary = latestMessage
        ? `${latestMessage.role}: ${truncate(latestMessage.content)}`
        : 'No messages yet.';
      const versionLabel = thread.version ? `v${thread.version.versionNum}` : 'Draft';
      return `- ${thread.id} [${thread.status} / ${versionLabel}] "${truncate(thread.anchorText)}" -> ${latestSummary}`;
    })
    .join('\n');
}

function truncate(value: string, maxLength = 140) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function looksLikeHtmlDocument(content: string) {
  const normalized = content.trim().toLowerCase();
  return (
    normalized.startsWith('<!doctype html') ||
    (normalized.includes('<html') && normalized.includes('</html>')) ||
    (normalized.includes('<body') && normalized.includes('</body>'))
  );
}

function resolveWebTargetPath(params: {
  contentLooksHtml: boolean;
  existingPath: string | null;
  explicitPath: string | null;
}) {
  if (params.explicitPath) {
    return params.explicitPath;
  }

  if (
    params.contentLooksHtml &&
    (!params.existingPath ||
      params.existingPath === 'index.ts' ||
      params.existingPath === 'main.ts' ||
      params.existingPath === 'main.js')
  ) {
    return 'index.html';
  }

  return params.existingPath || 'index.html';
}

function getDefaultLiveDraftPath(deliverableType: DeliverableType) {
  if (deliverableType === 'code') {
    return 'index.ts';
  }

  return 'main';
}

function inferFileLanguageFromPath(filePath: string) {
  const extension = filePath.split('.').pop()?.toLowerCase();
  if (!extension || extension === filePath.toLowerCase()) {
    return null;
  }

  const languageMap: Record<string, string> = {
    css: 'css',
    html: 'html',
    js: 'javascript',
    json: 'json',
    jsx: 'javascript',
    md: 'markdown',
    mdx: 'markdown',
    ts: 'typescript',
    tsx: 'typescript',
    txt: 'text',
  };

  return languageMap[extension] || extension;
}

function mapWorkspaceFileRecord(file: {
  content: string;
  createdAt: Date;
  createdByUserId: string | null;
  deletedAt: Date | null;
  documentId: string;
  id: string;
  isPrimary: boolean;
  kind: string;
  language: string | null;
  name: string;
  organizationId: string;
  originDeviceId: string | null;
  parentId: string | null;
  path: string;
  role?: string | null;
  revision: number;
  sortOrder: number;
  type: string;
  updatedAt: Date;
}): WorkspaceFileData {
  return {
    content: file.content,
    createdAt: file.createdAt,
    createdByUserId: file.createdByUserId,
    deletedAt: file.deletedAt,
    id: file.id,
    isPrimary: file.isPrimary,
    kind: normalizeWorkspaceFileKind(file.kind),
    language: file.language,
    name: file.name,
    nodeType: file.type === 'folder' ? 'folder' : 'file',
    organizationId: file.organizationId,
    originDeviceId: file.originDeviceId,
    parentId: file.parentId,
    path: file.path,
    role: file.role === 'support' ? 'support' : 'deliverable',
    revision: file.revision,
    sortOrder: file.sortOrder,
    updatedAt: file.updatedAt,
    workspaceId: file.documentId,
  };
}

function normalizeWorkspaceFileKind(kind: string): WorkspaceFileData['kind'] {
  if (kind === 'richtext' || kind === 'markdown' || kind === 'text' || kind === 'code') {
    return kind;
  }

  return 'text';
}

function formatSearchResult(result: {
  answer: string;
  citations: Array<{ title: string | null; url: string; snippet: string | null }>;
  query: string;
  results: Array<{ title: string | null; url: string; snippet: string | null }>;
}) {
  const lines = [`Query: ${result.query}`];

  if (result.answer.trim()) {
    lines.push('', result.answer.trim());
  }

  const citations = result.citations.length > 0 ? result.citations : result.results;
  if (citations.length > 0) {
    lines.push('', 'Citations:');
    citations.slice(0, 6).forEach((citation) => {
      lines.push(
        `- ${citation.title || citation.url}${citation.snippet ? ` — ${truncate(citation.snippet, 120)}` : ''} (${citation.url})`
      );
    });
  }

  return lines.join('\n');
}
