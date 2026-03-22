import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { parseStoredDeliverableType } from '@/lib/workspace/deliverable-types';
import { defineRoute } from '@/framework/resilience';


export const runtime = 'nodejs';

export const DELETE = defineRoute(async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> }
) {
  if (process.env.DAO_E2E !== '1') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await context.params;
  const normalizedWorkspaceId = workspaceId.trim();

  if (!normalizedWorkspaceId) {
    return NextResponse.json({ error: 'workspaceId is required.' }, { status: 400 });
  }

  await prisma.workspacePlan.deleteMany({
    where: {
      deletedAt: null,
      documentId: normalizedWorkspaceId,
      organizationId: actor.organizationId,
    },
  });

  return NextResponse.json({ ok: true });
});

export const PATCH = defineRoute(async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> }
) {
  if (process.env.DAO_E2E !== '1') {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await context.params;
  const normalizedWorkspaceId = workspaceId.trim();
  const body = (await req.json().catch(() => ({}))) as {
    deliverableType?: unknown;
  };
  const storedDeliverableType = parseStoredDeliverableType(body.deliverableType);

  if (!normalizedWorkspaceId) {
    return NextResponse.json({ error: 'workspaceId is required.' }, { status: 400 });
  }

  if (!storedDeliverableType) {
    return NextResponse.json(
      { error: 'A valid stored deliverableType is required.' },
      { status: 400 }
    );
  }

  const result = await prisma.workspacePlan.updateMany({
    where: {
      deletedAt: null,
      documentId: normalizedWorkspaceId,
      organizationId: actor.organizationId,
    },
    data: {
      deliverableType: storedDeliverableType,
    },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: 'Workspace plan not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
});
