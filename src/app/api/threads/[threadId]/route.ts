import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getBoundVersionIdForWiki } from '@/lib/comments/version-binding';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { mapCommentThread } from '@/lib/wiki/service';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { threadId } = await params;
  const body = await req.json();

  const existingThread = await prisma.commentThread.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      documentId: true,
      organizationId: true,
      versionId: true,
      status: true,
    },
  });

  if (!existingThread || existingThread.organizationId !== actor.organizationId) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  let versionId = existingThread.versionId;
  if (body.status === 'resolved' && !versionId) {
    versionId = await getBoundVersionIdForWiki(existingThread.documentId);
  }

  const thread = await prisma.commentThread.update({
    where: { id: threadId },
    data: {
      ...(body.status !== undefined && { status: body.status }),
      ...(body.status === 'resolved' && { resolvedAt: new Date() }),
      ...(body.status === 'open' && { resolvedAt: null }),
      ...(versionId !== existingThread.versionId && { versionId }),
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      revision: {
        increment: 1,
      },
    },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      version: true,
    },
  });

  return NextResponse.json(mapCommentThread(thread));
}
