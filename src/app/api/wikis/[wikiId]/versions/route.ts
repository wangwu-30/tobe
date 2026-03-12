import { NextRequest, NextResponse } from 'next/server';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { createWikiVersion, listWikiVersions, WikiLockConflictError } from '@/lib/wiki/service';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wikiId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { wikiId } = await params;
  const versions = await listWikiVersions({
    organizationId: actor.organizationId,
    wikiId,
  });

  return NextResponse.json(versions);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wikiId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { wikiId } = await params;

  try {
    const version = await createWikiVersion(actor, wikiId);
    return NextResponse.json(version);
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
