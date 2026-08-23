import { createHash } from 'node:crypto';

import { ValidationError } from '@/framework/resilience/app-error';
import { isRecord, safeJsonParse } from '@/framework/resilience/safe-data';
import {
  RUNTIME_CONTRACT_VERSION_V1,
  type RuntimeCandidateEvaluationV1,
  type RuntimeCandidateV1,
  type RuntimeRejectionCodeV1,
  type RuntimeRejectionReasonV1,
  type RuntimeRequirementValueV1,
  type RuntimeSelectionFailureCodeV1,
  type ExecutionRequirementsV1,
  type ExecutionSpecV1,
  type RuntimeExecutionKindV1,
  type RuntimeSelectionResultV1,
} from '@/agent/execution/contracts';

export const EXECUTION_JOB_CONTRACT_VERSION_V1 = 1 as const;

export type ExecutionJsonValueV1 =
  | boolean
  | number
  | string
  | null
  | readonly ExecutionJsonValueV1[]
  | { readonly [key: string]: ExecutionJsonValueV1 };

export type ExecutionJobSpecV1 = ExecutionSpecV1 & {
  readonly goal: string;
};

export type ContextManifestSourceV1 = {
  readonly type: 'workspace-draft' | 'document-version';
  readonly workspaceId: string;
  readonly conversationId: string | null;
  readonly documentVersionId: string | null;
};

export type ContextManifestWorkspaceV1 = {
  readonly id: string;
  readonly projectId: string | null;
  readonly title: string;
  readonly draftRevision: number;
  readonly revision: number;
};

export type ContextManifestDocumentV1 = {
  readonly id: string;
  readonly title: string;
  readonly versionId: string | null;
  readonly revision: number;
  readonly content: string;
  readonly contentSha256: string;
};

export type ContextManifestFileV1 = {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly path: string;
  readonly nodeType: 'file' | 'folder';
  readonly kind: 'richtext' | 'markdown' | 'text' | 'code';
  readonly role: 'deliverable' | 'support';
  readonly language: string | null;
  readonly content: string;
  readonly contentSha256: string;
  readonly sortOrder: number;
  readonly isPrimary: boolean;
  readonly revision: number;
};

export type FrozenKnowledgeBindingV1 = {
  readonly schemaVersion: 1;
  readonly bindingId: string;
  readonly spaceId: string;
  readonly workspaceId: string;
  readonly agentId: string | null;
  readonly mountPath: '/';
  readonly defaultBranch: string;
  readonly baseCommit: string;
};

export type ContextManifestV1 = {
  readonly schemaVersion: 1;
  readonly goal: string;
  readonly frozenAt: string;
  readonly source: ContextManifestSourceV1;
  readonly workspace: ContextManifestWorkspaceV1;
  readonly document: ContextManifestDocumentV1;
  readonly files: readonly ContextManifestFileV1[];
  readonly roomWatermark: {
    readonly roomId: string;
    readonly messageId: string;
    readonly sequence: number;
  } | null;
  readonly knowledgeCommit: FrozenKnowledgeBindingV1 | null;
};

export const EXECUTION_JOB_STATUSES_V1 = [
  'queued',
  'blocked',
  'running',
  'waiting_input',
  'cancel_requested',
  'cancelled',
  'succeeded',
  'failed',
] as const;

export type ExecutionJobStatusV1 =
  (typeof EXECUTION_JOB_STATUSES_V1)[number];

export const EXECUTION_ATTEMPT_STATUSES_V1 = [
  'pending',
  'running',
  'waiting_input',
  'quarantined',
  'cancelled',
  'succeeded',
  'failed',
] as const;

export type ExecutionAttemptStatusV1 =
  (typeof EXECUTION_ATTEMPT_STATUSES_V1)[number];

