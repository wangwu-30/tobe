import fs from 'node:fs/promises';
import path from 'node:path';

import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/prisma';
import { materializeWorkspaceMirror } from '@/lib/platform/mirror-manager';
import { recordSyncEvent } from '@/lib/platform/sync';
import { createInitialWorkspacePlan } from '@/lib/workspace/planning';
import {
  formatWorkflowPlaybookForPrompt,
  materializeWorkflowPlaybookSelection,
} from '@/lib/workflows/service';
import { mapConversation } from '@/objects/conversation/view';
import { mapWorkspaceFile } from '@/objects/file/schema';
import {
  getNextProjectTreeSortOrder,
  PROJECT_TREE_SORT_STEP,
} from '@/objects/project/queries';
import {
  ensureProjectRoom,
  postRoomMessageInTransaction,
} from '@/objects/room';
import { mapWorkspace } from '@/objects/workspace/view';
import {
  buildCompanionWebWorkspaceTitle,
  buildWorkspaceFileSeeds,
  slugProjectTitle,
} from '@/objects/workspace/web-starter-template';
import type { DeliverableType } from '@/types';

export class WorkspaceCreateValidationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'WORKSPACE_CREATE_INVALID'
  ) {
    super(message);
    this.name = 'WorkspaceCreateValidationError';
  }
}

export type WorkspaceCreateActor = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

export type CreatedWorkspaceRecord = Awaited<
  ReturnType<typeof createWorkspaceForRequest>
>;

