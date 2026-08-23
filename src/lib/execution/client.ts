import { apiCall, safeJsonParse } from '@/framework/resilience';

const INVALID_IDENTIFIER = Symbol('invalid-execution-identifier');

export type RuntimeSelection =
  | { mode: 'auto' }
  | { mode: 'explicit'; runtimeId: string };

export type ExecutionRuntime = {
  acceptingNewAttempts: boolean | null;
  availableSlots: number | null;
  capabilities: { kinds: string[] } | null;
  driver: string | null;
  enabled: boolean;
  healthState: string | null;
  id: string;
  key: string | null;
  name: string;
  version: string | null;
};

export type ExecutionJob = {
  goal: string | null;
  id: string;
  kind: string;
  attempts?: ExecutionAttempt[];
  cancelRequestedAt?: string | null;
  createdAt?: string | null;
  error?: JsonValue | null;
  finishedAt?: string | null;
  maxAttempts?: number;
  originRoomId: string | null;
  originRoomMessageId: string | null;
  priority?: number;
  queuedAt?: string | null;
  requestedRuntimeId: string | null;
  result?: JsonValue | null;
  revision?: number;
  selectedRuntime: ExecutionRuntime | null;
  selectedRuntimeId: string | null;
  selectionReason: string | null;
  startedAt?: string | null;
  status: string;
  teamTaskId?: string | null;
  updatedAt?: string | null;
};

export type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ExecutionAttempt = {
  id: string;
  number: number;
  status: string;
  generation: number;
  runtimeId: string | null;
  runtimeRunId: string | null;
  checkpoint: JsonValue | null;
  result: JsonValue | null;
  error: JsonValue | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ExecutionEvent = {
  id: string;
  attemptId: string | null;
  sequence: number;
  type: string;
  source: string;
  payload: JsonValue | null;
  payloadValid: boolean;
  occurredAt: string | null;
};

export type ExecutionLog = {
  id: string;
  jobId: string;
  attemptId: string | null;
  sequence: number;
  type: 'text-delta' | 'progress';
  source: string;
  runtimeEventId: string | null;
  text: string | null;
  percent: number | null;
  payloadValid: boolean;
  occurredAt: string | null;
  createdAt: string | null;
};

export type ExecutionArtifact = {
  id: string;
  attemptId: string | null;
  kind: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  storage: 'inline' | 'external' | 'missing';
  externalUrl: string | null;
  metadata: JsonValue | null;
  metadataValid: boolean;
  contentAvailable: boolean;
  contentUnavailableReason: string | null;
  createdAt: string | null;
};

export type ExecutionInputRequest = {
  id: string;
  attemptId: string;
  requestKey: string;
  prompt: string;
  inputSchema: JsonValue;
  response: JsonValue | null;
  responseId: string | null;
  status: 'pending' | 'answered' | 'cancelled';
  requestedAt: string | null;
  respondedAt: string | null;
  revision: number;
};

export type ExecutionJobSummary = {
  id: string;
  teamTaskId: string | null;
  goal: string;
  kind: string;
  status: string;
  priority: number;
  selectedRuntimeId: string | null;
  selectionReason: string | null;
  attemptCount: number;
  maxAttempts: number;
  revision: number;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
};

export type ExecutionPageInfo = {
  hasNextPage: boolean;
  nextCursor: string | null;
};

export type ExecutionJobDetail = {
  job: ExecutionJob;
  events: { items: ExecutionEvent[]; pageInfo: ExecutionPageInfo };
  artifacts: { items: ExecutionArtifact[]; pageInfo: ExecutionPageInfo };
  inputRequests: { items: ExecutionInputRequest[]; pageInfo: ExecutionPageInfo };
};

export type ExecutionReceipt = {
  acceptedAt: string | null;
  blocked: boolean;
  id: string | null;
  jobId: string | null;
  reason: string | null;
  selectedRuntimeId: string | null;
  selectionReason: string | null;
  status: string | null;
};

export type ExecutionLaunch = {
  job: ExecutionJob;
  receipt: ExecutionReceipt;
};

export type CreateExecutionJobInput = {
  conversationId?: string | null;
  documentVersionId?: string | null;
  goal: string;
  kind: 'coding';
  projectId?: string | null;
  requirements: Record<string, unknown>;
  runtimeSelection: RuntimeSelection;
  teamTaskId?: string | null;
  workspaceId: string;
};

export type ExecutionClientResult<T> =
  | { data: T; ok: true }
  | { error: string; ok: false };

export async function listExecutionRuntimes(): Promise<
  ExecutionClientResult<ExecutionRuntime[]>
> {
  const result = await apiCall<unknown>('/api/execution-runtimes');
  if (!result.ok) return { error: result.error.message, ok: false };
  return { data: normalizeRuntimeList(result.data), ok: true };
}

export async function createExecutionJob(
  input: CreateExecutionJobInput,
  idempotencyKey = createExecutionIdempotencyKey()
): Promise<ExecutionClientResult<ExecutionLaunch>> {
  // Keep this payload as an explicit allowlist. Context manifests, policy, and
  // room watermarks are materialized by the server from these source refs.
  const body = compactRecord({
    conversationId: input.conversationId,
    documentVersionId: input.documentVersionId,
    goal: input.goal,
    kind: input.kind,
    projectId: input.projectId,
    requirements: input.requirements,
    runtimeSelection: input.runtimeSelection,
    teamTaskId: input.teamTaskId,
    workspaceId: input.workspaceId,
  });
  const result = await apiCall<unknown>('/api/execution-jobs', {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'x-dao-idempotency-key': idempotencyKey,
    },
    method: 'POST',
  });
  if (!result.ok) return { error: result.error.message, ok: false };

  const launch = normalizeExecutionLaunch(
    result.data,
    { goal: input.goal, kind: input.kind }
  );
  return launch
    ? { data: launch, ok: true }
    : { error: 'The server accepted the request but returned no recognizable job.', ok: false };
}

