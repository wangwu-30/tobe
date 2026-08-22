import { apiCall } from '@/framework/resilience';

export const TASK_STATUSES = [
  'open',
  'claimed',
  'in_progress',
  'blocked',
  'review',
  'done',
  'cancelled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskKind = 'execution' | 'help';
export type TaskPriority = 0 | 1 | 2 | 3;
export type TaskActorType = 'agent' | 'user';

export type TaskAgent = {
  avatarUrl: string | null;
  handle: string | null;
  id: string;
  kind: string | null;
  name: string;
};

export type TaskDocumentLink = {
  href: string;
  id: string;
  title: string;
};

export type TaskActivity = {
  actorName: string | null;
  createdAt: string | null;
  id: string;
  kind: string;
  label: string;
};

export type TeamTask = {
  activities: TaskActivity[];
  assignee: TaskAgent | null;
  assigneeId: string | null;
  assigneeType: TaskActorType | null;
  blockedReason: string | null;
  createdAt: string | null;
  description: string;
  documents: TaskDocumentLink[];
  dueAt: string | null;
  id: string;
  kind: TaskKind;
  priority: TaskPriority | null;
  revision: number;
  projectId: string | null;
  sourceTitle: string | null;
  status: TaskStatus;
  title: string;
  updatedAt: string | null;
  workspaceId: string | null;
};

export type CreateTaskInput = {
  assigneeId?: string | null;
  assigneeType?: TaskActorType | null;
  description?: string;
  dueAt?: string | null;
  kind: TaskKind;
  priority?: TaskPriority | null;
  projectId?: string | null;
  sourceTitle?: string | null;
  title: string;
  workspaceId?: string | null;
};

export type UpdateTaskInput = Partial<
  Pick<
    CreateTaskInput,
    | 'assigneeId'
    | 'assigneeType'
    | 'description'
    | 'dueAt'
    | 'kind'
    | 'priority'
    | 'title'
  >
> & {
  blockedReason?: string | null;
  expectedUpdatedAt?: string;
  expectedRevision?: number;
  status?: TaskStatus;
};

export type TaskClientResult<T> =
  | { data: T; ok: true }
  | { error: string; ok: false };

export async function listTasks(): Promise<TaskClientResult<TeamTask[]>> {
  const result = await apiCall<unknown>('/api/tasks');
  if (!result.ok) {
    return { error: result.error.message, ok: false };
  }

  return { data: normalizeTaskList(result.data), ok: true };
}

export async function listTaskAgents(): Promise<TaskClientResult<TaskAgent[]>> {
  const result = await apiCall<unknown>('/api/agents');
  if (!result.ok) {
    return { error: result.error.message, ok: false };
  }

  return { data: normalizeAgentList(result.data), ok: true };
}

export async function createTask(
  input: CreateTaskInput
): Promise<TaskClientResult<TeamTask>> {
  const requestInput = { ...input };
  delete requestInput.sourceTitle;
  const result = await apiCall<unknown>('/api/tasks', {
    body: JSON.stringify(compactRecord(requestInput)),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

  if (!result.ok) {
    return { error: result.error.message, ok: false };
  }

  const task = normalizeTaskResponse(result.data);
  return task
    ? { data: task, ok: true }
    : { error: '任务已创建，但服务器没有返回可识别的任务。', ok: false };
}

export async function updateTask(
  taskId: string,
  input: UpdateTaskInput
): Promise<TaskClientResult<TeamTask | null>> {
  const result = await apiCall<unknown>(`/api/tasks/${encodeURIComponent(taskId)}`, {
    body: JSON.stringify(compactRecord(input)),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
  });

  if (!result.ok) {
    return { error: result.error.message, ok: false };
  }

  return { data: normalizeTaskResponse(result.data), ok: true };
}

export function normalizeTaskList(payload: unknown): TeamTask[] {
  const items = readArrayEnvelope(payload, ['tasks', 'items']);
  return items
    .map((item) => normalizeTask(item))
    .filter((item): item is TeamTask => item !== null);
}

export function normalizeAgentList(payload: unknown): TaskAgent[] {
  const items = readArrayEnvelope(payload, ['agents', 'items']);
  return items
    .map((item) => normalizeAgent(item))
    .filter((item): item is TaskAgent => item !== null);
}

function normalizeTaskResponse(payload: unknown) {
  const record = asRecord(payload);
  const nested = record.task ?? asRecord(record.data).task ?? record.data ?? payload;
  return normalizeTask(nested);
}

function normalizeTask(value: unknown): TeamTask | null {
  const record = asRecord(value);
  const id = readString(record, ['id', 'taskId']);
  if (!id) return null;

  const workspace = asRecord(
    record.workspace ?? record.document ?? record.deliverable ?? record.sourceDocument
  );
  const project = asRecord(record.project);
  const workspaceId =
    readString(record, ['workspaceId', 'documentId', 'deliverableId']) ||
    readString(workspace, ['id', 'workspaceId']);
  const projectId =
    readString(record, ['projectId']) ||
    readString(project, ['id', 'projectId']) ||
    readString(workspace, ['projectId']);
  const sourceTitle =
    readString(record, ['sourceTitle', 'documentTitle', 'workspaceTitle']) ||
    readString(workspace, ['title', 'name']) ||
    readString(project, ['title', 'name']);
  const assigneeRecord = asRecord(
    record.assignee ?? record.claimedBy ?? record.assignedAgent ?? record.agent
  );
  const assignee = normalizeAgent(assigneeRecord);
  const assigneeId =
    readString(record, ['assigneeId', 'claimedById', 'assignedAgentId', 'agentId']) ||
    assignee?.id ||
    null;

  return {
    activities: normalizeActivities(
      record.activities ?? record.activity ?? record.timeline ?? record.events,
      id
    ),
    assignee,
    assigneeId,
    assigneeType: normalizeActorType(record.assigneeType) || (assignee ? 'agent' : null),
    blockedReason: readString(record, ['blockedReason', 'blocked_reason']),
    createdAt: readString(record, ['createdAt', 'created_at']),
    description: readString(record, ['description', 'details', 'body']) || '',
    documents: normalizeDocuments(record, {
      projectId,
      sourceTitle,
      workspaceId,
    }),
    dueAt: readString(record, ['dueAt', 'dueDate', 'deadline']),
    id,
    kind: normalizeKind(record.kind ?? record.type),
    priority: normalizePriority(record.priority),
    revision: readPositiveInteger(record.revision) || 1,
    projectId,
    sourceTitle,
    status: normalizeStatus(record.status ?? record.state),
    title: readString(record, ['title', 'name', 'summary']) || '未命名任务',
    updatedAt: readString(record, ['updatedAt', 'updated_at']) ||
      readString(record, ['createdAt', 'created_at']),
    workspaceId,
  };
}

function normalizeAgent(value: unknown): TaskAgent | null {
  const record = asRecord(value);
  const id = readString(record, ['id', 'agentId', 'userId']);
  if (!id) return null;

  const handle = readString(record, ['handle', 'username', 'slug']);
  return {
    avatarUrl: readString(record, ['avatarUrl', 'avatar', 'imageUrl']),
    handle,
    id,
    kind: readString(record, ['kind', 'type', 'role']),
    name:
      readString(record, ['name', 'displayName', 'label', 'title']) ||
      (handle ? `@${handle.replace(/^@/, '')}` : '团队成员'),
  };
}

function normalizeDocuments(
  record: Record<string, unknown>,
  context: {
    projectId: string | null;
    sourceTitle: string | null;
    workspaceId: string | null;
  }
) {
  const rawDocuments = [
    ...toArray(record.linkedDocuments),
    ...toArray(record.documents),
    ...toArray(record.links),
  ];
  const documents = rawDocuments
    .map((value, index) => normalizeDocument(value, index, context.projectId))
    .filter((item): item is TaskDocumentLink => item !== null);

  if (documents.length === 0 && context.workspaceId) {
    documents.push({
      href: buildWorkspaceHref(context.workspaceId, context.projectId),
      id: context.workspaceId,
      title: context.sourceTitle || '',
    });
  }

  return Array.from(new Map(documents.map((item) => [item.href, item])).values());
}

function normalizeDocument(
  value: unknown,
  index: number,
  fallbackProjectId: string | null
): TaskDocumentLink | null {
  if (typeof value === 'string') {
    const href = normalizeHref(value);
    return href ? { href, id: `link-${index}`, title: '' } : null;
  }

  const record = asRecord(value);
  const workspaceId = readString(record, ['workspaceId', 'documentId', 'deliverableId']);
  const projectId = readString(record, ['projectId']) || fallbackProjectId;
  const href =
    normalizeHref(readString(record, ['href', 'url', 'path'])) ||
    (workspaceId ? buildWorkspaceHref(workspaceId, projectId) : null);
  if (!href) return null;

  return {
    href,
    id: readString(record, ['id']) || workspaceId || `link-${index}`,
    title: readString(record, ['title', 'name', 'label']) || '',
  };
}

function normalizeActivities(value: unknown, taskId: string): TaskActivity[] {
  return toArray(value)
    .map((item, index) => {
      const record = asRecord(item);
      const kind = readString(record, ['kind', 'type', 'action', 'event']) || 'updated';
      const actor = asRecord(record.actor ?? record.user ?? record.agent);
      return {
        actorName:
          readString(record, ['actorName', 'userName', 'agentName']) ||
          readString(actor, ['name', 'displayName', 'handle']),
        createdAt: readString(record, ['createdAt', 'timestamp', 'occurredAt']),
        id: readString(record, ['id']) || `${taskId}-activity-${index}`,
        kind,
        label:
          readString(record, ['label', 'message', 'description', 'summary']) ||
          activityLabel(kind),
      };
    })
    .sort((left, right) =>
      String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
    );
}

function normalizeStatus(value: unknown): TaskStatus {
  const status = String(value || 'open').trim().toLowerCase().replace(/[ -]+/g, '_');
  if (status === 'claimed' || status === 'assigned') return 'claimed';
  if (status === 'in_progress' || status === 'working' || status === 'active') {
    return 'in_progress';
  }
  if (status === 'blocked' || status === 'paused') return 'blocked';
  if (status === 'review' || status === 'in_review') return 'review';
  if (status === 'done' || status === 'completed' || status === 'complete') return 'done';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  return 'open';
}

function normalizeKind(value: unknown): TaskKind {
  const kind = String(value || 'execution').trim().toLowerCase();
  return kind === 'help' || kind === 'request' || kind === 'assistance'
    ? 'help'
    : 'execution';
}

function normalizeActorType(value: unknown): TaskActorType | null {
  return value === 'agent' || value === 'user' ? value : null;
}

function normalizePriority(value: unknown): TaskPriority | null {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(numberValue)) {
    return Math.max(0, Math.min(3, Math.round(numberValue))) as TaskPriority;
  }

  const priority = String(value || '').trim().toLowerCase();
  if (priority === 'low') return 0;
  if (priority === 'medium' || priority === 'normal') return 1;
  if (priority === 'high') return 2;
  if (priority === 'urgent' || priority === 'critical') return 3;
  return null;
}

function readPositiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function readArrayEnvelope(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  const data = record.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return readArrayEnvelope(data, keys);
  return [];
}

function buildWorkspaceHref(workspaceId: string, projectId: string | null) {
  const routeId = projectId || workspaceId;
  const search = projectId && projectId !== workspaceId
    ? `?node=${encodeURIComponent(workspaceId)}`
    : '';
  return `/workspace/${encodeURIComponent(routeId)}${search}`;
}

function normalizeHref(value: string | null) {
  if (!value) return null;
  if (value.startsWith('/')) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function activityLabel(kind: string) {
  const normalized = kind.toLowerCase();
  if (normalized.includes('claim')) return '领取了任务';
  if (normalized.includes('block')) return '将任务标记为受阻';
  if (normalized.includes('review')) return '提交了评审';
  if (normalized.includes('complete') || normalized.includes('done')) return '完成了任务';
  if (normalized.includes('create')) return '创建了任务';
  return '更新了任务';
}

function compactRecord<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== '')
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}
