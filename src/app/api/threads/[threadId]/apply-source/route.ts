import { NextRequest, NextResponse } from 'next/server';

import { ValidationError, defineRoute, isRecord } from '@/framework/resilience';
import { applyCommentSourceChange } from '@/lib/comments/source-apply';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { WorkspaceLockConflictError } from '@/objects/workspace/commands';

type ApplySourceRouteContext = {
  params: Promise<{ threadId: string }>;
};

export const POST = defineRoute(async function POST(
  req: NextRequest,
  { params }: ApplySourceRouteContext
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { threadId } = await params;
  const body: unknown = await req.json().catch(() => ({}));
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object.');
  }

  try {
    const result = await applyCommentSourceChange(actor, {
      expectedFileRevision: readPositiveRevision(body, 'expectedFileRevision'),
      expectedThreadRevision: readPositiveRevision(body, 'expectedThreadRevision'),
      expectedWorkspaceRevision: readPositiveRevision(
        body,
        'expectedWorkspaceRevision'
      ),
      fileId: readRequiredString(body, 'fileId'),
      nextContent: readString(body, 'nextContent'),
      threadId,
      workspaceId: readRequiredString(body, 'workspaceId'),
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WorkspaceLockConflictError) {
      return NextResponse.json(
        { error: error.message, lock: error.detail },
        { status: 423 }
      );
    }
    throw error;
  }
});

function readPositiveRevision(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ValidationError(`${field} must be a positive integer.`);
  }
  return value as number;
}

function readRequiredString(input: Record<string, unknown>, field: string) {
  const value = readString(input, field);
  if (!value.trim()) {
    throw new ValidationError(`${field} is required.`);
  }
  return value;
}

function readString(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string.`);
  }
  return value;
}
