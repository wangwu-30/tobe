import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { mapKnowledgeItem } from '@/lib/wiki/service';

export async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);
  const wikiId = searchParams.get('wikiId');

  const items = await prisma.knowledgeItem.findMany({
    where: {
      deletedAt: null,
      organizationId: actor.organizationId,
      ...(wikiId ? { documentId: wikiId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(items.map(mapKnowledgeItem));
}

export async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json();
  const item = await prisma.knowledgeItem.create({
    data: {
      organizationId: actor.organizationId,
      title: body.title,
      content: body.content,
      documentId: body.wikiId || body.documentId || null,
      sourceType: body.sourceType || 'note',
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
    },
  });
  return NextResponse.json(mapKnowledgeItem(item));
}

export async function DELETE(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  await prisma.knowledgeItem.updateMany({
    where: {
      deletedAt: null,
      id,
      organizationId: actor.organizationId,
    },
    data: {
      deletedAt: new Date(),
      revision: {
        increment: 1,
      },
    },
  });
  return NextResponse.json({ ok: true });
}
