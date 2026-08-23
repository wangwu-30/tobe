import { NextRequest, NextResponse } from 'next/server';

import { LocalGitKnowledgeBaseResolver } from '@/agent/knowledge';
import { ValidationError, defineRoute, isRecord } from '@/framework/resilience';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  createKnowledgeSpace,
  listKnowledgeSpaces,
  requireKnowledgeAdmin,
} from '@/objects/knowledge';

export const GET = defineRoute(async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  await requireKnowledgeAdmin(actor);
  const spaces = await listKnowledgeSpaces(actor);
  return NextResponse.json({ spaces });
});

export const POST = defineRoute(async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  await requireKnowledgeAdmin(actor);
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) throw new ValidationError('Request body must be an object.');
  const scope = body.scope;
  if (scope !== 'team' && scope !== 'agent') {
    throw new ValidationError('scope must be team or agent.');
  }
  const repoPath = requiredText(body.repoPath, 'repoPath');
  const defaultBranch = optionalText(body.defaultBranch) ?? 'main';
  try {
    await new LocalGitKnowledgeBaseResolver().resolve({ repoPath, defaultBranch });
  } catch {
    throw new ValidationError(
      'repoPath must be a local Git repository root containing defaultBranch.'
    );
  }
  const space = await createKnowledgeSpace(actor, {
    scope,
    ownerAgentId: nullableText(body.ownerAgentId),
    repoPath,
    defaultBranch,
    readPolicy: optionalText(body.readPolicy) ?? (scope === 'team' ? 'team' : 'owner'),
    writePolicy: 'review-only',
  });
  return NextResponse.json({ space }, { status: 201 });
});

function requiredText(value: unknown, field: string): string {
  const text = optionalText(value);
  if (!text) throw new ValidationError(`${field} is required.`);
  return text;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ValidationError('Text fields must be strings.');
  return value.trim() || undefined;
}

function nullableText(value: unknown): string | null {
  return optionalText(value) ?? null;
}