export async function getExecutionJob(
  jobId: string
): Promise<ExecutionClientResult<ExecutionJob>> {
  const result = await apiCall<unknown>(
    `/api/execution-jobs/${encodeURIComponent(jobId)}`
  );
  if (!result.ok) return { error: result.error.message, ok: false };

  const job = normalizeJobEnvelope(result.data);
  return job
    ? { data: job, ok: true }
    : { error: 'The server returned no recognizable job.', ok: false };
}

export async function listExecutionJobs(input: {
  cursor?: string | null;
  limit?: number;
  search?: string | null;
  signal?: AbortSignal;
  status?: string | null;
} = {}): Promise<
  ExecutionClientResult<{ items: ExecutionJobSummary[]; pageInfo: ExecutionPageInfo }>
> {
  const params = new URLSearchParams();
  if (input.cursor) params.set('cursor', input.cursor);
  if (input.limit !== undefined) params.set('limit', String(input.limit));
  if (input.search) params.set('q', input.search);
  if (input.status) params.set('status', input.status);
  const result = await apiCall<unknown>(
    `/api/execution-jobs${params.size ? `?${params}` : ''}`,
    { signal: input.signal }
  );
  if (!result.ok) return { error: result.error.message, ok: false };
  const root = asRecord(result.data);
  const items = Array.isArray(root.items)
    ? root.items.map(normalizeJobSummary).filter(isPresent)
    : [];
  return {
    data: { items, pageInfo: normalizePageInfo(root.pageInfo) },
    ok: true,
  };
}

export async function getExecutionJobDetail(
  jobId: string
): Promise<ExecutionClientResult<ExecutionJobDetail>> {
  const result = await apiCall<unknown>(
    `/api/execution-jobs/${encodeURIComponent(jobId)}`
  );
  if (!result.ok) return { error: result.error.message, ok: false };
  const detail = normalizeJobDetail(result.data);
  return detail
    ? { data: detail, ok: true }
    : { error: 'The server returned no recognizable job detail.', ok: false };
}

export async function listExecutionEvents(
  jobId: string,
  cursor?: string | null
): Promise<ExecutionClientResult<{ items: ExecutionEvent[]; pageInfo: ExecutionPageInfo }>> {
  const params = new URLSearchParams();
  if (cursor) params.set('afterSequence', cursor);
  const result = await apiCall<unknown>(
    `/api/execution-jobs/${encodeURIComponent(jobId)}/events${
      params.size ? `?${params}` : ''
    }`
  );
  if (!result.ok) return { error: result.error.message, ok: false };
  const root = asRecord(result.data);
  return {
    data: {
      items: Array.isArray(root.items)
        ? root.items.map(normalizeEvent).filter(isPresent)
        : [],
      pageInfo: normalizePageInfo(root.pageInfo),
    },
    ok: true,
  };
}

