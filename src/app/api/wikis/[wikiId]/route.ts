import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getActiveWikiLock, getWikiWorkspace, updateWiki, WikiLockConflictError } from '@/lib/wiki/service';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wikiId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { wikiId } = await params;
  const { searchParams } = new URL(req.url);
  const conversationId = searchParams.get('conversationId');

  const workspace = await getWikiWorkspace({
    conversationId,
    organizationId: actor.organizationId,
    wikiId,
  });

  if (!workspace.wiki) {
    return NextResponse.json({ error: 'Wiki not found' }, { status: 404 });
  }

  const activeLock = await getActiveWikiLock(actor.organizationId, wikiId);

  return NextResponse.json({
    ...workspace,
    activeLock,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wikiId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { wikiId } = await params;
  const body = await req.json();

  const existing = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: wikiId,
      organizationId: actor.organizationId,
    },
    select: { id: true },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Wiki not found' }, { status: 404 });
  }

  try {
    const wiki = await updateWiki(actor, {
      content: body.content,
      status: body.status,
      title: body.title,
      wikiId,
    });

    return NextResponse.json(wiki);
  } catch (error) {
    if (error instanceof WikiLockConflictError) {
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
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wikiId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { wikiId } = await params;

  const existing = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: wikiId,
      organizationId: actor.organizationId,
    },
    select: { id: true },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Wiki not found' }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.document.update({
      where: { id: wikiId },
      data: {
        deletedAt: new Date(),
        revision: {
          increment: 1,
        },
      },
    }),
    prisma.session.updateMany({
      where: {
        deletedAt: null,
        organizationId: actor.organizationId,
        wikiId,
      },
      data: {
        deletedAt: new Date(),
        revision: {
          increment: 1,
        },
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