export type ExecutionAttemptDtoV1 = {
  schemaVersion: 1;
  id: string;
  jobId: string;
  runtimeId: string | null;
  number: number;
  status: ExecutionAttemptStatusV1;
  generation: number;
  leaseOwnerId: string | null;
  leaseExpiresAt: string | null;
  lastHeartbeatAt: string | null;
  runtimeRunId: string | null;
  checkpoint: ExecutionJsonValueV1 | null;
  result: ExecutionJsonValueV1 | null;
  error: ExecutionJsonValueV1 | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionJobDtoV1 = {
  schemaVersion: 1;
  id: string;
  organizationId: string;
  teamTaskId: string | null;
  originRoomId: string | null;
  originRoomMessageId: string | null;
  kind: RuntimeExecutionKindV1;
  status: ExecutionJobStatusV1;
  priority: number;
  spec: ExecutionJobSpecV1;
  requirements: ExecutionRequirementsV1;
  contextManifest: ContextManifestV1;
  selection: RuntimeSelectionResultV1;
  requestedRuntimeId: string | null;
  selectedRuntimeId: string | null;
  selectionReason: string | null;
  selectedAt: string | null;
  maxAttempts: number;
  deadlineAt: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequestedAt: string | null;
  result: ExecutionJsonValueV1 | null;
  error: ExecutionJsonValueV1 | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  attempts: readonly ExecutionAttemptDtoV1[];
};

export type ExecutionJobReceiptV1 = {
  schemaVersion: 1;
  jobId: string;
  teamTaskId: string | null;
  status: Extract<ExecutionJobStatusV1, 'queued' | 'blocked'>;
  revision: number;
  selectedRuntimeId: string | null;
  selection: RuntimeSelectionResultV1;
  acceptedAt: string;
};

export type ExecutionJobRecord = {
  id: string;
  organizationId: string;
  teamTaskId: string | null;
  originRoomId: string | null;
  originRoomMessageId: string | null;
  kind: string;
  status: string;
  priority: number;
  specJson: string;
  requirementsJson: string;
  contextManifestJson: string;
  selectionJson: string;
  requestedRuntimeId: string | null;
  selectedRuntimeId: string | null;
  selectionReason: string | null;
  selectedAt: Date | string | null;
  maxAttempts: number;
  deadlineAt: Date | string | null;
  queuedAt: Date | string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  cancelRequestedAt: Date | string | null;
  resultJson: string | null;
  errorJson: string | null;
  revision: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type ExecutionAttemptRecord = {
  id: string;
  jobId: string;
  runtimeId: string | null;
  number: number;
  status: string;
  generation: number;
  leaseOwnerId: string | null;
  leaseExpiresAt: Date | string | null;
  lastHeartbeatAt: Date | string | null;
  runtimeRunId: string | null;
  capacityReserved?: boolean | number;
  checkpointJson: string | null;
  resultJson: string | null;
  errorJson: string | null;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const EXECUTION_KINDS: readonly RuntimeExecutionKindV1[] = [
  'coding',
  'research',
  'browser',
  'document',
  'workflow',
];
const STREAMING = ['none', 'text', 'typed-events'] as const;
const INTERRUPT = ['none', 'process-kill', 'graceful'] as const;
const WORKSPACE = ['none', 'directory', 'git-worktree'] as const;
const SANDBOX = ['host', 'container', 'vm', 'remote'] as const;
const HEALTH_STATES = ['healthy', 'degraded', 'unhealthy', 'offline'] as const;
const REJECTION_CODES: readonly RuntimeRejectionCodeV1[] = [
  'duplicate-runtime-id',
  'not-explicit-runtime',
  'not-allowed-by-organization',
  'runtime-degraded',
  'runtime-unhealthy',
  'runtime-not-accepting-attempts',
  'runtime-at-capacity',
  'execution-kind-not-supported',
  'native-resume-required',
  'checkpoint-required',
  'streaming-capability-insufficient',
  'interrupt-capability-insufficient',
  'workspace-capability-insufficient',
  'sandbox-not-supported',
  'structured-artifacts-required',
  'waiting-for-human-required',
  'model-not-supported',
  'feature-not-supported',
];
const SELECTION_FAILURE_CODES: readonly RuntimeSelectionFailureCodeV1[] = [
  'invalid-selection-request',
  'requested-runtime-not-found',
  'requested-runtime-ineligible',
  'no-compatible-runtime',
];
const SELECTED_BY = [
  'explicit-request',
  'agent-preference',
  'automatic-ranking',
] as const;

export function isExecutionJobStatusV1(
  value: unknown
): value is ExecutionJobStatusV1 {
  return EXECUTION_JOB_STATUSES_V1.some((status) => status === value);
}

export function isTerminalExecutionJobStatus(
  status: ExecutionJobStatusV1
) {
  return status === 'cancelled' || status === 'succeeded' || status === 'failed';
}

export function parseExecutionSpecV1(value: unknown): ExecutionSpecV1 {
  if (!isRecord(value) || value.schemaVersion !== RUNTIME_CONTRACT_VERSION_V1) {
    throw new ValidationError('Execution spec must use schemaVersion 1.');
  }
  const kind = value.kind;
  if (!EXECUTION_KINDS.some((candidate) => candidate === kind)) {
    throw new ValidationError('Execution spec kind is invalid.');
  }
  if (value.model !== undefined && typeof value.model !== 'string') {
    throw new ValidationError('Execution spec model must be a string.');
  }
  const requirements = parseExecutionRequirementsV1(value.requirements);
  return {
    schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
    goal: readRequiredText(value.goal, 'Execution spec goal'),
    kind: kind as RuntimeExecutionKindV1,
    ...(typeof value.model === 'string' && value.model.trim()
      ? { model: value.model.trim() }
      : {}),
    requirements,
  };
}

export function parseExecutionJobSpecV1(value: unknown): ExecutionJobSpecV1 {
  const spec = parseExecutionSpecV1(value);
  if (!isRecord(value)) {
    throw new ValidationError('Execution job spec must be an object.');
  }
  return {
    ...spec,
    goal: readRequiredText(value.goal, 'Execution job goal'),
  };
}

export function parseExecutionRequirementsV1(
  value: unknown
): ExecutionRequirementsV1 {
  if (!isRecord(value)) {
    throw new ValidationError('Execution requirements must be an object.');
  }
  for (const field of [
    'nativeResume',
    'checkpoint',
    'structuredArtifacts',
    'waitingForHuman',
  ] as const) {
    if (value[field] !== undefined && value[field] !== true) {
      throw new ValidationError(`${field} requirement must be true when provided.`);
    }
  }
  if (value.streaming !== undefined && !STREAMING.includes(value.streaming as never)) {
    throw new ValidationError('Invalid streaming requirement.');
  }
  if (value.interrupt !== undefined && !INTERRUPT.includes(value.interrupt as never)) {
    throw new ValidationError('Invalid interrupt requirement.');
  }
  if (value.workspace !== undefined && !WORKSPACE.includes(value.workspace as never)) {
    throw new ValidationError('Invalid workspace requirement.');
  }
  if (
    value.sandbox !== undefined &&
    (!Array.isArray(value.sandbox) ||
      !value.sandbox.every((entry) => SANDBOX.includes(entry as never)))
  ) {
    throw new ValidationError('Invalid sandbox requirement.');
  }
  if (
    value.features !== undefined &&
    (!Array.isArray(value.features) ||
      !value.features.every((entry) => typeof entry === 'string' && entry.trim()))
  ) {
    throw new ValidationError('Execution requirement features must be strings.');
  }

  return value as ExecutionRequirementsV1;
}

export function parseContextManifestV1(value: unknown): ContextManifestV1 {
  if (!isRecord(value) || value.schemaVersion !== EXECUTION_JOB_CONTRACT_VERSION_V1) {
    throw new ValidationError('Context manifest must use schemaVersion 1.');
  }
  if (!isRecord(value.source)) {
    throw new ValidationError('Context manifest source is invalid.');
  }
  if (
    value.source.type !== 'workspace-draft' &&
    value.source.type !== 'document-version'
  ) {
    throw new ValidationError('Context manifest source type is invalid.');
  }
  if (!isRecord(value.workspace)) {
    throw new ValidationError('Context manifest workspace is invalid.');
  }
  if (!isRecord(value.document)) {
    throw new ValidationError('Context manifest document is invalid.');
  }
  if (!Array.isArray(value.files)) {
    throw new ValidationError('Context manifest files must be an array.');
  }
  if (
    value.roomWatermark !== null &&
    !isRecord(value.roomWatermark)
  ) {
    throw new ValidationError(
      'Context manifest roomWatermark must be an object or null.'
    );
  }
  const source: ContextManifestSourceV1 = {
    type: value.source.type,
    workspaceId: readRequiredText(
      value.source.workspaceId,
      'Context manifest source workspaceId'
    ),
    conversationId: readNullableText(
      value.source.conversationId,
      'Context manifest source conversationId'
    ),
    documentVersionId: readNullableText(
      value.source.documentVersionId,
      'Context manifest source documentVersionId'
    ),
  };
  const workspace: ContextManifestWorkspaceV1 = {
    id: readRequiredText(value.workspace.id, 'Context manifest workspace id'),
    projectId: readNullableText(
      value.workspace.projectId,
      'Context manifest workspace projectId'
    ),
    title: readString(value.workspace.title, 'Context manifest workspace title'),
    draftRevision: readNonNegativeInteger(
      value.workspace.draftRevision,
      'Context manifest workspace draftRevision'
    ),
    revision: readNonNegativeInteger(
      value.workspace.revision,
      'Context manifest workspace revision'
    ),
  };
  const document: ContextManifestDocumentV1 = {
    id: readRequiredText(value.document.id, 'Context manifest document id'),
    title: readString(value.document.title, 'Context manifest document title'),
    versionId: readNullableText(
      value.document.versionId,
      'Context manifest document versionId'
    ),
    revision: readNonNegativeInteger(
      value.document.revision,
      'Context manifest document revision'
    ),
    content: readString(
      value.document.content,
      'Context manifest document content'
    ),
    contentSha256: readSha256(
      value.document.contentSha256,
      'Context manifest document contentSha256'
    ),
  };
  const files = value.files.map((file, index) =>
    parseContextManifestFileV1(file, index)
  );
  const roomWatermark = value.roomWatermark
    ? {
        roomId: readRequiredText(
          value.roomWatermark.roomId,
          'Context manifest roomWatermark roomId'
        ),
        messageId: readRequiredText(
          value.roomWatermark.messageId,
          'Context manifest roomWatermark messageId'
        ),
        sequence: readNonNegativeInteger(
          value.roomWatermark.sequence,
          'Context manifest roomWatermark sequence'
        ),
      }
    : null;
  const knowledgeCommit =
    value.knowledgeCommit === null
      ? null
      : parseFrozenKnowledgeBindingV1(value.knowledgeCommit);
  const goal = readRequiredText(value.goal, 'Context manifest goal');
  const frozenAt = readIsoDate(
    value.frozenAt,
    'Context manifest frozenAt'
  );

  if (source.workspaceId !== workspace.id || document.id !== workspace.id) {
    throw new ValidationError(
      'Context manifest workspace and document ids must match the source.'
    );
  }
  if (
    knowledgeCommit !== null &&
    knowledgeCommit.workspaceId !== workspace.id
  ) {
    throw new ValidationError(
      'Context manifest knowledge binding workspace must match the source.'
    );
  }
  if (source.documentVersionId !== document.versionId) {
    throw new ValidationError(
      'Context manifest document version must match the source.'
    );
  }
  if (
    (source.type === 'workspace-draft' && source.documentVersionId !== null) ||
    (source.type === 'document-version' && source.documentVersionId === null)
  ) {
    throw new ValidationError(
      'Context manifest source type does not match its document version.'
    );
  }
  if (sha256(document.content) !== document.contentSha256) {
    throw new ValidationError(
      'Context manifest document content hash does not match its content.'
    );
  }
  for (const file of files) {
    if (sha256(file.content) !== file.contentSha256) {
      throw new ValidationError(
        `Context manifest file ${file.id} content hash does not match its content.`
      );
    }
  }
  if (source.type === 'workspace-draft') {
    const primaryFile =
      files.find((file) => file.nodeType === 'file' && file.isPrimary) ||
      files.find((file) => file.nodeType === 'file');
    if (primaryFile && document.content !== primaryFile.content) {
      throw new ValidationError(
        'Context manifest draft document content must match its primary file.'
      );
    }
  }

  return {
    schemaVersion: EXECUTION_JOB_CONTRACT_VERSION_V1,
    goal,
    frozenAt,
    source,
    workspace,
    document,
    files,
    roomWatermark,
    knowledgeCommit,
  };
}

export function parseFrozenKnowledgeBindingV1(
  value: unknown
): FrozenKnowledgeBindingV1 {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new ValidationError(
      'Frozen knowledge binding must use schemaVersion 1.'
    );
  }
  assertExactKeys(
    value,
    [
      'schemaVersion',
      'bindingId',
      'spaceId',
      'workspaceId',
      'agentId',
      'mountPath',
      'defaultBranch',
      'baseCommit',
    ],
    'Frozen knowledge binding'
  );
  if (value.mountPath !== '/') {
    throw new ValidationError(
      'Frozen knowledge binding mountPath must be "/".'
    );
  }

  return {
    schemaVersion: EXECUTION_JOB_CONTRACT_VERSION_V1,
    bindingId: readRequiredText(
      value.bindingId,
      'Frozen knowledge binding bindingId'
    ),
    spaceId: readRequiredText(
      value.spaceId,
      'Frozen knowledge binding spaceId'
    ),
    workspaceId: readRequiredText(
      value.workspaceId,
      'Frozen knowledge binding workspaceId'
    ),
    agentId: readNullableText(
      value.agentId,
      'Frozen knowledge binding agentId'
    ),
    mountPath: '/',
    defaultBranch: readRequiredText(
      value.defaultBranch,
      'Frozen knowledge binding defaultBranch'
    ),
    baseCommit: readGitObjectId(
      value.baseCommit,
      'Frozen knowledge binding baseCommit'
    ),
  };
}

export function mapExecutionJob(
  job: ExecutionJobRecord,
  attempts: readonly ExecutionAttemptRecord[] = []
): ExecutionJobDtoV1 {
  if (Boolean(job.originRoomId) !== Boolean(job.originRoomMessageId)) {
    throw new Error('Stored Execution origin Room references are incomplete.');
  }
  const specValue = safeJsonParse<unknown>(job.specJson, null);
  const requirementsValue = safeJsonParse<unknown>(job.requirementsJson, null);
  const manifestValue = safeJsonParse<unknown>(job.contextManifestJson, null);
  const selectionValue = safeJsonParse<unknown>(job.selectionJson, null);

  return {
    schemaVersion: EXECUTION_JOB_CONTRACT_VERSION_V1,
    id: job.id,
    organizationId: job.organizationId,
    teamTaskId: job.teamTaskId,
    originRoomId: job.originRoomId,
    originRoomMessageId: job.originRoomMessageId,
    kind: parseExecutionKind(job.kind),
    status: parseJobStatus(job.status),
    priority: job.priority,
    spec: parseStoredSpec(specValue),
    requirements: parseStoredRequirements(requirementsValue),
    contextManifest: parseStoredManifest(manifestValue),
    selection: parseStoredSelection(selectionValue),
    requestedRuntimeId: job.requestedRuntimeId,
    selectedRuntimeId: job.selectedRuntimeId,
    selectionReason: job.selectionReason,
    selectedAt: toIsoString(job.selectedAt),
    maxAttempts: job.maxAttempts,
    deadlineAt: toIsoString(job.deadlineAt),
    queuedAt: toRequiredIsoString(job.queuedAt),
    startedAt: toIsoString(job.startedAt),
    finishedAt: toIsoString(job.finishedAt),
    cancelRequestedAt: toIsoString(job.cancelRequestedAt),
    result: parseStoredJson(job.resultJson),
    error: parseStoredJson(job.errorJson),
    revision: job.revision,
    createdAt: toRequiredIsoString(job.createdAt),
    updatedAt: toRequiredIsoString(job.updatedAt),
    attempts: attempts.map(mapExecutionAttempt),
  };
}

export function mapExecutionAttempt(
  attempt: ExecutionAttemptRecord
): ExecutionAttemptDtoV1 {
  return {
    schemaVersion: EXECUTION_JOB_CONTRACT_VERSION_V1,
    id: attempt.id,
    jobId: attempt.jobId,
    runtimeId: attempt.runtimeId,
    number: attempt.number,
    status: parseAttemptStatus(attempt.status),
    generation: attempt.generation,
    leaseOwnerId: attempt.leaseOwnerId,
    leaseExpiresAt: toIsoString(attempt.leaseExpiresAt),
    lastHeartbeatAt: toIsoString(attempt.lastHeartbeatAt),
    runtimeRunId: attempt.runtimeRunId,
    checkpoint: parseStoredJson(attempt.checkpointJson),
    result: parseStoredJson(attempt.resultJson),
    error: parseStoredJson(attempt.errorJson),
    startedAt: toIsoString(attempt.startedAt),
    finishedAt: toIsoString(attempt.finishedAt),
    createdAt: toRequiredIsoString(attempt.createdAt),
    updatedAt: toRequiredIsoString(attempt.updatedAt),
  };
}

export function toExecutionJobReceipt(
  job: Pick<
    ExecutionJobDtoV1,
    | 'id'
    | 'teamTaskId'
    | 'status'
    | 'revision'
    | 'selectedRuntimeId'
    | 'selection'
    | 'createdAt'
  >
): ExecutionJobReceiptV1 {
  if (job.status !== 'queued' && job.status !== 'blocked') {
    throw new Error(`Cannot create an acceptance receipt for ${job.status} job.`);
  }
  return {
    schemaVersion: EXECUTION_JOB_CONTRACT_VERSION_V1,
    jobId: job.id,
    teamTaskId: job.teamTaskId,
    status: job.status,
    revision: job.revision,
    selectedRuntimeId: job.selectedRuntimeId,
    selection: job.selection,
    acceptedAt: job.createdAt,
  };
}

export function parseExecutionJobReceiptV1(
  value: unknown
): ExecutionJobReceiptV1 {
  if (!isRecord(value) || value.schemaVersion !== EXECUTION_JOB_CONTRACT_VERSION_V1) {
    throw new ValidationError('Execution job receipt must use schemaVersion 1.');
  }
  assertExactKeys(
    value,
    [
      'schemaVersion',
      'jobId',
      'teamTaskId',
      'status',
      'revision',
      'selectedRuntimeId',
      'selection',
      'acceptedAt',
    ],
    'Execution job receipt'
  );
  if (value.status !== 'queued' && value.status !== 'blocked') {
    throw new ValidationError('Execution job receipt status must be queued or blocked.');
  }

  const jobId = readRequiredText(value.jobId, 'Execution job receipt jobId');
  const teamTaskId = readNullableText(
    value.teamTaskId,
    'Execution job receipt teamTaskId'
  );
  const revision = readPositiveInteger(
    value.revision,
    'Execution job receipt revision'
  );
  const selectedRuntimeId = readNullableText(
    value.selectedRuntimeId,
    'Execution job receipt selectedRuntimeId'
  );
  const selection = parseRuntimeSelectionResultV1(value.selection);
  const acceptedAt = readIsoDate(
    value.acceptedAt,
    'Execution job receipt acceptedAt'
  );

  if (value.status === 'queued') {
    if (!selection.matched || selectedRuntimeId === null) {
      throw new ValidationError(
        'A queued execution job receipt requires a matched runtime selection.'
      );
    }
    if (selection.selected.descriptor.runtimeId !== selectedRuntimeId) {
      throw new ValidationError(
        'Execution job receipt selectedRuntimeId must match its selection.'
      );
    }
  } else if (selection.matched || selectedRuntimeId !== null) {
    throw new ValidationError(
      'A blocked execution job receipt requires an unmatched runtime selection.'
    );
  }

  return {
    schemaVersion: EXECUTION_JOB_CONTRACT_VERSION_V1,
    jobId,
    teamTaskId,
    status: value.status,
    revision,
    selectedRuntimeId,
    selection,
    acceptedAt,
  };
}

export function parseRuntimeSelectionResultV1(
  value: unknown
): RuntimeSelectionResultV1 {
  if (!isRecord(value) || value.schemaVersion !== RUNTIME_CONTRACT_VERSION_V1) {
    throw new ValidationError('Runtime selection must use schemaVersion 1.');
  }
  if (!Array.isArray(value.evaluations)) {
    throw new ValidationError('Runtime selection evaluations must be an array.');
  }
  const evaluations = value.evaluations.map((evaluation, index) =>
    parseRuntimeCandidateEvaluationV1(evaluation, index)
  );

  if (value.matched === true) {
    assertExactKeys(
      value,
      ['schemaVersion', 'matched', 'selected', 'selectedBy', 'evaluations'],
      'Matched runtime selection'
    );
    const selected = parseRuntimeCandidateV1(
      value.selected,
      'Runtime selection selected'
    );
    if (!isEnumValue(value.selectedBy, SELECTED_BY)) {
      throw new ValidationError('Runtime selection selectedBy is invalid.');
    }
    const matchingEvaluation = evaluations.find(
      ({ candidate }) =>
        candidate.descriptor.runtimeId === selected.descriptor.runtimeId &&
        sameRuntimeCandidateV1(candidate, selected)
    );
    if (!matchingEvaluation || !matchingEvaluation.eligible) {
      throw new ValidationError(
        'Runtime selection selected candidate must have an eligible evaluation.'
      );
    }
    return {
      schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
      matched: true,
      selected,
      selectedBy: value.selectedBy,
      evaluations,
    };
  }

  if (value.matched !== false) {
    throw new ValidationError('Runtime selection matched must be a boolean.');
  }
  assertExactKeys(
    value,
    ['schemaVersion', 'matched', 'selected', 'failure', 'evaluations'],
    'Unmatched runtime selection'
  );
  if (value.selected !== null) {
    throw new ValidationError('Unmatched runtime selection selected must be null.');
  }
  return {
    schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
    matched: false,
    selected: null,
    failure: parseRuntimeSelectionFailureV1(value.failure),
    evaluations,
  };
}

export function isExecutionJsonValueV1(
  value: unknown,
  seen = new Set<object>()
): value is ExecutionJsonValueV1 {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'object') {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isExecutionJsonValueV1(entry, seen))
    : Object.values(value).every((entry) => isExecutionJsonValueV1(entry, seen));
  seen.delete(value);
  return valid;
}

function parseContextManifestFileV1(
  value: unknown,
  index: number
): ContextManifestFileV1 {
  if (!isRecord(value)) {
    throw new ValidationError(`Context manifest file ${index} is invalid.`);
  }
  const nodeType = value.nodeType;
  if (nodeType !== 'file' && nodeType !== 'folder') {
    throw new ValidationError(
      `Context manifest file ${index} nodeType is invalid.`
    );
  }
  const kind = value.kind;
  if (
    kind !== 'richtext' &&
    kind !== 'markdown' &&
    kind !== 'text' &&
    kind !== 'code'
  ) {
    throw new ValidationError(`Context manifest file ${index} kind is invalid.`);
  }
  const role = value.role;
  if (role !== 'deliverable' && role !== 'support') {
    throw new ValidationError(`Context manifest file ${index} role is invalid.`);
  }
  if (typeof value.isPrimary !== 'boolean') {
    throw new ValidationError(
      `Context manifest file ${index} isPrimary must be a boolean.`
    );
  }

  return {
    id: readRequiredText(value.id, `Context manifest file ${index} id`),
    parentId: readNullableText(
      value.parentId,
      `Context manifest file ${index} parentId`
    ),
    name: readString(value.name, `Context manifest file ${index} name`),
    path: readString(value.path, `Context manifest file ${index} path`),
    nodeType,
    kind,
    role,
    language: readNullableString(
      value.language,
      `Context manifest file ${index} language`
    ),
    content: readString(
      value.content,
      `Context manifest file ${index} content`
    ),
    contentSha256: readSha256(
      value.contentSha256,
      `Context manifest file ${index} contentSha256`
    ),
    sortOrder: readInteger(
      value.sortOrder,
      `Context manifest file ${index} sortOrder`
    ),
    isPrimary: value.isPrimary,
    revision: readNonNegativeInteger(
      value.revision,
      `Context manifest file ${index} revision`
    ),
  };
}

function parseRuntimeCandidateEvaluationV1(
  value: unknown,
  index: number
): RuntimeCandidateEvaluationV1 {
  if (!isRecord(value)) {
    throw new ValidationError(`Runtime selection evaluation ${index} is invalid.`);
  }
  assertExactKeys(
    value,
    ['candidate', 'eligible', 'preferenceRank', 'rejectionReasons'],
    `Runtime selection evaluation ${index}`
  );
  if (typeof value.eligible !== 'boolean') {
    throw new ValidationError(
      `Runtime selection evaluation ${index} eligible must be a boolean.`
    );
  }
  const preferenceRank =
    value.preferenceRank === null
      ? null
      : readNonNegativeInteger(
          value.preferenceRank,
          `Runtime selection evaluation ${index} preferenceRank`
        );
  if (!Array.isArray(value.rejectionReasons)) {
    throw new ValidationError(
      `Runtime selection evaluation ${index} rejectionReasons must be an array.`
    );
  }
  const rejectionReasons = value.rejectionReasons.map((reason, reasonIndex) =>
    parseRuntimeRejectionReasonV1(reason, index, reasonIndex)
  );
  if (value.eligible !== (rejectionReasons.length === 0)) {
    throw new ValidationError(
      `Runtime selection evaluation ${index} eligibility conflicts with its rejection reasons.`
    );
  }
  return {
    candidate: parseRuntimeCandidateV1(
      value.candidate,
      `Runtime selection evaluation ${index} candidate`
    ),
    eligible: value.eligible,
    preferenceRank,
    rejectionReasons,
  };
}

function parseRuntimeCandidateV1(
  value: unknown,
  field: string
): RuntimeCandidateV1 {
  if (!isRecord(value)) {
    throw new ValidationError(`${field} must be an object.`);
  }
  assertExactKeys(value, ['descriptor', 'health', 'capacity'], field);
  if (!isRecord(value.descriptor)) {
    throw new ValidationError(`${field} descriptor must be an object.`);
  }
  assertExactKeys(
    value.descriptor,
    [
      'schemaVersion',
      'runtimeId',
      'displayName',
      'runtimeVersion',
      'capabilities',
      ...(value.descriptor.selectionPriority === undefined
        ? []
        : ['selectionPriority']),
    ],
    `${field} descriptor`
  );
  if (value.descriptor.schemaVersion !== RUNTIME_CONTRACT_VERSION_V1) {
    throw new ValidationError(`${field} descriptor must use schemaVersion 1.`);
  }
  const selectionPriority =
    value.descriptor.selectionPriority === undefined
      ? undefined
      : readFiniteNumber(
          value.descriptor.selectionPriority,
          `${field} descriptor selectionPriority`
        );
  const capabilities = parseRuntimeCapabilitiesV1(
    value.descriptor.capabilities,
    `${field} descriptor capabilities`
  );

  if (!isRecord(value.health)) {
    throw new ValidationError(`${field} health must be an object.`);
  }
  const health = value.health;
  assertExactKeys(
    health,
    [
      'state',
      'acceptingNewAttempts',
      ...(health.observedAt === undefined ? [] : ['observedAt']),
      ...(health.message === undefined ? [] : ['message']),
    ],
    `${field} health`
  );
  if (!isEnumValue(health.state, HEALTH_STATES)) {
    throw new ValidationError(`${field} health state is invalid.`);
  }
  if (typeof health.acceptingNewAttempts !== 'boolean') {
    throw new ValidationError(
      `${field} health acceptingNewAttempts must be a boolean.`
    );
  }
  const observedAt =
    health.observedAt === undefined
      ? undefined
      : readIsoDate(health.observedAt, `${field} health observedAt`);
  const message =
    health.message === undefined
      ? undefined
      : readString(health.message, `${field} health message`);

  if (!isRecord(value.capacity)) {
    throw new ValidationError(`${field} capacity must be an object.`);
  }
  assertExactKeys(
    value.capacity,
    [
      'availableSlots',
      ...(value.capacity.activeAttempts === undefined
        ? []
        : ['activeAttempts']),
      ...(value.capacity.maxConcurrentAttempts === undefined
        ? []
        : ['maxConcurrentAttempts']),
    ],
    `${field} capacity`
  );
  const availableSlots = readFiniteNumber(
    value.capacity.availableSlots,
    `${field} capacity availableSlots`
  );
  const activeAttempts =
    value.capacity.activeAttempts === undefined
      ? undefined
      : readNonNegativeInteger(
          value.capacity.activeAttempts,
          `${field} capacity activeAttempts`
        );
  const maxConcurrentAttempts =
    value.capacity.maxConcurrentAttempts === undefined
      ? undefined
      : readNonNegativeInteger(
          value.capacity.maxConcurrentAttempts,
          `${field} capacity maxConcurrentAttempts`
        );

  return {
    descriptor: {
      schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
      runtimeId: readRequiredText(
        value.descriptor.runtimeId,
        `${field} descriptor runtimeId`
      ),
      displayName: readString(
        value.descriptor.displayName,
        `${field} descriptor displayName`
      ),
      runtimeVersion: readRequiredText(
        value.descriptor.runtimeVersion,
        `${field} descriptor runtimeVersion`
      ),
      capabilities,
      ...(selectionPriority === undefined ? {} : { selectionPriority }),
    },
    health: {
      state: health.state,
      acceptingNewAttempts: health.acceptingNewAttempts,
      ...(observedAt === undefined ? {} : { observedAt }),
      ...(message === undefined ? {} : { message }),
    },
    capacity: {
      availableSlots,
      ...(activeAttempts === undefined ? {} : { activeAttempts }),
      ...(maxConcurrentAttempts === undefined
        ? {}
        : { maxConcurrentAttempts }),
    },
  };
}

function parseRuntimeCapabilitiesV1(
  value: unknown,
  field: string
): RuntimeCandidateV1['descriptor']['capabilities'] {
  if (!isRecord(value) || value.schemaVersion !== RUNTIME_CONTRACT_VERSION_V1) {
    throw new ValidationError(`${field} must use schemaVersion 1.`);
  }
  assertExactKeys(
    value,
    [
      'schemaVersion',
      'kinds',
      'nativeResume',
      'checkpoint',
      'streaming',
      'interrupt',
      'workspace',
      'sandbox',
      'structuredArtifacts',
      'waitingForHuman',
      'supportedModels',
      ...(value.features === undefined ? [] : ['features']),
    ],
    field
  );
  const kinds = readEnumArray(value.kinds, EXECUTION_KINDS, `${field} kinds`);
  const nativeResume = readBoolean(value.nativeResume, `${field} nativeResume`);
  const checkpoint = readBoolean(value.checkpoint, `${field} checkpoint`);
  const streaming = readEnum(value.streaming, STREAMING, `${field} streaming`);
  const interrupt = readEnum(value.interrupt, INTERRUPT, `${field} interrupt`);
  const workspace = readEnum(value.workspace, WORKSPACE, `${field} workspace`);
  const sandbox = readEnum(value.sandbox, SANDBOX, `${field} sandbox`);
  const structuredArtifacts = readBoolean(
    value.structuredArtifacts,
    `${field} structuredArtifacts`
  );
  const waitingForHuman = readBoolean(
    value.waitingForHuman,
    `${field} waitingForHuman`
  );
  const supportedModels = readStrictStringArray(
    value.supportedModels,
    `${field} supportedModels`
  );
  const features =
    value.features === undefined
      ? undefined
      : readStrictStringArray(value.features, `${field} features`);

  return {
    schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
    kinds,
    nativeResume,
    checkpoint,
    streaming,
    interrupt,
    workspace,
    sandbox,
    structuredArtifacts,
    waitingForHuman,
    supportedModels,
    ...(features === undefined ? {} : { features }),
  };
}

function parseRuntimeRejectionReasonV1(
  value: unknown,
  evaluationIndex: number,
  reasonIndex: number
): RuntimeRejectionReasonV1 {
  const field =
    `Runtime selection evaluation ${evaluationIndex} rejection reason ${reasonIndex}`;
  if (!isRecord(value)) {
    throw new ValidationError(`${field} is invalid.`);
  }
  assertExactKeys(
    value,
    [
      'code',
      'message',
      ...(value.path === undefined ? [] : ['path']),
      ...(value.expected === undefined ? [] : ['expected']),
      ...(value.actual === undefined ? [] : ['actual']),
    ],
    field
  );
  const code = readEnum(value.code, REJECTION_CODES, `${field} code`);
  const path =
    value.path === undefined
      ? undefined
      : readRequiredText(value.path, `${field} path`);
  const expected =
    value.expected === undefined
      ? undefined
      : parseRuntimeRequirementValueV1(value.expected, `${field} expected`);
  const actual =
    value.actual === undefined
      ? undefined
      : parseRuntimeRequirementValueV1(value.actual, `${field} actual`);
  return {
    code,
    message: readRequiredText(value.message, `${field} message`),
    ...(path === undefined ? {} : { path }),
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
  };
}

function parseRuntimeRequirementValueV1(
  value: unknown,
  field: string
): RuntimeRequirementValueV1 {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string')
  ) {
    return value;
  }
  throw new ValidationError(`${field} is invalid.`);
}

