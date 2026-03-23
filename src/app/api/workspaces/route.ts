import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getSettingsFromHeaders } from '@/lib/ai/providers';
import { translate } from '@/lib/i18n/copy';
import {
  IdempotencyConflictError,
  IdempotencyInProgressError,
  withIdempotency,
} from '@/lib/platform/idempotency';
import { materializeWorkspaceMirror } from '@/lib/platform/mirror-manager';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { recordSyncEvent } from '@/lib/platform/sync';
import { WORKSPACE_CREATE_IDEMPOTENCY_HEADER } from '@/lib/workspace/create-request';
import {
  mapDeliverableTypeToCreateIntent,
  normalizeWorkspaceCreateIntent,
} from '@/lib/workspace/create-intent';
import { normalizeStoredDeliverableType } from '@/lib/workspace/deliverable-types';
import { createInitialWorkspacePlan } from '@/lib/workspace/planning';
import {
  getNextProjectTreeSortOrder,
  listProjects as listWorkspaces,
  PROJECT_TREE_SORT_STEP,
} from '@/objects/project/queries';
import { mapConversation } from '@/objects/conversation/view';
import { mapWorkspaceFile } from '@/objects/file/schema';
import { mapWorkspace } from '@/objects/workspace/view';
import {
  formatWorkflowPlaybookForPrompt,
  materializeWorkflowPlaybookSelection,
} from '@/lib/workflows/service';
import type { DeliverableType } from '@/types';
import { defineRoute } from '@/framework/resilience';


class WorkspaceCreateValidationError extends Error {}

type CreatedWorkspaceRecord = Awaited<ReturnType<typeof createWorkspaceForRequest>>;

export const GET = defineRoute(async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const workspaces = await listWorkspaces(actor.organizationId);
  return NextResponse.json({ items: workspaces });
});

