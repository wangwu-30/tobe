import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import { prisma } from '@/lib/db/prisma';
import { safeJsonParse } from '@/framework/resilience';
import {
  formatProjectAiContext,
  loadProjectAiContextData,
} from '@/lib/ai/project-context';
import { plateToMarkdown } from '@/lib/ai/serializer';
import {
  getBoundVersionIdForWiki,
  bindDraftThreadsToVersion,
} from '@/lib/comments/version-binding';
import {
  listWorkspaceRuns,
  startWorkspacePreview,
  stopWorkspacePreview,
} from '@/lib/platform/run-service';
import { recordSyncEvent } from '@/lib/platform/sync';
import {
  getProjectNodeCatalog,
  readNodeContent,
} from '@/lib/workspace/node';
import {
  normalizeStoredDeliverableType,
  parseStoredDeliverableType,
} from '@/lib/workspace/deliverable-types';
import { deriveRenderAs } from '@/lib/workspace/render-as';
import { listWorkspaceFiles } from '@/objects/file/queries';
import {
  listWorkspaceVersions,
  mapWorkspaceVersionWithLabels,
} from '@/objects/state/queries';
import {
  createWorkspaceVersion as createWorkspaceVersionCommand,
} from '@/objects/state/commands';
import { branchConversation } from '@/objects/conversation/commands';
import { detectWorkspacePreviewCapability } from '@/lib/workspace/preview';
import { inferDeliverableType } from '@/lib/workspace/planning';
import { getPendingStagedChangeSets } from '@/lib/workspace/staged-changes';
import {
  createNote,
  listNotes,
  splitNotesByKind,
} from '@/objects/note';
import { canAccessProjectFromProject } from '@/objects/project-mount';
import { ensureWorkspaceEditable } from '@/objects/workspace/commands';
import { createStartExecutionJobTool } from '@/agent/tools/execution/start-execution-job';
import { createPublishTeamTaskTool } from '@/agent/tools/team-task/publish-team-task';
import { createProposeDocumentChangeTool } from '@/agent/tools/document/propose-document-change';
import type { AgentToolConfirmationAuthority } from '@/agent/tool-policy';
import type { SearchProvider } from '@/lib/search/types';
import type {
  DeliverableType,
  RenderAs,
  ResearchMode,
} from '@/types';

type DebugWorkspacePlanDetails = {
  activeStageId: string | null;
  constraints: string | null;
  deliverableType: DeliverableType;
  goal: string;
  id: string;
  lastProgressNote: string | null;
  renderAs: RenderAs;
  status: string;
  storedDeliverableType: ReturnType<typeof parseStoredDeliverableType>;
  styleGuide: string | null;
  version: number;
};

type ResultShapeFile = {
  isPrimary?: boolean | null;
  kind: string | null;
  path: string;
};

