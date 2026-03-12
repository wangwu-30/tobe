import { NextRequest, NextResponse } from 'next/server';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { acquireWikiLock, releaseWikiLock, WikiLockConflictError } from '@/lib/wiki/service';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wikiId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { wikiId } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    const lock = await acquireWikiLock(actor, {
      lockedVersionId: body.lockedVersionId,
      ttlMinutes: body.ttlMinutes,
      wikiId,
    });

    return NextResponse.json(lock);
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

  try {
    return NextResponse.json(await releaseWikiLock(actor, wikiId));
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
