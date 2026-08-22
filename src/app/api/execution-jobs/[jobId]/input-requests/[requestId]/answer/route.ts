import { NextRequest, NextResponse } from 'next/server';

import { ValidationError, defineRoute, isRecord } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { answerExecutionInputRequest } from '@/objects/execution-job';

type RouteContext = {
  params: Promise<{ jobId: string; requestId: string }>;
};

export const POST = defineRoute(async function POST(
  req: NextRequest,
  { params }: RouteContext
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { jobId, requestId } = await params;
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object.');
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'response')) {
    throw new ValidationError('response is required.');
  }
  const result = await answerExecutionInputRequest(actor, jobId, requestId, {
    expectedInputRevision: body.expectedInputRevision as number,
    expectedJobRevision: body.expectedJobRevision as number,
    responseId:
      (typeof body.responseId === 'string' && body.responseId.trim()) ||
      req.headers.get('x-dao-idempotency-key')?.trim() ||
      req.headers.get('x-idempotency-key')?.trim() ||
      req.headers.get('idempotency-key')?.trim() ||
      undefined,
    response: body.response as never,
  });
  return NextResponse.json(result);
});