export const POST = defineRoute(async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json().catch(() => ({}));
  const settings = getSettingsFromHeaders(req.headers);
  const language = settings.language || 'zh-CN';
  const requestedCreateMode = normalizeWorkspaceCreateIntent(body.createMode);
  const legacyDeliverableType = normalizeStoredDeliverableType(body.deliverableType);
  const createMode =
    requestedCreateMode ||
    mapDeliverableTypeToCreateIntent(legacyDeliverableType) ||
    'document';
  const deliverableType =
    requestedCreateMode === 'web'
      ? 'web'
      : requestedCreateMode === 'document'
        ? 'document'
        : legacyDeliverableType === 'web'
          ? 'web'
          : 'document';
  const selectedIntentNote =
    typeof body.selectedIntentNote === 'string' && body.selectedIntentNote.trim()
      ? body.selectedIntentNote.trim()
      : null;
  const mergedConstraints = mergeIntentDetailIntoConstraints(
    typeof body.constraints === 'string' ? body.constraints : null,
    selectedIntentNote
  );
  const suggestedTitle = deriveWorkspaceTitle(body.title || body.goal);
  const projectParentPath =
    typeof body.projectParentPath === 'string' && body.projectParentPath.trim()
      ? body.projectParentPath.trim()
      : null;
  const conversationId =
    typeof body.conversationId === 'string' && body.conversationId.trim()
      ? body.conversationId.trim()
      : null;
  const projectId =
    typeof body.projectId === 'string' && body.projectId.trim()
      ? body.projectId.trim()
      : null;
  const projectTitle =
    typeof body.projectTitle === 'string' && body.projectTitle.trim()
      ? body.projectTitle.trim()
      : null;
  const projectFolderId =
    typeof body.projectFolderId === 'string' && body.projectFolderId.trim()
      ? body.projectFolderId.trim()
      : null;
  const workflowPlaybookId =
    typeof body.workflowPlaybookId === 'string' && body.workflowPlaybookId.trim()
      ? body.workflowPlaybookId.trim()
      : null;

  if (projectParentPath && !path.isAbsolute(projectParentPath)) {
    return NextResponse.json(
      { error: 'Project save location must be an absolute path.' },
      { status: 400 }
    );
  }
  const requestKey = req.headers.get(WORKSPACE_CREATE_IDEMPOTENCY_HEADER)?.trim() || null;
  const requestHash = JSON.stringify({
    constraints: mergedConstraints,
    createMode,
    deliverableType,
    goal: body.goal || null,
    conversationId,
    projectFolderId,
    projectParentPath,
    projectId,
    projectTitle,
    selectedIntentNote,
    styleGuide: body.styleGuide || null,
    title: suggestedTitle || null,
    workflowPlaybookId,
  });

  try {
    const workspace = await withIdempotency({
      action: async () => {
        const createdItems =
              createMode === 'both'
            ? await createWorkspacePairForRequest(actor, {
                constraints: mergedConstraints,
                conversationTitle: body.conversationTitle,
                conversationId,
                goal: body.goal,
                initialContent: typeof body.content === 'string' ? body.content : null,
                initialPlanNote: translate(language, 'plan.generatingDescription'),
                language,
                projectFolderId,
                projectParentPath,
                projectId,
                projectTitle,
                styleGuide: body.styleGuide,
                title: suggestedTitle || undefined,
                workflowPlaybookId,
              })
            : [
                await createWorkspaceForRequest(actor, {
                  constraints: mergedConstraints,
                  conversationTitle: body.conversationTitle,
                  conversationId,
                  deliverableType,
                  goal: body.goal,
                  initialContent: typeof body.content === 'string' ? body.content : null,
                  initialPlanNote: translate(language, 'plan.generatingDescription'),
                  projectFolderId,
                  projectParentPath,
                  projectId,
                  projectTitle,
                  styleGuide: body.styleGuide,
                  title: suggestedTitle || undefined,
                  workflowPlaybookId,
                }),
              ];
        await Promise.all(
          createdItems.map((created) =>
            finalizeWorkspaceCreation(actor, created).catch((error) => {
              console.error('Workspace creation side effects failed.', error);
            })
          )
        );

        return mapWorkspaceCreateResponse(createdItems);
      },
      key: requestKey,
      operation: 'workspace:create',
      organizationId: actor.organizationId,
      requestHash,
      resource: (result) => ({
        resourceId:
          result && typeof result === 'object' && 'workspace' in result
            ? ((result.workspace as { id?: string }).id || null)
            : null,
        resourceType: 'workspace',
      }),
      userId: actor.userId,
    });

    return NextResponse.json(workspace);
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json(
        {
          error:
            'This project request key is already being used for a different project payload.',
        },
        { status: 409 }
      );
    }

    if (error instanceof IdempotencyInProgressError) {
      return NextResponse.json(
        { error: 'This project request is still in progress. Please wait a moment.' },
        { status: 409 }
      );
    }

    if (error instanceof WorkspaceCreateValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    console.error('Workspace creation failed.', error);
    return NextResponse.json(
      { error: 'Could not create the project.' },
      { status: 500 }
    );
  }
});

