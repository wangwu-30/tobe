import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

import { defineRoute } from '@/framework/resilience';
import { getSettingsFromHeaders } from '@/lib/ai/providers';
import { translate } from '@/lib/i18n/copy';
import {
  IdempotencyConflictError,
  IdempotencyInProgressError,
  withAtomicIdempotency,
} from '@/lib/platform/idempotency';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { materializeWorkflowPlaybookSelection } from '@/lib/workflows/service';
import {
  mapDeliverableTypeToCreateIntent,
  normalizeWorkspaceCreateIntent,
} from '@/lib/workspace/create-intent';
import { WORKSPACE_CREATE_IDEMPOTENCY_HEADER } from '@/lib/workspace/create-request';
import { normalizeStoredDeliverableType } from '@/lib/workspace/deliverable-types';
import { listProjects as listWorkspaces } from '@/objects/project/queries';
import {
  createWorkspaceForRequest,
  createWorkspacePairForRequest,
  finalizeWorkspaceCreations,
  mapWorkspaceCreateResource,
  mapWorkspaceCreateResponse,
  WorkspaceCreateValidationError,
  type CreatedWorkspaceRecord,
} from '@/objects/workspace/create-commands';
import {
  deriveWorkspaceTitle,
  mergeIntentDetailIntoConstraints,
} from '@/objects/workspace/web-starter-template';

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
  const conversationTitle =
    typeof body.conversationTitle === 'string' && body.conversationTitle.trim()
      ? body.conversationTitle.trim()
      : null;
  const goal =
    typeof body.goal === 'string' && body.goal.trim() ? body.goal.trim() : null;
  const initialContent = typeof body.content === 'string' ? body.content : null;
  const styleGuide =
    typeof body.styleGuide === 'string' && body.styleGuide.trim()
      ? body.styleGuide.trim()
      : null;
  const initialPlanNote = translate(language, 'plan.generatingDescription');
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
    content: initialContent,
    conversationTitle,
    createMode,
    deliverableType,
    goal,
    conversationId,
    language,
    projectFolderId,
    projectParentPath,
    projectId,
    projectTitle,
    selectedIntentNote,
    styleGuide,
    title: suggestedTitle || null,
    workflowPlaybookId,
  });

  try {
    const resolvedWorkflowPlaybook = workflowPlaybookId
      ? await materializeWorkflowPlaybookSelection(actor, workflowPlaybookId)
      : undefined;
    let createdItemsToFinalize: CreatedWorkspaceRecord[] | null = null;
    const workspace = await withAtomicIdempotency({
      action: async (tx) => {
        const creationInput = {
          constraints: mergedConstraints,
          conversationTitle,
          conversationId,
          goal,
          initialContent,
          initialPlanNote,
          projectFolderId,
          projectParentPath,
          projectId,
          projectTitle,
          resolvedWorkflowPlaybook,
          styleGuide,
          title: suggestedTitle || undefined,
          workflowPlaybookId,
        };
        const createdItems =
          createMode === 'both'
            ? await createWorkspacePairForRequest(
                actor,
                { ...creationInput, language },
                tx
              )
            : [
                await createWorkspaceForRequest(
                  actor,
                  { ...creationInput, deliverableType },
                  tx
                ),
              ];

        createdItemsToFinalize = createdItems;
        return mapWorkspaceCreateResponse(createdItems);
      },
      key: requestKey,
      operation: 'workspace:create',
      organizationId: actor.organizationId,
      requestHash,
      resource: mapWorkspaceCreateResource,
      userId: actor.userId,
    });

    if (createdItemsToFinalize) {
      await finalizeWorkspaceCreations(actor, createdItemsToFinalize);
    }

    return NextResponse.json(workspace);
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json(
        {
          code: 'WORKSPACE_CREATE_IDEMPOTENCY_CONFLICT',
          error:
            'This project request key is already being used for a different project payload.',
        },
        { status: 409 }
      );
    }

    if (error instanceof IdempotencyInProgressError) {
      return NextResponse.json(
        {
          code: 'WORKSPACE_CREATE_IN_PROGRESS',
          error: 'This project request is still in progress. Please wait a moment.',
        },
        { status: 409 }
      );
    }

    if (error instanceof WorkspaceCreateValidationError) {
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: error.status }
      );
    }

    console.error('Workspace creation failed.', error);
    return NextResponse.json(
      { error: 'Could not create the project.' },
      { status: 500 }
    );
  }
});
