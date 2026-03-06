import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET() {
  const memories = await prisma.memory.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(memories);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const memory = await prisma.memory.update({
    where: { id: body.id },
    data: {
      ...(body.content !== undefined && { content: body.content }),
      ...(body.active !== undefined && { active: body.active }),
      ...(body.category !== undefined && { category: body.category }),
    },
  });
  return NextResponse.json(memory);
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  await prisma.memory.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
