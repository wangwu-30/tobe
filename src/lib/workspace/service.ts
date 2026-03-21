import {
  createWorkspaceFile as createWorkspaceFileCommand,
  ensureSupportUploadsFolder as ensureSupportUploadsFolderCommand,
  ensureWorkspaceFiles,
  updateWorkspaceFile as updateWorkspaceFileCommand,
} from '@/objects/file/commands';
import {
  createAssistantRun,
  createConversationForWorkspace,
  createConversationMessage,
  updateAssistantRun,
} from '@/objects/conversation/commands';
import {
  mapChatAttachment,
  mapConversation,
} from '@/objects/conversation/view';
import { getWorkspaceConversationState } from '@/objects/conversation/queries';
import {
  buildWorkspacePath,
  getDefaultFileName,
  getInitialFileContent,
  inferFileKind,
  inferFileLanguage,
  makeUniqueChildName,
  mapWorkspaceFile,
  parseVersionFiles,
  resolvePrimaryFile,
} from '@/objects/file/schema';
import {
  getNextProjectTreeSortOrder,
  resolveWorkspaceProjectId,
} from '@/objects/project/queries';
import { buildWorkspaceProjectSurface } from '@/objects/project/view';
import {
  createWorkspaceVersion as createWorkspaceVersionCommand,
  pruneWorkspaceRecoveryCheckpoints,
  replaceWorkspaceDraftWithVersionFiles,
  restoreWorkspaceVersion as restoreWorkspaceVersionCommand,
  setWorkspaceVersionPinned as setWorkspaceVersionPinnedCommand,
} from '@/objects/state/commands';
import {
  buildWorkspaceVersionSelection,
  listWorkspaceVersions,
  mapWorkspaceVersionWithLabels,
  mapWorkspaceVersionsWithLabels,
  resolveDraftBaseVersionIdForVersion,
} from '@/objects/state/queries';
import { hasStateLabelKind } from '@/objects/state/schema';
import { mapCommentMessage, mapCommentThread } from '@/objects/comment/view';
import {
  WorkspaceLockConflictError,
  ensureWorkspaceEditable,
} from '@/objects/workspace/commands';
import { getActiveWorkspaceLock } from '@/objects/workspace/queries';
import {
  mapWorkspace,
  mapWorkspaceVersion,
  buildWorkspaceRuntimeSurface,
  mapWorkspaceWithRelations,
} from '@/objects/workspace/view';
import { prisma } from '@/lib/db/prisma';
import { bindDraftThreadsToVersion } from '@/lib/comments/version-binding';
import { materializeWorkspaceMirror } from '@/lib/platform/mirror-manager';
import {
  listWorkspaceRuns,
  startWorkspacePreview,
} from '@/lib/platform/run-service';
import { recordSyncEvent } from '@/lib/platform/sync';
import { DEFAULT_APP_LANGUAGE, type AppLanguage } from '@/lib/i18n/language';
import {
  getWorkspacePlan,
  listStagedChangeSets,
} from '@/lib/workspace/planning';
import type {
  ChatAttachmentData,
  ProjectSummaryData,
  WorkspaceFileData,
  WorkspaceViewData,
} from '@/types';

type ActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

export { WorkspaceRecoveryPinLimitError } from '@/objects/state/commands';