export async function listExecutionLogs(
  jobId: string,
  cursor?: string | null
): Promise<ExecutionClientResult<{ items: ExecutionLog[]; pageInfo: ExecutionPageInfo }>> {
  const params = new URLSearchParams();
  if (cursor) params.set('afterSequence', cursor);
  const result = await apiCall<unknown>(
    `/api/execution-jobs/${encodeURIComponent(jobId)}/logs${
      params.size ? `?${params}` : ''
    }`
  );
  if (!result.ok) return { error: result.error.message, ok: false };
  const root = asRecord(result.data);
  return {
    data: {
      items: Array.isArray(root.items)
        ? root.items.map(normalizeLog).filter(isPresent)
        : [],
      pageInfo: normalizePageInfo(root.pageInfo),
    },
    ok: true,
  };
}

export async function listExecutionArtifacts(
  jobId: string,
  cursor?: string | null
): Promise<ExecutionClientResult<{ items: ExecutionArtifact[]; pageInfo: ExecutionPageInfo }>> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  const result = await apiCall<unknown>(
    `/api/execution-jobs/${encodeURIComponent(jobId)}/artifacts${
      params.size ? `?${params}` : ''
    }`
  );
  if (!result.ok) return { error: result.error.message, ok: false };
  const root = asRecord(result.data);
  return {
    data: {
      items: Array.isArray(root.items)
        ? root.items.map(normalizeArtifact).filter(isPresent)
        : [],
      pageInfo: normalizePageInfo(root.pageInfo),
    },
    ok: true,
  };
}

export async function getExecutionArtifactContent(
  jobId: string,
  artifactId: string
): Promise<ExecutionClientResult<JsonValue | null>> {
  const result = await apiCall<unknown>(
    `/api/execution-jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}`
  );
  if (!result.ok) return { error: result.error.message, ok: false };
  const root = asRecord(result.data);
  if (!isJsonValue(root.content)) {
    return { error: 'The artifact content was not valid JSON.', ok: false };
  }
  return { data: root.content, ok: true };
}

