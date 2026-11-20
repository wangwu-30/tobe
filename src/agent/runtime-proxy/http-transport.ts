import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage } from 'node:http';

import { safeJsonParse } from '@/framework/resilience/safe-data';

export const HTTP_PROXY_DEFAULT_TIMEOUT_MS_V1 = 30_000;
export const HTTP_PROXY_DEFAULT_MAX_RESPONSE_BYTES_V1 = 2 * 1024 * 1024;
export const HTTP_PROXY_DEFAULT_MAX_LINE_BYTES_V1 = 512 * 1024;

export type HttpProxyEndpointValidationCodeV1 =
  | 'missing-endpoint'
  | 'invalid-endpoint'
  | 'remote-endpoint-disallowed'
  | 'remote-endpoint-requires-https';

export type HttpProxyEndpointValidationResultV1 =
  | { valid: true; normalizedBaseUrl: string; isLoopback: boolean }
  | {
      valid: false;
      code: HttpProxyEndpointValidationCodeV1;
      message: string;
    };

export type HttpProxyJsonRequestV1 = {
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
};

export type HttpProxyJsonResponseV1 = {
  status: number;
  body: unknown;
};

export type HttpProxyStreamRequestV1 = {
  path: string;
  body?: unknown;
  signal?: AbortSignal;
};

export interface HttpProxyTransportV1 {
  requestJson(
    request: HttpProxyJsonRequestV1
  ): Promise<HttpProxyJsonResponseV1>;
  streamNdjson(request: HttpProxyStreamRequestV1): AsyncIterable<unknown>;
}

export type NodeHttpProxyTransportConfigV1 = {
  baseUrl: string;
  token?: string | null;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  maxLineBytes?: number;
  allowRemoteEndpoint?: boolean;
};

export type HttpProxyTransportErrorCodeV1 =
  | 'proxy-endpoint-invalid'
  | 'proxy-request-aborted'
  | 'proxy-request-timeout'
  | 'proxy-network-error'
  | 'proxy-http-error'
  | 'proxy-response-too-large'
  | 'proxy-malformed-json';

/**
 * Typed transport failure. Error messages and metadata never embed credentials.
 */
export class HttpProxyTransportError extends Error {
  readonly code: HttpProxyTransportErrorCodeV1;
  readonly status?: number;

  constructor(
    code: HttpProxyTransportErrorCodeV1,
    message: string,
    status?: number
  ) {
    super(message);
    this.name = 'HttpProxyTransportError';
    this.code = code;
    this.status = status;
  }
}

export function isLoopbackHostnameV1(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}

/**
 * Validates proxy endpoints fail-closed. By default only loopback HTTP(S)
 * endpoints are permitted; remote endpoints require explicit opt-in and HTTPS.
 */
