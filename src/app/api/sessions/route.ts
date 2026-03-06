import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET() {
  const sessions = await prisma.session.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: { take: 1, orderBy: { createdAt: 'desc' } },
      documents: { take: 1, orderBy: { updatedAt: 'desc' } },
    },
  });
  return NextResponse.json(sessions);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const session = await prisma.session.create({
    data: { title: body.title || 'New Session' },
  });
  return NextResponse.json(session);
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  await prisma.session.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
