'use client';

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-full min-h-screen items-center justify-center bg-muted/20 p-6">
      <div className="w-full max-w-lg rounded-3xl border border-border bg-background p-8 shadow-sm">
        <p className="text-sm font-semibold text-foreground">Workspace failed to load.</p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {error.message || 'The workspace surface hit an unexpected error.'}
        </p>
        <button
          type="button"
          className="mt-5 inline-flex h-10 items-center justify-center rounded-full border border-border px-4 text-sm font-medium text-foreground transition hover:bg-muted"
          onClick={reset}
        >
          Retry
        </button>
      </div>
    </div>
  );
}