export async function createWorkspaceForRequest(
  actor: WorkspaceCreateActor,
  input: {
    constraints?: string | null;
    conversationTitle?: unknown;
    conversationId?: string | null;
    deliverableType: DeliverableType;
    goal?: unknown;
    initialContent?: string | null;
    initialPlanNote?: string | null;
    projectFolderId?: string | null;
    projectParentPath?: string | null;
    projectId?: string | null;
    projectTitle?: string | null;
    resolvedWorkflowPlaybook?: Awaited<
      ReturnType<typeof materializeWorkflowPlaybookSelection>
    >;
    styleGuide?: string | null;
    title?: string;
    workflowPlaybookId?: string | null;
    publishGoalToRoom?: boolean;
  },
  transaction?: Prisma.TransactionClient
) {
  const db = transaction || prisma;
  const title = input.title?.trim() || 'Untitled Project';
  const goal =
    typeof input.goal === 'string' && input.goal.trim().length > 0
      ? input.goal.trim()
      : null;
  const planGoal = goal || title || 'Create a new deliverable';
  const projectParentPath = input.projectParentPath?.trim() || null;
  const requestedProjectId = input.projectId?.trim() || null;
  const requestedConversationId = input.conversationId?.trim() || null;
  const requestedProjectFolderId = input.projectFolderId?.trim() || null;
  const requestedProjectTitle = input.projectTitle?.trim() || null;
  const requestedWorkflowPlaybookId = input.workflowPlaybookId?.trim() || null;
  const inheritedProject = requestedProjectId
    ? await db.document.findFirst({
        where: {
          deletedAt: null,
          organizationId: actor.organizationId,
          OR: [{ id: requestedProjectId }, { projectId: requestedProjectId }],
        },
        select: {
          id: true,
          projectId: true,
          projectRootPath: true,
          projectTitle: true,
          title: true,
        },
        orderBy: { createdAt: 'asc' },
      })
    : null;

  if (requestedProjectId && !inheritedProject) {
    throw new WorkspaceCreateValidationError('Project not found.');
  }

  if (requestedProjectFolderId && !requestedProjectId) {
    throw new WorkspaceCreateValidationError('Project folder requires a project.');
  }

  const workflowPlaybook =
    input.resolvedWorkflowPlaybook !== undefined
      ? input.resolvedWorkflowPlaybook
      : requestedWorkflowPlaybookId
        ? await materializeWorkflowPlaybookSelection(actor, requestedWorkflowPlaybookId)
        : null;

  if (requestedWorkflowPlaybookId && !workflowPlaybook) {
    throw new WorkspaceCreateValidationError('Workflow playbook not found.');
  }

  if (workflowPlaybook && workflowPlaybook.status !== 'active') {
    throw new WorkspaceCreateValidationError(
      'Only active workflow playbooks can be reused for a new deliverable.'
    );
  }

  const workflowPrompt = workflowPlaybook
    ? formatWorkflowPlaybookForPrompt(workflowPlaybook)
    : null;
  const initialPlan = createInitialWorkspacePlan({
    activeWorkflowPlaybookId: workflowPlaybook?.id || null,
    constraints:
      [input.constraints?.trim() || null, workflowPrompt]
        .filter(Boolean)
        .join('\n\n') || null,
    deliverableType: input.deliverableType,
    goal: planGoal,
    styleGuide: input.styleGuide || null,
  });
  initialPlan.lastProgressNote =
    input.initialPlanNote?.trim() || initialPlan.lastProgressNote;

  if (requestedProjectFolderId) {
    const folder = await db.projectFolder.findFirst({
      where: {
        deletedAt: null,
        id: requestedProjectFolderId,
        organizationId: actor.organizationId,
        projectId: requestedProjectId || undefined,
      },
      select: { id: true },
    });

    if (!folder) {
      throw new WorkspaceCreateValidationError('Project folder not found.');
    }
  }

  if (projectParentPath && !requestedProjectId) {
    await assertProjectParentPath(projectParentPath);
  }

  const fileSeeds = buildWorkspaceFileSeeds({
    deliverableType: input.deliverableType,
    heading: title,
    initialContent: input.initialContent || null,
  });

  const createInTransaction = async (tx: Prisma.TransactionClient) => {
    const reusableConversation =
      requestedProjectId && requestedConversationId
        ? await findReusableProjectConversation({
            conversationId: requestedConversationId,
            organizationId: actor.organizationId,
            projectId: requestedProjectId,
            tx,
          })
        : null;
    const onboardingConversation =
      !requestedProjectId && requestedConversationId
        ? await tx.session.findFirst({
            where: {
              deletedAt: null,
              id: requestedConversationId,
              organizationId: actor.organizationId,
            },
          })
        : null;

    if (requestedConversationId && requestedProjectId && !reusableConversation) {
      throw new WorkspaceCreateValidationError('Conversation not found for project.');
    }

    if (!requestedProjectId && requestedConversationId && !onboardingConversation) {
      throw new WorkspaceCreateValidationError(
        'Onboarding conversation not found.',
        404,
        'ONBOARDING_CONVERSATION_NOT_FOUND'
      );
    }

    if (
      onboardingConversation &&
      (onboardingConversation.scopeKind !== 'team' ||
        onboardingConversation.sourceType !== 'onboarding' ||
        onboardingConversation.projectId ||
        onboardingConversation.wikiId ||
        onboardingConversation.activeFileId ||
        onboardingConversation.baseVersionId)
    ) {
      throw new WorkspaceCreateValidationError(
        'Conversation is not an unbound onboarding conversation.',
        409,
        'ONBOARDING_CONVERSATION_NOT_ADOPTABLE'
      );
    }

    if (onboardingConversation) {
      const activeOnboardingRun = await tx.assistantRun.findFirst({
        where: {
          deletedAt: null,
          organizationId: actor.organizationId,
          scopeKind: 'team',
          sessionId: onboardingConversation.id,
          status: { in: ['queued', 'planning', 'running'] },
        },
        select: { id: true },
      });
      if (activeOnboardingRun) {
        throw new WorkspaceCreateValidationError(
          'Wait for the onboarding reply to finish before creating a Wiki.',
          409,
          'ONBOARDING_RUN_ACTIVE'
        );
      }
    }

    const createWorkspacePlanRecord = tx.workspacePlan.create as unknown as (
      args: object
    ) => Promise<unknown>;
    const conversation =
      reusableConversation ||
      onboardingConversation ||
      (await tx.session.create({
        data: {
          organizationId: actor.organizationId,
          projectId: requestedProjectId,
          scopeKind: 'wiki',
          title:
            typeof input.conversationTitle === 'string' &&
            input.conversationTitle.trim().length > 0
              ? input.conversationTitle.trim()
              : title,
          createdByUserId: actor.userId,
          originDeviceId: actor.deviceId,
          sourceType: 'chat',
        },
      }));

    const nextTreeSortOrder = requestedProjectId
      ? await getNextProjectTreeSortOrder(
          {
            organizationId: actor.organizationId,
            parentFolderId: requestedProjectFolderId,
            projectId: requestedProjectId,
          },
          tx
        )
      : PROJECT_TREE_SORT_STEP;

    let workspace = await tx.document.create({
      data: {
        organizationId: actor.organizationId,
        sessionId: conversation.id,
        projectId: requestedProjectId,
        projectFolderId: requestedProjectFolderId,
        projectTitle:
          requestedProjectTitle ||
          inheritedProject?.projectTitle ||
          inheritedProject?.title ||
          title,
        treeSortOrder: nextTreeSortOrder,
        title,
        content: fileSeeds.primary.content,
        projectRootPath: inheritedProject?.projectRootPath || null,
        status: 'draft',
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
    });

    if (!requestedProjectId || projectParentPath) {
      workspace = await tx.document.update({
        where: { id: workspace.id },
        data: {
          projectId: requestedProjectId || workspace.id,
          projectTitle:
            requestedProjectTitle ||
            inheritedProject?.projectTitle ||
            inheritedProject?.title ||
            title,
          ...(projectParentPath
            ? {
                projectRootPath: await resolveManagedProjectRootPath({
                  projectParentPath,
                  title,
                  workspaceId: workspace.id,
                }),
              }
            : {}),
        },
      });
    }

    const primaryFile = await tx.workspaceFile.create({
      data: {
        organizationId: actor.organizationId,
        documentId: workspace.id,
        name: fileSeeds.primary.name,
        path: fileSeeds.primary.name,
        type: 'file',
        kind: fileSeeds.primary.kind,
        role: 'deliverable',
        language: fileSeeds.primary.language,
        content: fileSeeds.primary.content,
        isPrimary: true,
        sortOrder: 0,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
      },
    });

    const additionalFiles = [];
    for (const [index, file] of fileSeeds.additional.entries()) {
      additionalFiles.push(
        await tx.workspaceFile.create({
          data: {
            organizationId: actor.organizationId,
            documentId: workspace.id,
            name: file.name,
            path: file.name,
            type: 'file',
            kind: file.kind,
            role: 'deliverable',
            language: file.language,
            content: file.content,
            isPrimary: false,
            sortOrder: index + 1,
            createdByUserId: actor.userId,
            originDeviceId: actor.deviceId,
          },
        })
      );
    }

    let updatedConversation;
    if (onboardingConversation) {
      const adoption = await tx.session.updateMany({
        where: {
          deletedAt: null,
          id: onboardingConversation.id,
          organizationId: actor.organizationId,
          activeFileId: null,
          baseVersionId: null,
          projectId: null,
          revision: onboardingConversation.revision,
          scopeKind: 'team',
          sourceType: 'onboarding',
          wikiId: null,
          assistantRuns: {
            none: {
              deletedAt: null,
              organizationId: actor.organizationId,
              scopeKind: 'team',
              status: { in: ['queued', 'planning', 'running'] },
            },
          },
        },
        data: {
          activeFileId: primaryFile.id,
          originDeviceId: actor.deviceId,
          projectId: workspace.projectId || workspace.id,
          revision: { increment: 1 },
          scopeKind: 'wiki',
          updatedAt: new Date(),
        },
      });

      if (adoption.count !== 1) {
        throw new WorkspaceCreateValidationError(
          'Onboarding conversation is no longer adoptable.',
          409,
          'ONBOARDING_CONVERSATION_NOT_ADOPTABLE'
        );
      }

      updatedConversation = await tx.session.findUniqueOrThrow({
        where: { id: onboardingConversation.id },
      });
    } else {
      updatedConversation = await tx.session.update({
        where: { id: conversation.id },
        data: {
          activeFileId: primaryFile.id,
          projectId: workspace.projectId || workspace.id,
          scopeKind: 'wiki',
        },
      });
    }

    await createWorkspacePlanRecord({
      data: {
        organizationId: actor.organizationId,
        documentId: workspace.id,
        goal: initialPlan.goal,
        deliverableType: initialPlan.deliverableType,
        constraints: initialPlan.constraints,
        styleGuide: initialPlan.styleGuide,
        status: initialPlan.status,
        version: initialPlan.version,
        stagesJson: JSON.stringify(initialPlan.stages),
        activeStageId: initialPlan.activeStageId,
        lastProgressNote: initialPlan.lastProgressNote,
        createdByUserId: actor.userId,
        originDeviceId: actor.deviceId,
        ...(initialPlan.activeWorkflowPlaybookId
          ? {
              activeWorkflowPlaybookId: initialPlan.activeWorkflowPlaybookId,
            }
          : {}),
      },
    });

    const room = await ensureProjectRoom(
      tx,
      actor,
      workspace.projectId || workspace.id
    );
    const initialRoomMessageReceipt =
      goal && input.publishGoalToRoom !== false
        ? await postRoomMessageInTransaction(tx, actor, room.id, {
            metadata: {
              source: 'project-creation',
              workspaceId: workspace.id,
            },
            text: goal,
          })
        : null;

    return {
      conversation: updatedConversation,
      files: [primaryFile, ...additionalFiles],
      initialRoomMessageReceipt,
      primaryFile,
      room,
      workspace,
    };
  };

  return transaction
    ? createInTransaction(transaction)
    : prisma.$transaction(createInTransaction);
}

export async function createWorkspacePairForRequest(
  actor: WorkspaceCreateActor,
  input: {
    constraints?: string | null;
    conversationTitle?: unknown;
    conversationId?: string | null;
    goal?: unknown;
    initialContent?: string | null;
    initialPlanNote?: string | null;
    language?: string | null;
    projectFolderId?: string | null;
    projectParentPath?: string | null;
    projectId?: string | null;
    projectTitle?: string | null;
    resolvedWorkflowPlaybook?: Awaited<
      ReturnType<typeof materializeWorkflowPlaybookSelection>
    >;
    styleGuide?: string | null;
    title?: string;
    workflowPlaybookId?: string | null;
  },
  transaction: Prisma.TransactionClient
) {
  const documentWorkspace = await createWorkspaceForRequest(
    actor,
    {
      ...input,
      deliverableType: 'document',
    },
    transaction
  );

  const webWorkspace = await createWorkspaceForRequest(
    actor,
    {
      ...input,
      conversationTitle: null,
      conversationId: documentWorkspace.conversation.id,
      deliverableType: 'web',
      projectId:
        documentWorkspace.workspace.projectId || documentWorkspace.workspace.id,
      projectParentPath: null,
      projectTitle:
        input.projectTitle?.trim() ||
        documentWorkspace.workspace.projectTitle ||
        documentWorkspace.workspace.title,
      publishGoalToRoom: false,
      title: buildCompanionWebWorkspaceTitle(
        documentWorkspace.workspace.title,
        input.language || null
      ),
    },
    transaction
  );

  return [documentWorkspace, webWorkspace];
}

export async function finalizeWorkspaceCreations(
  actor: WorkspaceCreateActor,
  createdItems: CreatedWorkspaceRecord[]
) {
  await Promise.all(
    createdItems.map((created) =>
      finalizeWorkspaceCreation(actor, created).catch((error) => {
        console.error('Workspace creation side effects failed.', error);
      })
    )
  );
}

export function mapWorkspaceCreateResource(result: unknown) {
  return {
    resourceId:
      result && typeof result === 'object' && 'workspace' in result
        ? (result.workspace as { id?: string }).id || null
        : null,
    resourceType: 'workspace',
  };
}

export function mapWorkspaceCreateResponse(
  createdItems: CreatedWorkspaceRecord[]
) {
  const primary = createdItems[0];
  if (!primary) {
    throw new WorkspaceCreateValidationError(
      'Workspace creation did not produce a result.'
    );
  }

  return {
    conversation: mapConversation(primary.conversation),
    createdDeliverables: createdItems.map((created) => ({
      conversation: mapConversation(created.conversation),
      initialRoomMessageReceipt: created.initialRoomMessageReceipt,
      primaryFile: mapWorkspaceFile(created.primaryFile),
      room: created.room,
      workspace: mapWorkspace(created.workspace),
    })),
    primaryFile: mapWorkspaceFile(primary.primaryFile),
    initialRoomMessageReceipt: primary.initialRoomMessageReceipt,
    room: primary.room,
    workspace: mapWorkspace(primary.workspace),
  };
}

async function findReusableProjectConversation(params: {
  conversationId: string;
  organizationId: string;
  projectId: string;
  tx: Prisma.TransactionClient | typeof prisma;
}) {
  const projectNodeIds = await params.tx.document.findMany({
    where: {
      deletedAt: null,
      organizationId: params.organizationId,
      OR: [{ id: params.projectId }, { projectId: params.projectId }],
    },
    select: {
      id: true,
    },
  });

  return params.tx.session.findFirst({
    where: {
      deletedAt: null,
      id: params.conversationId,
      organizationId: params.organizationId,
      OR: [
        { projectId: params.projectId },
        {
          projectId: null,
          wikiId: { in: projectNodeIds.map((node) => node.id) },
        },
      ],
    },
  });
}

async function finalizeWorkspaceCreation(
  actor: WorkspaceCreateActor,
  created: CreatedWorkspaceRecord
) {
  await Promise.allSettled([
    recordSyncEvent({
      actorUserId: actor.userId,
      entityId: created.workspace.id,
      entityType: 'workspace',
      organizationId: actor.organizationId,
      originDeviceId: actor.deviceId,
      payload: {
        op: 'create',
        title: created.workspace.title,
      },
      revision: created.workspace.revision,
    }),
    recordSyncEvent({
      actorUserId: actor.userId,
      entityId: created.conversation.id,
      entityType: 'conversation',
      organizationId: actor.organizationId,
      originDeviceId: actor.deviceId,
      payload: {
        op: 'create',
        title: created.conversation.title,
        workspaceId: created.workspace.id,
        projectId: created.workspace.projectId || created.workspace.id,
      },
      revision: created.conversation.revision,
    }),
    ...created.files.map((file) =>
      recordSyncEvent({
        actorUserId: actor.userId,
        entityId: file.id,
        entityType: 'workspace_file',
        organizationId: actor.organizationId,
        originDeviceId: actor.deviceId,
        payload: {
          op: 'create',
          path: file.path,
          workspaceId: created.workspace.id,
        },
        revision: file.revision,
      })
    ),
  ]);

  await materializeWorkspaceMirror({
    organizationId: actor.organizationId,
    workspaceId: created.workspace.id,
  });
}

async function assertProjectParentPath(projectParentPath: string) {
  const stat = await fs.stat(projectParentPath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new WorkspaceCreateValidationError('Project save location is unavailable.');
  }
}

async function resolveManagedProjectRootPath(params: {
  projectParentPath: string;
  title: string;
  workspaceId: string;
}) {
  const baseName = `${slugProjectTitle(params.title)}-${params.workspaceId.slice(-6)}`;
  let suffix = 1;

  while (true) {
    const candidateName = suffix === 1 ? baseName : `${baseName}-${suffix}`;
    const candidatePath = path.join(params.projectParentPath, candidateName);
    const exists = await fs
      .access(candidatePath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      return candidatePath;
    }

    suffix += 1;
  }
}
