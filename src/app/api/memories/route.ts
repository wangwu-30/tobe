import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { mapMemory } from '@/lib/wiki/service';

export async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);
  const wikiId = searchParams.get('wikiId');

  const memories = await prisma.memory.findMany({
    where: {
      deletedAt: null,
      organizationId: actor.organizationId,
      ...(wikiId ? { documentId: wikiId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(memories.map(mapMemory));
}

export async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json();
  const memory = await prisma.memory.create({
    data: {
      active: body.active ?? true,
      category: body.category || 'preference',
      content: body.content,
      createdByUserId: actor.userId,
      documentId: body.wikiId || body.documentId || null,
      organizationId: actor.organizationId,
      originDeviceId: actor.deviceId,
    },
  });
  return NextResponse.json(mapMemory(memory));
}

export async function PATCH(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const memory = await prisma.memory.update({
    where: { id: body.id },
    data: {
      ...(body.content !== undefined && { content: body.content }),
      ...(body.active !== undefined && { active: body.active }),
      ...(body.category !== undefined && { category: body.category }),
      ...(body.wikiId !== undefined && { documentId: body.wikiId }),
      originDeviceId: actor.deviceId,
      createdByUserId: actor.userId,
      revision: {
        increment: 1,
      },
    },
  });
  return NextResponse.json(mapMemory(memory));
}

export async function DELETE(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  await prisma.memory.updateMany({
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
