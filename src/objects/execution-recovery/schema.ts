export const EXECUTION_RECOVERY_SCHEMA_VERSION_V1 = 1 as const;

export const EXECUTION_RECOVERY_STAGES_V1 = [
  'prepare',
  'finalize',
  'cleanup',
] as const;
export type ExecutionRecoveryStageV1 =
  (typeof EXECUTION_RECOVERY_STAGES_V1)[number];

export const EXECUTION_RECOVERY_CLASSIFICATIONS_V1 = [
  'absent',
  'prepared-clean',
  'prepared-dirty',
  'finalized-clean',
  'drifted',
  'partial',
  'unknown',
] as const;
export type ExecutionRecoveryClassificationV1 =
  (typeof EXECUTION_RECOVERY_CLASSIFICATIONS_V1)[number];

export const EXECUTION_RECOVERY_STATUSES_V1 = [
  'open',
  'action_requested',
  'resolved',
] as const;
export type ExecutionRecoveryStatusV1 =
  (typeof EXECUTION_RECOVERY_STATUSES_V1)[number];

export const EXECUTION_RECOVERY_ACTIONS_V1 = ['retry', 'discard'] as const;
export type ExecutionRecoveryActionV1 =
  (typeof EXECUTION_RECOVERY_ACTIONS_V1)[number];

export const EXECUTION_RECOVERY_RESOLUTIONS_V1 = [
  'retried',
  'discarded',
  'superseded',
] as const;
export type ExecutionRecoveryResolutionV1 =
  (typeof EXECUTION_RECOVERY_RESOLUTIONS_V1)[number];

export type ExecutionRecoveryIncidentDtoV1 = {
  schemaVersion: typeof EXECUTION_RECOVERY_SCHEMA_VERSION_V1;
  id: string;
  jobId: string;
  attemptId: string;
  generation: number;
  stage: ExecutionRecoveryStageV1;
  reasonCode: string;
  classification: ExecutionRecoveryClassificationV1;
  discardable: boolean;
  status: ExecutionRecoveryStatusV1;
  requestedAction: ExecutionRecoveryActionV1 | null;
  resolution: ExecutionRecoveryResolutionV1 | null;
  actionRequestedAt: string | null;
  actionRequestedById: string | null;
  resolvedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionRecoveryIncidentRecordV1 = {
  id: string;
  jobId: string;
  attemptId: string;
  generation: number;
  stage: string;
  reasonCode: string;
  classification: string;
  discardable: boolean | number;
  status: string;
  requestedAction: string | null;
  resolution: string | null;
  actionRequestedAt: Date | string | null;
  actionRequestedById: string | null;
  resolvedAt: Date | string | null;
  revision: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export function mapExecutionRecoveryIncidentV1(
  row: ExecutionRecoveryIncidentRecordV1
): ExecutionRecoveryIncidentDtoV1 {
  if (!isExecutionRecoveryStageV1(row.stage)) {
    throw new Error('Stored execution recovery stage is invalid.');
  }
  if (!isExecutionRecoveryClassificationV1(row.classification)) {
    throw new Error('Stored execution recovery classification is invalid.');
  }
  if (!isExecutionRecoveryStatusV1(row.status)) {
    throw new Error('Stored execution recovery status is invalid.');
  }
  if (
    row.requestedAction !== null &&
    !isExecutionRecoveryActionV1(row.requestedAction)
  ) {
    throw new Error('Stored execution recovery action is invalid.');
  }
  if (
    row.resolution !== null &&
    !isExecutionRecoveryResolutionV1(row.resolution)
  ) {
    throw new Error('Stored execution recovery resolution is invalid.');
  }
  return {
    schemaVersion: EXECUTION_RECOVERY_SCHEMA_VERSION_V1,
    id: row.id,
    jobId: row.jobId,
    attemptId: row.attemptId,
    generation: Number(row.generation),
    stage: row.stage,
    reasonCode: row.reasonCode,
    classification: row.classification,
    discardable: Boolean(row.discardable),
    status: row.status,
    requestedAction: row.requestedAction,
    resolution: row.resolution,
    actionRequestedAt: toIso(row.actionRequestedAt),
    actionRequestedById:
      typeof row.actionRequestedById === 'string' &&
      row.actionRequestedById.trim()
        ? row.actionRequestedById.trim()
        : null,
    resolvedAt: toIso(row.resolvedAt),
    revision: Number(row.revision),
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

export function isExecutionRecoveryStageV1(
  value: unknown
): value is ExecutionRecoveryStageV1 {
  return EXECUTION_RECOVERY_STAGES_V1.includes(value as never);
}

export function isExecutionRecoveryClassificationV1(
  value: unknown
): value is ExecutionRecoveryClassificationV1 {
  return EXECUTION_RECOVERY_CLASSIFICATIONS_V1.includes(value as never);
}

export function isExecutionRecoveryStatusV1(
  value: unknown
): value is ExecutionRecoveryStatusV1 {
  return EXECUTION_RECOVERY_STATUSES_V1.includes(value as never);
}

export function isExecutionRecoveryActionV1(
  value: unknown
): value is ExecutionRecoveryActionV1 {
  return EXECUTION_RECOVERY_ACTIONS_V1.includes(value as never);
}

export function isExecutionRecoveryResolutionV1(
  value: unknown
): value is ExecutionRecoveryResolutionV1 {
  return EXECUTION_RECOVERY_RESOLUTIONS_V1.includes(value as never);
}

function toIso(value: Date | string | null): string | null {
  return value === null ? null : requiredIso(value);
}

function requiredIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error('Stored execution recovery timestamp is invalid.');
  }
  return date.toISOString();
}
