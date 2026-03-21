import { NextRequest, NextResponse } from 'next/server';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import {
  createNote,
  listNotes,
  softDeleteNote,
  updateNote,
} from '@/objects/note';
import type { NoteScope } from '@/types';

function resolveNoteScope(value: string | null): NoteScope {
  if (value === 'user' || value === 'project') {
    return value;
  }

  return 'deliverable';
}

export async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);
  const scopeId = searchParams.get('scopeId');
  const kind = searchParams.get('kind');
  const activeOnly = searchParams.get('activeOnly') === '1';

  const notes = await listNotes({
    organizationId: actor.organizationId,
    activeOnly,
    kinds: kind ? [kind] : undefined,
    scopeTargets: scopeId
      ? [{ scope: resolveNoteScope(searchParams.get('scope')), scopeId }]
      : undefined,
  });

  return NextResponse.json(notes);
}

export async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json();
  const scopeId =
    typeof body.scopeId === 'string' && body.scopeId.trim() ? body.scopeId.trim() : null;

  if (!scopeId) {
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
    scope: resolveNoteScope(typeof body.scope === 'string' ? body.scope : null),
    scopeId,
    source:
      typeof body.source === 'string' && body.source.trim() ? body.source.trim() : 'manual',
    sourceRef:
      typeof body.sourceRef === 'string' && body.sourceRef.trim() ? body.sourceRef.trim() : null,
    title: typeof body.title === 'string' ? body.title : null,
  });

  return NextResponse.json(note);
}

export async function PATCH(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const body = await req.json();
  if (!body.id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const note = await updateNote({
    id: body.id,
    ...(body.content !== undefined ? { content: body.content } : {}),
    ...(body.active !== undefined ? { active: body.active } : {}),
    ...(body.kind !== undefined ? { kind: body.kind } : {}),
    ...(body.source !== undefined ? { source: body.source } : {}),
    ...(body.sourceRef !== undefined ? { sourceRef: body.sourceRef } : {}),
    ...(body.title !== undefined ? { title: body.title } : {}),
    organizationId: actor.organizationId,
    originDeviceId: actor.deviceId,
  });

  return NextResponse.json(note);
}

export async function DELETE(req: NextRequest) {
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
}
