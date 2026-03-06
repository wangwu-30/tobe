import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET() {
  const items = await prisma.knowledgeItem.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const item = await prisma.knowledgeItem.create({
    data: {
      title: body.title,
      content: body.content,
      documentId: body.documentId || null,
      sourceType: body.sourceType || 'note',
    },
  });
  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  await prisma.knowledgeItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