export function validateHttpProxyEndpointV1(
  rawEndpoint: string | null | undefined,
  options: { allowRemoteEndpoint?: boolean } = {}
): HttpProxyEndpointValidationResultV1 {
  const trimmed = rawEndpoint?.trim() ?? '';
  if (!trimmed) {
    return {
      valid: false,
      code: 'missing-endpoint',
      message: 'An explicit runtime proxy endpoint URL is required.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      code: 'invalid-endpoint',
      message:
        'The runtime proxy endpoint must be an absolute HTTP(S) URL without embedded credentials.',
    };
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    return {
      valid: false,
      code: 'invalid-endpoint',
      message:
        'The runtime proxy endpoint must be a clean HTTP(S) base URL without credentials, query, or fragment.',
    };
  }

  const loopback = isLoopbackHostnameV1(parsed.hostname);
  if (!loopback) {
    if (!options.allowRemoteEndpoint) {
      return {
        valid: false,
        code: 'remote-endpoint-disallowed',
        message:
          'Non-loopback runtime proxy endpoints are blocked by default; set allowRemoteEndpoint: true to opt in.',
      };
    }
    if (parsed.protocol !== 'https:') {
      return {
        valid: false,
        code: 'remote-endpoint-requires-https',
        message: 'Non-loopback runtime proxy endpoints must use HTTPS.',
      };
    }
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  return {
    valid: true,
    normalizedBaseUrl: `${parsed.origin}${normalizedPath}`,
    isLoopback: loopback,
  };
}

export function createNodeHttpProxyTransportV1(
  config: NodeHttpProxyTransportConfigV1
): HttpProxyTransportV1 {
  const endpointCheck = validateHttpProxyEndpointV1(config.baseUrl, {
    allowRemoteEndpoint: config.allowRemoteEndpoint,
  });
  if (!endpointCheck.valid) {
    throw new HttpProxyTransportError(
      'proxy-endpoint-invalid',
      endpointCheck.message
    );
  }

  const baseUrl = endpointCheck.normalizedBaseUrl;
  const token = config.token?.trim() || null;
  const timeoutMs = readPositiveBudget(
    config.requestTimeoutMs ?? HTTP_PROXY_DEFAULT_TIMEOUT_MS_V1,
    'requestTimeoutMs'
  );
  const maxResponseBytes = readPositiveBudget(
    config.maxResponseBytes ?? HTTP_PROXY_DEFAULT_MAX_RESPONSE_BYTES_V1,
    'maxResponseBytes'
  );
  const maxLineBytes = readPositiveBudget(
    config.maxLineBytes ?? HTTP_PROXY_DEFAULT_MAX_LINE_BYTES_V1,
    'maxLineBytes'
  );

  return {
    async requestJson(request) {
      const targetUrl = resolveProxyPath(baseUrl, request.path);
      const payload =
        request.body === undefined ? undefined : JSON.stringify(request.body);
      const response = await openNodeRequest({
        url: targetUrl,
        method: request.method ?? 'POST',
        payload,
        accept: 'application/json',
        token,
        timeoutMs,
        signal: request.signal,
      });

      const text = await readBoundedBody(
        response,
        maxResponseBytes,
        request.signal
      );
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        throw new HttpProxyTransportError(
          'proxy-http-error',
          `Runtime proxy returned HTTP ${status} for ${request.path}.`,
          status
        );
      }
      if (!text.trim()) {
        return { status, body: null };
      }
      const parsed = safeJsonParse<unknown>(text, PARSE_SENTINEL);
      if (parsed === PARSE_SENTINEL) {
        throw new HttpProxyTransportError(
          'proxy-malformed-json',
          `Runtime proxy returned invalid JSON for ${request.path}.`,
          status
        );
      }
      return { status, body: parsed };
    },

    async *streamNdjson(request) {
      const targetUrl = resolveProxyPath(baseUrl, request.path);
      const payload =
        request.body === undefined ? undefined : JSON.stringify(request.body);
      const response = await openNodeRequest({
        url: targetUrl,
        method: 'POST',
        payload,
        accept: 'application/x-ndjson, application/json',
        token,
        timeoutMs,
        signal: request.signal,
      });

      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        response.resume();
        throw new HttpProxyTransportError(
          'proxy-http-error',
          `Runtime proxy stream returned HTTP ${status} for ${request.path}.`,
          status
        );
      }

      const onAbort = () => {
        response.destroy(
          new HttpProxyTransportError(
            'proxy-request-aborted',
            'Runtime proxy stream was aborted.'
          )
        );
      };
      if (request.signal?.aborted) {
        onAbort();
        throw new HttpProxyTransportError(
          'proxy-request-aborted',
          'Runtime proxy stream was aborted.'
        );
      }
      request.signal?.addEventListener('abort', onAbort, { once: true });

      let totalBytes = 0;
      let buffer = '';
      try {
        for await (const chunk of response) {
          const bytes = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(String(chunk), 'utf8');
          totalBytes += bytes.byteLength;
          if (totalBytes > maxResponseBytes) {
            throw new HttpProxyTransportError(
              'proxy-response-too-large',
              'Runtime proxy stream exceeded maximum response byte budget.'
            );
          }

          buffer += bytes.toString('utf8');
          if (Buffer.byteLength(buffer, 'utf8') > maxLineBytes && !buffer.includes('\n')) {
            throw new HttpProxyTransportError(
              'proxy-response-too-large',
              'Runtime proxy stream line exceeded maximum line byte budget.'
            );
          }

          let newlineIndex = buffer.indexOf('\n');
          while (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (line.length > 0) {
              yield parseNdjsonLine(line, request.path);
            }
            newlineIndex = buffer.indexOf('\n');
          }
        }

        const trailing = buffer.trim();
        if (trailing.length > 0) {
          yield parseNdjsonLine(trailing, request.path);
        }
      } catch (error) {
        if (error instanceof HttpProxyTransportError) {
          throw error;
        }
        if (request.signal?.aborted) {
          throw new HttpProxyTransportError(
            'proxy-request-aborted',
            'Runtime proxy stream was aborted.'
          );
        }
        throw new HttpProxyTransportError(
          'proxy-network-error',
          `Runtime proxy stream failed for ${request.path}.`
        );
      } finally {
        request.signal?.removeEventListener('abort', onAbort);
        if (!response.destroyed) {
          response.destroy();
        }
      }
    },
  };
}