export async function createWorkspaceWithConversation(
  actor: ActorContext,
  input?: {
    content?: string;
    conversationTitle?: string;
    fileName?: string;
    fileKind?: 'richtext' | 'markdown' | 'text' | 'code';
    title?: string;
  }
) {
  const title = input?.title?.trim() || 'Untitled Project';
  const initialFileName =
    input?.fileName?.trim() || getDefaultFileName(input?.fileKind || 'richtext');
  const initialFileKind = input?.fileKind || inferFileKind(initialFileName);
  const content =
    input?.content !== undefined ? input.content : getInitialFileContent(initialFileKind);

  const result = await prisma.$transaction(async (tx) => {
    const conversation = await tx.session.create({
      data: {
        organizationId: actor.organizationId,
        title: input?.conversationTitle?.trim() || title,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
        sourceType: 'chat',
      },
    });

    let workspace = await tx.document.create({
      data: {
        organizationId: actor.organizationId,
        sessionId: conversation.id,
        title,
        content,
        status: 'draft',
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
    });

    workspace = await tx.document.update({
      where: { id: workspace.id },
      data: {
        projectId: workspace.id,
        projectTitle: title,
      },
    });

    const primaryFile = await tx.workspaceFile.create({
      data: {
        organizationId: actor.organizationId,
        documentId: workspace.id,
        name: initialFileName,
        path: initialFileName,
        type: 'file',
        kind: initialFileKind,
        role: 'deliverable',
        language: inferFileLanguage(initialFileName),
        content,
        isPrimary: true,
        sortOrder: 0,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
    });

    const updatedConversation = await tx.session.update({
      where: { id: conversation.id },
      data: {
        activeFileId: primaryFile.id,
        wikiId: workspace.id,
      },
    });

    return {
      conversation: updatedConversation,
      primaryFile,
      workspace,
    };
  });

  await Promise.all([
    recordSyncEvent({
      actorUserId: actor.userId,
      entityId: result.workspace.id,
      entityType: 'workspace',
      organizationId: actor.organizationId,
      originDeviceId: actor.deviceId,
      payload: {
        op: 'create',
        title: result.workspace.title,
      },
      revision: result.workspace.revision,
    }),
    recordSyncEvent({
      actorUserId: actor.userId,
      entityId: result.primaryFile.id,
      entityType: 'workspace_file',
      organizationId: actor.organizationId,
      originDeviceId: actor.deviceId,
      payload: {
        op: 'create',
        name: result.primaryFile.name,
        workspaceId: result.workspace.id,
      },
      revision: result.primaryFile.revision,
    }),
    recordSyncEvent({
      actorUserId: actor.userId,
      entityId: result.conversation.id,
      entityType: 'conversation',
      organizationId: actor.organizationId,
      originDeviceId: actor.deviceId,
      payload: {
        op: 'create',
        title: result.conversation.title,
        workspaceId: result.workspace.id,
      },
      revision: result.conversation.revision,
    }),
  ]);

  await materializeWorkspaceMirror({
    organizationId: actor.organizationId,
    workspaceId: result.workspace.id,
  });

  return {
    conversation: mapConversation(result.conversation),
    primaryFile: mapWorkspaceFile(result.primaryFile),
    workspace: mapWorkspace(result.workspace),
  };
}

export async function storeMessageSupportAttachments(
  actor: ActorContext,
  input: {
    attachments: Array<{
      content: string;
      kind: ChatAttachmentData['kind'];
      mimeType: string | null;
      originalName: string;
      sizeBytes: number | null;
      source: ChatAttachmentData['source'];
      storageFormat: ChatAttachmentData['storageFormat'];
    }>;
    conversationId: string;
    messageId: string;
    workspaceId: string;
  }
) {
  const uploadRoot = await ensureSupportUploadsFolder(actor, input.workspaceId);
  const createdAttachments: ChatAttachmentData[] = [];

  for (const attachment of input.attachments) {
    const file = await createWorkspaceFileCommand(actor, {
      kind: 'text',
      name: attachment.originalName,
      parentId: uploadRoot.id,
      role: 'support',
      workspaceId: input.workspaceId,
    });

    const updatedFile = await updateWorkspaceFileCommand(actor, {
      content: attachment.content,
      fileId: file.id,
      role: 'support',
      workspaceId: input.workspaceId,
    });

    const created = await prisma.chatAttachment.create({
      data: {
        organizationId: actor.organizationId,
        sessionId: input.conversationId,
        messageId: input.messageId,
        documentId: input.workspaceId,
        fileId: updatedFile.id,
        kind: attachment.kind,
        source: attachment.source,
        storageFormat: attachment.storageFormat,
        mimeType: attachment.mimeType,
        originalName: attachment.originalName,
        sizeBytes: attachment.sizeBytes,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
      include: {
        file: {
          select: {
            path: true,
          },
        },
      },
    });

    createdAttachments.push(mapChatAttachment(created));
  }

  return createdAttachments;
}

export async function updateWorkspace(
  actor: ActorContext,
  input: {
    content?: string;
    projectFolderId?: string | null;
    treeSortOrder?: number;
    status?: string;
    title?: string;
    workspaceId: string;
  }
) {
  await ensureWorkspaceEditable(actor, input.workspaceId);
  const files = await ensureWorkspaceFiles(actor.organizationId, input.workspaceId);
  const primaryFile = resolvePrimaryFile(files);
  const workspaceRecord =
    input.projectFolderId !== undefined
      ? await prisma.document.findFirst({
          where: {
            deletedAt: null,
            id: input.workspaceId,
            organizationId: actor.organizationId,
          },
          select: { id: true, projectFolderId: true, projectId: true, treeSortOrder: true },
        })
      : null;

  if (input.projectFolderId !== undefined && !workspaceRecord) {
    throw new Error('Workspace not found.');
  }

  if (input.projectFolderId) {
    const projectFolder = await prisma.projectFolder.findFirst({
      where: {
        deletedAt: null,
        id: input.projectFolderId,
        organizationId: actor.organizationId,
        projectId: resolveWorkspaceProjectId(workspaceRecord!),
      },
      select: { id: true },
    });

    if (!projectFolder) {
      throw new Error('Project folder not found.');
    }
  }

  const nextTreeSortOrder =
    input.treeSortOrder !== undefined
      ? input.treeSortOrder
      : input.projectFolderId !== undefined &&
          workspaceRecord &&
          workspaceRecord.projectFolderId !== input.projectFolderId
        ? await getNextProjectTreeSortOrder({
            organizationId: actor.organizationId,
            parentFolderId: input.projectFolderId || null,
            projectId: resolveWorkspaceProjectId(workspaceRecord),
          })
        : undefined;

  if (input.content !== undefined && primaryFile) {
    await prisma.workspaceFile.update({
      where: { id: primaryFile.id },
      data: {
        content: input.content,
        originDeviceId: actor.deviceId,
        createdByUserId: actor.userId,
        revision: {
          increment: 1,
        },
      },
    });
  }

  const workspace = await prisma.document.update({
    where: { id: input.workspaceId },
    data: {
      ...(input.content !== undefined && { content: input.content }),
      ...(input.projectFolderId !== undefined && {
        projectFolderId: input.projectFolderId,
      }),
      ...(nextTreeSortOrder !== undefined && {
        treeSortOrder: nextTreeSortOrder,
      }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.title !== undefined && { title: input.title }),
      originDeviceId: actor.deviceId,
      createdByUserId: actor.userId,
      revision: {
        increment: 1,
      },
      updatedAt: new Date(),
    },
  });

  await recordSyncEvent({
    actorUserId: actor.userId,
    entityId: workspace.id,
    entityType: 'workspace',
    organizationId: actor.organizationId,
    originDeviceId: actor.deviceId,
    payload: {
      op: 'update',
      status: input.status,
      projectFolderId: input.projectFolderId,
      treeSortOrder: nextTreeSortOrder,
      title: input.title,
      hasContent: input.content !== undefined,
    },
    revision: workspace.revision,
  });

  if (input.content !== undefined) {
    await materializeWorkspaceMirror({
      organizationId: actor.organizationId,
      workspaceId: input.workspaceId,
    });
  }

  return mapWorkspace(workspace);
}

export async function continueWorkspaceFromVersion(
  actor: ActorContext,
  input: {
    activeFileId?: string | null;
    parentConversationId?: string | null;
    safetyCheckpointTitle?: string;
    title?: string;
    versionId: string;
    workspaceId: string;
  }
) {
  await ensureWorkspaceEditable(actor, input.workspaceId);

  const sourceVersion = await prisma.version.findFirst({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      id: input.versionId,
      organizationId: actor.organizationId,
    },
    include: {
      labels: {
        where: {
          deletedAt: null,
        },
      },
    },
  });

  if (!sourceVersion) {
    throw new Error('Version not found.');
  }

  const safetyCheckpointRecord = await createWorkspaceVersionCommand(
    actor,
    {
      bindDraftThreads: true,
      recovery: true,
      title: input.safetyCheckpointTitle || 'Safety Checkpoint before Continue',
      workspaceId: input.workspaceId,
    },
    {
      bindDraftThreadsToVersion,
      ensureWorkspaceEditable,
      recordSyncEvent,
    }
  );
  const safetyCheckpoint = await mapWorkspaceVersionWithLabels({
    organizationId: actor.organizationId,
    version: safetyCheckpointRecord,
  });

  const workspace = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: input.workspaceId,
      organizationId: actor.organizationId,
    },
    select: {
      currentVersion: true,
      id: true,
      title: true,
    },
  });

  if (!workspace) {
    throw new Error('Workspace not found.');
  }

  const branchTitle = input.title?.trim() || sourceVersion.title || workspace.title;
  const branchVersion = await prisma.$transaction(async (tx) => {
    const nextVersionNum = workspace.currentVersion + 1;
    await tx.label.updateMany({
      where: {
        deletedAt: null,
        kind: 'head',
        organizationId: actor.organizationId,
        versionId: sourceVersion.id,
      },
      data: {
        deletedAt: new Date(),
        originDeviceId: actor.deviceId,
        revision: {
          increment: 1,
        },
      },
    });

    const created = await tx.version.create({
      data: {
        organizationId: actor.organizationId,
        documentId: workspace.id,
        versionNum: nextVersionNum,
        content: sourceVersion.content,
        title: branchTitle,
        parentVersionId: sourceVersion.id,
        sourceSessionId: input.parentConversationId || null,
        sourceMessageId: null,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
    });

    await tx.label.createMany({
      data: [
        {
          organizationId: actor.organizationId,
          versionId: created.id,
          kind: 'milestone',
          name: created.title,
          createdByUserId: actor.userId,
          originDeviceId: actor.deviceId,
        },
        {
          organizationId: actor.organizationId,
          versionId: created.id,
          kind: 'head',
          name: created.title,
          createdByUserId: actor.userId,
          originDeviceId: actor.deviceId,
        },
      ],
    });

    await tx.document.update({
      where: { id: workspace.id },
      data: {
        currentVersion: nextVersionNum,
        originDeviceId: actor.deviceId,
        revision: {
          increment: 1,
        },
      },
    });

    return created;
  });

  await recordSyncEvent({
    actorUserId: actor.userId,
    entityId: branchVersion.id,
    entityType: 'workspace_version',
    organizationId: actor.organizationId,
    originDeviceId: actor.deviceId,
    payload: {
      op: 'create',
      versionNum: branchVersion.versionNum,
      workspaceId: workspace.id,
      sourceConversationId: input.parentConversationId || null,
      sourceMessageId: null,
    },
    revision: branchVersion.revision,
  });

  const { activeFileId } = await replaceWorkspaceDraftWithVersionFiles(
    actor,
    {
      draftBaseVersionId: branchVersion.id,
      hadActivePreview: (
        await listWorkspaceRuns({
          organizationId: actor.organizationId,
          workspaceId: input.workspaceId,
        })
      ).some(
        (run) =>
          run.kind === 'preview' &&
          (run.status === 'pending' || run.status === 'running')
      ),
      preferredActiveFileId: input.activeFileId || null,
      versionFiles: parseVersionFiles(branchVersion.content),
      workspaceId: input.workspaceId,
    },
    {
      materializeWorkspaceMirror,
      startWorkspacePreview,
    }
  );

  const conversation = await createConversationForWorkspace(actor, {
    activeFileId,
    baseVersionId: branchVersion.id,
    parentConversationId: input.parentConversationId,
    sourceType: 'version',
    title: branchTitle,
    workspaceId: input.workspaceId,
  });
  const mappedBranchVersion = await mapWorkspaceVersionWithLabels({
    organizationId: actor.organizationId,
    version: branchVersion,
  });

  return {
    baseVersion: mappedBranchVersion,
    conversation,
    safetyCheckpoint,
  };
}

