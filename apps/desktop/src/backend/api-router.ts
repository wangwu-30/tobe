import { NextRequest } from 'next/server';
import type { DesktopApiRequest, DesktopFormDataEntry, DesktopRequestBody } from '../shared/bridge';

const routeModules = import.meta.glob('../../../../src/app/api/**/route.ts');

type RouteHandlerModule = Partial<
  Record<'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT', RouteHandler>
>;

type RouteHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> }
) => Promise<Response> | Response;

type RouteDefinition = {
  loader: () => Promise<RouteHandlerModule>;
  paramNames: string[];
  pathname: string;
  pattern: RegExp;
};

const routeDefinitions = Object.entries(routeModules)
  .map(([modulePath, loader]) => createRouteDefinition(modulePath, loader))
  .sort((left, right) => right.pathname.length - left.pathname.length);

export async function invokeDesktopApiRoute(request: DesktopApiRequest) {
  const targetUrl = new URL(request.path, 'http://desktop.local');
  const match = matchRoute(targetUrl.pathname);
  if (!match) {
    return new Response(
      JSON.stringify({ error: `No desktop API route matches ${targetUrl.pathname}.` }),
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        status: 404,
        statusText: 'Not Found',
      }
    );
  }

  const routeModule = await match.definition.loader();
  const handler = routeModule[request.method as keyof RouteHandlerModule];
  if (typeof handler !== 'function') {
    return new Response(
      JSON.stringify({ error: `${request.method} is not supported for ${targetUrl.pathname}.` }),
      {
        headers: {
          Allow: Object.keys(routeModule).sort().join(', '),
          'Content-Type': 'application/json; charset=utf-8',
        },
        status: 405,
        statusText: 'Method Not Allowed',
      }
    );
  }

  const headers = new Headers(request.headers);
  const body = buildRequestBody(request.body, headers);
  const nextRequest = new NextRequest(targetUrl.toString(), {
    body,
    headers,
    method: request.method,
  });

  return handler(nextRequest, {
    params: Promise.resolve(match.params),
  });
}

function buildRequestBody(body: DesktopRequestBody, headers: Headers) {
  if (body.kind === 'empty') {
    return undefined;
  }

  if (body.kind === 'text') {
    return body.value;
  }

  headers.delete('content-type');
  const formData = new FormData();
  for (const entry of body.entries) {
    appendFormDataEntry(formData, entry);
  }
  return formData;
}

function appendFormDataEntry(formData: FormData, entry: DesktopFormDataEntry) {
  if (entry.kind === 'text') {
    formData.append(entry.name, entry.value);
    return;
  }

  const file = new File([entry.bytes], entry.fileName, {
    type: entry.mimeType || 'application/octet-stream',
  });
  formData.append(entry.name, file, entry.fileName);
}

function createRouteDefinition(
  modulePath: string,
  loader: () => Promise<unknown>
): RouteDefinition {
  const pathname = modulePath
    .replace(/\\/g, '/')
    .replace(/^.*\/src\/app/, '')
    .replace(/\/route\.ts$/, '');
  const paramNames: string[] = [];
  const pattern = new RegExp(
    `^${pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => {
        if (segment.startsWith('[') && segment.endsWith(']')) {
          const paramName = segment.slice(1, -1);
          paramNames.push(paramName);
          return `/(?<${paramName}>[^/]+)`;
        }

        return `/${escapeRegex(segment)}`;
      })
      .join('')}/?$`
  );

  return {
    loader: loader as () => Promise<RouteHandlerModule>,
    paramNames,
    pathname,
    pattern,
  };
}

function matchRoute(pathname: string) {
  for (const definition of routeDefinitions) {
    const match = definition.pattern.exec(pathname);
    if (!match) {
      continue;
    }

    const params = definition.paramNames.reduce<Record<string, string>>((acc, name) => {
      acc[name] = decodeURIComponent(match.groups?.[name] || '');
      return acc;
    }, {});

    return {
      definition,
      params,
    };
  }

  return null;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