type CreateWorkspaceAgentToolsParams = {
  actorUserId: string;
  confirmationAuthority?: AgentToolConfirmationAuthority;
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
  confirmationAuthority,
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

  const rememberToolSummary = (summary: string) => {
    const normalized = summary.trim();
    if (!normalized || toolSummaries.includes(normalized)) {
      return;
    }

    toolSummaries.push(normalized);
  };

  const loadCurrentProjectContext = async () =>
    loadProjectAiContextData({
      organizationId,
      workspaceId,
    });

  const assertAccessibleProject = async (targetProjectId: string) => {
    const projectContext = await loadCurrentProjectContext();
    if (!projectContext) {
      throw new Error('No current project context.');
    }

    const hasAccess = await canAccessProjectFromProject({
      organizationId,
      sourceProjectId: projectContext.id,
      targetProjectId,
    });

    if (!hasAccess) {
      throw new Error('The requested project is not mounted into the current project.');
    }

    return projectContext;
  };

  const formatProjectNodeCatalog = (params: {
    currentNodeId?: string | null;
    nodes: Array<{
      id: string;
      isCurrent: boolean;
      renderAs: string;
      status: string;
      title: string;
    }>;
    projectId: string;
    projectTitle: string;
  }) => [
    `Project: ${params.projectTitle} (${params.nodes.length} node${params.nodes.length === 1 ? '' : 's'}) [projectId: ${params.projectId}]`,
    'Project nodes:',
    ...params.nodes.map((node) => {
      const currentPrefix =
        node.id === params.currentNodeId || node.isCurrent ? '[current] ' : '';
      return `- ${currentPrefix}${node.title} [workspaceId: ${node.id}] (shape: ${node.renderAs}, status: ${node.status})`;
    }),
  ].join('\n');

  const assertAccessibleNodeTarget = async (params: {
    projectId: string;
    targetNodeId: string;
  }) => {
    const projectContext =
      params.projectId === (await loadCurrentProjectContext())?.id
        ? await loadCurrentProjectContext()
        : await assertAccessibleProject(params.projectId);

    if (!projectContext) {
      throw new Error('No current project context.');
    }

    if (params.projectId === projectContext.id) {
      const targetDeliverable = projectContext.deliverables.find(
        (deliverable) => deliverable.id === params.targetNodeId
      );

      if (!targetDeliverable) {
        throw new Error('The requested node is not in the current project.');
      }

      return {
        projectContext,
        targetProjectId: projectContext.id,
      };
    }

    const catalog = await getProjectNodeCatalog({
      organizationId,
      projectId: params.projectId,
    });

    if (!catalog) {
      throw new Error('The requested mounted project was not found.');
    }

    const targetDeliverable = catalog.nodes.find(
      (deliverable) => deliverable.id === params.targetNodeId
    );

    if (!targetDeliverable) {
      throw new Error('The requested node is not in the mounted project.');
    }

    return {
      projectContext,
      targetProjectId: catalog.id,
    };
  };

  const executeListProjectNodes = async (input?: { projectId?: string }) => {
    const projectContext = await loadCurrentProjectContext();
    if (!projectContext) {
      return {
        content: [{ type: 'text' as const, text: 'No current project context.' }],
        details: null,
      };
    }

    const requestedProjectId = input?.projectId?.trim() || projectContext.id;
    if (requestedProjectId === projectContext.id) {
      return {
        content: [
          {
            type: 'text' as const,
            text: formatProjectNodeCatalog({
              currentNodeId: projectContext.currentWorkspaceId,
              nodes: projectContext.deliverables,
              projectId: projectContext.id,
              projectTitle: projectContext.title,
            }),
          },
        ],
        details: projectContext,
      };
    }

    await assertAccessibleProject(requestedProjectId);
    const catalog = await getProjectNodeCatalog({
      organizationId,
      projectId: requestedProjectId,
    });
    const mountedProjectSummary = projectContext.mountedProjects.find(
      (project) => project.id === requestedProjectId
    );
    if (!catalog) {
      throw new Error('The requested mounted project was not found.');
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: formatProjectNodeCatalog({
            nodes: catalog.nodes,
            projectId: catalog.id,
            projectTitle: mountedProjectSummary?.title || catalog.title,
          }),
        },
      ],
      details: {
        projectId: catalog.id,
        projectTitle: mountedProjectSummary?.title || catalog.title,
        nodes: catalog.nodes,
      },
    };
  };

  const executeReadNodeContent = async (input: {
    fileId?: string;
    nodeId?: string;
    path?: string;
    projectId?: string;
    targetWorkspaceId?: string;
  }) => {
    const targetNodeId = input.nodeId || input.targetWorkspaceId || '';
    if (!targetNodeId) {
      throw new Error('A target node id is required.');
    }

    const projectContext = await loadCurrentProjectContext();
    if (!projectContext) {
      throw new Error('No current project context.');
    }

    const targetProjectId = input.projectId?.trim() || projectContext.id;
    const accessibleTarget = await assertAccessibleNodeTarget({
      projectId: targetProjectId,
      targetNodeId,
    });
    const nodeContent = await readNodeContent({
      fileId: input.fileId,
      organizationId,
      path: input.path,
      projectId: accessibleTarget.targetProjectId,
      targetNodeId,
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: [
            `Project ID: ${accessibleTarget.targetProjectId}`,
            `Node: ${nodeContent.node.title}`,
            `Node ID: ${nodeContent.node.id}`,
            `Result shape: ${nodeContent.node.renderAs}`,
            `Status: ${nodeContent.node.status}`,
            '',
            'Files:',
            nodeContent.files
              .filter((file) => file.nodeType === 'file')
              .map(
                (file) =>
                  `- ${file.path} (${file.kind}${file.isPrimary ? ', primary' : ''})`
              )
              .join('\n'),
            '',
            `# ${nodeContent.file.path}`,
            '',
            nodeContent.file.content,
          ].join('\n'),
        },
      ],
      details: {
        file: nodeContent.file,
        files: nodeContent.files,
        targetProjectId: accessibleTarget.targetProjectId,
        targetDeliverable: nodeContent.node,
        targetNode: nodeContent.node,
      },
    };
  };

  const buildScopedNoteTargets = (projectId?: string | null) => [
    ...(wikiId ? [{ scope: 'deliverable' as const, scopeId: wikiId }] : []),
    ...(projectId ? [{ scope: 'project' as const, scopeId: projectId }] : []),
    ...(actorUserId ? [{ scope: 'user' as const, scopeId: actorUserId }] : []),
  ];

  const workspaceStateActor = {
    deviceId: originDeviceId,
    organizationId,
    userId: actorUserId,
  };

  const createVersion = async (input: {
    bindDraftThreads?: boolean;
    recovery?: boolean;
    sourceConversationId?: string | null;
    sourceMessageId?: string | null;
    title?: string;
    workspaceId: string;
  }) =>
    mapWorkspaceVersionWithLabels({
      organizationId,
      version: await createWorkspaceVersionCommand(workspaceStateActor, input, {
        bindDraftThreadsToVersion,
        ensureWorkspaceEditable,
        recordSyncEvent,
      }),
    });

  const resolveContextScopeLabel = (
    note: { scope: string; scopeId: string },
    projectId?: string | null
  ) => {
    if (note.scope === 'deliverable' && note.scopeId === wikiId) {
      return 'current';
    }

    if (note.scope === 'project' && projectId && note.scopeId === projectId) {
      return 'project';
    }

    return note.scope === 'user' ? 'user' : note.scope;
  };

  const resolveWorkspacePresentation = (params: {
    content: string;
    files: ResultShapeFile[];
    goal: string | null | undefined;
    title: string | null | undefined;
    workspacePlanDeliverableType: string | null | undefined;
  }): {
    deliverableType: DeliverableType;
    renderAs: RenderAs;
    storedDeliverableType: ReturnType<typeof parseStoredDeliverableType>;
  } => {
    const primaryFile =
      params.files.find((file) => file.isPrimary) || params.files[0] || null;
    const storedDeliverableType = parseStoredDeliverableType(
      params.workspacePlanDeliverableType || null
    );
    const deliverableType =
      normalizeStoredDeliverableType(params.workspacePlanDeliverableType) ||
      inferDeliverableType({
        explicitType: params.workspacePlanDeliverableType || null,
        fileKind: primaryFile?.kind || null,
        files: params.files.map((file) => ({
          kind: file.kind,
          path: file.path,
        })),
        goal: params.goal || params.title || 'Current deliverable',
        title: primaryFile?.path || params.title || 'Current deliverable',
      });

    return {
      deliverableType,
      renderAs: deriveRenderAs({
        content: params.content,
        deliverableType,
        storedDeliverableType,
      }),
      storedDeliverableType,
    };
  };

  const mapDebugWorkspacePlanDetails = (
    workspacePlan:
      | {
          activeStageId?: string | null;
          constraints?: string | null;
          deliverableType?: string | null;
          goal: string;
          id: string;
          lastProgressNote?: string | null;
          status: string;
          styleGuide?: string | null;
          version: number;
        }
      | null
      | undefined,
    workspaceSurface?: {
      content?: string | null;
      files?: ResultShapeFile[] | null;
      title?: string | null;
    }
  ): DebugWorkspacePlanDetails | null => {
    if (!workspacePlan) {
      return null;
    }

    const presentation = resolveWorkspacePresentation({
      content: workspaceSurface?.content || '',
      files: workspaceSurface?.files || [],
      goal: workspacePlan.goal,
      title: workspaceSurface?.title || workspacePlan.goal,
      workspacePlanDeliverableType: workspacePlan.deliverableType,
    });

    return {
      activeStageId: workspacePlan.activeStageId || null,
      constraints: workspacePlan.constraints || null,
      deliverableType: presentation.deliverableType,
      goal: workspacePlan.goal,
      id: workspacePlan.id,
      lastProgressNote: workspacePlan.lastProgressNote || null,
      renderAs: presentation.renderAs,
      status: workspacePlan.status,
      storedDeliverableType: presentation.storedDeliverableType,
      styleGuide: workspacePlan.styleGuide || null,
      version: workspacePlan.version,
    };
  };

  const tools: AgentTool[] = [
    {
      name: 'get_workspace_context',
      label: 'Get Workspace Context',
      description:
        'Inspect the current deliverable workspace, including project deliverable summaries, the live draft, shared brief, visible versions, staged changes, review threads, and reusable notes.',
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
        const notes = await listNotes({
          activeOnly: true,
          organizationId,
          scopeTargets: buildScopedNoteTargets(projectContext?.id || null),
          take: 20,
        });
        const { knowledgeNotes, memoryNotes } = splitNotesByKind(notes);
        const previewCapability = detectWorkspacePreviewCapability(wiki?.files || []);
        const activePreviewRun =
          workspaceRuns.find(
            (run) =>
              run.kind === 'preview' &&
              (run.status === 'pending' || run.status === 'running')
          ) || null;
        const workspacePresentation =
          wiki || workspacePlan
            ? resolveWorkspacePresentation({
                content: wiki?.content || '',
                files:
                  wiki?.files.map((file) => ({
                    isPrimary: file.isPrimary,
                    kind: file.kind,
                    path: file.path,
                  })) || [],
                goal: workspacePlan?.goal || wiki?.title,
                title: wiki?.title || workspacePlan?.goal,
                workspacePlanDeliverableType: workspacePlan?.deliverableType,
              })
            : null;
        const workspaceResultShape = workspacePresentation?.renderAs || null;

        const summary = [
          `Conversation: ${conversation?.title || conversationId}`,
          wiki
            ? `Current Node Workspace: ${wiki.title} (${wiki.status}, v${wiki.currentVersion})`
            : 'Current Node Workspace: none',
          '',
          'Current project nodes:',
          projectContext ? formatProjectAiContext(projectContext, { includeWorkspaceIds: true }) : 'No current project context.',
          '',
          'Current node content:',
          wiki ? serializeWikiContent(wiki.content) : 'No current node yet.',
          '',
          'Workspace brief:',
          workspacePlan
            ? [
                `- Goal: ${workspacePlan.goal}`,
                workspaceResultShape ? `- Result shape: ${workspaceResultShape}` : null,
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
                    `- [${file.type}] ${file.path} (${file.kind}${file.isPrimary ? ', primary content file' : ''})`
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
            : 'No current node yet.',
          '',
          'Pending verification review threads:',
          wiki
            ? summarizeThreads(
                wiki.threads.filter((thread) => thread.status === 'applied')
              )
            : 'No current node yet.',
          '',
          'Resolved review threads:',
          wiki
            ? summarizeThreads(wiki.threads.filter((thread) => thread.status === 'resolved'))
            : 'No current node yet.',
          '',
          'Knowledge items:',
          knowledgeNotes.length > 0
            ? knowledgeNotes
                .map(
                  (item) =>
                    `- [${resolveContextScopeLabel(item, projectContext?.id || null)}] ${item.title || 'Untitled'}: ${item.content}`
                )
                .join('\n')
            : 'None.',
          '',
          'Active memories:',
          memoryNotes.length > 0
            ? memoryNotes
                .map(
                  (memory) =>
                    `- [${resolveContextScopeLabel(memory, projectContext?.id || null)} / ${memory.kind}] ${memory.content}`
                )
                .join('\n')
            : 'None.',
        ].join('\n');

        return {
          content: [{ type: 'text', text: summary }],
          details: {
            conversation,
            notes,
            projectContext,
            stagedChangeSets,
            workspaceRuns,
            workspacePlan: mapDebugWorkspacePlanDetails(workspacePlan, {
              content: wiki?.content || '',
              files:
                wiki?.files.map((file) => ({
                  isPrimary: file.isPrimary,
                  kind: file.kind,
                  path: file.path,
                })) || [],
              title: wiki?.title || workspacePlan?.goal || null,
            }),
            wiki,
          },
        };
      },
    },
    {
      name: 'list_project_nodes',
      label: 'List Project Nodes',
      description:
        'List nodes in the current project, or in a mounted project when `projectId` is provided, including workspace ids for follow-up reads.',
      parameters: Type.Object({
        projectId: Type.Optional(Type.String({ minLength: 1 })),
      }),
      async execute(_toolCallId, params) {
        return executeListProjectNodes(
          params as {
            projectId?: string;
          }
        );
      },
    },
    {
      name: 'read_node_content',
      label: 'Read Node Content',
      description:
        'Read the primary file or a specific file from another node in the current project, or from a mounted project when `projectId` is provided.',
      parameters: Type.Object({
        fileId: Type.Optional(Type.String({ minLength: 1 })),
        nodeId: Type.String({ minLength: 1 }),
        path: Type.Optional(Type.String({ minLength: 1 })),
        projectId: Type.Optional(Type.String({ minLength: 1 })),
      }),
      async execute(_toolCallId, params) {
        return executeReadNodeContent(
          params as {
            fileId?: string;
            nodeId: string;
            path?: string;
            projectId?: string;
          }
        );
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

        const version = await createVersion({
          sourceConversationId: conversationId,
          title: wiki.title,
          workspaceId,
        });
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
    createProposeDocumentChangeTool({
      actorUserId,
      organizationId,
      originDeviceId,
      rememberSummary: rememberToolSummary,
      sessionId: conversationId,
      sourceType: 'workspace-assistant',
      workspaceId,
    }) as AgentTool,
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
                          `- v${version.versionNum} ${version.title} (${version.visible ? 'milestone' : version.recoveryKind === 'pinned' ? 'pinned recovery point' : 'recovery point'})`
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
        const version = await createVersion({
          sourceConversationId: conversationId,
          title: input.title,
          workspaceId,
        });
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
    createPublishTeamTaskTool({
      actorUserId,
      organizationId,
      originDeviceId,
      rememberSummary: rememberToolSummary,
      resolveProjectId: async () => (await loadCurrentProjectContext())?.id || null,
      workspaceId,
    }) as AgentTool,
    createStartExecutionJobTool({
      actorUserId,
      confirmationAuthority,
      conversationId,
      organizationId,
      originDeviceId,
      rememberSummary: rememberToolSummary,
      workspaceId,
    }) as AgentTool,
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
        const item = await createNote({
          content: input.content,
          createdByUserId: actorUserId,
          kind: 'knowledge',
          organizationId,
          originDeviceId,
          scope: 'deliverable',
          scopeId: wikiId,
          source: 'agent-note',
          title: input.title,
        });

        return {
          content: [{ type: 'text', text: `Saved knowledge item "${item.title || 'Untitled'}".` }],
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
  const parsed = safeJsonParse<unknown>(content, null);
  return Array.isArray(parsed) ? plateToMarkdown(parsed) : content;
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