function parseRuntimeSelectionFailureV1(
  value: unknown
): Extract<RuntimeSelectionResultV1, { matched: false }>['failure'] {
  if (!isRecord(value)) {
    throw new ValidationError('Runtime selection failure must be an object.');
  }
  assertExactKeys(
    value,
    [
      'code',
      'message',
      ...(value.runtimeId === undefined ? [] : ['runtimeId']),
    ],
    'Runtime selection failure'
  );
  const code = readEnum(
    value.code,
    SELECTION_FAILURE_CODES,
    'Runtime selection failure code'
  );
  const runtimeId =
    value.runtimeId === undefined
      ? undefined
      : readRequiredText(value.runtimeId, 'Runtime selection failure runtimeId');
  return {
    code,
    message: readRequiredText(value.message, 'Runtime selection failure message'),
    ...(runtimeId === undefined ? {} : { runtimeId }),
  };
}

function readRequiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string.`);
  }
  return value;
}

function readNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return readString(value, field);
}

function readNullableText(value: unknown, field: string): string | null {
  if (value === null) return null;
  return readRequiredText(value, field);
}

function readInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value)) {
    throw new ValidationError(`${field} must be an integer.`);
  }
  return value as number;
}

function readNonNegativeInteger(value: unknown, field: string): number {
  const number = readInteger(value, field);
  if (number < 0) {
    throw new ValidationError(`${field} must not be negative.`);
  }
  return number;
}

function readPositiveInteger(value: unknown, field: string): number {
  const number = readInteger(value, field);
  if (number < 1) {
    throw new ValidationError(`${field} must be positive.`);
  }
  return number;
}

function readFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${field} must be a finite number.`);
  }
  return value;
}

