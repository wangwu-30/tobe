import { NextRequest, NextResponse } from 'next/server';

import { ValidationError, defineRoute } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  createTeamTask,
  isTaskActorType,
  isTeamTaskKind,
  isTeamTaskStatus,
  listTeamTasks,
} from '@/objects/task';

export const GET = defineRoute(async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || undefined;
  const kind = searchParams.get('kind') || undefined;
  const assigneeType = searchParams.get('assigneeType') || undefined;

  if (status !== undefined && !isTeamTaskStatus(status)) {
    throw new ValidationError('Invalid task status.');
  }
  if (kind !== undefined && !isTeamTaskKind(kind)) {
    throw new ValidationError('Invalid task kind.');
  }
  if (assigneeType !== undefined && !isTaskActorType(assigneeType)) {
    throw new ValidationError('Invalid assignee type.');
  }

  const tasks = await listTeamTasks(actor, {
    assigneeId: readQueryText(searchParams, 'assigneeId'),
    assigneeType,
    kind,
    projectId: readQueryText(searchParams, 'projectId'),
    status,
    threadId: readQueryText(searchParams, 'threadId'),
    workspaceId: readQueryText(searchParams, 'workspaceId'),
  });

  return NextResponse.json({ tasks });
});

export const POST = defineRoute(async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body: unknown = await req.json().catch(() => ({}));
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be an object.');
  }
  const input = body as Record<string, unknown>;

  const task = await createTeamTask(actor, {
    assigneeId: readNullableString(input.assigneeId, 'assigneeId'),
    assigneeType: readNullableActorType(input.assigneeType, 'assigneeType'),
    createdById: actor.userId,
    createdByType: 'user',
    description: readNullableString(input.description, 'description'),
    dueAt: readNullableString(input.dueAt, 'dueAt'),
    kind: readOptionalKind(input.kind),
    priority: readOptionalNumber(input.priority, 'priority'),
    projectId: readNullableString(input.projectId, 'projectId'),
    threadId: readNullableString(input.threadId, 'threadId'),
    title: typeof input.title === 'string' ? input.title : '',
    workspaceId: readNullableString(input.workspaceId, 'workspaceId'),
  });

  return NextResponse.json({ task }, { status: 201 });
});

function readQueryText(params: URLSearchParams, name: string) {
  const value = params.get(name);
  return value?.trim() || undefined;
}

function readOptionalKind(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (!isTeamTaskKind(value)) {
    throw new ValidationError('Invalid task kind.');
  }
  return value;
}

function readOptionalActorType(value: unknown, field: string) {
  if (value === undefined) {
    return undefined;
  }
  if (!isTaskActorType(value)) {
    throw new ValidationError(`Invalid ${field}.`);
  }
  return value;
}

function readNullableActorType(value: unknown, field: string) {
  if (value === undefined || value === null) {
    return value;
  }
  return readOptionalActorType(value, field);
}

function readOptionalString(value: unknown, field: string) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string.`);
  }
  return value;
}

function readNullableString(value: unknown, field: string) {
  if (value === undefined || value === null) {
    return value;
  }
  return readOptionalString(value, field);
}

function readOptionalNumber(value: unknown, field: string) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number') {
    throw new ValidationError(`${field} must be a number.`);
  }
  return value;
}
