import type { NoteData } from '@/types';

export const STUDIO_CONTEXT_BUDGET_V1 = {
  chat: {
    maxKnowledgeNotesChars: 4_000,
    maxKnowledgeNotesItems: 16,
    maxMemoriesChars: 3_000,
    maxMemoriesItems: 16,
    maxPlaybookChars: 4_000,
  },
  comment: {
    maxKnowledgeNotesChars: 2_500,
    maxKnowledgeNotesItems: 12,
    maxMemoriesChars: 2_000,
    maxMemoriesItems: 12,
    maxWikiChars: 16_000,
  },
  noteQueryTakeLimit: 64,
  suggestion: {
    maxMemoriesChars: 2_000,
    maxMemoriesItems: 12,
    maxWikiChars: 16_000,
  },
} as const;

const TRUNCATION_SUFFIX = ' [...truncated]';
const MIN_TRUNCATED_LINE_CHARS = 48;

export type BoundedNoteSelectionResult = {
  includedCount: number;
  lines: string[];
  omissionNotice: string | null;
  omittedCount: number;
  truncatedCount: number;
  usedChars: number;
};

export type BoundedTextResult = {
  content: string;
  originalLength: number;
  truncated: boolean;
};

export function resolveStudioNotePriority(
  note: Pick<NoteData, 'scope' | 'scopeId'>,
  params: {
    projectId?: string | null;
    workspaceId?: string | null;
  }
): number {
  if (
    note.scope === 'deliverable' &&
    params.workspaceId &&
    note.scopeId === params.workspaceId
  ) {
    return 0;
  }
  if (
    note.scope === 'project' &&
    params.projectId &&
    note.scopeId === params.projectId
  ) {
    return 1;
  }
  if (note.scope === 'user') {
    return 2;
  }
  return 3;
}

export function selectBoundedNoteLines<
  T extends Pick<NoteData, 'scope' | 'scopeId'>,
>(params: {
  formatLine: (note: T) => string;
  label: string;
  maxChars: number;
  maxItems: number;
  notes: readonly T[];
  projectId?: string | null;
  workspaceId?: string | null;
}): BoundedNoteSelectionResult {
  const { formatLine, label, maxChars, maxItems, notes, projectId, workspaceId } =
    params;
  if (notes.length === 0 || maxChars <= 0 || maxItems <= 0) {
    return {
      includedCount: 0,
      lines: [],
      omissionNotice:
        notes.length > 0
          ? `... (${notes.length} active ${label} omitted due to context budget)`
          : null,
      omittedCount: notes.length,
      truncatedCount: 0,
      usedChars: 0,
    };
  }

  // Stable priority sort: deliverable (current) -> project -> user -> other.
  const prioritized = notes
    .map((note, index) => ({
      index,
      note,
      priority: resolveStudioNotePriority(note, { projectId, workspaceId }),
    }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index);

  const lines: string[] = [];
  let usedChars = 0;
  let truncatedCount = 0;

  for (const { note } of prioritized) {
    if (lines.length >= maxItems) {
      break;
    }
    const rendered = formatLine(note);
    const separatorChars = lines.length > 0 ? 1 : 0;
    const remaining = maxChars - usedChars - separatorChars;
    if (remaining <= 0) {
      break;
    }

    if (rendered.length <= remaining) {
      lines.push(rendered);
      usedChars += separatorChars + rendered.length;
      continue;
    }

    if (remaining >= MIN_TRUNCATED_LINE_CHARS) {
      const sliceLength = Math.max(1, remaining - TRUNCATION_SUFFIX.length);
      const clipped = `${rendered.slice(0, sliceLength).trimEnd()}${TRUNCATION_SUFFIX}`;
      lines.push(clipped);
      usedChars += separatorChars + clipped.length;
      truncatedCount += 1;
    }
    break;
  }

  const includedCount = lines.length;
  const omittedCount = Math.max(0, prioritized.length - includedCount);
  const omissionNotice =
    omittedCount > 0
      ? `... (${omittedCount} additional active ${label} omitted due to context budget)`
      : null;

  return {
    includedCount,
    lines,
    omissionNotice,
    omittedCount,
    truncatedCount,
    usedChars,
  };
}

export function truncateBoundedText(
  value: string,
  maxChars: number,
  options: { anchorText?: string | null } = {}
): BoundedTextResult {
  if (value.length <= maxChars) {
    return {
      content: value,
      originalLength: value.length,
      truncated: false,
    };
  }

  const anchor = options.anchorText?.trim();
  const anchorIndex = anchor ? value.indexOf(anchor) : -1;

  if (anchorIndex >= 0 && maxChars > 200) {
    const markerBudget = 44;
    const windowSize = Math.max(anchor!.length, maxChars - markerBudget);
    const halfBefore = Math.floor((windowSize - anchor!.length) / 2);
    const start = Math.max(
      0,
      Math.min(value.length - windowSize, anchorIndex - Math.max(0, halfBefore))
    );
    const end = Math.min(value.length, start + windowSize);
    const prefix = start > 0 ? '[...earlier content omitted]\n' : '';
    const suffix = end < value.length ? '\n[...later content omitted]' : '';
    return {
      content: `${prefix}${value.slice(start, end)}${suffix}`,
      originalLength: value.length,
      truncated: true,
    };
  }

  const suffix = '\n[...content truncated due to context budget]';
  const keepChars = Math.max(1, maxChars - suffix.length);
  return {
    content: `${value.slice(0, keepChars).trimEnd()}${suffix}`,
    originalLength: value.length,
    truncated: true,
  };
}
