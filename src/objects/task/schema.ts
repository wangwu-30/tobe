import { isRecord, safeJsonParse } from '@/framework/resilience/safe-data';
import type {
  AgentProfileData,
  TaskActivityData,
  TaskActorType,
  TeamTaskData,
  TeamTaskKind,
  TeamTaskPriority,
  TeamTaskStatus,
} from '@/types';

export const TEAM_TASK_KINDS = ['execution', 'help'] as const;
export const TEAM_TASK_STATUSES = [
  'open',
  'claimed',
  'in_progress',
  'blocked',
  'review',
  'done',
  'cancelled',
] as const;
export const TASK_ACTOR_TYPES = ['user', 'agent'] as const;
export const USER_TASK_ACTIVITY_TYPES = ['comment', 'handoff', 'delivery'] as const;
export type UserTaskActivityType = (typeof USER_TASK_ACTIVITY_TYPES)[number];

export type TaskActor = {
  deviceId?: string;
  organizationId: string;
  userId: string;
};

type TaskActivityRecord = {
  actorId: string;
  actorType: string;
  createdAt: Date;
  id: string;
  message: string;
  metadataJson: string;
  taskId: string;
  type: string;
};

type TeamTaskRecord = {
  activities?: TaskActivityRecord[];
  assigneeId: string | null;
  assigneeType: string | null;
  blockedReason: string | null;
  completedAt: Date | null;
  createdAt: Date;
  createdById: string;
  createdByType: string;
  description: string;
  dueAt: Date | null;
  id: string;
  kind: string;
  organizationId: string;
  priority: number;
  projectId: string | null;
  revision: number;
  status: string;
  threadId: string | null;
  title: string;
  updatedAt: Date;
  workspaceId: string | null;
};

type AgentProfileRecord = {
  builtin: boolean;
  createdAt: Date;
  description: string;
  enabled: boolean;
  handle: string;
  id: string;
  name: string;
  organizationId: string;
  skillsJson: string;
  updatedAt: Date;
};

export function isTeamTaskKind(value: unknown): value is TeamTaskKind {
  return TEAM_TASK_KINDS.some((kind) => kind === value);
}

export function isTeamTaskStatus(value: unknown): value is TeamTaskStatus {
  return TEAM_TASK_STATUSES.some((status) => status === value);
}

export function isTaskActorType(value: unknown): value is TaskActorType {
  return TASK_ACTOR_TYPES.some((actorType) => actorType === value);
}

export function isUserTaskActivityType(
  value: unknown
): value is UserTaskActivityType {
  return USER_TASK_ACTIVITY_TYPES.some((activityType) => activityType === value);
}

export function mapTaskActivity(activity: TaskActivityRecord): TaskActivityData {
  const metadata = safeJsonParse<unknown>(activity.metadataJson, {});

  return {
    actorId: activity.actorId,
    actorType: isTaskActorType(activity.actorType) ? activity.actorType : 'user',
    createdAt: activity.createdAt,
    id: activity.id,
    message: activity.message,
    metadata: isRecord(metadata) ? metadata : {},
    taskId: activity.taskId,
    type: activity.type,
  };
}

export function mapTeamTask(task: TeamTaskRecord): TeamTaskData {
  return {
    activities: (task.activities || []).map(mapTaskActivity),
    assigneeId: task.assigneeId,
    assigneeType:
      task.assigneeType && isTaskActorType(task.assigneeType)
        ? task.assigneeType
        : null,
    blockedReason: task.blockedReason,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    createdById: task.createdById,
    createdByType: isTaskActorType(task.createdByType)
      ? task.createdByType
      : 'user',
    description: task.description,
    dueAt: task.dueAt,
    id: task.id,
    kind: isTeamTaskKind(task.kind) ? task.kind : 'execution',
    organizationId: task.organizationId,
    priority: normalizeTeamTaskPriority(task.priority),
    projectId: task.projectId,
    revision: task.revision,
    status: isTeamTaskStatus(task.status) ? task.status : 'open',
    threadId: task.threadId,
    title: task.title,
    updatedAt: task.updatedAt,
    workspaceId: task.workspaceId,
  };
}

export function mapAgentProfile(agent: AgentProfileRecord): AgentProfileData {
  const skills = safeJsonParse<unknown>(agent.skillsJson, []);

  return {
    builtin: agent.builtin,
    createdAt: agent.createdAt,
    description: agent.description,
    enabled: agent.enabled,
    handle: agent.handle,
    id: agent.id,
    name: agent.name,
    organizationId: agent.organizationId,
    skills: Array.isArray(skills)
      ? skills.filter((skill): skill is string => typeof skill === 'string')
      : [],
    updatedAt: agent.updatedAt,
  };
}

function normalizeTeamTaskPriority(priority: number): TeamTaskPriority {
  return priority === 1 || priority === 2 || priority === 3 ? priority : 0;
}
