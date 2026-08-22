import { apiCall, isRecord } from '@/framework/resilience';

export type ExecutionRecoveryAction = 'retry' | 'discard';
export type ExecutionRecoveryIncident = {
  id: string;
  jobId: string;
  attemptId: string;
  generation: number;
  stage: 'prepare' | 'finalize' | 'cleanup';
  reasonCode: string;
  classification:
    | 'absent'
    | 'prepared-clean'
    | 'prepared-dirty'
    | 'finalized-clean'
    | 'drifted'
    | 'partial'
    | 'unknown';
  discardable: boolean;
  status: 'open' | 'action_requested' | 'resolved';
  requestedAction: ExecutionRecoveryAction | null;
  resolution: 'retried' | 'discarded' | 'superseded' | null;
  actionRequestedAt: string | null;
  actionRequestedById: string | null;
  resolvedAt: string | null;
  revision: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ExecutionRecoveryInspection = {
  current: ExecutionRecoveryIncident | null;
  items: ExecutionRecoveryIncident[];
};

export type ExecutionRecoveryClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function inspectExecutionRecovery(
  jobId: string
): Promise<ExecutionRecoveryClientResult<ExecutionRecoveryInspection>> {
  const result = await apiCall<unknown>(
    `/api/execution-jobs/${encodeURIComponent(jobId)}/recovery`
  );
  if (!result.ok) return { ok: false, error: result.error.message };
  const root = record(result.data);
  const recovery = record(root.recovery);
  const items = Array.isArray(recovery.items)
    ? recovery.items.map(normalizeIncident).filter(isPresent)
    : null;
  if (!items) return invalidResponse('The recovery response was invalid.');
  const current = recovery.current === null
    ? null
    : normalizeIncident(recovery.current);
  if (recovery.current !== null && !current) {
    return invalidResponse('The current recovery incident was invalid.');
  }
  return { ok: true, data: { current, items } };
}

export async function requestExecutionRecoveryActionClient(
  jobId: string,
  incident: Pick<ExecutionRecoveryIncident, 'id' | 'revision'>,
  action: ExecutionRecoveryAction
): Promise<ExecutionRecoveryClientResult<ExecutionRecoveryIncident>> {
  const result = await apiCall<unknown>(
    `/api/execution-jobs/${encodeURIComponent(jobId)}/recovery`,
    {
      body: JSON.stringify({
        action,
        incidentId: incident.id,
        expectedRevision: incident.revision,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }
  );
  if (!result.ok) return { ok: false, error: result.error.message };
  const parsed = normalizeIncident(record(result.data).incident);
  return parsed
    ? { ok: true, data: parsed }
    : invalidResponse('The recovery action response was invalid.');
}

function normalizeIncident(value: unknown): ExecutionRecoveryIncident | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const jobId = text(value.jobId);
  const attemptId = text(value.attemptId);
  const generation = integer(value.generation);
  const revision = integer(value.revision);
  const stage = oneOf(value.stage, ['prepare', 'finalize', 'cleanup'] as const);
  const classification = oneOf(value.classification, [
    'absent',
    'prepared-clean',
    'prepared-dirty',
    'finalized-clean',
    'drifted',
    'partial',
    'unknown',
  ] as const);
  const status = oneOf(value.status, [
    'open',
    'action_requested',
    'resolved',
  ] as const);
  const requestedAction = nullableOneOf(value.requestedAction, [
    'retry',
    'discard',
  ] as const);
  const resolution = nullableOneOf(value.resolution, [
    'retried',
    'discarded',
    'superseded',
  ] as const);
  if (
    !id || !jobId || !attemptId || generation === null || revision === null ||
    !stage || !classification || !status || requestedAction === undefined ||
    resolution === undefined || typeof value.discardable !== 'boolean'
  ) {
    return null;
  }
  return {
    id, jobId, attemptId, generation, revision, stage, classification, status,
    reasonCode: text(value.reasonCode) || 'unknown',
    discardable: value.discardable,
    requestedAction,
    resolution,
    actionRequestedAt: text(value.actionRequestedAt),
    actionRequestedById: text(value.actionRequestedById),
    resolvedAt: text(value.resolvedAt),
    createdAt: text(value.createdAt),
    updatedAt: text(value.updatedAt),
  };
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  choices: T
): T[number] | null {
  return typeof value === 'string' && choices.includes(value)
    ? (value as T[number])
    : null;
}

function nullableOneOf<const T extends readonly string[]>(
  value: unknown,
  choices: T
): T[number] | null | undefined {
  return value === null ? null : oneOf(value, choices) ?? undefined;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function invalidResponse<T>(error: string): ExecutionRecoveryClientResult<T> {
  return { ok: false, error };
}
