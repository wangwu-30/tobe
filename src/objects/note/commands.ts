import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/prisma';
import type {
  NoteData,
  NoteScope,
} from '@/types';
import { mapNote } from './schema';

type NoteDb = Prisma.TransactionClient | typeof prisma;

export async function createNote(
  input: {
    active?: boolean;
    content: string;
    createdByUserId?: string | null;
    kind: string;
    organizationId: string;
    originDeviceId?: string | null;
    scope: NoteScope;
    scopeId: string;
    source: string;
    sourceRef?: string | null;
    title?: string | null;
  },
  db: NoteDb = prisma
): Promise<NoteData> {
  const note = await db.note.create({
    data: {
      active: input.active ?? true,
      content: input.content,
      createdByUserId: input.createdByUserId || null,
      kind: input.kind,
      organizationId: input.organizationId,
      originDeviceId: input.originDeviceId || null,
      scope: input.scope,
      scopeId: input.scopeId,
      source: input.source,
      sourceRef: input.sourceRef || null,
      title: input.title?.trim() || null,
    },
  });

  return mapNote(note);
}

export async function updateNote(
  input: {
    id: string;
    active?: boolean;
    content?: string;
    kind?: string;
    organizationId: string;
    originDeviceId?: string | null;
    scope?: NoteScope;
    scopeId?: string;
    source?: string;
    sourceRef?: string | null;
    title?: string | null;
  },
  db: NoteDb = prisma
): Promise<NoteData> {
  const result = await db.note.updateMany({
    where: {
      id: input.id,
      organizationId: input.organizationId,
    },
    data: {
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(input.scopeId !== undefined ? { scopeId: input.scopeId } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
      ...(input.title !== undefined ? { title: input.title?.trim() || null } : {}),
      originDeviceId: input.originDeviceId || null,
      revision: {
        increment: 1,
      },
    },
  });

  if (result.count !== 1) {
    throw new Error('Note not found.');
  }

  const note = await db.note.findFirstOrThrow({
    where: {
      id: input.id,
      organizationId: input.organizationId,
    },
  });

  return mapNote(note);
}

export async function softDeleteNote(
  input: {
    id: string;
    organizationId: string;
  },
  db: NoteDb = prisma
) {
  await db.note.updateMany({
    where: {
      deletedAt: null,
      id: input.id,
      organizationId: input.organizationId,
    },
    data: {
      deletedAt: new Date(),
      revision: {
        increment: 1,
      },
    },
  });
}

export async function saveExtractedNotes(
  params: {
    notes: Array<{ content: string; kind: string }>;
    organizationId: string;
    scope: NoteScope;
    scopeId: string;
    sourceRef: string;
  },
  db: NoteDb = prisma
) {
  const created = await Promise.all(
    params.notes.map((note) =>
      createNote(
        {
          content: note.content,
          kind: note.kind,
          organizationId: params.organizationId,
          scope: params.scope,
          scopeId: params.scopeId,
          source: 'thread',
          sourceRef: params.sourceRef,
        },
        db
      )
    )
  );

  return created;
}
