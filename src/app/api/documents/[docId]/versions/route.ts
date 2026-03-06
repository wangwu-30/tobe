import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  const { docId } = await params;
  const versions = await prisma.version.findMany({
    where: { documentId: docId },
    orderBy: { versionNum: 'desc' },
  });
  return NextResponse.json(versions);
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  const { docId } = await params;
  const doc = await prisma.document.findUnique({ where: { id: docId } });
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const nextVersion = doc.currentVersion + 1;

  const [version] = await prisma.$transaction([
    prisma.version.create({
      data: {
        documentId: docId,
        versionNum: nextVersion,
        content: doc.content,
        title: doc.title,
      },
    }),
    prisma.document.update({
      where: { id: docId },
      data: { currentVersion: nextVersion, status: 'locked' },
    }),
  ]);

  return NextResponse.json(version);
}
