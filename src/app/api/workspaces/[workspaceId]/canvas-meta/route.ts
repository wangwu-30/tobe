import { NextRequest, NextResponse } from 'next/server';
import { defineRoute } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { prisma } from '@/lib/db/prisma';

export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;

  const document = await prisma.document.findFirst({
    where: {
      id: workspaceId,
      organizationId: actor.organizationId,
      deletedAt: null,
    },
    select: {
      canvasMetaJson: true,
    },
  });

  if (!document) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ canvasMetaJson: document.canvasMetaJson });
});

export const PATCH = defineRoute(async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { workspaceId } = await params;
  const body = await req.json();
  const { canvasMetaJson } = body;

  if (typeof canvasMetaJson !== 'string' && canvasMetaJson !== null) {
    return NextResponse.json(
      { error: 'canvasMetaJson must be a string or null' },
      { status: 400 }
    );
  }

  await prisma.document.update({
    where: {
      id: workspaceId,
      organizationId: actor.organizationId,
    },
    data: {
      canvasMetaJson,
    },
  });

  return NextResponse.json({ ok: true });
});
