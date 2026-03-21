import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/prisma';
import type {
  NoteData,
  NoteScope,
} from '@/types';
import {
  isKnowledgeNote,
  mapNote,
} from './schema';

type NoteDb = Prisma.TransactionClient | typeof prisma;

export type NoteScopeTarget = {
  scope: NoteScope;
  scopeId: string;
};

export function buildNoteScopeFilters(targets: NoteScopeTarget[]) {
  return targets
    .filter((target) => Boolean(target.scopeId))
    .map((target) => ({
      scope: target.scope,
      scopeId: target.scopeId,
    }));
}

export async function listNotes(
  params: {
    organizationId: string;
    activeOnly?: boolean;
    excludeKinds?: string[];
    kinds?: string[];
    scopeTargets?: NoteScopeTarget[];
    take?: number;
  },
  db: NoteDb = prisma
): Promise<NoteData[]> {
  const scopeFilters = buildNoteScopeFilters(params.scopeTargets || []);

  const notes = await db.note.findMany({
    where: {
      deletedAt: null,
      organizationId: params.organizationId,
      ...(params.activeOnly ? { active: true } : {}),
      ...(params.kinds?.length ? { kind: { in: params.kinds } } : {}),
      ...(params.excludeKinds?.length ? { kind: { notIn: params.excludeKinds } } : {}),
      ...(scopeFilters.length > 0 ? { OR: scopeFilters } : {}),
    },
    orderBy: { createdAt: 'desc' },
    ...(params.take ? { take: params.take } : {}),
  });

  return notes.map(mapNote);
}

export function splitNotesByKind(notes: NoteData[]) {
  return {
    knowledgeNotes: notes.filter((note) => isKnowledgeNote(note)),
    memoryNotes: notes.filter((note) => !isKnowledgeNote(note)),
  };
}
