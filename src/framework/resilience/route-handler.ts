import { NextResponse } from 'next/server';

import { toAppError } from './app-error';

type RouteHandler<TArgs extends unknown[] = unknown[]> = (
  ...args: TArgs
) => Promise<Response> | Response;

export function defineRoute<TArgs extends unknown[]>(handler: RouteHandler<TArgs>) {
  return async (...args: TArgs) => {
    try {
      return await handler(...args);
    } catch (error) {
      const appError = toAppError(error);
      console.error('[route]', appError);
      return NextResponse.json(
        {
          detail: appError.detail,
          error: appError.message,
          kind: appError.kind,
        },
        { status: appError.statusCode }
      );
    }
  };
}
