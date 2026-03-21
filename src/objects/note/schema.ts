import type {
  NoteData,
  NoteScope,
} from '@/types';

type NoteRecord = {
  id: string;
  organizationId: string;
  scope: string;
  scopeId: string;
  kind: string;
  title: string | null;
  content: string;
  source: string;
  sourceRef: string | null;
  active: boolean;
  createdByUserId: string | null;
  originDeviceId: string | null;
  revision: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function normalizeNoteScope(scope: string): NoteScope {
  if (scope === 'user' || scope === 'project') {
    return scope;
  }

  return 'deliverable';
}

export function mapNote(note: NoteRecord): NoteData {
  return {
    id: note.id,
    organizationId: note.organizationId,
    scope: normalizeNoteScope(note.scope),
    scopeId: note.scopeId,
    kind: note.kind,
    title: note.title,
    content: note.content,
    source: note.source,
    sourceRef: note.sourceRef,
    active: note.active,
    createdByUserId: note.createdByUserId,
    originDeviceId: note.originDeviceId,
    revision: note.revision,
    deletedAt: note.deletedAt,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

export function isKnowledgeNote(note: Pick<NoteData, 'kind'>) {
  return note.kind === 'knowledge';
}
