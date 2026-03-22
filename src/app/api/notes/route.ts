import { NextRequest, NextResponse } from 'next/server';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  createNote,
  listNotes,
  softDeleteNote,
  updateNote,
} from '@/objects/note';
import type { NoteScope } from '@/types';
import { defineRoute } from '@/framework/resilience';


function resolveNoteScope(value: string | null): NoteScope {
  if (value === 'user' || value === 'project') {
    return value;
  }

  return 'deliverable';
}

function resolveNoteScopeTarget(params: {
  actorUserId: string;
  scope: string | null;
  scopeId: string | null;
}) {
  if (!params.scope) {
    return null;
  }

  const scope = resolveNoteScope(params.scope);
  if (scope === 'user') {
    return {
      scope,
      scopeId: params.scopeId?.trim() || params.actorUserId,
    };
  }

  const scopeId = params.scopeId?.trim();
  if (!scopeId) {
    return null;
  }

  return {
    scope,
    scopeId,
  };
}

export const GET = defineRoute(async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);
  const scopeId = searchParams.get('scopeId');
  const scope = searchParams.get('scope') || (scopeId ? 'deliverable' : null);
  const kind = searchParams.get('kind');
  const activeOnly = searchParams.get('activeOnly') === '1';
  const scopeTarget = resolveNoteScopeTarget({
    actorUserId: actor.userId,
    scope,
    scopeId,
  });

  if (scope && !scopeTarget) {
    return NextResponse.json([]);
  }

  const notes = await listNotes({
    organizationId: actor.organizationId,
    activeOnly,
    kinds: kind ? [kind] : undefined,
    scopeTargets: scopeTarget ? [scopeTarget] : undefined,
  });

  return NextResponse.json(notes);
});

export const POST = defineRoute(async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json();
  const scopeTarget = resolveNoteScopeTarget({
    actorUserId: actor.userId,
    scope:
      typeof body.scope === 'string'
        ? body.scope
        : typeof body.scopeId === 'string' && body.scopeId.trim()
          ? 'deliverable'
          : null,
    scopeId: typeof body.scopeId === 'string' ? body.scopeId : null,
  });

  if (!scopeTarget) {
    return NextResponse.json({ error: 'Missing scopeId' }, { status: 400 });
  }

  const note = await createNote({
    active: body.active ?? true,
    content: body.content,
    createdByUserId: actor.userId,
    kind:
      typeof body.kind === 'string' && body.kind.trim() ? body.kind.trim() : 'knowledge',
    organizationId: actor.organizationId,
    originDeviceId: actor.deviceId,
    scope: scopeTarget.scope,
    scopeId: scopeTarget.scopeId,
    source:
      typeof body.source === 'string' && body.source.trim() ? body.source.trim() : 'manual',
    sourceRef:
      typeof body.sourceRef === 'string' && body.sourceRef.trim() ? body.sourceRef.trim() : null,
    title: typeof body.title === 'string' ? body.title : null,
  });

  return NextResponse.json(note);
});

export const PATCH = defineRoute(async function PATCH(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json();
  if (!body.id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  let scopeUpdate:
    | {
        scope: NoteScope;
        scopeId: string;
      }
    | null
    | undefined;
  if (body.scope !== undefined || body.scopeId !== undefined) {
    scopeUpdate = resolveNoteScopeTarget({
      actorUserId: actor.userId,
      scope:
        typeof body.scope === 'string'
          ? body.scope
          : typeof body.scopeId === 'string' && body.scopeId.trim()
            ? 'deliverable'
            : null,
      scopeId: typeof body.scopeId === 'string' ? body.scopeId : null,
    });

    if (!scopeUpdate) {
      return NextResponse.json({ error: 'Missing scopeId' }, { status: 400 });
    }
  }

  const note = await updateNote({
    id: body.id,
    ...(body.content !== undefined ? { content: body.content } : {}),
    ...(body.active !== undefined ? { active: body.active } : {}),
    ...(body.kind !== undefined ? { kind: body.kind } : {}),
    ...(scopeUpdate ? { scope: scopeUpdate.scope, scopeId: scopeUpdate.scopeId } : {}),
    ...(body.source !== undefined ? { source: body.source } : {}),
    ...(body.sourceRef !== undefined ? { sourceRef: body.sourceRef } : {}),
    ...(body.title !== undefined ? { title: body.title } : {}),
    organizationId: actor.organizationId,
    originDeviceId: actor.deviceId,
  });

  return NextResponse.json(note);
});

export const DELETE = defineRoute(async function DELETE(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  await softDeleteNote({
    id,
    organizationId: actor.organizationId,
  });

  return NextResponse.json({ ok: true });
});