export async function cancelExecutionJob(
  jobId: string,
  expectedRevision: number
): Promise<ExecutionClientResult<ExecutionJob>> {
  const result = await apiCall<unknown>(
    `/api/execution-jobs/${encodeURIComponent(jobId)}/cancel`,
    {
      body: JSON.stringify({ expectedRevision }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }
  );
  if (!result.ok) return { error: result.error.message, ok: false };
  const job = normalizeJobEnvelope(result.data);
  return job
    ? { data: job, ok: true }
    : { error: 'The server returned no recognizable job.', ok: false };
}

export async function answerExecutionInputRequest(
  jobId: string,
  request: Pick<ExecutionInputRequest, 'id' | 'revision'>,
  expectedJobRevision: number,
  response: JsonValue,
  responseId = `response:${request.id}`
): Promise<ExecutionClientResult<ExecutionJobDetail>> {
  const result = await apiCall<unknown>(
    `/api/execution-jobs/${encodeURIComponent(jobId)}/input-requests/${encodeURIComponent(request.id)}/answer`,
    {
      body: JSON.stringify({
        expectedInputRevision: request.revision,
        expectedJobRevision,
        responseId,
        response,
      }),
      headers: {
        'Content-Type': 'application/json',
        'x-dao-idempotency-key': responseId,
      },
      method: 'POST',
    }
  );
  if (!result.ok) return { error: result.error.message, ok: false };
  return getExecutionJobDetail(jobId);
}

export function normalizeRuntimeList(payload: unknown): ExecutionRuntime[] {
  return readArrayEnvelope(payload, ['runtimes', 'items'])
    .map(normalizeRuntime)
    .filter((runtime): runtime is ExecutionRuntime => runtime !== null);
}

export function normalizeExecutionLaunch(
  payload: unknown,
  fallback?: { goal?: string | null; kind?: string }
): ExecutionLaunch | null {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const rawReceipt = root.receipt ?? data.receipt;
  const receiptRecord = asRecord(rawReceipt);
  const rawJob =
    root.job ?? data.job ?? receiptRecord.job ?? data.executionJob ?? root.executionJob;
  let job = normalizeJob(rawJob);

  if (!job) {
    job = normalizeJob(data) || normalizeJob(root) || normalizeJob(receiptRecord);
  }
  if (job && !job.goal && fallback?.goal) {
    job = { ...job, goal: cleanString(fallback.goal) };
  }
  if (!job) {
    const jobId =
      readString(receiptRecord, ['jobId', 'executionJobId']) ||
      readString(data, ['jobId', 'executionJobId']) ||
      readString(root, ['jobId', 'executionJobId']);
    if (jobId) {
      const selection = parseRecord(
        receiptRecord.selection ?? receiptRecord.selectionResult
      );
      const selectedRuntime = normalizeRuntime(selection.selected);
      job = {
        goal: cleanString(fallback?.goal),
        id: jobId,
        kind: fallback?.kind || 'coding',
        originRoomId: null,
        originRoomMessageId: null,
        requestedRuntimeId: null,
        selectedRuntime,
        selectedRuntimeId:
          readString(receiptRecord, ['selectedRuntimeId', 'runtimeId']) ||
          selectedRuntime?.id ||
          null,
        selectionReason:
          readString(receiptRecord, ['selectionReason', 'selectedBy']) ||
          readSelectionReason(selection),
        status: readString(receiptRecord, ['status', 'state']) || 'unknown',
      };
    }
  }
  if (!job) return null;

  return {
    job,
    receipt: normalizeReceipt(rawReceipt ?? root, job),
  };
}

export function normalizeJobEnvelope(payload: unknown): ExecutionJob | null {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  return normalizeJob(root.job ?? data.job ?? root.executionJob ?? data.executionJob ?? root.data ?? payload);
}

function normalizeRuntime(value: unknown): ExecutionRuntime | null {
  const record = asRecord(value);
  const descriptor = asRecord(record.descriptor ?? record.runtime);
  const id = readString(record, ['id', 'runtimeId']) ||
    readString(descriptor, ['id', 'runtimeId']) ||
    readString(record, ['key']);
  if (!id) return null;

  const health = parseRecord(record.health ?? record.healthJson);
  const capacity = parseRecord(record.capacity ?? record.capacityJson);
  const capacityTotal = readNumber(record, ['capacityTotal', 'maxConcurrentAttempts']);
  const capacityUsed = readNumber(record, ['capacityUsed', 'activeAttempts']);
  const availableSlots =
    readNumber(capacity, ['availableSlots', 'available']) ??
    (capacityTotal !== null
      ? Math.max(0, capacityTotal - (capacityUsed || 0))
      : null);
  const enabled = typeof record.enabled === 'boolean' ? record.enabled : true;
  const rawCapabilities = asRecord(
    record.capabilities ?? descriptor.capabilities
  );
  const capabilities =
    Array.isArray(rawCapabilities.kinds) &&
    rawCapabilities.kinds.every(
      (kind) => typeof kind === 'string' && kind.trim().length > 0
    )
      ? { kinds: rawCapabilities.kinds.map((kind) => String(kind)) }
      : null;

  return {
    acceptingNewAttempts: readBoolean(health, ['acceptingNewAttempts', 'accepting']) ??
      readBoolean(record, ['acceptingNewAttempts']),
    availableSlots,
    capabilities,
    driver: readString(record, ['driver', 'driverId']) ||
      readString(descriptor, ['driver', 'driverId']),
    enabled,
    healthState: readString(health, ['state', 'status']) ||
      readString(record, ['healthStatus', 'status']),
    id,
    key: readString(record, ['key', 'slug']),
    name: readString(record, ['name', 'displayName', 'label']) ||
      readString(descriptor, ['name', 'displayName', 'label']) ||
      readString(record, ['key']) ||
      id,
    version: readString(record, ['version', 'runtimeVersion']) ||
      readString(descriptor, ['version', 'runtimeVersion']),
  };
}

function normalizeJob(value: unknown): ExecutionJob | null {
  const record = asRecord(value);
  const id = readString(record, ['id', 'jobId', 'executionJobId']);
  if (!id) return null;
  const originRoom = normalizeExecutionOriginRoom(record);
  if (!originRoom) return null;

  const spec = parseRecord(record.spec ?? record.executionSpec ?? record.specJson);
  const contextManifest = parseRecord(
    record.contextManifest ?? record.context ?? record.contextManifestJson
  );
  const selection = parseRecord(
    record.runtimeSelection ?? record.selection ?? record.strategy ?? record.selectionJson
  );
  const selected =
    normalizeRuntime(record.selectedRuntime) ||
    normalizeRuntime(asRecord(selection.selected).descriptor ? selection.selected : null);

  return {
    attempts: Array.isArray(record.attempts)
      ? record.attempts.map(normalizeAttempt).filter(isPresent)
      : undefined,
    cancelRequestedAt: readString(record, ['cancelRequestedAt']),
    createdAt: readString(record, ['createdAt']),
    error: isJsonValue(record.error) ? record.error : null,
    finishedAt: readString(record, ['finishedAt']),
    goal: readString(record, ['goal', 'objective', 'title']) ||
      readString(spec, ['goal', 'objective', 'title']) ||
      readString(contextManifest, ['goal', 'objective', 'title']),
    id,
    kind: readString(record, ['kind', 'type']) || readString(spec, ['kind', 'type']) || 'coding',
    maxAttempts: readNumber(record, ['maxAttempts']) ?? undefined,
    ...originRoom,
    priority: readNumber(record, ['priority']) ?? undefined,
    queuedAt: readString(record, ['queuedAt']),
    requestedRuntimeId: readString(record, ['requestedRuntimeId']) ||
      (readString(selection, ['mode']) === 'explicit'
        ? readString(selection, ['runtimeId'])
        : null),
    selectedRuntime: selected,
    selectedRuntimeId: readString(record, ['selectedRuntimeId', 'runtimeId']) ||
      selected?.id ||
      readString(asRecord(selection.selected), ['runtimeId', 'id']),
    result: isJsonValue(record.result) ? record.result : null,
    revision: readNumber(record, ['revision']) ?? undefined,
    selectionReason: readString(record, ['selectionReason', 'selectedBy']) ||
      readSelectionReason(selection),
    startedAt: readString(record, ['startedAt']),
    status: readString(record, ['status', 'state']) || 'unknown',
    teamTaskId: readString(record, ['teamTaskId']),
    updatedAt: readString(record, ['updatedAt']),
  };
}

function normalizeJobSummary(value: unknown): ExecutionJobSummary | null {
  const record = asRecord(value);
  const id = readString(record, ['id']);
  const goal = readString(record, ['goal']);
  const status = readString(record, ['status']);
  if (!id || !goal || !status) return null;
  return {
    id,
    teamTaskId: readString(record, ['teamTaskId']),
    goal,
    kind: readString(record, ['kind']) || 'unknown',
    status,
    priority: readNumber(record, ['priority']) ?? 0,
    selectedRuntimeId: readString(record, ['selectedRuntimeId']),
    selectionReason: readString(record, ['selectionReason']),
    attemptCount: readNumber(record, ['attemptCount']) ?? 0,
    maxAttempts: readNumber(record, ['maxAttempts']) ?? 1,
    revision: readNumber(record, ['revision']) ?? 1,
    queuedAt: readString(record, ['queuedAt']),
    startedAt: readString(record, ['startedAt']),
    finishedAt: readString(record, ['finishedAt']),
    updatedAt: readString(record, ['updatedAt']),
  };
}

function normalizeJobDetail(value: unknown): ExecutionJobDetail | null {
  const root = asRecord(value);
  const job = normalizeJob(root.job);
  if (!job) return null;
  return {
    job,
    events: normalizePage(root.events, normalizeEvent),
    artifacts: normalizePage(root.artifacts, normalizeArtifact),
    inputRequests: normalizePage(root.inputRequests, normalizeInputRequest),
  };
}

function normalizeAttempt(value: unknown): ExecutionAttempt | null {
  const record = asRecord(value);
  const id = readString(record, ['id']);
  const status = readString(record, ['status']);
  const number = readNumber(record, ['number']);
  const generation = readNumber(record, ['generation']);
  if (!id || !status || number === null || generation === null) return null;
  return {
    id, number, status, generation,
    runtimeId: readString(record, ['runtimeId']),
    runtimeRunId: readString(record, ['runtimeRunId']),
    checkpoint: isJsonValue(record.checkpoint) ? record.checkpoint : null,
    result: isJsonValue(record.result) ? record.result : null,
    error: isJsonValue(record.error) ? record.error : null,
    startedAt: readString(record, ['startedAt']),
    finishedAt: readString(record, ['finishedAt']),
    createdAt: readString(record, ['createdAt']),
    updatedAt: readString(record, ['updatedAt']),
  };
}

function normalizeEvent(value: unknown): ExecutionEvent | null {
  const record = asRecord(value);
  const id = readString(record, ['id']);
  const type = readString(record, ['type']);
  const sequence = readNumber(record, ['sequence']);
  if (!id || !type || sequence === null) return null;
  const payloadValid = record.payloadValid === true && isJsonValue(record.payload);
  return {
    id,
    attemptId: readString(record, ['attemptId']),
    sequence,
    type,
    source: readString(record, ['source']) || 'unknown',
    payload: payloadValid ? record.payload as JsonValue : null,
    payloadValid,
    occurredAt: readString(record, ['occurredAt']),
  };
}

function normalizeLog(value: unknown): ExecutionLog | null {
  const record = asRecord(value);
  const id = readString(record, ['id']);
  const jobId = readString(record, ['jobId']);
  const sequence = readNumber(record, ['sequence']);
  const type = record.type;
  if (
    !id ||
    !jobId ||
    sequence === null ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    (type !== 'text-delta' && type !== 'progress')
  ) return null;

  const rawPercent = record.percent;
  const percentValid =
    rawPercent === null ||
    rawPercent === undefined ||
    (typeof rawPercent === 'number' &&
      Number.isFinite(rawPercent) &&
      rawPercent >= 0 &&
      rawPercent <= 100);
  const payloadValid =
    record.payloadValid === true &&
    typeof record.text === 'string' &&
    (type === 'text-delta'
      ? rawPercent === null || rawPercent === undefined
      : percentValid);
  return {
    id,
    jobId,
    attemptId: readString(record, ['attemptId']),
    sequence,
    type,
    source: readString(record, ['source']) || 'unknown',
    runtimeEventId: readString(record, ['runtimeEventId']),
    text: payloadValid && typeof record.text === 'string' ? record.text : null,
    percent: payloadValid && type === 'progress' && typeof rawPercent === 'number'
      ? rawPercent
      : null,
    payloadValid,
    occurredAt: readString(record, ['occurredAt']),
    createdAt: readString(record, ['createdAt']),
  };
}

function normalizeExecutionOriginRoom(
  record: Record<string, unknown>
): Pick<ExecutionJob, 'originRoomId' | 'originRoomMessageId'> | null {
  const originRoomId = readNullableIdentifier(record.originRoomId);
  const originRoomMessageId = readNullableIdentifier(
    record.originRoomMessageId
  );
  if (
    originRoomId === INVALID_IDENTIFIER ||
    originRoomMessageId === INVALID_IDENTIFIER ||
    (originRoomId === null) !== (originRoomMessageId === null)
  ) {
    return null;
  }
  return { originRoomId, originRoomMessageId };
}

function normalizeArtifact(value: unknown): ExecutionArtifact | null {
  const record = asRecord(value);
  const id = readString(record, ['id']);
  const name = readString(record, ['name']);
  const kind = readString(record, ['kind']);
  const storage = record.storage;
  if (
    !id || !name || !kind ||
    (storage !== 'inline' && storage !== 'external' && storage !== 'missing')
  ) return null;
  const metadataValid = record.metadataValid === true && isJsonValue(record.metadata);
  return {
    id,
    attemptId: readString(record, ['attemptId']),
    kind,
    name,
    mimeType: readString(record, ['mimeType']),
    sizeBytes: readNumber(record, ['sizeBytes']),
    sha256: readString(record, ['sha256']),
    storage,
    externalUrl: readString(record, ['externalUrl']),
    metadata: metadataValid ? record.metadata as JsonValue : null,
    metadataValid,
    contentAvailable: record.contentAvailable === true,
    contentUnavailableReason: readString(record, ['contentUnavailableReason']),
    createdAt: readString(record, ['createdAt']),
  };
}

function normalizeInputRequest(value: unknown): ExecutionInputRequest | null {
  const record = asRecord(value);
  const id = readString(record, ['id']);
  const attemptId = readString(record, ['attemptId']);
  const requestKey = readString(record, ['requestKey']);
  const prompt = readString(record, ['prompt']);
  const revision = readNumber(record, ['revision']);
  const status = record.status;
  if (
    !id || !attemptId || !requestKey || !prompt || revision === null ||
    (status !== 'pending' && status !== 'answered' && status !== 'cancelled') ||
    !isJsonValue(record.inputSchema)
  ) return null;
  return {
    id, attemptId, requestKey, prompt, revision, status,
    inputSchema: record.inputSchema,
    response: isJsonValue(record.response) ? record.response : null,
    responseId: readString(record, ['responseId']),
    requestedAt: readString(record, ['requestedAt']),
    respondedAt: readString(record, ['respondedAt']),
  };
}

function normalizePage<T>(
  value: unknown,
  normalizer: (entry: unknown) => T | null
) {
  const record = asRecord(value);
  return {
    items: Array.isArray(record.items)
      ? record.items.map(normalizer).filter(isPresent)
      : [],
    pageInfo: normalizePageInfo(record.pageInfo),
  };
}

function normalizePageInfo(value: unknown): ExecutionPageInfo {
  const record = asRecord(value);
  return {
    hasNextPage: record.hasNextPage === true,
    nextCursor: readString(record, ['nextCursor']),
  };
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : Object.values(value).every((entry) => isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function normalizeReceipt(
  value: unknown,
  job: ExecutionJob
): ExecutionReceipt {
  const record = typeof value === 'string' ? { id: value } : asRecord(value);
  const selection = parseRecord(record.selection ?? record.selectionResult);
  const selectionFailure = asRecord(selection.failure);
  const status = readString(record, ['status', 'state', 'disposition']);
  const blockedValue = readBoolean(record, ['blocked']);
  const blocked =
    blockedValue === true ||
    selection.matched === false ||
    ['blocked', 'rejected'].includes((status || '').toLowerCase());

  return {
    acceptedAt: readString(record, ['acceptedAt']),
    blocked,
    id: readString(record, ['id', 'receiptId', 'requestId']),
    jobId: readString(record, ['jobId', 'executionJobId']) || job.id,
    reason: readString(record, ['reason', 'message', 'blockedReason', 'error']) ||
      readString(selectionFailure, ['message', 'reason', 'code']),
    selectedRuntimeId: readString(record, ['selectedRuntimeId', 'runtimeId']) ||
      job.selectedRuntimeId,
    selectionReason: readString(record, ['selectionReason', 'selectedBy']) ||
      readSelectionReason(selection) ||
      job.selectionReason,
    status,
  };
}

function readSelectionReason(selection: Record<string, unknown>) {
  return readString(selection, ['selectionReason', 'reason', 'selectedBy']) ||
    readString(asRecord(selection.selected), [
      'selectionReason',
      'reason',
      'selectedBy',
    ]) ||
    readString(asRecord(selection.failure), ['code', 'message']);
}

function readArrayEnvelope(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = asRecord(payload);
  const data = root.data;
  for (const key of keys) {
    if (Array.isArray(root[key])) return root[key];
  }
  if (Array.isArray(data)) return data;
  const dataRecord = asRecord(data);
  for (const key of keys) {
    if (Array.isArray(dataRecord[key])) return dataRecord[key];
  }
  return [];
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    return asRecord(safeJsonParse<unknown>(value, null));
  }
  return asRecord(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
  }
  return null;
}

function readNullableIdentifier(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !value.trim()) return INVALID_IDENTIFIER;
  return value.trim();
}

function readNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function readBoolean(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof record[key] === 'boolean') return record[key];
  }
  return null;
}

function cleanString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function compactRecord<T extends Record<string, unknown>>(record: T) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  );
}

export function createExecutionIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `execution-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
