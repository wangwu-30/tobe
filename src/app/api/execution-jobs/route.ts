import { NextRequest, NextResponse } from 'next/server';

import {
  ValidationError,
  defineRoute,
  isRecord,
} from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  EXECUTION_JOB_IDEMPOTENCY_HEADER,
  createExecutionJob,
  isExecutionJobStatusV1,
  listExecutionJobs,
  parseExecutionSpecV1,
} from '@/objects/execution-job';
import type { RuntimeSelectionStrategyV1 } from '@/agent/execution';

const SERVER_OWNED_FIELDS = [
  'contextManifest',
  'organizationPolicy',
  'agentPreference',
  'originRoomId',
  'originRoomMessageId',
] as const;
const MAX_EXECUTION_JOB_SEARCH_LENGTH = 200;

export const GET = defineRoute(async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || undefined;
  if (status !== undefined && !isExecutionJobStatusV1(status)) {
    throw new ValidationError('Invalid execution job status.');
  }
  const kind = readKind(searchParams.get('kind'));
  const search = readSearch(searchParams.get('q'));
  const jobs = await listExecutionJobs(actor, {
    cursor: searchParams.get('cursor'),
    kind,
    limit: readQueryInteger(searchParams, 'limit'),
    search,
    status,
    teamTaskId: searchParams.get('teamTaskId'),
  });
  return NextResponse.json({ schemaVersion: 1, ...jobs });
});

export const POST = defineRoute(async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object.');
  }
  const serverOwnedField = SERVER_OWNED_FIELDS.find((field) =>
    Object.prototype.hasOwnProperty.call(body, field)
  );
  if (serverOwnedField) {
    throw new ValidationError(
      `${serverOwnedField} is server-owned and cannot be submitted.`
    );
  }

  const goal = readRequiredText(body.goal, 'goal');
  const spec = readSpec(body, goal);
  const strategy = readStrategy(body.strategy ?? body.runtimeSelection);
  const idempotencyKey =
    req.headers.get(EXECUTION_JOB_IDEMPOTENCY_HEADER)?.trim() ||
    req.headers.get('x-idempotency-key')?.trim() ||
    req.headers.get('idempotency-key')?.trim() ||
    null;

  const receipt = await createExecutionJob(
    actor,
    {
      goal,
      spec,
      strategy,
      teamTaskId: readNullableText(body.teamTaskId, 'teamTaskId'),
      priority: readOptionalNumber(body.priority, 'priority'),
      maxAttempts: readOptionalNumber(body.maxAttempts, 'maxAttempts'),
      deadlineAt: readNullableText(body.deadlineAt, 'deadlineAt'),
      workspaceId: readRequiredText(body.workspaceId, 'workspaceId'),
      projectId: readNullableText(body.projectId, 'projectId'),
      documentVersionId: readNullableText(
        body.documentVersionId,
        'documentVersionId'
      ),
      conversationId: readNullableText(body.conversationId, 'conversationId'),
    },
    { idempotencyKey }
  );

  return NextResponse.json(
    { schemaVersion: 1, receipt },
    { status: 202 }
  );
});

function readSpec(body: Record<string, unknown>, goal: string) {
  if (body.spec !== undefined) {
    if (!isRecord(body.spec)) {
      throw new ValidationError('Execution spec must be an object.');
    }
    if (
      body.spec.goal !== undefined &&
      readRequiredText(body.spec.goal, 'spec.goal') !== goal
    ) {
      throw new ValidationError('spec.goal must match the top-level goal.');
    }
    return parseExecutionSpecV1({ ...body.spec, goal });
  }

  // A small compatibility adapter for the UI's initial flat command shape.
  return parseExecutionSpecV1({
    schemaVersion: body.schemaVersion ?? 1,
    goal,
    kind: body.kind,
    model: body.model,
    requirements: body.requirements ?? {},
  });
}

function readStrategy(value: unknown): RuntimeSelectionStrategyV1 | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new ValidationError('Runtime selection strategy must be an object.');
  }
  if (value.mode === 'auto') return { mode: 'auto' };
  if (value.mode === 'explicit' && typeof value.runtimeId === 'string') {
    return { mode: 'explicit', runtimeId: value.runtimeId };
  }
  throw new ValidationError('Invalid runtime selection strategy.');
}

function readNullableText(value: unknown, field: string) {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string or null.`);
  }
  return value;
}

function readRequiredText(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function readOptionalNumber(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== 'number') {
    throw new ValidationError(`${field} must be a number.`);
  }
  return value;
}

function readQueryInteger(params: URLSearchParams, field: string) {
  const value = params.get(field);
  if (value === null || value === '') return undefined;
  if (!/^\d+$/.test(value)) {
    throw new ValidationError(`${field} must be an integer.`);
  }
  return Number(value);
}

function readKind(value: string | null) {
  if (!value) return undefined;
  if (
    value !== 'coding' &&
    value !== 'research' &&
    value !== 'browser' &&
    value !== 'document' &&
    value !== 'workflow'
  ) {
    throw new ValidationError('Invalid execution job kind.');
  }
  return value;
}

function readSearch(value: string | null) {
  if (value === null) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > MAX_EXECUTION_JOB_SEARCH_LENGTH) {
    throw new ValidationError(
      `q must be no longer than ${MAX_EXECUTION_JOB_SEARCH_LENGTH} characters.`
    );
  }
  return normalized;
}
