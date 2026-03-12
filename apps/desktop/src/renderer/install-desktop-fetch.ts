import type { DesktopApiRequest, DesktopRequestBody } from '../shared/bridge';

const NATIVE_FETCH = globalThis.fetch.bind(globalThis);

export function installDesktopFetchBridge() {
  const desktopBridge = window.daoDesktop;
  if (
    !desktopBridge?.api?.fetch ||
    !desktopBridge.api.subscribeStream ||
    !desktopBridge.api.unsubscribeStream
  ) {
    return;
  }
  const desktopApi = {
    fetch: desktopBridge.api.fetch,
    subscribeStream: desktopBridge.api.subscribeStream,
    unsubscribeStream: desktopBridge.api.unsubscribeStream,
  };

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = await normalizeDesktopRequest(input, init);
    if (!request) {
      return NATIVE_FETCH(input, init);
    }

    const start = await desktopApi.fetch(request);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const token = desktopApi.subscribeStream((event) => {
          if (event.streamId !== start.streamId) {
            return;
          }

          if (event.type === 'chunk' && event.chunk) {
            controller.enqueue(new Uint8Array(event.chunk));
            return;
          }

          desktopApi.unsubscribeStream(token);
          if (event.type === 'error') {
            controller.error(new Error(event.error || 'Desktop stream failed.'));
          } else {
            controller.close();
          }
        });

        init?.signal?.addEventListener(
          'abort',
          () => {
            desktopApi.unsubscribeStream(token);
            controller.error(new DOMException('Aborted', 'AbortError'));
          },
          { once: true }
        );
      },
    });

    return new Response(stream, {
      headers: new Headers(start.headers),
      status: start.status,
      statusText: start.statusText,
    });
  };
}

async function normalizeDesktopRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<DesktopApiRequest | null> {
  const request = input instanceof Request ? input : null;
  const path = resolveRequestPath(input, request);
  if (!path?.startsWith('/api/')) {
    return null;
  }

  const method = (init?.method || request?.method || 'GET').toUpperCase();
  const headers = normalizeHeaders(init?.headers || request?.headers);
  const body = await normalizeBody(init?.body, request);

  return {
    body,
    headers,
    method,
    path,
  };
}

function resolveRequestPath(input: RequestInfo | URL, request: Request | null) {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return `${input.pathname}${input.search}`;
  }

  if (request) {
    const url = new URL(request.url, window.location.origin);
    return `${url.pathname}${url.search}`;
  }

  return null;
}

async function normalizeBody(body: RequestInit['body'], request: Request | null): Promise<DesktopRequestBody> {
  if (!body && !request) {
    return { kind: 'empty' };
  }

  if (body instanceof FormData) {
    return {
      entries: await serializeFormData(body),
      kind: 'form-data',
    };
  }

  if (typeof body === 'string') {
    return {
      kind: 'text',
      value: body,
    };
  }

  if (request && request.method !== 'GET' && request.method !== 'HEAD') {
    const cloned = request.clone();
    const contentType = cloned.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      return {
        entries: await serializeFormData(await cloned.formData()),
        kind: 'form-data',
      };
    }

    const text = await cloned.text();
    if (!text) {
      return { kind: 'empty' };
    }
    return {
      kind: 'text',
      value: text,
    };
  }

  return { kind: 'empty' };
}

function normalizeHeaders(headersInit?: HeadersInit) {
  const headers = new Headers(headersInit || undefined);
  return Object.fromEntries(headers.entries());
}

async function serializeFormData(formData: FormData) {
  const entries = [];
  for (const [name, value] of formData.entries()) {
    if (typeof value === 'string') {
      entries.push({
        kind: 'text' as const,
        name,
        value,
      });
      continue;
    }

    entries.push({
      bytes: await value.arrayBuffer(),
      fileName: value.name,
      kind: 'file' as const,
      mimeType: value.type || null,
      name,
    });
  }
  return entries;
}
