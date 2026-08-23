import * as React from 'react';

import { ExecutionJobsPage } from '@/components/execution/execution-jobs-page';

export default function JobsPage() {
  return (
    <React.Suspense
      fallback={
        <div
          aria-live="polite"
          className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground"
          role="status"
        >
          Loading execution jobs…
        </div>
      }
    >
      <ExecutionJobsPage />
    </React.Suspense>
  );
}
