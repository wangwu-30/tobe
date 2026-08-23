import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { mapStagedChangeSet } from '@/lib/workspace/planning';
import { ValidationError } from '@/framework/resilience';
import { WorkspaceLockConflictError } from '@/objects/workspace/commands';
import {
  applyStagedChangeSet,
  discardStagedChangeSet,
} from '@/lib/workspace/staged-changes';
import { defineRoute } from '@/framework/resilience';


export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ changeSetId: string; workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { changeSetId, workspaceId } = await params;

  const changeSet = await prisma.stagedChangeSet.findFirst({
    where: {
      deletedAt: null,
      documentId: workspaceId,
      id: changeSetId,
      organizationId: actor.organizationId,
    },
  });

  if (!changeSet) {
    return NextResponse.json({ error: 'Staged change set not found' }, { status: 404 });
  }

  return NextResponse.json(mapStagedChangeSet(changeSet));
});

export const PATCH = defineRoute(async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ changeSetId: string; workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { changeSetId, workspaceId } = await params;
  const body = await req.json().catch(() => ({}));
  if (body.action !== 'apply' && body.action !== 'discard') {
    throw new ValidationError('action must be apply or discard.');
  }
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) {
    throw new ValidationError('expectedRevision must be a positive integer.');
  }
  const action: 'apply' | 'discard' = body.action;

  const changeSet = await prisma.stagedChangeSet.findFirst({
    where: {
      deletedAt: null,
      documentId: workspaceId,
      id: changeSetId,
      organizationId: actor.organizationId,
    },
  });

  if (!changeSet) {
    return NextResponse.json({ error: 'Staged change set not found' }, { status: 404 });
  }

  if (action === 'discard') {
    const discarded = await discardStagedChangeSet(actor, {
      changeSetId,
      expectedRevision: body.expectedRevision,
      workspaceId,
    });
    return NextResponse.json(discarded);
  }

  try {
    const applied = await applyStagedChangeSet(actor, {
      changeSetId,
      checkpointTitle: body.checkpointTitle,
      expectedRevision: body.expectedRevision,
      workspaceId,
    });

    return NextResponse.json(applied);
  } catch (error) {
    if (error instanceof WorkspaceLockConflictError) {
      return NextResponse.json(
        {
          error: error.message,
          lock: error.detail,
        },
        { status: 423 }
      );
    }

    throw error;
  }
});
