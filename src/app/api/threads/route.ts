import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const documentId = searchParams.get('documentId');
  if (!documentId) return NextResponse.json({ error: 'Missing documentId' }, { status: 400 });

  const threads = await prisma.commentThread.findMany({
    where: { documentId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(threads);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const thread = await prisma.commentThread.create({
    data: {
      documentId: body.documentId,
      anchorText: body.anchorText,
      messages: {
        create: body.firstMessage
          ? { role: 'user', content: body.firstMessage }
          : undefined,
      },
    },
    include: { messages: true },
  });
  return NextResponse.json(thread);
}
