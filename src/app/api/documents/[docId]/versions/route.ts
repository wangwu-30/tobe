import { NextRequest, NextResponse } from 'next/server';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { isVisibleVersion } from '@/lib/workspace/planning';
import { createWikiVersion, listWikiVersions, WikiLockConflictError } from '@/lib/wiki/service';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { docId } = await params;
  const versions = await listWikiVersions({
    organizationId: actor.organizationId,
    wikiId: docId,
  });
  return NextResponse.json(versions.filter(isVisibleVersion));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { docId } = await params;

  try {
    const version = await createWikiVersion(actor, docId);
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
