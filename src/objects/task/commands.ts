import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/framework/resilience/app-error';
import { isRecord } from '@/framework/resilience/safe-data';
import { prisma } from '@/lib/db/prisma';
import type {
  TaskActivityData,
  TaskActorType,
  TeamTaskData,
  TeamTaskKind,
  TeamTaskStatus,
} from '@/types';
import { getTeamTask } from './queries';
import {
  isTaskActorType,
  isTeamTaskKind,
  isTeamTaskStatus,
  isUserTaskActivityType,
  mapTaskActivity,
  mapTeamTask,
  type TaskActor,
  type UserTaskActivityType,
} from './schema';

const STATUS_TRANSITIONS: Record<TeamTaskStatus, readonly TeamTaskStatus[]> = {
  open: ['claimed', 'in_progress', 'cancelled'],
  claimed: ['open', 'in_progress', 'blocked', 'cancelled'],
  in_progress: ['blocked', 'review', 'done', 'cancelled'],
  blocked: ['claimed', 'in_progress', 'cancelled'],
  review: ['in_progress', 'done', 'cancelled'],
  done: [],
  cancelled: [],
};

export type CreateTeamTaskInput = {
  assigneeId?: string | null;
  assigneeType?: TaskActorType | null;
  createdById?: string;
  createdByType?: TaskActorType;
  description?: string | null;
  dueAt?: Date | string | null;
  kind?: TeamTaskKind;
  priority?: number;
  projectId?: string | null;
  threadId?: string | null;
  title: string;
  workspaceId?: string | null;
};

export type UpdateTeamTaskInput = {
  assigneeId?: string | null;
  assigneeType?: TaskActorType | null;
  blockedReason?: string | null;
  description?: string | null;
  dueAt?: Date | string | null;
  expectedUpdatedAt?: Date | string;
  expectedRevision?: number;
  kind?: TeamTaskKind;
  priority?: number;
  projectId?: string | null;
  status?: TeamTaskStatus;
  threadId?: string | null;
  title?: string;
  workspaceId?: string | null;
};

export type AddTaskActivityInput = {
  actorId?: string;
  actorType?: TaskActorType;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
  type: UserTaskActivityType;
};

export async function createTeamTask(
  actor: TaskActor,
  input: CreateTeamTaskInput
): Promise<TeamTaskData> {
  const title = requireText(input.title, 'Task title is required.');
  const kind = input.kind ?? 'execution';
  const createdByType = input.createdByType ?? 'user';
  const createdById = input.createdById?.trim() || actor.userId;
  const assignment = readAssignment(input.assigneeType, input.assigneeId);

  if (!isTeamTaskKind(kind)) {
    throw new ValidationError('Invalid task kind.');
  }
  if (!isTaskActorType(createdByType)) {
    throw new ValidationError('Invalid creator type.');
  }

  const priority = readPriority(input.priority);
  const dueAt = readDate(input.dueAt, 'Invalid due date.');
  const initialStatus: TeamTaskStatus = assignment.assigneeId ? 'claimed' : 'open';
  const projectId = nullableText(input.projectId);
  const threadId = nullableText(input.threadId);
  const workspaceId = nullableText(input.workspaceId);
  await Promise.all([
    validateTaskLinks(actor.organizationId, { projectId, threadId, workspaceId }),
    validateAssignee(actor.organizationId, assignment),
  ]);

  return prisma.$transaction(async (db) => {
    const task = await db.teamTask.create({
      data: {
        assigneeId: assignment.assigneeId,
        assigneeType: assignment.assigneeType,
        createdById,
        createdByType,
        description: input.description?.trim() || '',
        dueAt,
        kind,
        organizationId: actor.organizationId,
        priority,
        projectId,
        status: initialStatus,
        threadId,
        title,
        workspaceId,
      },
    });

    await db.taskActivity.create({
      data: {
        actorId: createdById,
        actorType: createdByType,
        message: `Created task: ${title}`,
        metadataJson: JSON.stringify({ kind, status: initialStatus }),
        organizationId: actor.organizationId,
        taskId: task.id,
        type: 'created',
      },
    });
    if (assignment.assigneeId && assignment.assigneeType) {
      await db.taskActivity.create({
        data: {
          actorId: createdById,
          actorType: createdByType,
          message: `Assigned task to ${assignment.assigneeId}.`,
          metadataJson: JSON.stringify({
            assigneeId: assignment.assigneeId,
            assigneeType: assignment.assigneeType,
          }),
          organizationId: actor.organizationId,
          taskId: task.id,
          type: 'assigned',
        },
      });
    }

    return mapTeamTask(
      await db.teamTask.findUniqueOrThrow({
        where: { id: task.id },
        include: {
          activities: {
            orderBy: { createdAt: 'asc' },
          },
        },
      })
    );
  });
}

