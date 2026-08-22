import { NextRequest, NextResponse } from 'next/server';

import { NotFoundError, ValidationError, defineRoute } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  getTeamTask,
  isTaskActorType,
  isTeamTaskKind,
  isTeamTaskStatus,
  updateTeamTask,
} from '@/objects/task';

type TaskRouteContext = { params: Promise<{ taskId: string }> };

export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: TaskRouteContext
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { taskId } = await params;
  const task = await getTeamTask(actor, taskId);
  if (!task) {
    throw new NotFoundError('Task not found.');
  }

  return NextResponse.json({ task });
});

export const PATCH = defineRoute(async function PATCH(
  req: NextRequest,
  { params }: TaskRouteContext
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { taskId } = await params;
  const body: unknown = await req.json().catch(() => ({}));
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be an object.');
  }
  const input = body as Record<string, unknown>;

  const task = await updateTeamTask(actor, taskId, {
    assigneeId: readNullableString(input, 'assigneeId'),
    assigneeType: readNullableActorType(input, 'assigneeType'),
    blockedReason: readNullableString(input, 'blockedReason'),
    description: readNullableString(input, 'description'),
    dueAt: readNullableString(input, 'dueAt'),
    expectedUpdatedAt: readString(input, 'expectedUpdatedAt'),
    expectedRevision: readNumber(input, 'expectedRevision'),
    kind: readKind(input),
    priority: readNumber(input, 'priority'),
    projectId: readNullableString(input, 'projectId'),
    status: readStatus(input),
    threadId: readNullableString(input, 'threadId'),
    title: readString(input, 'title'),
    workspaceId: readNullableString(input, 'workspaceId'),
  });

  return NextResponse.json({ task });
});

function readString(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string.`);
  }
  return value;
}

function readNullableString(input: Record<string, unknown>, field: string) {
  if (!(field in input)) {
    return undefined;
  }
  if (input[field] === null) {
    return null;
  }
  return readString(input, field);
}

function readNumber(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number') {
    throw new ValidationError(`${field} must be a number.`);
  }
  return value;
}

function readKind(input: Record<string, unknown>) {
  const value = input.kind;
  if (value === undefined) {
    return undefined;
  }
  if (!isTeamTaskKind(value)) {
    throw new ValidationError('Invalid task kind.');
  }
  return value;
}

function readStatus(input: Record<string, unknown>) {
  const value = input.status;
  if (value === undefined) {
    return undefined;
  }
  if (!isTeamTaskStatus(value)) {
    throw new ValidationError('Invalid task status.');
  }
  return value;
}

function readNullableActorType(input: Record<string, unknown>, field: string) {
  if (!(field in input)) {
    return undefined;
  }
  const value = input[field];
  if (value === null) {
    return null;
  }
  if (!isTaskActorType(value)) {
    throw new ValidationError(`Invalid ${field}.`);
  }
  return value;
}
