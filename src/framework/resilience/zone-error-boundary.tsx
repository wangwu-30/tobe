'use client';

import * as React from 'react';

import { recordError } from './error-ring';

type BoundaryFallbackArgs = {
  error: Error;
  retry: () => void;
};

type ZoneErrorBoundaryProps = {
  children: React.ReactNode;
  fallback?: React.ReactNode | ((args: BoundaryFallbackArgs) => React.ReactNode);
  level?: 'critical' | 'recoverable';
  zone: string;
};

type ZoneErrorBoundaryState = {
  error: Error | null;
};

export class ZoneErrorBoundary extends React.Component<
  ZoneErrorBoundaryProps,
  ZoneErrorBoundaryState
> {
  state: ZoneErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    recordError({
      detail: error.stack || null,
      message: error.message,
      source: 'boundary',
      stack: error.stack || null,
      zone: this.props.zone,
    });
  }

  private readonly retry = () => {
    this.setState({ error: null });
  };

  render() {
    const { children, fallback, level = 'recoverable', zone } = this.props;
    const { error } = this.state;

    if (!error) {
      return children;
    }

    if (typeof fallback === 'function') {
      return fallback({ error, retry: this.retry });
    }

    if (fallback) {
      return fallback;
    }

    return (
      <div
        className="flex h-full min-h-[200px] items-center justify-center bg-muted/20 p-6"
        data-testid={`zone-error-boundary-${zone}`}
      >
        <div className="w-full max-w-md rounded-2xl border border-destructive/20 bg-background p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-foreground">
            {level === 'critical' ? 'This area hit a critical error.' : 'This area hit an error.'}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {error.message || 'Something went wrong while rendering this section.'}
          </p>
          <button
            type="button"
            className="mt-4 inline-flex h-9 items-center justify-center rounded-full border border-border px-4 text-sm font-medium text-foreground transition hover:bg-muted"
            onClick={this.retry}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
}
