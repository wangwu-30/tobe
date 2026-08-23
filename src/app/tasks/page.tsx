import * as React from 'react';

import { TaskCenter } from '@/components/tasks/task-center';

export default function TasksPage() {
  return (
    <React.Suspense
      fallback={
        <div
          aria-live="polite"
          className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground"
          role="status"
        >
          Loading team tasks…
        </div>
      }
    >
      <TaskCenter />
    </React.Suspense>
  );
}
