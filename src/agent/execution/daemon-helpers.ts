import type { RuntimeEventV1 } from './driver';
import type {
  ActiveExecutionAttemptV1,
  DeferredV1,
  ExecutionDaemonJsonValueV1,
  ExecutionDaemonRecoveryStageV1,
  RuntimeCompletionV1,
} from './daemon-types';

export function completionFromEvent(
  event: Extract<RuntimeEventV1, { type: 'attempt-completed' }>,
  runtimeRunId: string | undefined,
  text: string,
  truncated: boolean
): RuntimeCompletionV1 {
  const runtime: Record<string, ExecutionDaemonJsonValueV1> = {};
  if (runtimeRunId) {
    runtime.runtimeRunId = runtimeRunId;
  }
  if (event.status === 'succeeded') {
    return {
      status: 'succeeded',
      result: {
        ...runtime,
        text,
        truncated,
        ...(event.message ? { message: event.message } : {}),
      },
    };
  }
  if (event.status === 'interrupted') {
    return {
      status: 'cancelled',
      ...(event.message
        ? { error: { ...runtime, message: event.message } }
        : {}),
    };
  }
  return {
    status: 'failed',
    error: {
      code: 'runtime-attempt-failed',
      ...runtime,
      message: event.message || 'Runtime attempt failed.',
    },
  };
}

export function partialPrepareFailure(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'branch-already-exists' ||
      error.code === 'worktree-path-conflict' ||
      error.code === 'worktree-state-changed')
  );
}

export function recoveryReasonCode(
  error: unknown,
  stage: ExecutionDaemonRecoveryStageV1
): string {
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[a-z0-9][a-z0-9-]{0,79}$/.test(error.code)
  ) {
    return error.code;
  }
  return `workspace-${stage}-failed`;
}

export function withRuntimeRunId(
  completion: RuntimeCompletionV1,
  runtimeRunId: string | undefined
): RuntimeCompletionV1 {
  return runtimeRunId ? { ...completion, runtimeRunId } : completion;
}

export function runtimeDriverFailure(error: unknown): RuntimeCompletionV1 {
  return {
    status: 'failed',
    error: {
      code: 'runtime-driver-error',
      message: errorMessage(error),
    },
  };
}

export function cancellationCompletion(
  runtimeRunId?: string
): RuntimeCompletionV1 {
  return {
    status: 'cancelled',
    error: {
      ...(runtimeRunId ? { runtimeRunId } : {}),
      message: 'Execution cancelled.',
    },
    ...(runtimeRunId ? { runtimeRunId } : {}),
  };
}

export function terminalEventForCompletion(
  completion: RuntimeCompletionV1
): Extract<RuntimeEventV1, { type: 'attempt-completed' }> {
  return {
    type: 'attempt-completed',
    status:
      completion.status === 'cancelled'
        ? 'interrupted'
        : completion.status,
    ...(completion.status === 'succeeded'
      ? {}
      : { message: terminalCompletionMessage(completion) }),
  };
}

export function terminalCompletionMessage(
  completion: RuntimeCompletionV1
): string {
  const error = completion.error;
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return completion.status === 'cancelled'
    ? 'Execution cancelled.'
    : 'Runtime attempt failed.';
}

export function runtimeEventId(generation: number, sequence: number): string {
  return `generation:${generation}:event:${sequence}`;
}

export function rememberInterruptAddress(
  active: ActiveExecutionAttemptV1,
  event: RuntimeEventV1
): void {
  if (event.type === 'attempt-started') {
    // A rejected write must not advance durable state, but this id is still
    // required to stop the orphaned runtime work.
    active.runtimeRunId = event.runtimeAttemptId;
  }
}

export function createDeferred(): DeferredV1 {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve() {
      resolvePromise?.();
      resolvePromise = undefined;
    },
  };
}

export function requireNonEmptyText(value: string, field: string): string {
  if (!value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

export function readPositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
