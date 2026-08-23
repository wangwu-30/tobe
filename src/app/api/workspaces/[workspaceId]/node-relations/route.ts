import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { defineRoute } from '@/framework/resilience';

/**
 * GET /api/workspaces/[workspaceId]/node-relations
 * List all node relations for a project (where workspaceId is the projectId).
 */
export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;

  // workspaceId here is the projectId
  const projectId = workspaceId;

  // Find all nodes in this project
  const projectNodes = await prisma.document.findMany({
    where: {
      deletedAt: null,
      organizationId: actor.organizationId,
      OR: [{ id: projectId }, { projectId }],
    },
    select: { id: true },
  });
  const nodeIds = projectNodes.map((n) => n.id);

  const relations = await prisma.nodeRelation.findMany({
    where: {
      organizationId: actor.organizationId,
      sourceNodeId: { in: nodeIds },
      targetNodeId: { in: nodeIds },
    },
    select: {
      id: true,
      sourceNodeId: true,
      targetNodeId: true,
      kind: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ relations });
});

/**
 * POST /api/workspaces/[workspaceId]/node-relations
 * Create a new relation between two nodes.
 */
export const POST = defineRoute(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const body = await req.json().catch(() => ({}));

  const sourceNodeId = typeof body.sourceNodeId === 'string' ? body.sourceNodeId : null;
  const targetNodeId = typeof body.targetNodeId === 'string' ? body.targetNodeId : null;
  const kind = typeof body.kind === 'string' ? body.kind : 'dependency';

  if (!sourceNodeId || !targetNodeId) {
    return NextResponse.json(
      { error: 'sourceNodeId and targetNodeId are required.' },
      { status: 400 }
    );
  }

  if (sourceNodeId === targetNodeId) {
    return NextResponse.json(
      { error: 'Cannot create a self-referencing relation.' },
      { status: 400 }
    );
  }

  // Verify both nodes exist and belong to the same project
  const projectId = workspaceId;
  const nodeIds = [sourceNodeId, targetNodeId];
  const nodes = await prisma.document.findMany({
    where: {
      deletedAt: null,
      organizationId: actor.organizationId,
      id: { in: nodeIds },
      OR: [{ id: projectId }, { projectId }],
    },
    select: { id: true },
  });

  if (nodes.length !== 2) {
    return NextResponse.json(
      { error: 'Both nodes must exist in the same project.' },
      { status: 404 }
    );
  }

  const relation = await prisma.nodeRelation.upsert({
    where: {
      sourceNodeId_targetNodeId_kind: {
        sourceNodeId,
        targetNodeId,
        kind,
      },
    },
    create: {
      organizationId: actor.organizationId,
      sourceNodeId,
      targetNodeId,
      kind,
    },
    update: {},
    select: {
      id: true,
      sourceNodeId: true,
      targetNodeId: true,
      kind: true,
    },
  });

  return NextResponse.json(relation, { status: 201 });
});

/**
 * DELETE /api/workspaces/[workspaceId]/node-relations
 * Delete a relation by id (passed as query param or body).
 */
export const DELETE = defineRoute(async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;

  const { searchParams } = new URL(req.url);
  const relationId = searchParams.get('id');

  if (!relationId) {
    return NextResponse.json({ error: 'Relation id is required.' }, { status: 400 });
  }

  const projectNodeScope = {
    deletedAt: null,
    organizationId: actor.organizationId,
    OR: [{ id: workspaceId }, { projectId: workspaceId }],
  };
  const deleted = await prisma.nodeRelation.deleteMany({
    where: {
      id: relationId,
      organizationId: actor.organizationId,
      sourceNode: projectNodeScope,
      targetNode: projectNodeScope,
    },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: 'Relation not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
});
