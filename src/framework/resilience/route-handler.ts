import { NextResponse } from 'next/server';

import { toAppError } from './app-error';

const MAX_LOG_MESSAGE_LENGTH = 500;
const UNEXPECTED_ERROR_MESSAGE = 'Unexpected error.';

type RouteHandler<TArgs extends unknown[] = unknown[]> = (
  ...args: TArgs
) => Promise<Response> | Response;

export function defineRoute<TArgs extends unknown[]>(handler: RouteHandler<TArgs>) {
  return async (...args: TArgs) => {
    try {
      return await handler(...args);
    } catch (error) {
      const appError = toAppError(error);
      const isUnexpected = appError.kind === 'unexpected';
      const publicMessage = isUnexpected
        ? UNEXPECTED_ERROR_MESSAGE
        : appError.message;
      // Next's development error inspector may itself throw while formatting an
      // Error object under the WASM SWC fallback. Keep route logging scalar so
      // the original status response is never replaced by that secondary error.
      console.error(
        `[route] ${appError.statusCode} ${appError.kind}: ${sanitizeLogMessage(publicMessage)}`
      );
      return NextResponse.json(
        {
          detail: isUnexpected ? null : appError.detail,
          error: publicMessage,
          kind: appError.kind,
        },
        { status: appError.statusCode }
      );
    }
  };
}

function sanitizeLogMessage(message: string) {
  return message
    .slice(0, MAX_LOG_MESSAGE_LENGTH)
    .replace(/[\p{C}\u2028\u2029]+/gu, ' ')
    .trim();
}
