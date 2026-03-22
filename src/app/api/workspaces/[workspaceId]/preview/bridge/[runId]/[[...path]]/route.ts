import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { injectPreviewBridgeIntoHtml } from '@/lib/workspace/preview-bridge';
import { defineRoute } from '@/framework/resilience';


export const GET = defineRoute(async function GET(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ path?: string[]; runId: string; workspaceId: string }>;
  }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { path = [], runId, workspaceId } = await params;
  const shouldServeRetryShell = isRootDocumentRequest(req, path);
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

    if (shouldServeRetryShell && upstream.status >= 500) {
      return createPreviewRetryShellResponse();
    }

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
    if (shouldServeRetryShell) {
      return createPreviewRetryShellResponse();
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Could not load preview bridge asset.',
      },
      { status: 502 }
    );
  }
});

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

function isRootDocumentRequest(req: NextRequest, path: string[]) {
  if (path.length > 0) {
    return false;
  }

  const accept = req.headers.get('accept') || '';
  return accept.includes('text/html') || accept.includes('*/*');
}

function createPreviewRetryShellResponse() {
  return new NextResponse(buildPreviewRetryShellHtml(), {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
    },
    status: 503,
  });
}

function buildPreviewRetryShellHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Starting preview...</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "SF Pro Display", "Helvetica Neue", sans-serif;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(15, 23, 42, 0.06), transparent 55%),
          #f8fafc;
        color: #0f172a;
      }

      main {
        width: min(420px, calc(100vw - 48px));
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 28px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 24px 70px -40px rgba(15, 23, 42, 0.45);
        padding: 28px 24px;
        text-align: center;
      }

      .spinner {
        width: 28px;
        height: 28px;
        margin: 0 auto 16px;
        border-radius: 999px;
        border: 3px solid rgba(148, 163, 184, 0.3);
        border-top-color: #0f172a;
        animation: spin 0.9s linear infinite;
      }

      h1 {
        margin: 0;
        font-size: 18px;
        line-height: 1.4;
      }

      p {
        margin: 10px 0 0;
        font-size: 14px;
        line-height: 1.6;
        color: #475569;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="spinner" aria-hidden="true"></div>
      <h1>Starting preview...</h1>
      <p>The preview runtime is still warming up. This page will retry automatically.</p>
    </main>
    <script>
      window.setTimeout(() => window.location.reload(), 700);
    </script>
  </body>
</html>`;
}
