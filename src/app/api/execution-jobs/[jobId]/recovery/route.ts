import { NextRequest, NextResponse } from 'next/server';

import { ValidationError, defineRoute, isRecord } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  inspectExecutionRecoveryIncidents,
  isExecutionRecoveryActionV1,
  requestExecutionRecoveryAction,
} from '@/objects/execution-recovery';

type RouteContext = { params: Promise<{ jobId: string }> };

export const GET = defineRoute(async function GET(
  req: NextRequest,
  { params }: RouteContext
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { jobId } = await params;
  const recovery = await inspectExecutionRecoveryIncidents(actor, jobId);
  return NextResponse.json({ schemaVersion: 1, recovery });
});

export const POST = defineRoute(async function POST(
  req: NextRequest,
  { params }: RouteContext
) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be an object.');
  }
  if (!isExecutionRecoveryActionV1(body.action)) {
    throw new ValidationError('action must be retry or discard.');
  }
  if (typeof body.incidentId !== 'string' || !body.incidentId.trim()) {
    throw new ValidationError('incidentId is required.');
  }
  if (!Number.isInteger(body.expectedRevision)) {
    throw new ValidationError('expectedRevision must be an integer.');
  }
  const { jobId } = await params;
  const incident = await requestExecutionRecoveryAction(actor, jobId, {
    incidentId: body.incidentId.trim(),
    action: body.action,
    expectedRevision: body.expectedRevision as number,
  });
  return NextResponse.json({ schemaVersion: 1, incident });
});
