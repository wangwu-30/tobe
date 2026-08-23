'use client';

import * as React from 'react';

import { ZoneErrorBoundary } from '@/framework/resilience';

export function ResilienceDebugPage() {
  const [shouldCrash, setShouldCrash] = React.useState(false);

  React.useEffect(() => {
    setShouldCrash(true);
  }, []);

  return (
    <main className="grid min-h-screen gap-6 bg-slate-50 p-8 md:grid-cols-2">
      <section
        className="rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm"
        data-testid="resilience-healthy-zone"
      >
        <p className="text-sm font-semibold text-slate-900">Healthy sibling zone</p>
        <p className="mt-2 text-sm text-slate-600">
          This block must stay visible while a neighboring zone crashes.
        </p>
      </section>

      <ZoneErrorBoundary
        zone="debug-deliverable"
        fallback={({ error, retry }) => (
          <section
            className="rounded-3xl border border-rose-200 bg-white p-6 shadow-sm"
            data-testid="resilience-fallback-zone"
          >
            <p className="text-sm font-semibold text-slate-900">
              This zone hit an error.
            </p>
            <p className="mt-2 text-sm text-slate-600">{error.message}</p>
            <button
              type="button"
              className="mt-4 inline-flex h-9 items-center justify-center rounded-full border border-slate-300 px-4 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
              onClick={() => {
                setShouldCrash(false);
                retry();
              }}
            >
              Retry
            </button>
          </section>
        )}
      >
        <DebugCrashingZone shouldCrash={shouldCrash} />
      </ZoneErrorBoundary>
    </main>
  );
}

function DebugCrashingZone({ shouldCrash }: { shouldCrash: boolean }) {
  if (shouldCrash) {
    throw new Error('Debug deliverable zone crashed.');
  }

  return (
    <section
      className="rounded-3xl border border-sky-200 bg-white p-6 shadow-sm"
      data-testid="resilience-recovered-zone"
    >
      <p className="text-sm font-semibold text-slate-900">Recovered zone</p>
      <p className="mt-2 text-sm text-slate-600">
        Retry should restore only this zone.
      </p>
    </section>
  );
}