async function createWorkspaceForRequest(
  actor: { deviceId: string; organizationId: string; userId: string },
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
    styleGuide?: string | null;
    title?: string;
    workflowPlaybookId?: string | null;
  }
) {
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
  const inheritedProject =
    requestedProjectId
      ? await prisma.document.findFirst({
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

  const workflowPlaybook = requestedWorkflowPlaybookId
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
    constraints: [input.constraints?.trim() || null, workflowPrompt].filter(Boolean).join('\n\n') || null,
    deliverableType: input.deliverableType,
    goal: planGoal,
    styleGuide: input.styleGuide || null,
  });
  initialPlan.lastProgressNote = input.initialPlanNote?.trim() || initialPlan.lastProgressNote;

  if (requestedProjectFolderId) {
    const folder = await prisma.projectFolder.findFirst({
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

  return prisma.$transaction(async (tx) => {
    const reusableConversation =
      requestedProjectId && requestedConversationId
        ? await findReusableProjectConversation({
            conversationId: requestedConversationId,
            organizationId: actor.organizationId,
            projectId: requestedProjectId,
            tx,
          })
        : null;

    if (requestedConversationId && requestedProjectId && !reusableConversation) {
      throw new WorkspaceCreateValidationError('Conversation not found for project.');
    }

    const createWorkspacePlanRecord = tx.workspacePlan.create as unknown as (
      args: object
    ) => Promise<unknown>;
    const conversation =
      reusableConversation ||
      (await tx.session.create({
        data: {
          organizationId: actor.organizationId,
          projectId: requestedProjectId,
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

    const updatedConversation = await tx.session.update({
      where: { id: conversation.id },
      data: {
        activeFileId: primaryFile.id,
        projectId: workspace.projectId || workspace.id,
      },
    });

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

    return {
      conversation: updatedConversation,
      files: [primaryFile, ...additionalFiles],
      primaryFile,
      workspace,
    };
  });
}

async function createWorkspacePairForRequest(
  actor: { deviceId: string; organizationId: string; userId: string },
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
    styleGuide?: string | null;
    title?: string;
    workflowPlaybookId?: string | null;
  }
) {
  const documentWorkspace = await createWorkspaceForRequest(actor, {
    ...input,
    deliverableType: 'document',
  });

  const webWorkspace = await createWorkspaceForRequest(actor, {
    ...input,
    conversationTitle: null,
    conversationId: documentWorkspace.conversation.id,
    deliverableType: 'web',
    projectId: documentWorkspace.workspace.projectId || documentWorkspace.workspace.id,
    projectParentPath: null,
    projectTitle:
      input.projectTitle?.trim() ||
      documentWorkspace.workspace.projectTitle ||
      documentWorkspace.workspace.title,
    title: buildCompanionWebWorkspaceTitle(
      documentWorkspace.workspace.title,
      input.language || null
    ),
  });

  return [documentWorkspace, webWorkspace];
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
  actor: { deviceId: string; organizationId: string; userId: string },
  created: Awaited<ReturnType<typeof createWorkspaceForRequest>>
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

function mapWorkspaceCreateResponse(createdItems: CreatedWorkspaceRecord[]) {
  const primary = createdItems[0];
  if (!primary) {
    throw new WorkspaceCreateValidationError('Workspace creation did not produce a result.');
  }

  return {
    conversation: mapConversation(primary.conversation),
    createdDeliverables: createdItems.map((created) => ({
      conversation: mapConversation(created.conversation),
      primaryFile: mapWorkspaceFile(created.primaryFile),
      workspace: mapWorkspace(created.workspace),
    })),
    primaryFile: mapWorkspaceFile(primary.primaryFile),
    workspace: mapWorkspace(primary.workspace),
  };
}

function buildWorkspaceFileSeeds(params: {
  deliverableType: DeliverableType;
  heading: string;
  initialContent?: string | null;
}) {
  if (params.deliverableType === 'web') {
    return {
      additional: [
        {
          content: buildStaticWebStyles(),
          kind: 'code' as const,
          language: 'css',
          name: 'styles.css',
        },
      ],
      primary: {
        content: buildStaticWebIndexHtml(params.heading),
        kind: 'code' as const,
        language: 'html',
        name: 'index.html',
      },
    };
  }

  return {
    additional: [],
    primary: {
      content: params.initialContent || '[]',
      kind: 'markdown' as const,
      language: 'markdown',
      name: 'main',
    },
  };
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
    const exists = await fs.access(candidatePath).then(() => true).catch(() => false);

    if (!exists) {
      return candidatePath;
    }

    suffix += 1;
  }
}

function slugProjectTitle(title: string) {
  const normalized = title
    .normalize('NFKC')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s_-]+/gu, ' ')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return normalized || 'project';
}

function deriveWorkspaceTitle(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .replace(/\s+/g, ' ')
    .replace(/[。！？!?,，；;：:]+$/g, '')
    .trim();

  if (!normalized) {
    return null;
  }

  const strippedLead = normalized.replace(
    /^(写一份|写一个|写一篇|做一份|做一个|做一页|生成一份|生成一个|创建一份|创建一个|起草一份|产出一份)\s*/u,
    ''
  );
  const firstClause = strippedLead.split(/[，。,.：:]/u)[0]?.trim() || strippedLead;
  const candidate = firstClause || strippedLead;

  return candidate.length > 28 ? `${candidate.slice(0, 25).trimEnd()}...` : candidate;
}

function mergeIntentDetailIntoConstraints(
  constraints: string | null,
  selectedIntentNote: string | null
) {
  const detail = selectedIntentNote?.trim() || '';
  const base = constraints?.trim() || '';

  if (!detail) {
    return base || null;
  }

  return [base, `Supplementary result-shape note: ${detail}`]
    .filter(Boolean)
    .join('\n\n');
}

function buildCompanionWebWorkspaceTitle(title: string, language: string | null) {
  const trimmedTitle = title.trim() || 'Untitled Project';
  return language?.startsWith('zh')
    ? `${trimmedTitle} 配套网页`
    : `${trimmedTitle} Companion Site`;
}

function buildStaticWebIndexHtml(title: unknown) {
  const heading = escapeHtmlText(
    typeof title === 'string' && title.trim().length > 0
      ? title.trim()
      : 'New Web Deliverable'
  );

  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${heading}</title>`,
    '    <link rel="stylesheet" href="./styles.css" />',
    '  </head>',
    '  <body>',
    '    <main class="page-shell">',
    '      <section class="hero-card">',
    '        <p class="eyebrow">Web deliverable</p>',
    `        <h1>${heading}</h1>`,
    '        <p class="lede">',
    '          This workspace starts with a previewable page shell that works fully offline.',
    '          Replace the sections, copy, and styling with the real page during the first',
    '          author pass.',
    '        </p>',
    '        <div class="cta-row">',
    '          <a class="primary-cta" href="#sections">Review the visible result</a>',
    '          <a class="secondary-cta" href="#notes">Refine the structure</a>',
    '        </div>',
    '      </section>',
    '      <section id="sections" class="content-grid">',
    '        <article class="detail-card">',
    '          <p class="card-label">Section</p>',
    '          <h2>Hero</h2>',
    '          <p>Start from the visible result, then rewrite the copy and hierarchy in place.</p>',
    '        </article>',
    '        <article class="detail-card">',
    '          <p class="card-label">Section</p>',
    '          <h2>Proof</h2>',
    '          <p>Add highlights, social proof, or supporting facts here once the main story is clear.</p>',
    '        </article>',
    '        <article id="notes" class="detail-card">',
    '          <p class="card-label">Section</p>',
    '          <h2>Next step</h2>',
    '          <p>Keep the live page readable first. Only open the implementation view when you truly need to edit the source.</p>',
    '        </article>',
    '      </section>',
    '    </main>',
    '  </body>',
    '</html>',
  ].join('\n');
}

function buildStaticWebStyles() {
  return [
    ':root {',
    '  color-scheme: light;',
    "  font-family: 'SF Pro Display', 'Helvetica Neue', sans-serif;",
    '  background: linear-gradient(180deg, #f5f1e8 0%, #f9f7f3 100%);',
    '  color: #171717;',
    '}',
    '',
    '* {',
    '  box-sizing: border-box;',
    '}',
    '',
    'body {',
    '  margin: 0;',
    '  min-height: 100vh;',
    '  background: radial-gradient(circle at top, rgba(201, 153, 66, 0.16), transparent 32%),',
    '    linear-gradient(180deg, #f5f1e8 0%, #f9f7f3 100%);',
    '}',
    '',
    '.page-shell {',
    '  min-height: 100vh;',
    '  display: grid;',
    '  place-items: center;',
    '  padding: 32px;',
    '}',
    '',
    '.hero-card {',
    '  width: min(720px, 100%);',
    '  padding: 48px;',
    '  border-radius: 32px;',
    '  background: rgba(255, 255, 255, 0.88);',
    '  border: 1px solid rgba(23, 23, 23, 0.08);',
    '  box-shadow: 0 24px 80px rgba(60, 44, 12, 0.12);',
    '}',
    '',
    '.cta-row {',
    '  display: flex;',
    '  flex-wrap: wrap;',
    '  gap: 12px;',
    '  margin-top: 28px;',
    '}',
    '',
    '.primary-cta,',
    '.secondary-cta {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  min-height: 44px;',
    '  padding: 0 18px;',
    '  border-radius: 999px;',
    '  text-decoration: none;',
    '  font-size: 14px;',
    '  font-weight: 600;',
    '  transition: transform 180ms ease, box-shadow 180ms ease;',
    '}',
    '',
    '.primary-cta {',
    '  color: #fff;',
    '  background: linear-gradient(135deg, #111827, #8a6a2f);',
    '  box-shadow: 0 18px 40px rgba(23, 23, 23, 0.18);',
    '}',
    '',
    '.secondary-cta {',
    '  color: #171717;',
    '  background: rgba(255, 255, 255, 0.72);',
    '  border: 1px solid rgba(23, 23, 23, 0.08);',
    '}',
    '',
    '.primary-cta:hover,',
    '.secondary-cta:hover {',
    '  transform: translateY(-1px);',
    '}',
    '',
    '.content-grid {',
    '  width: min(960px, 100%);',
    '  display: grid;',
    '  gap: 18px;',
    '  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));',
    '  margin-top: 20px;',
    '}',
    '',
    '.detail-card {',
    '  border-radius: 24px;',
    '  background: rgba(255, 255, 255, 0.82);',
    '  border: 1px solid rgba(23, 23, 23, 0.08);',
    '  padding: 24px;',
    '  box-shadow: 0 18px 60px rgba(60, 44, 12, 0.08);',
    '}',
    '',
    '.card-label {',
    '  margin: 0 0 8px;',
    '  font-size: 11px;',
    '  letter-spacing: 0.18em;',
    '  text-transform: uppercase;',
    '  color: rgba(23, 23, 23, 0.45);',
    '}',
    '',
    '.detail-card h2 {',
    '  margin: 0;',
    '  font-size: 20px;',
    '  line-height: 1.2;',
    '}',
    '',
    '.detail-card p:last-child {',
    '  margin-bottom: 0;',
    '}',
    '',
    '.eyebrow {',
    '  margin: 0 0 12px;',
    '  font-size: 12px;',
    '  letter-spacing: 0.24em;',
    '  text-transform: uppercase;',
    '  color: #8a6a2f;',
    '}',
    '',
    'h1 {',
    '  margin: 0;',
    '  font-size: clamp(2.6rem, 5vw, 4.4rem);',
    '  line-height: 0.95;',
    '}',
    '',
    '.lede {',
    '  margin: 18px 0 0;',
    '  max-width: 56ch;',
    '  font-size: 16px;',
    '  line-height: 1.7;',
    '  color: rgba(23, 23, 23, 0.72);',
    '}',
    '',
    '@media (max-width: 640px) {',
    '  .page-shell {',
    '    padding: 18px;',
    '  }',
    '',
    '  .hero-card {',
    '    padding: 28px;',
    '    border-radius: 24px;',
    '  }',
    '',
    '  .cta-row {',
    '    flex-direction: column;',
    '  }',
    '}',
  ].join('\n');
}

function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