export async function updateTeamTask(
  actor: TaskActor,
  taskId: string,
  input: UpdateTeamTaskInput
): Promise<TeamTaskData> {
  const existing = await getTeamTask(actor, taskId);
  if (!existing) {
    throw new NotFoundError('Task not found.');
  }
  const expectedRevision = input.expectedRevision ?? existing.revision;
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new ValidationError('Invalid expected task revision.');
  }
  if (input.expectedRevision !== undefined && input.expectedRevision !== existing.revision) {
    throw new ConflictError('Task changed while it was being updated.');
  }
  const expectedUpdatedAt = readExpectedUpdatedAt(input.expectedUpdatedAt);
  if (expectedUpdatedAt && expectedUpdatedAt.valueOf() !== new Date(existing.updatedAt).valueOf()) {
    throw new ConflictError('Task changed while it was being updated.');
  }

  const status = input.status ?? existing.status;
  if (!isTeamTaskStatus(status)) {
    throw new ValidationError('Invalid task status.');
  }
  if (status !== existing.status && !STATUS_TRANSITIONS[existing.status].includes(status)) {
    throw new ValidationError(
      `Task cannot transition from ${existing.status} to ${status}.`
    );
  }
  if (input.kind !== undefined && !isTeamTaskKind(input.kind)) {
    throw new ValidationError('Invalid task kind.');
  }

  const selfClaim =
    existing.status === 'open' &&
    status === 'claimed' &&
    input.assigneeType === undefined &&
    input.assigneeId === undefined;
  const assignment = readAssignment(
    selfClaim
      ? 'user'
      : input.assigneeType === undefined
        ? existing.assigneeType
        : input.assigneeType,
    selfClaim
      ? actor.userId
      : input.assigneeId === undefined
        ? existing.assigneeId
        : input.assigneeId
  );
  if ((status === 'claimed' || status === 'in_progress') && !assignment.assigneeId) {
    throw new ValidationError(`Task status ${status} requires an assignee.`);
  }

  const blockedReason =
    status === 'blocked'
      ? nullableText(input.blockedReason ?? existing.blockedReason)
      : null;
  if (status === 'blocked' && !blockedReason) {
    throw new ValidationError('Blocked tasks require a blocked reason.');
  }

  const title =
    input.title === undefined
      ? existing.title
      : requireText(input.title, 'Task title is required.');
  const priority =
    input.priority === undefined ? existing.priority : readPriority(input.priority);
  const dueAt =
    input.dueAt === undefined
      ? existing.dueAt
      : readDate(input.dueAt, 'Invalid due date.');
  const assignmentChanged =
    assignment.assigneeId !== existing.assigneeId ||
    assignment.assigneeType !== existing.assigneeType;
  const statusChanged = status !== existing.status;
  const projectId =
    input.projectId === undefined ? existing.projectId : nullableText(input.projectId);
  const threadId =
    input.threadId === undefined ? existing.threadId : nullableText(input.threadId);
  const workspaceId =
    input.workspaceId === undefined
      ? existing.workspaceId
      : nullableText(input.workspaceId);
  await Promise.all([
    validateTaskLinks(actor.organizationId, { projectId, threadId, workspaceId }),
    validateAssignee(actor.organizationId, assignment),
  ]);

  return prisma.$transaction(async (db) => {
    const updateResult = await db.teamTask.updateMany({
      where: {
        id: taskId,
        organizationId: actor.organizationId,
        revision: expectedRevision,
      },
      data: {
        assigneeId: assignment.assigneeId,
        assigneeType: assignment.assigneeType,
        blockedReason,
        completedAt:
          status === 'done'
            ? existing.completedAt || new Date()
            : statusChanged
              ? null
              : existing.completedAt,
        description:
          input.description === undefined
            ? existing.description
            : input.description?.trim() || '',
        dueAt,
        kind: input.kind ?? existing.kind,
        priority,
        projectId,
        revision: { increment: 1 },
        status,
        threadId,
        title,
        workspaceId,
      },
    });
    if (updateResult.count !== 1) {
      throw new ConflictError('Task changed while it was being updated.');
    }

    const activityType = statusChanged
      ? 'status_changed'
      : assignmentChanged
        ? 'assigned'
        : 'updated';
    await db.taskActivity.create({
      data: {
        actorId: actor.userId,
        actorType: 'user',
        message: statusChanged
          ? `Changed status from ${existing.status} to ${status}.`
          : assignmentChanged
            ? assignment.assigneeId
              ? `Assigned task to ${assignment.assigneeId}.`
              : 'Unassigned task.'
            : 'Updated task details.',
        metadataJson: JSON.stringify({
          ...(assignmentChanged
            ? {
                assigneeId: assignment.assigneeId,
                assigneeType: assignment.assigneeType,
              }
            : {}),
          ...(statusChanged ? { fromStatus: existing.status, toStatus: status } : {}),
        }),
        organizationId: actor.organizationId,
        taskId,
        type: activityType,
      },
    });

    return mapTeamTask(
      await db.teamTask.findUniqueOrThrow({
        where: { id: taskId },
        include: {
          activities: {
            orderBy: { createdAt: 'asc' },
          },
        },
      })
    );
  });
}

