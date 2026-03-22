'use client';

import * as React from 'react';

import { recordError } from './error-ring';

let initialized = false;

export function initGlobalErrorHandlers() {
  if (initialized || typeof window === 'undefined') {
    return;
  }

  initialized = true;

  window.addEventListener('error', (event) => {
    recordError({
      detail: event.message || null,
      message: event.error instanceof Error ? event.error.message : event.message || 'Unknown error.',
      source: 'global',
      stack: event.error instanceof Error ? event.error.stack || null : null,
      zone: null,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    recordError({
      detail: stringifyReason(reason),
      message:
        reason instanceof Error
          ? reason.message
          : 'Unhandled promise rejection.',
      source: 'global',
      stack: reason instanceof Error ? reason.stack || null : null,
      zone: null,
    });
  });
}

export function GlobalErrorHandlers() {
  React.useEffect(() => {
    initGlobalErrorHandlers();
  }, []);

  return null;
}

function stringifyReason(reason: unknown) {
  if (typeof reason === 'string' && reason.trim()) {
    return reason.trim();
  }

  if (reason instanceof Error) {
    return reason.stack || reason.message;
  }

  try {
    return JSON.stringify(reason);
  } catch {
    return null;
  }
}
