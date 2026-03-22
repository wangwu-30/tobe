export type AppErrorKind =
  | 'conflict'
  | 'forbidden'
  | 'network'
  | 'not-found'
  | 'timeout'
  | 'unexpected'
  | 'unauthorized'
  | 'validation';

type AppErrorOptions = {
  cause?: unknown;
  detail?: string | null;
  kind?: AppErrorKind;
  retryable?: boolean;
  statusCode?: number;
};

export class AppError extends Error {
  readonly detail: string | null;
  readonly kind: AppErrorKind;
  readonly retryable: boolean;
  readonly statusCode: number;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.detail = options.detail ?? null;
    this.kind = options.kind ?? 'unexpected';
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode ?? 500;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, options: Omit<AppErrorOptions, 'kind' | 'statusCode'> = {}) {
    super(message, { ...options, kind: 'validation', statusCode: 400 });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized.', options: Omit<AppErrorOptions, 'kind' | 'statusCode'> = {}) {
    super(message, { ...options, kind: 'unauthorized', statusCode: 401 });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden.', options: Omit<AppErrorOptions, 'kind' | 'statusCode'> = {}) {
    super(message, { ...options, kind: 'forbidden', statusCode: 403 });
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, options: Omit<AppErrorOptions, 'kind' | 'statusCode'> = {}) {
    super(message, { ...options, kind: 'not-found', statusCode: 404 });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, options: Omit<AppErrorOptions, 'kind' | 'statusCode'> = {}) {
    super(message, { ...options, kind: 'conflict', statusCode: 409 });
  }
}

export function toAppError(error: unknown) {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    const mapped = mapNamedError(error);
    if (mapped) {
      return mapped;
    }

    return new AppError(error.message || 'Unexpected error.', {
      cause: error,
      detail: error.stack || null,
    });
  }

  return new AppError('Unexpected error.', {
    detail: stringifyUnknownError(error),
  });
}

function mapNamedError(error: Error) {
  switch (error.name) {
    case 'IdempotencyConflictError':
    case 'WorkspaceLockConflictError':
    case 'WorkspaceRecoveryPinLimitError':
      return new ConflictError(error.message, {
        cause: error,
        detail: error.stack || null,
      });
    default:
      return null;
  }
}

function stringifyUnknownError(error: unknown) {
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  try {
    return JSON.stringify(error);
  } catch {
    return null;
  }
}
