import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function POST(req: NextRequest) {
  const { sessionId, title, content } = await req.json();

  const doc = await prisma.document.create({
    data: {
      sessionId,
      title: title || 'Untitled',
      content: content || '[]',
      status: 'reviewing',
    },
  });

  return NextResponse.json(doc);
}
