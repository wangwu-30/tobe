import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await params;
  const messages = await prisma.commentMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json(messages);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await params;
  const body = await req.json();
  const message = await prisma.commentMessage.create({
    data: {
      threadId,
      role: body.role,
      content: body.content,
      model: body.model || null,
    },
  });

  // Update thread updatedAt
  await prisma.commentThread.update({
    where: { id: threadId },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json(message);
}
