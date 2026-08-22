import { NextRequest, NextResponse } from 'next/server';

import { ValidationError, defineRoute, isRecord } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { addTaskActivity, isUserTaskActivityType } from '@/objects/task';

export const POST = defineRoute(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { taskId } = await params;
  const body: unknown = await req.json().catch(() => ({}));
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object.');
  }

  const type = typeof body.type === 'string' ? body.type : body.kind;
  const message = typeof body.message === 'string' ? body.message : body.content;
  if (!isUserTaskActivityType(type)) {
    throw new ValidationError(
      'Activity type must be one of: comment, handoff, delivery.'
    );
  }
  if (message !== undefined && message !== null && typeof message !== 'string') {
    throw new ValidationError('Activity message must be a string.');
  }
  if (body.metadata !== undefined && body.metadata !== null && !isRecord(body.metadata)) {
    throw new ValidationError('Activity metadata must be an object.');
  }

  const result = await addTaskActivity(actor, taskId, {
    actorId: actor.userId,
    actorType: 'user',
    message: message ?? null,
    metadata: body.metadata ?? null,
    type,
  });

  return NextResponse.json(result, { status: 201 });
});