function readStrictStringArray(
  value: unknown,
  field: string
): readonly string[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (entry) =>
        typeof entry === 'string' &&
        entry.length > 0 &&
        entry.trim() === entry
    )
  ) {
    throw new ValidationError(`${field} must contain non-empty strings.`);
  }
  return value;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${field} must be a boolean.`);
  }
  return value;
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string
): T {
  if (!isEnumValue(value, allowed)) {
    throw new ValidationError(`${field} is invalid.`);
  }
  return value;
}

function readEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string
): readonly T[] {
  if (!Array.isArray(value) || !value.every((entry) => isEnumValue(entry, allowed))) {
    throw new ValidationError(`${field} are invalid.`);
  }
  return value;
}

function isEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[]
): value is T {
  return typeof value === 'string' && allowed.some((entry) => entry === value);
}

function readSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new ValidationError(`${field} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function readGitObjectId(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
  ) {
    throw new ValidationError(
      `${field} must be a full lowercase Git object id.`
    );
  }
  return value;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  field: string
) {
  const expectedKeys = new Set(expected);
  const unexpected = Object.keys(value).filter((key) => !expectedKeys.has(key));
  if (unexpected.length > 0) {
    throw new ValidationError(
      `${field} contains unsupported fields: ${unexpected.sort().join(', ')}.`
    );
  }
}