export async function switchWorkspaceToVersionBranch(
  actor: ActorContext,
  input: {
    activeFileId?: string | null;
    parentConversationId?: string | null;
    safetyCheckpointTitle?: string;
    title?: string;
    versionId: string;
    workspaceId: string;
  }
) {
  await ensureWorkspaceEditable(actor, input.workspaceId);

  const sourceVersion = await prisma.version.findFirst({
    where: {
      deletedAt: null,
      documentId: input.workspaceId,
      id: input.versionId,
      organizationId: actor.organizationId,
    },
    include: {
      labels: {
        where: {
          deletedAt: null,
        },
      },
    },
  });

  if (!sourceVersion) {
    throw new Error('Version not found.');
  }

  if (!hasStateLabelKind(sourceVersion.labels, 'head')) {
    throw new Error('Only visible branch heads can become the current draft base.');
  }

  const safetyCheckpointRecord = await createWorkspaceVersionCommand(
    actor,
    {
      bindDraftThreads: true,
      recovery: true,
      title:
        input.safetyCheckpointTitle || 'Safety Checkpoint before Branch Switch',
      workspaceId: input.workspaceId,
    },
    {
      bindDraftThreadsToVersion,
      ensureWorkspaceEditable,
      recordSyncEvent,
    }
  );
  const safetyCheckpoint = await mapWorkspaceVersionWithLabels({
    organizationId: actor.organizationId,
    version: safetyCheckpointRecord,
  });

  const { activeFileId } = await replaceWorkspaceDraftWithVersionFiles(
    actor,
    {
      draftBaseVersionId: sourceVersion.id,
      hadActivePreview: (
        await listWorkspaceRuns({
          organizationId: actor.organizationId,
          workspaceId: input.workspaceId,
        })
      ).some(
        (run) =>
          run.kind === 'preview' &&
          (run.status === 'pending' || run.status === 'running')
      ),
      preferredActiveFileId: input.activeFileId || null,
      versionFiles: parseVersionFiles(sourceVersion.content),
      workspaceId: input.workspaceId,
    },
    {
      materializeWorkspaceMirror,
      startWorkspacePreview,
    }
  );

  const conversation = await createConversationForWorkspace(actor, {
    activeFileId,
    baseVersionId: sourceVersion.id,
    parentConversationId: input.parentConversationId,
    sourceType: 'version',
    title: input.title?.trim() || sourceVersion.title,
    workspaceId: input.workspaceId,
  });

  return {
    baseVersion: mapWorkspaceVersion(sourceVersion),
    conversation,
    safetyCheckpoint,
  };
}
export async function getWorkspaceView(params: {
  conversationId?: string | null;
  fileId?: string | null;
  language?: AppLanguage | null;
  organizationId: string;
  versionId?: string | null;
  workspaceId: string;
}): Promise<WorkspaceViewData> {
  const workspace = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: params.workspaceId,
      organizationId: params.organizationId,
    },
    include: {
      workspacePlan: {
        select: {
          deliverableType: true,
        },
      },
    },
  });

  if (!workspace) {
    return {
      workspace: null,
      currentProject: null,
      projectFolders: [],
      projectDeliverables: [],
      deliverable: null,
      files: [],
      versions: [],
      visibleVersions: [],
      versionFiles: [],
      currentFile: null,
      currentConversation: null,
      latestConversation: null,
      conversationTree: [],
      conversationRuns: [],
      activeAssistantRun: null,
      activePreviewRun: null,
      selectedVersion: null,
      stagedChangeSets: [],
      workspacePlan: null,
      workflowStatus: null,
      activeLock: null,
    };
  }

  const [
    files,
    versions,
    activeLock,
    workspacePlan,
    projectDocuments,
    projectFolders,
    stagedChangeSets,
    workspaceRuns,
  ] = await Promise.all([
    ensureWorkspaceFiles(params.organizationId, workspace.id),
    listWorkspaceVersions({
      organizationId: params.organizationId,
      workspaceId: workspace.id,
    }),
    getActiveWorkspaceLock(params.organizationId, workspace.id),
    getWorkspacePlan({
      organizationId: params.organizationId,
      workspaceId: workspace.id,
    }),
    prisma.document.findMany({
      where: {
        deletedAt: null,
        organizationId: params.organizationId,
        OR: [
          { id: resolveWorkspaceProjectId(workspace) },
          { projectId: resolveWorkspaceProjectId(workspace) },
        ],
      },
      include: {
        files: {
          where: {
            deletedAt: null,
            isPrimary: true,
            role: 'deliverable',
          },
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
        workspacePlan: true,
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.projectFolder.findMany({
      where: {
        deletedAt: null,
        organizationId: params.organizationId,
        projectId: resolveWorkspaceProjectId(workspace),
      },
      orderBy: { updatedAt: 'desc' },
    }),
    listStagedChangeSets({
      organizationId: params.organizationId,
      workspaceId: workspace.id,
    }),
    listWorkspaceRuns({
      organizationId: params.organizationId,
      workspaceId: workspace.id,
    }),
  ]);

  const workspaceFiles = files.map(mapWorkspaceFile);
  const pendingChangeSetsByConversation = new Map<string, number>();
  stagedChangeSets
    .filter((changeSet) => changeSet.status === 'pending' && changeSet.conversationId)
    .forEach((changeSet) => {
      const conversationId = changeSet.conversationId!;
      pendingChangeSetsByConversation.set(
        conversationId,
        (pendingChangeSetsByConversation.get(conversationId) || 0) + 1
      );
    });
  const {
    activeAssistantRun,
    conversationRuns,
    conversationTree,
    currentConversation,
    latestConversation,
  } = await getWorkspaceConversationState({
    conversationId: params.conversationId,
    organizationId: params.organizationId,
    pendingChangeSetsByConversation,
    workspace,
    workspaceId: workspace.id,
  });

  const {
    currentFile,
    selectedVersion,
    versionFiles,
    visibleVersions,
  } = buildWorkspaceVersionSelection({
    conversationActiveFileId: currentConversation?.activeFileId,
    requestedFileId: params.fileId,
    selectedVersionId: params.versionId,
    versions,
    workspaceFiles,
  });
  const {
    activePreviewRun,
    workflowStatus,
    deliverable,
    workspacePlan: hydratedWorkspacePlan,
  } = buildWorkspaceRuntimeSurface({
    activeAssistantRun,
    language: params.language || DEFAULT_APP_LANGUAGE,
    stagedChangeSets,
    versions,
    workspace,
    workspaceFiles,
    workspacePlan,
    workspaceRuns,
  });
  const {
    currentProject,
    projectDeliverables,
    projectFolders: mappedProjectFolders,
  } = buildWorkspaceProjectSurface({
    projectDocuments,
    projectFolders,
    workspace,
  });

  return {
    workspace: mapWorkspaceWithRelations({
      ...workspace,
      deliverable,
      files,
      stagedChangeSets,
      versions,
      workspacePlan: hydratedWorkspacePlan,
    }),
    currentProject,
    projectFolders: mappedProjectFolders,
    projectDeliverables,
    deliverable,
    files: workspaceFiles,
    versions,
    visibleVersions,
    versionFiles,
    currentFile,
    currentConversation,
    latestConversation,
    conversationTree,
    conversationRuns,
    activeAssistantRun,
    activePreviewRun,
    selectedVersion,
    stagedChangeSets,
    workspacePlan: hydratedWorkspacePlan,
    workflowStatus,
    activeLock,
  };
}

export async function getConversationWorkspace(params: {
  conversationId: string;
  organizationId: string;
}) {
  const conversation = await prisma.session.findFirst({
    where: {
      deletedAt: null,
      id: params.conversationId,
      organizationId: params.organizationId,
    },
    include: {
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      },
      wiki: true,
    },
  });

  if (!conversation || !conversation.wiki) {
    return null;
  }

  const view = await getWorkspaceView({
    conversationId: conversation.id,
    organizationId: params.organizationId,
    workspaceId: conversation.wiki.id,
  });

  return {
    conversation: view.currentConversation,
    workspace: view.workspace,
  };
}

async function ensureSupportUploadsFolder(
  actor: ActorContext,
  workspaceId: string
) {
  return ensureSupportUploadsFolderCommand(actor, workspaceId, {
    ensureWorkspaceEditable,
  });
}
