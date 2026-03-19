import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { injectPreviewBridgeIntoHtml } from '@/lib/workspace/preview-bridge';

export async function GET(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ path?: string[]; runId: string; workspaceId: string }>;
  }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { path = [], runId, workspaceId } = await params;
  const run = await prisma.workspaceRun.findFirst({
    where: {
      documentId: workspaceId,
      id: runId,
      kind: 'preview',
      organizationId: actor.organizationId,
    },
    select: {
      previewUrl: true,
    },
  });

  if (!run?.previewUrl) {
    return NextResponse.json(
      { error: 'Preview run not found.' },
      { status: 404 }
    );
  }

  try {
    const targetUrl = new URL(run.previewUrl);
    targetUrl.pathname = appendTargetPath(targetUrl.pathname, path);
    targetUrl.search = req.nextUrl.search;

    const upstream = await fetch(targetUrl, {
      headers: forwardPreviewHeaders(req.headers),
      redirect: 'manual',
    });
    const headers = new Headers(upstream.headers);
    headers.delete('content-length');
    headers.delete('content-security-policy');
    headers.delete('x-frame-options');

    const contentType = headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const html = await upstream.text();
      return new NextResponse(injectPreviewBridgeIntoHtml(html), {
        headers,
        status: upstream.status,
        statusText: upstream.statusText,
      });
    }

    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      headers,
      status: upstream.status,
      statusText: upstream.statusText,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Could not load preview bridge asset.',
      },
      { status: 502 }
    );
  }
}

function appendTargetPath(basePathname: string, extraPath: string[]) {
  if (extraPath.length === 0) {
    return basePathname || '/';
  }

  const trimmedBase = basePathname.endsWith('/') ? basePathname.slice(0, -1) : basePathname;
  return `${trimmedBase}/${extraPath.map(encodeURIComponent).join('/')}`;
}

function forwardPreviewHeaders(headers: Headers) {
  const nextHeaders = new Headers();
  const accept = headers.get('accept');
  const acceptLanguage = headers.get('accept-language');
  const userAgent = headers.get('user-agent');

  if (accept) {
    nextHeaders.set('accept', accept);
  }

  if (acceptLanguage) {
    nextHeaders.set('accept-language', acceptLanguage);
  }

  if (userAgent) {
    nextHeaders.set('user-agent', userAgent);
  }

  return nextHeaders;
}
