import { NextRequest, NextResponse } from 'next/server';

import { ValidationError, defineRoute, isRecord } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  createKnowledgeBinding,
  listKnowledgeBindings,
  requireKnowledgeAdmin,
} from '@/objects/knowledge';

export const GET = defineRoute(async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  await requireKnowledgeAdmin(actor);
  const { searchParams } = new URL(req.url);
  const bindings = await listKnowledgeBindings(actor, {
    workspaceId: searchParams.get('workspaceId')?.trim() || undefined,
    spaceId: searchParams.get('spaceId')?.trim() || undefined,
  });
  return NextResponse.json({ bindings });
});

export const POST = defineRoute(async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  await requireKnowledgeAdmin(actor);
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) throw new ValidationError('Request body must be an object.');
  const access = body.access;
  if (access !== 'read' && access !== 'propose') {
    throw new ValidationError('access must be read or propose.');
  }
  if (body.mountPath !== undefined && body.mountPath !== '/') {
    throw new ValidationError('The local knowledge MVP only supports mountPath /.');
  }
  const binding = await createKnowledgeBinding(actor, {
    workspaceId: requiredText(body.workspaceId, 'workspaceId'),
    agentId: nullableText(body.agentId),
    spaceId: requiredText(body.spaceId, 'spaceId'),
    mountPath: '/',
    access,
  });
  return NextResponse.json({ binding }, { status: 201 });
});

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} is required.`);
  }
  return value.trim();
}

function nullableText(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new ValidationError('agentId must be a string.');
  return value.trim() || null;
}