function readIsoDate(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be an ISO date string.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new ValidationError(`${field} must be an ISO date string.`);
  }
  return date.toISOString();
}

function parseStoredSpec(value: unknown) {
  try {
    return parseExecutionJobSpecV1(value);
  } catch (cause) {
    throw storedDataError('spec', cause);
  }
}

function parseStoredRequirements(value: unknown) {
  try {
    return parseExecutionRequirementsV1(value);
  } catch (cause) {
    throw storedDataError('requirements', cause);
  }
}

function parseStoredManifest(value: unknown): ContextManifestV1 {
  try {
    return parseContextManifestV1(value);
  } catch (cause) {
    throw storedDataError('context manifest', cause);
  }
}

function parseStoredSelection(value: unknown): RuntimeSelectionResultV1 {
  if (
    isRecord(value) &&
    value.schemaVersion === RUNTIME_CONTRACT_VERSION_V1 &&
    typeof value.matched === 'boolean' &&
    Array.isArray(value.evaluations) &&
    (value.matched || isRecord(value.failure))
  ) {
    return value as RuntimeSelectionResultV1;
  }
  throw storedDataError('runtime selection');
}

function sameRuntimeCandidateV1(
  left: RuntimeCandidateV1,
  right: RuntimeCandidateV1
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function storedDataError(field: string, cause?: unknown) {
  return new Error(`Stored execution job ${field} is invalid.`,
    cause === undefined ? undefined : { cause });
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function parseStoredJson(raw: string | null): ExecutionJsonValueV1 | null {
  return safeJsonParse<ExecutionJsonValueV1 | null>(
    raw,
    null,
    (value): value is ExecutionJsonValueV1 | null => isExecutionJsonValueV1(value)
  );
}

function parseExecutionKind(value: string): RuntimeExecutionKindV1 {
  if (EXECUTION_KINDS.some((kind) => kind === value)) {
    return value as RuntimeExecutionKindV1;
  }
  throw storedDataError('kind');
}

function parseJobStatus(value: string): ExecutionJobStatusV1 {
  if (isExecutionJobStatusV1(value)) {
    return value;
  }
  throw storedDataError('status');
}

function parseAttemptStatus(value: string): ExecutionAttemptStatusV1 {
  if (EXECUTION_ATTEMPT_STATUSES_V1.some((status) => status === value)) {
    return value as ExecutionAttemptStatusV1;
  }
  throw storedDataError('attempt status');
}

function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function toRequiredIsoString(value: Date | string): string {
  return toIsoString(value) || new Date(0).toISOString();
}
