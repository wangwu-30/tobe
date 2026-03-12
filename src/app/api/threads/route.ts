import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { mapCommentThread } from '@/lib/wiki/service';

export async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);
  const workspaceId =
    searchParams.get('workspaceId') ||
    searchParams.get('wikiId') ||
    searchParams.get('documentId');
  const fileId = searchParams.get('fileId');
  const snapshotId = searchParams.get('snapshotId');
  if (!workspaceId) {
    return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 });
  }

  const threads = await prisma.commentThread.findMany({
    where: {
      deletedAt: null,
      documentId: workspaceId,
      ...(fileId ? { fileId } : {}),
      ...(snapshotId ? { versionId: snapshotId } : {}),
      organizationId: actor.organizationId,
    },
    include: {
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      },
      version: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(threads.map(mapCommentThread));
}

export async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json();
  const workspaceId = body.workspaceId || body.wikiId || body.documentId;
  if (!workspaceId) {
    return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 });
  }

  const thread = await prisma.commentThread.create({
    data: {
      organizationId: actor.organizationId,
      documentId: workspaceId,
      fileId: body.fileId || null,
      versionId: body.snapshotId || null,
      anchorText: body.anchorText,
      draftRevision:
        typeof body.draftRevision === 'number' ? body.draftRevision : null,
      selectionAnchor: body.selectionAnchor || null,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      messages: {
        create: body.firstMessage
          ? {
              organizationId: actor.organizationId,
              role: 'user',
              content: body.firstMessage,
              createdByUserId: actor.userId,
              originDeviceId: actor.deviceId,
            }
          : undefined,
      },
    },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      version: true,
    },
  });
  return NextResponse.json(mapCommentThread(thread));
}