export async function addTaskActivity(
  actor: TaskActor,
  taskId: string,
  input: AddTaskActivityInput
): Promise<{ activity: TaskActivityData; task: TeamTaskData }> {
  const existing = await getTeamTask(actor, taskId);
  if (!existing) {
    throw new NotFoundError('Task not found.');
  }

  const type = requireText(input.type, 'Activity type is required.');
  if (!isUserTaskActivityType(type)) {
    throw new ValidationError('Invalid user activity type.');
  }
  const actorType = input.actorType ?? 'user';
  if (!isTaskActorType(actorType)) {
    throw new ValidationError('Invalid activity actor type.');
  }
  if (input.metadata !== undefined && input.metadata !== null && !isRecord(input.metadata)) {
    throw new ValidationError('Activity metadata must be an object.');
  }

  return prisma.$transaction(async (db) => {
    const activity = await db.taskActivity.create({
      data: {
        actorId: input.actorId?.trim() || actor.userId,
        actorType,
        message: input.message?.trim() || '',
        metadataJson: JSON.stringify(input.metadata || {}),
        organizationId: actor.organizationId,
        taskId,
        type,
      },
    });
    const task = await db.teamTask.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        activities: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return {
      activity: mapTaskActivity(activity),
      task: mapTeamTask(task),
    };
  });
}

function readAssignment(
  assigneeType: TaskActorType | null | undefined,
  assigneeId: string | null | undefined
) {
  const normalizedId = nullableText(assigneeId);
  if (!normalizedId) {
    if (assigneeType) {
      throw new ValidationError('Assignee type requires an assignee id.');
    }
    return { assigneeId: null, assigneeType: null };
  }

  if (!assigneeType || !isTaskActorType(assigneeType)) {
    throw new ValidationError('Assignee id requires a valid assignee type.');
  }

  return { assigneeId: normalizedId, assigneeType };
}

function readPriority(value: number | undefined) {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isInteger(value) || value < 0 || value > 3) {
    throw new ValidationError('Task priority must be an integer from 0 to 3.');
  }
  return value;
}

function readDate(value: Date | string | null | undefined, message: string) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new ValidationError(message);
  }
  return date;
}

function readExpectedUpdatedAt(value: Date | string | undefined) {
  if (value === undefined) {
    return null;
  }
  return readDate(value, 'Invalid expected task version.');
}

function nullableText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireText(value: unknown, message: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(message);
  }
  return value.trim();
}

async function validateTaskLinks(
  organizationId: string,
  links: {
    projectId: string | null;
    threadId: string | null;
    workspaceId: string | null;
  }
) {
  const documentIds = Array.from(
    new Set([links.projectId, links.workspaceId].filter((id): id is string => Boolean(id)))
  );
  const [documents, thread] = await Promise.all([
    documentIds.length > 0
      ? prisma.document.findMany({
          where: {
            deletedAt: null,
            id: { in: documentIds },
            organizationId,
          },
          select: { id: true },
        })
      : Promise.resolve([]),
    links.threadId
      ? prisma.commentThread.findFirst({
          where: {
            deletedAt: null,
            id: links.threadId,
            organizationId,
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  const foundDocumentIds = new Set(documents.map((document) => document.id));

  if (links.projectId && !foundDocumentIds.has(links.projectId)) {
    throw new ValidationError('Project must reference a document in the current organization.');
  }
  if (links.workspaceId && !foundDocumentIds.has(links.workspaceId)) {
    throw new ValidationError('Workspace must reference a document in the current organization.');
  }
  if (links.threadId && !thread) {
    throw new ValidationError('Thread must belong to the current organization.');
  }
}

async function validateAssignee(
  organizationId: string,
  assignment: { assigneeId: string | null; assigneeType: TaskActorType | null }
) {
  if (!assignment.assigneeId || !assignment.assigneeType) {
    return;
  }

  const assignee =
    assignment.assigneeType === 'user'
      ? await prisma.organizationMembership.findUnique({
          where: {
            organizationId_userId: {
              organizationId,
              userId: assignment.assigneeId,
            },
          },
          select: { userId: true },
        })
      : await prisma.agentProfile.findFirst({
          where: {
            enabled: true,
            id: assignment.assigneeId,
            organizationId,
          },
          select: { id: true },
        });

  if (!assignee) {
    throw new ValidationError(
      assignment.assigneeType === 'user'
        ? 'Assignee must be a member of the current organization.'
        : 'Assignee must be an enabled agent in the current organization.'
    );
  }
}
