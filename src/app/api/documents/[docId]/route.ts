import { NextRequest, NextResponse } from 'next/server';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { getWikiWorkspace, updateWiki, WikiLockConflictError } from '@/lib/wiki/service';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { docId } = await params;
  const workspace = await getWikiWorkspace({
    organizationId: actor.organizationId,
    wikiId: docId,
  });

  if (!workspace.wiki) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(workspace.wiki);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { docId } = await params;
  const body = await req.json();

  try {
    const wiki = await updateWiki(actor, {
      content: body.content,
      status: body.status,
      title: body.title,
      wikiId: docId,
    });

    return NextResponse.json(wiki);
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
