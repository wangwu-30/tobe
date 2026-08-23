import { safeJsonParse } from './safe-data';

const DEFAULT_API_TIMEOUT_MS = 30_000;
const DEFAULT_BACKOFF_MS = 500;
const DEFAULT_RETRY_STATUSES = [408, 429, 500, 502, 503, 504];

export type ApiErrorKind = 'http' | 'network' | 'parse' | 'timeout';

export type ApiErrorData = {
  code?: string | null;
  detail: string | null;
  kind: ApiErrorKind;
  message: string;
  retryable: boolean;
  status: number | null;
};

export type ApiResult<T> =
  | {
      data: T;
      ok: true;
      response: Response;
    }
  | {
      error: ApiErrorData;
      ok: false;
      response: Response | null;
    };

type ApiFetchOptions = Omit<RequestInit, 'signal'> & {
  backoffMs?: number;
  retries?: number;
  retryStatuses?: number[];
  signal?: AbortSignal | null;
  timeoutMs?: number;
};

type ApiCallOptions = ApiFetchOptions & {
  parseAs?: 'json' | 'text' | 'void';
};

export async function apiFetch(input: RequestInfo | URL, options: ApiFetchOptions = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const retries = options.retries ?? (method === 'GET' || method === 'HEAD' ? 1 : 0);
  const retryStatuses = options.retryStatuses ?? DEFAULT_RETRY_STATUSES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId =
      timeoutMs > 0
        ? globalThis.setTimeout(() => controller.abort('timeout'), timeoutMs)
        : null;
    const externalSignal = options.signal;
    const handleExternalAbort = () => controller.abort('aborted');
    externalSignal?.addEventListener('abort', handleExternalAbort, { once: true });

    try {
      const response = await fetch(input, {
        ...options,
        signal: controller.signal,
      });

      if (
        attempt < retries &&
        retryStatuses.includes(response.status) &&
        isRetryableMethod(method)
      ) {
        await wait(backoffMs * 2 ** attempt);
        continue;
      }

      return response;
    } catch (error) {
      const timeout = controller.signal.aborted && controller.signal.reason === 'timeout';
      const retryable = attempt < retries && isRetryableMethod(method);
      if (retryable) {
        await wait(backoffMs * 2 ** attempt);
        continue;
      }

      return buildSyntheticErrorResponse({
        detail: error instanceof Error ? error.message : null,
        kind: timeout ? 'timeout' : 'network',
        message: timeout ? 'The request timed out.' : 'The request could not be completed.',
        retryable: isRetryableMethod(method),
        status: timeout ? 408 : 503,
      });
    } finally {
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
      externalSignal?.removeEventListener('abort', handleExternalAbort);
    }
  }

  return buildSyntheticErrorResponse({
    detail: null,
    kind: 'network',
    message: 'The request could not be completed.',
    retryable: false,
    status: 503,
  });
}

export async function apiCall<T>(
  input: RequestInfo | URL,
  options: ApiCallOptions = {}
): Promise<ApiResult<T>> {
  const response = await apiFetch(input, options);

  if (!response.ok) {
    return {
      error: await readApiError(response),
      ok: false,
      response,
    };
  }

  if (options.parseAs === 'void') {
    return {
      data: undefined as T,
      ok: true,
      response,
    };
  }

  if (options.parseAs === 'text') {
    return {
      data: (await response.text()) as T,
      ok: true,
      response,
    };
  }

  const raw = await response.text();
  if (!raw.trim()) {
    return {
      data: null as T,
      ok: true,
      response,
    };
  }

  const parsed = safeJsonParse<unknown>(raw, null);
  if (parsed === null) {
    return {
      error: {
        code: null,
        detail: raw.slice(0, 2000) || null,
        kind: 'parse',
        message: 'The response could not be parsed.',
        retryable: false,
        status: response.status,
      },
      ok: false,
      response,
    };
  }

  return {
    data: parsed as T,
    ok: true,
    response,
  };
}

export async function apiCallOrThrow<T>(
  input: RequestInfo | URL,
  options: ApiCallOptions & {
    fallbackMessage: string;
  }
) {
  const result = await apiCall<T>(input, options);
  if (!result.ok) {
    throw new Error(result.error.message || options.fallbackMessage);
  }
  return result.data;
}

export async function readApiError(response: Response): Promise<ApiErrorData> {
  const raw = await response.text().catch(() => '');
  const payload = safeJsonParse<Record<string, unknown> | null>(raw, null);
  const fallbackMessage =
    response.statusText || 'The request failed.';
  const parsedResponseFailed = raw.trim().length > 0 && payload === null;

  return {
    code: typeof payload?.code === 'string' ? payload.code : null,
    detail:
      typeof payload?.detail === 'string'
        ? payload.detail
        : raw.trim()
          ? raw.slice(0, 2000)
          : null,
    kind:
      payload?.kind === 'network' ||
      payload?.kind === 'parse' ||
      payload?.kind === 'timeout'
        ? payload.kind
        : parsedResponseFailed
          ? 'parse'
        : 'http',
    message:
      parsedResponseFailed
        ? 'The response could not be parsed.'
        : typeof payload?.error === 'string'
        ? payload.error
        : typeof payload?.message === 'string'
          ? payload.message
          : fallbackMessage,
    retryable:
      typeof payload?.retryable === 'boolean'
        ? payload.retryable
        : DEFAULT_RETRY_STATUSES.includes(response.status),
    status: response.status,
  };
}

function buildSyntheticErrorResponse(error: ApiErrorData) {
  return new Response(JSON.stringify({
    code: error.code || null,
    detail: error.detail,
    error: error.message,
    kind: error.kind,
    retryable: error.retryable,
  }), {
    headers: {
      'Content-Type': 'application/json',
    },
    status: error.status || 500,
  });
}

function isRetryableMethod(method: string) {
  return method === 'GET' || method === 'HEAD';
}

function wait(ms: number) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
