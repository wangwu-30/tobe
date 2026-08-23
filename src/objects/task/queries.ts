import { ValidationError } from '@/framework/resilience/app-error';
import { prisma } from '@/lib/db/prisma';
import type {
  TaskActorType,
  TeamTaskData,
  TeamTaskKind,
  TeamTaskStatus,
} from '@/types';
import {
  isTaskActorType,
  isTeamTaskKind,
  isTeamTaskStatus,
  mapTeamTask,
  type TaskActor,
} from './schema';

export type TeamTaskFilters = {
  assigneeId?: string | null;
  assigneeType?: TaskActorType;
  kind?: TeamTaskKind;
  projectId?: string | null;
  status?: TeamTaskStatus;
  threadId?: string | null;
  workspaceId?: string | null;
};

export async function listTeamTasks(
  actor: Pick<TaskActor, 'organizationId'>,
  filters: TeamTaskFilters = {}
): Promise<TeamTaskData[]> {
  if (filters.status !== undefined && !isTeamTaskStatus(filters.status)) {
    throw new ValidationError('Invalid task status.');
  }
  if (filters.kind !== undefined && !isTeamTaskKind(filters.kind)) {
    throw new ValidationError('Invalid task kind.');
  }
  if (filters.assigneeType !== undefined && !isTaskActorType(filters.assigneeType)) {
    throw new ValidationError('Invalid assignee type.');
  }

  const tasks = await prisma.teamTask.findMany({
    where: {
      organizationId: actor.organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.assigneeType ? { assigneeType: filters.assigneeType } : {}),
      ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
      ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}),
      ...(filters.threadId ? { threadId: filters.threadId } : {}),
    },
    include: {
      activities: {
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: [
      { priority: 'desc' },
      { updatedAt: 'desc' },
    ],
  });

  return tasks.map(mapTeamTask);
}

export async function getTeamTask(
  actor: Pick<TaskActor, 'organizationId'>,
  taskId: string
): Promise<TeamTaskData | null> {
  const task = await prisma.teamTask.findFirst({
    where: {
      id: taskId,
      organizationId: actor.organizationId,
    },
    include: {
      activities: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  return task ? mapTeamTask(task) : null;
}