const PARSE_SENTINEL = Symbol('http-proxy-json-parse-failed');

function parseNdjsonLine(line: string, path: string): unknown {
  const parsed = safeJsonParse<unknown>(line, PARSE_SENTINEL);
  if (parsed === PARSE_SENTINEL) {
    throw new HttpProxyTransportError(
      'proxy-malformed-json',
      `Runtime proxy emitted malformed NDJSON line for ${path}.`
    );
  }
  return parsed;
}

function readPositiveBudget(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new HttpProxyTransportError(
      'proxy-endpoint-invalid',
      `${field} must be a positive integer.`
    );
  }
  return value;
}

function resolveProxyPath(baseUrl: string, path: string): URL {
  if (!path.startsWith('/')) {
    throw new HttpProxyTransportError(
      'proxy-endpoint-invalid',
      'Proxy request path must start with "/".'
    );
  }
  return new URL(`${baseUrl}${path}`);
}

function openNodeRequest(options: {
  url: URL;
  method: 'GET' | 'POST';
  payload?: string;
  accept: string;
  token: string | null;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(
        new HttpProxyTransportError(
          'proxy-request-aborted',
          'Runtime proxy request was aborted before sending.'
        )
      );
      return;
    }

    const transport = options.url.protocol === 'https:' ? https : http;
    const headers: Record<string, string> = {
      Accept: options.accept,
    };
    if (options.payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(
        Buffer.byteLength(options.payload, 'utf8')
      );
    }
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      fn();
    };

    const req = transport.request(
      options.url,
      {
        method: options.method,
        headers,
        timeout: options.timeoutMs,
      },
      (res) => {
        finish(() => resolve(res));
      }
    );

    const onAbort = () => {
      req.destroy(
        new HttpProxyTransportError(
          'proxy-request-aborted',
          'Runtime proxy request was aborted.'
        )
      );
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    req.on('timeout', () => {
      req.destroy(
        new HttpProxyTransportError(
          'proxy-request-timeout',
          `Runtime proxy request timed out after ${options.timeoutMs}ms.`
        )
      );
    });

    req.on('error', (error) => {
      finish(() => {
        if (error instanceof HttpProxyTransportError) {
          reject(error);
          return;
        }
        if (options.signal?.aborted) {
          reject(
            new HttpProxyTransportError(
              'proxy-request-aborted',
              'Runtime proxy request was aborted.'
            )
          );
          return;
        }
        reject(
          new HttpProxyTransportError(
            'proxy-network-error',
            `Runtime proxy request failed: ${error.message}`
          )
        );
      });
    });

    if (options.payload !== undefined) {
      req.write(options.payload);
    }
    req.end();
  });
}

function readBoundedBody(
  response: IncomingMessage,
  maxBytes: number,
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      fn();
    };

    const onAbort = () => {
      response.destroy();
      finish(() =>
        reject(
          new HttpProxyTransportError(
            'proxy-request-aborted',
            'Runtime proxy response was aborted.'
          )
        )
      );
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    response.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
      totalBytes += buf.byteLength;
      if (totalBytes > maxBytes) {
        response.destroy();
        finish(() =>
          reject(
            new HttpProxyTransportError(
              'proxy-response-too-large',
              'Runtime proxy response exceeded maximum byte budget.'
            )
          )
        );
        return;
      }
      chunks.push(buf);
    });

    response.on('end', () => {
      finish(() => resolve(Buffer.concat(chunks).toString('utf8')));
    });

    response.on('error', (error) => {
      finish(() => {
        if (error instanceof HttpProxyTransportError) {
          reject(error);
          return;
        }
        reject(
          new HttpProxyTransportError(
            'proxy-network-error',
            `Runtime proxy response failed: ${error.message}`
          )
        );
      });
    });
  });
}
